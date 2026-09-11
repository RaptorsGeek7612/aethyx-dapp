# Audit de sécurité — Invest'Or Gateway

**Date** : 11 septembre 2026
**Périmètre** : les 23 fichiers de `backend/contracts/`, à `c6c1f48`
**Nature** : revue interne par lecture de code, non une attestation par un tiers indépendant
**Déploiement examiné** : Sepolia, `VaultManager` `0x63C5bACc…6b53`

## Synthèse

| # | Constat | Sévérité | Statut sur Sepolia |
|---|---|---|---|
| 1 | Le blocage immobilier se contourne par auto-transfert | **Élevée** | **Corrigé** — non redéployé |
| 2 | Frais réglables jusqu'à 100 % | **Moyenne** | Latent (frais à 0) |
| 3 | Rachat de poussière : destruction sans contrepartie | **Faible** | Latent (sous-jacents en 18 décimales) |
| 4 | `getPrice` revert sur horodatage futur, hors `try/catch` | **Faible** | Latent |
| 5 | Valeur de retour de `transferFrom` ignorée | **Faible** | Non exploitable en l'état |
| 6 | `registerAsset` ne vérifie pas la cohérence de l'`assetId` | **Faible** | Non exploitable en l'état |

Aucun constat critique. Le constat 1 invalidait une propriété que le protocole annonce ; il a été
corrigé dans le code après cette revue (voir sa section). **Le marché déployé sur Sepolia porte
encore l'adaptateur vulnérable** : la correction n'entrera en vigueur qu'au prochain déploiement.

---

## 1. Le blocage immobilier se contourne par auto-transfert — **Élevée** · corrigé

**Localisation** : `RealEstateAdapter.sol`, `withdraw`

```solidity
if (lockedAmount[to] > 0 && normalizedAmount > matured) {
    revert StillLocked(to, normalizedAmount, matured, nextUnlockAt(to));
}
```

**Description.** Le blocage est indexé sur l'adresse qui *rachète*, pas sur les tokens. Un
détenteur dont `lockedAmount` vaut zéro n'est soumis à aucune restriction. Or les tokens wrappés
sont des ERC-20 librement transférables : il suffit à un déposant d'envoyer ses RLD à une seconde
adresse qu'il contrôle pour que cette adresse rachète immédiatement, sans aucune attente.

**Scénario d'exploitation.** Trois transactions, sans compétence particulière :

1. Alice dépose 100 tRE → reçoit 100 RLD ; `lockedAmount[Alice] = 100`, échéance à 30 jours.
2. Alice transfère ses 100 RLD vers `Alice2`, une adresse qu'elle contrôle.
3. `Alice2` rachète les 100 RLD : `lockedAmount[Alice2] == 0`, la condition est fausse, aucun
   revert. Le sous-jacent sort de l'adaptateur le jour même.

Ce n'est pas une hypothèse : le test `test/RealEstateAdapter.ts:157`, « never locks a holder who
acquired the wrapped token on the secondary market », exécute exactement cette séquence et
**assertit qu'elle réussit**. L'exemption pensée pour l'acheteur de marché secondaire est
indistinguable d'un auto-transfert, parce que rien on-chain ne sépare les deux.

**Conséquence.** La durée de détention n'est pas une garantie, c'est une convention que seul un
déposant non averti respecte. Toute la justification du mécanisme — laisser au règlement
immobilier le temps réel qu'il exige — ne tient plus dès qu'un déposant ajoute une transaction.

**Recommandation.** Il faut choisir entre deux propriétés incompatibles : « le blocage est
contraignant » et « le token wrappé est librement transférable sans traîner son blocage ». Trois
directions possibles :

- **Bloquer les tokens, pas les adresses.** Empêcher le transfert des RLD non échus (un hook
  `_update` sur le token wrappé qui consulte l'adaptateur). Le blocage devient réel, au prix de la
  libre transférabilité — ce qui affaiblit l'intérêt même du wrap.
- **Représenter la position bloquée par un actif non fongible** (un reçu ERC-721 par dépôt) et
  n'émettre le RLD fongible qu'à l'échéance. Le blocage devient inviolable et le RLD reste
  entièrement libre, au prix d'un modèle plus lourd.
- **Assumer et documenter.** Si la libre transférabilité prime, alors il faut cesser de présenter
  la durée comme une contrainte de sécurité et la décrire pour ce qu'elle est : une friction par
  défaut, contournable. C'est le choix le moins coûteux, mais il doit être explicite dans
  l'interface comme dans la documentation.

**Correction retenue.** Aucune des trois directions ci-dessus n'a été suivie telle quelle : la
première sacrifie la libre transférabilité, qui est la raison d'être du protocole, et la deuxième
rouvre le problème de signature partagée qui avait déjà fait écarter un paramètre par dépôt.

La bonne question n'est pas « qui a le droit de racheter » mais « à quelle vitesse le collatéral
peut sortir » — c'est le règlement immobilier qui prend du temps, pas la personne. Le blocage est
donc désormais **un échéancier global au marché** : chaque dépôt alimente une réserve commune qui
mûrit après `lockupPeriod`, et tout rachat puise dans la part déjà mûre, quel qu'en soit l'auteur.

L'auto-transfert ne contourne plus rien : la seconde adresse puise dans la même réserve. Et le
token wrappé reste intégralement transférable — seule sa conversion en sous-jacent est cadencée.

Conséquences :

- Les vues perdent leur paramètre d'adresse : `lockedAmountNow()`, `maturedAmountNow()`,
  `nextUnlockAt()`, `lockSchedule()`. Les anciennes signatures disparaissent plutôt que de changer
  de sens en silence, afin qu'un appelant resté sur l'ancienne ABI échoue franchement.
- Un acheteur de marché secondaire attend désormais la maturité du marché. C'est la situation
  économiquement honnête : le collatéral n'est réellement pas liquide avant, et le calendrier est
  lisible on-chain avant tout achat.
- Le test `test/RealEstateAdapter.ts` qui assertissait la réussite du contournement a été remplacé
  par deux tests : l'un vérifie que l'auto-transfert échoue puis réussit après maturité, l'autre
  que le token wrappé reste transférable pendant le blocage.

**Non déployé.** L'adaptateur en place sur Sepolia (`0x36b88A2b…C69B`) reste celui d'avant
correction. Fermer la faille exige un nouveau déploiement sous un nouvel `assetId`, `registerAsset`
refusant de repointer un identifiant existant.

---

## 2. Frais réglables jusqu'à 100 % — **Moyenne**

**Localisation** : `VaultManager.sol`, `_validateFees`

```solidity
if (depositFeeBps > BPS_DENOMINATOR) revert FeeTooHigh(depositFeeBps);
```

**Description.** La borne est stricte au-delà de 10 000 bps, donc 10 000 bps — soit 100 % — est
accepté. `setAssetFees` est ouvert à `ASSET_MANAGER_ROLE`.

**Scénario.** Le détenteur d'`ASSET_MANAGER_ROLE`, compromis ou malveillant, porte
`redeemFeeBps` à 10 000. Au rachat suivant : `feeAmount = wrappedAmount`, `netAmount = 0`. La
totalité des tokens du racheteur part au Treasury, `burnFrom` brûle zéro, `withdraw` libère zéro.
L'utilisateur perd l'intégralité de sa position en une transaction, sans erreur. Le même
raisonnement vaut sur `depositFeeBps` : tout le dépôt est émis au Treasury, le déposant reçoit
zéro.

Aucune temporisation, aucun plafond, aucun événement préalable ne sépare la décision de son effet.

**Recommandation.** Plafonner les frais à une valeur défendable — quelques centaines de points de
base — directement dans `_validateFees`, borne incluse. Un plafond dans le code vaut mieux qu'un
plafond dans une intention. Si des frais élevés doivent rester possibles, les soumettre à un
timelock afin que les déposants puissent sortir avant l'application.

---

## 3. Rachat de poussière : destruction sans contrepartie — **Faible**

**Localisation** : `AssetAdapter.sol`, `_fromCanonical` et `withdraw`

**Description.** Pour un sous-jacent à moins de 18 décimales, la conversion retour est une
division entière, donc tronquante. Un rachat portant sur un montant normalisé inférieur au facteur
de conversion produit `amount == 0` : `VaultManager` brûle les tokens wrappés, l'adaptateur
transfère zéro, et l'appel réussit.

**Scénario.** Sous-jacent à 6 décimales (facteur 1e12). L'utilisateur rachète 999 999 999 999 en
base 18 : ses tokens wrappés sont brûlés, il reçoit 0 unité de sous-jacent, aucune erreur n'est
levée. La perte est plafonnée à une unité de sous-jacent par appel — faible en valeur, mais
silencieuse, et elle écarte l'offre wrappée de la valeur verrouillée dans le sens favorable au
protocole.

**Statut.** Latent sur Sepolia : les trois sous-jacents déployés (`MockERC3643`) sont en 18
décimales, où `_fromCanonical` est l'identité. Le test `AssetAdapterDecimals.ts` couvre bien les
sous-jacents à 6 et 8 décimales, mais sur des montants ronds uniquement, jamais sur la troncature.

**Recommandation.** Faire échouer un retrait dont le montant converti tombe à zéro alors que le
montant demandé ne l'était pas, et ajouter un cas de test sur la poussière pour chaque nombre de
décimales déjà couvert.

---

## 4. `getPrice` revert sur horodatage futur, hors `try/catch` — **Faible**

**Localisation** : `OracleManager.sol`, `getPrice`

```solidity
try IPriceSource(sources[i]).latestPrice(assetId) returns (uint256 p, uint256 updatedAt) {
    if (p == 0 || block.timestamp - updatedAt > config.maxStaleness) continue;
```

**Description.** Le bloc `returns` d'un `try` s'exécute dans le contexte de l'appelant : un revert
qui s'y produit n'est **pas** rattrapé par le `catch`. Si une source renvoie un `updatedAt`
postérieur au bloc courant, la soustraction déborde par le bas et fait échouer `getPrice` en
entier — précisément ce que la conception en `try/catch` visait à éviter.

La protection contre une source défaillante ne couvre donc que les sources qui échouent
franchement, pas celles qui renvoient une donnée malformée.

**Recommandation.** Comparer avant de soustraire :
`if (p == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > config.maxStaleness) continue;`
Une source qui prétend connaître le futur mérite d'être écartée, pas crue.

---

## 5. Valeur de retour de `transferFrom` ignorée — **Faible**

**Localisation** : `VaultManager.sol`, `_redeem`

```solidity
if (feeAmount > 0) config.wrappedToken.transferFrom(redeemer, treasury, feeAmount);
```

**Description.** `IWrappedToken` hérite d'`IERC20`, dont `transferFrom` renvoie un booléen, ici
non vérifié. `GLDToken` repose sur l'ERC20 d'OpenZeppelin, qui revert en cas d'échec : le constat
n'est donc pas exploitable aujourd'hui. Mais `registerAsset` accepte une adresse de token wrappé
arbitraire ; un token qui renvoie `false` sans revert ferait passer le rachat en laissant les
frais impayés.

**Recommandation.** Utiliser `SafeERC20` — déjà présent dans le projet, dans `Treasury.sol` — pour
cet appel comme pour tout appel à un token dont le protocole ne contrôle pas l'implémentation.

---

## 6. `registerAsset` ne vérifie pas la cohérence de l'`assetId` — **Faible**

**Localisation** : `VaultManager.sol`, `registerAsset`

**Description.** Rien ne contrôle que `AssetAdapter(adapter).assetId()` égale l'`assetId` sous
lequel l'adaptateur est enregistré, ni qu'un même adaptateur n'est pas enregistré sous deux
identifiants. Dans ce dernier cas, deux tokens wrappés distincts seraient émis contre un seul et
même pool de collatéral, et l'invariant de couverture tomberait.

Les trois fabriques passent toujours des valeurs cohérentes, et `FACTORY_ROLE` ne leur est accordé
qu'à elles : le constat n'est pas atteignable en l'état. Il reste une garde manquante sur
l'invariant le plus important du protocole.

**Recommandation.** Ajouter `if (AssetAdapter(adapter).assetId() != assetId) revert(...)`. Une
vérification à l'enregistrement coûte une lecture unique et ferme la porte définitivement.

---

## Ce qui a été examiné et jugé sain

- **Invariant de couverture.** Au dépôt, `normalizedAmount` est verrouillé et exactement autant
  de token wrappé est émis, part de frais comprise ; au rachat, la part nette seule est brûlée et
  libérée, les frais circulant en token wrappé vers le Treasury. L'offre wrappée suit la valeur
  verrouillée dans les deux sens.
- **Réentrance.** `deposit`, `depositFor`, `redeem` et `redeemFor` portent `nonReentrant`, et
  `ReentrantERC3643` exerce les deux chemins de rappel — au `transferFrom` du dépôt comme au
  `transfer` du retrait. Les deux tests passent.
- **`ROUTER_ROLE`.** Accordé au seul `InvestOrGateway`, puis définitivement figé par
  `lockRouterRole` qui pointe son administration vers un rôle sans membre. Le périmètre de
  confiance ne peut plus s'élargir après déploiement. Le Gateway transmet `msg.sender` sans jamais
  prendre la garde des tokens, et n'a donc pas besoin d'être inscrit sur liste blanche ERC-3643.
- **Conformité ERC-3643.** `AssetAdapter` vérifie `isVerified` sur lui-même et `canTransfer` avant
  chaque mouvement, ce qui évite les reverts sans message des déploiements T-REX.
- **Agrégation de prix.** Médiane sur sources fraîches, quorum minimal, filtre de dispersion,
  exclusion des sources en échec. Une source morte ne bloque pas l'agrégation (voir le constat 4
  pour la seule brèche).
- **Pause.** `VaultManager` et `InvestOrGateway` se gèlent indépendamment ; les deux comportements
  sont testés.
- **Échéancier immobilier.** Chaque dépôt porte sa propre échéance, balayée de la plus ancienne à
  la plus récente via un curseur — un dépôt tardif ne repousse jamais un dépôt antérieur. Correct
  en soi ; c'est le contrôle d'accès au rachat qui pose problème (constat 1).

## Risques de centralisation

Indépendants de tout bug, et structurels :

- `DEFAULT_ADMIN_ROLE` accorde et révoque tous les rôles, y compris le sien. Sur le déploiement
  Sepolia, il est détenu par un EOA (`0x51F6eBAf…`), pas par un multisig ni un timelock.
- `ASSET_MANAGER_ROLE` peut geler un actif, en changer les frais (voir le constat 2) et modifier
  les paramètres de l'oracle.
- `ORACLE_UPDATER_ROLE` fixe les prix de `ManualPriceSource`. Sur Sepolia, les deux sources
  enregistrées sous `GOLD` sont des sources manuelles : le prix affiché est celui que
  l'administrateur veut bien pousser, et la médiane de deux sources tenues par la même main
  n'apporte aucune protection réelle.

## Limites de cet audit

Revue par lecture de code, menée par le même agent qui a modifié une partie de ces contrats dans
la même session — ce n'est pas un regard indépendant. Aucun outil d'analyse statique (Slither,
Mythril), aucun fuzzing, aucune vérification formelle n'a été exécuté. Les bibliothèques tierces
(OpenZeppelin, Chainlink) sont présumées correctes et n'ont pas été revues.

Le protocole reste du code de démonstration : sous-jacents simulés (`MockERC3643`), oracle
majoritairement manuel, administrateur EOA. Il n'est pas destiné à porter des fonds réels en
l'état, et cette revue ne change pas ce statut.
