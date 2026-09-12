# Audit de sécurité — AETHYX Gateway

**Date** : 11 septembre 2026, étendu le 12 septembre 2026 au module CDP
**Périmètre** : les 23 fichiers de `backend/contracts/` à `c6c1f48` pour les constats 1 à 7 ; les
26 fichiers à `078176a` pour les constats 8 et 9, qui ajoutent `CDPManager.sol` et `StableToken.sol`
**Nature** : revue interne par lecture de code, non une attestation par un tiers indépendant
**Déploiement examiné** : Sepolia, `VaultManager` `0x63C5bACc…6b53` — le module CDP n'y est pas
encore déployé, voir `backend/README.md#module-cdp`

## Synthèse

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | L'échéance immobilière se contourne par auto-transfert | **Élevée** | **Risque accepté** — arbitrage produit assumé |
| 2 | Frais réglables jusqu'à 100 % | **Moyenne** | Latent (frais à 0) |
| 3 | Rachat de poussière : destruction sans contrepartie | **Faible** | Latent (sous-jacents en 18 décimales) |
| 4 | `getPrice` revert sur horodatage futur, hors `try/catch` | **Faible** | Latent |
| 5 | Valeur de retour de `transferFrom` ignorée | **Faible** | Non exploitable en l'état |
| 6 | `registerAsset` ne vérifie pas la cohérence de l'`assetId` | **Faible** | Non exploitable en l'état |
| 7 | Les fabriques figent le bytecode de leur adaptateur | **Moyenne** | **Corrigé** — fabrique redéployée, ancienne révoquée |
| 8 | Liquidation du CDP sans socialisation de la mauvaise dette | **Moyenne à élevée selon paramètres** | **Non traité** — décision produit en attente |
| 9 | `addCollateralType` ne vérifie pas l'étalon du prix enregistré | **Faible à élevée selon l'erreur** | Latent (aucun collatéral erroné enregistré à ce jour) |

Aucun constat critique. Le constat 1 invalidait une propriété que le protocole annonce ; il est
corrigé et déployé. Le constat 7, découvert en tentant ce déploiement, expliquait pourquoi deux
générations de correctifs n'avaient jamais atteint la chaîne. Les constats 8 et 9 portent sur le
module CDP, pas encore déployé : latents par construction, pas encore par chance.

Marché en vigueur : `REAL_ESTATE_PARIS_01_V4`, adaptateur `0x7aE821eb…3700` (6 051 octets, calendrier
global vérifié par balayage des sélecteurs), fabrique `0xABB4C7D0…71aD`.

Durcissement appliqué par `scripts/harden-legacy-real-estate.ts` : le `FACTORY_ROLE` de la fabrique
remplacée `0x0d759a29…92cE` est révoqué, et cinq des sept marchés supersédés sont gelés. Deux
restent actifs — `REAL_ESTATE_PARIS_01` (0,1 en circulation) et `REAL_ESTATE_PARIS_01_15D` (0,2) —
parce que `setAssetActive(false)` bloque aussi le rachat : les geler enfermerait le collatéral de
leurs porteurs. Un blocage contournable est un moindre mal que des fonds irrécupérables. Les fermer
suppose d'obtenir d'abord le rachat de ces porteurs, puis de relancer le script.

---

## 1. L'échéance immobilière se contourne par auto-transfert — **Élevée** · risque accepté

> **Mise à jour — risque accepté.** Après avoir été retiré puis rétabli, le mécanisme est
> aujourd'hui une **échéance par dépôt** : même durée pour tous, comptée depuis la date de chaque
> dépôt, si bien que deux dépôts espacés de trois jours deviennent remboursables à trois jours
> d'intervalle. Marché en vigueur : `REAL_ESTATE_PARIS_01_V6`, adaptateur `0x2f118f11…A3eD`.
>
> Ce choix rouvre délibérément le constat ci-dessous. Des échéances individuelles doivent être
> indexées sur l'adresse du déposant, et un jeton librement transférable permet d'en changer : le
> contournement décrit plus bas fonctionne à nouveau. La seule parade — un échéancier commun au
> marché — a été implémentée, déployée, puis écartée, parce qu'elle dissout précisément
> l'individualité des dépôts que ce marché veut exprimer.
>
> L'arbitrage appartient au produit et il est tranché en faveur de l'individualité. Ce qui suit
> reste donc à lire comme la description d'un risque **connu, mesuré et assumé**, pas d'un oubli.
> Il est épinglé par un test (`test/RealEstateAdapter.ts`, « documents the accepted escape ») pour
> qu'il ne puisse ni être oublié, ni être pris pour une régression.

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

**Déployé.** Le marché `REAL_ESTATE_PARIS_01_V4` porte l'adaptateur `0x7aE821eb…3700`, vérifié par
balayage de ses sélecteurs : `lockedAmountNow()`, `maturedAmountNow()`, `nextUnlockAt()` et
`lockSchedule()` présents, `lockedUntil(address)` et `lockedAmountOf(address)` absents, et 6 051
octets — la taille exacte de la compilation courante.

Le marché précédent (`REAL_ESTATE_PARIS_01_V3`, adaptateur `0x36b88A2b…C69B`) était pire que cette
section ne le disait d'abord : il exposait `lockedUntil(address)` et aucune fonction de calendrier,
soit l'adaptateur **d'origine**, d'avant même le passage à une échéance par dépôt. Voir le constat
n°7 pour la cause. Il reste enregistré et actif sur VaultManager — le frontend ne le référence plus,
mais quiconque en détient le token wrappé peut encore l'utiliser.

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

## 7. Les fabriques figent le bytecode de leur adaptateur — **Moyenne**

**Localisation** : `RealEstateAssetFactory.sol`, et par construction `GoldAssetFactory` et
`SilverAssetFactory`

**Description.** Une fabrique embarque le *bytecode de création* de son adaptateur, figé au moment
où la fabrique elle-même a été compilée et déployée. Elle est immuable : une fabrique déployée
avant une modification de l'adaptateur continue d'émettre l'ancienne version indéfiniment, quoi que
disent les sources locales. Rien dans le code ni dans les scripts ne signalait cet écart.

**Constat sur le déploiement.** La fabrique enregistrée sur Sepolia
(`0x0d759a29…92cE`) fait 14 395 octets contre 15 800 pour la compilation courante. Un `immutable`
est écrit sur place et ne change jamais la longueur : un écart de taille signifie un code
réellement différent.

Conséquence concrète, vérifiée par balayage des sélecteurs du marché déployé aujourd'hui :

```
présent  lockupPeriod()        présent  lockedUntil(address)
absent   lockedAmountOf(address)   absent   lockedAmountNow()
absent   maturedAmountOf(address)  absent   maturedAmountNow()
absent   nextUnlockAt(address)     absent   nextUnlockAt()
absent   lockSchedule(address)     absent   lockSchedule()
```

Le marché `REAL_ESTATE_PARIS_01_V3` ne porte donc ni le calendrier global, ni même l'échéance par
dépôt : il porte le tout premier adaptateur, celui dont un unique `lockedUntil` par adresse était
écrasé à chaque dépôt — si bien qu'abonder une position presque échue la reverrouillait
intégralement. Deux générations de correctifs sont absentes de la chaîne alors qu'elles sont dans
le dépôt depuis des semaines.

L'interface lisant ces fonctions avec `allowFailure`, leur absence se traduisait par des entrées en
échec silencieux : le panneau de blocage ne s'affichait tout simplement jamais, sans le moindre
message d'erreur.

**Recommandation.** Redéployer la fabrique en même temps que tout changement d'adaptateur, et le
vérifier plutôt que le supposer. Le script `scripts/deploy-real-estate-market.ts` le fait
désormais : il compare la taille du code de la fabrique enregistrée à celle de la compilation
courante, en redéploie une au besoin avec son `FACTORY_ROLE`, puis relit l'adaptateur obtenu pour
confirmer qu'il expose `lockedAmountNow()` avant d'écrire quoi que ce soit.

Penser aussi à révoquer le `FACTORY_ROLE` de la fabrique remplacée : tant qu'elle le détient, un
`ASSET_MANAGER_ROLE` peut encore enregistrer des marchés adossés à l'ancien adaptateur. Le script
imprime la commande sans l'exécuter — retirer un privilège en production se décide, ne se subit pas.

---

## 8. Liquidation du CDP sans socialisation de la mauvaise dette — **Moyenne à élevée selon paramètres** · décision en attente

**Localisation** : `CDPManager.sol`, `liquidate`

**Description.** La liquidation est totale et immédiate : le liquidateur rembourse `debtRepaid`
(la dette courante, frais de stabilité inclus) et reçoit `collateralSeized` (tout le collatéral de
la position), sans aucune vérification que la valeur du second couvre le premier au moment de
l'exécution.

```solidity
uint256 debtRepaid = position.debtAmount;
uint256 collateralSeized = position.collateralAmount;
// ... aucun contrôle entre les deux lignes ci-dessus et le transfert plus bas
```

**Scénario.** Une position est ouverte à 200 % de ratio, saine. Le prix du collatéral chute de
40 % en un seul bloc — un flux Chainlink qui rattrape un décrochage, une source manuelle poussée
en retard, une volatilité réelle du sous-jacent. La position se retrouve sous le seuil de
liquidation *et* sous 100 % : le collatéral ne vaut plus la dette qu'il devait garantir. Le premier
liquidateur à agir rembourse la dette au prix nominal et reçoit un collatéral qui vaut, au marché,
moins que ce qu'il vient de payer — une perte pour lui, pas pour le protocole, tant qu'il accepte
de liquider quand même. S'il n'y a aucune incitation à le faire dans ces conditions, personne ne
liquide : la dette reste ouverte, non couverte, et personne d'autre que son titulaire ne le sait
avant de tenter d'interagir avec elle.

Le même effet peut naître sans aucun mouvement de prix, purement par l'accumulation du frais de
stabilité sur une position jamais réglée depuis longtemps (voir `_currentDebt`) — plus lent, mais
tout aussi silencieux tant que rien n'appelle `_settleAccrual` sur cette position précise.

**Ce qui existe déjà, et ce qui manque.** L'écart entre `minCollateralRatioBps` et
`liquidationThresholdBps` (150 % / 130 % dans `deploy-cdp.ts`) est la seule marge de sécurité :
au-delà d'une chute de prix qui la traverse en un seul bloc, rien n'absorbe la différence. Aucun
mécanisme de `AETHYX` — ni Treasury, ni un fonds dédié, ni une réduction proportionnelle de la
dette des autres positions du même collatéral — ne socialise une perte qui dépasserait cette marge.

**Recommandation.** Trois directions, non exclusives :

- **Fonds d'assurance.** Affecter tout ou partie du frais de stabilité déjà perçu par le Treasury
  (voir `_settleAccrual`) à une réserve dédiée, mobilisable pour compléter un liquidateur dont le
  collatéral reçu ne couvre pas la dette remboursée — le mécanisme de MakerDAO/Liquity le plus
  courant, et celui qui demande le moins de changement : le frais de stabilité existe déjà.
- **Socialisation directe.** Répartir la perte non couverte sur `totalDebt` du même collatéral,
  au prorata des positions restantes — plus simple à raisonner, mais fait porter le risque d'une
  position aux autres emprunteurs du même marché sans qu'ils l'aient choisi.
- **Accepter et documenter.** Si le protocole reste à l'échelle d'une démonstration avec des
  plafonds de dette bas (`debtCeiling`), le risque réel est petit et peut rester assumé — mais
  alors il faut le dire dans l'interface, pas seulement ici.

**Statut.** Aucune des trois directions n'a été retenue : c'est un arbitrage produit, pas un bug
à corriger, et il n'a pas encore été tranché. Consigné ici pour qu'il ne soit ni oublié ni pris
pour un oubli.

---

## 9. `addCollateralType` ne vérifie pas l'étalon du prix enregistré — **Faible à élevée selon l'erreur**

**Localisation** : `CDPManager.sol`, `addCollateralType`

**Description.** Rien n'empêche d'enregistrer un `collateralId` dont le prix, dans
`OracleManager`, est libellé dans un étalon différent de la parité nominale du stablecoin — le
piège que le README documente déjà pour `GOLD` (euros par gramme) contre `GOLD_USD_OZ` (dollars
par once). La natspec de la fonction met en garde contre cette erreur, mais aucune ligne de code
ne la rend impossible. C'est exactement le même défaut de conception que le constat 6
(`registerAsset` ne vérifie pas la cohérence de l'`assetId`) : un invariant critique, réel, mais
seulement documenté, jamais imposé.

**Scénario.** Un administrateur enregistre par erreur `GOLD_USD_OZ` comme collatéral au lieu de
`GOLD`, en réutilisant le mauvais identifiant lors d'une intégration Chainlink pressée. La valeur
en dollars par once est plus de trente fois la valeur en euros par gramme : chaque position ouverte
sur ce collatéral paraît alors surcollatéralisée d'un facteur du même ordre. Un emprunteur qui
comprend l'écart peut emprunter bien au-delà de ce que son collatéral vaut réellement, jusqu'à ce
que quelqu'un s'en aperçoive.

**Recommandation.** Contrairement au constat 6, il n'existe rien d'équivalent à
`AssetAdapter.assetId()` à comparer on-chain : l'étalon d'un prix n'est pas une donnée que
`OracleManager` connaît de lui-même. La garde ne peut donc pas être purement on-chain ; elle doit
être un contrôle de processus au moment du déploiement — un script qui, avant d'appeler
`addCollateralType`, relit le prix courant du `collateralId` visé et le fait confirmer
explicitement par l'opérateur (par exemple, en l'affichant en clair : *« 92,40 — confirmez qu'il
s'agit bien d'euros par gramme »*), sur le modèle de ce que
`scripts/deploy-real-estate-market.ts` fait déjà pour vérifier le bytecode d'une fabrique avant
d'écrire quoi que ce soit.

**Statut.** Latent : `deploy-cdp.ts` n'enregistre à ce jour que `GOLD`, dont le prix est bien en
euros par gramme.

---

## Ce qui a été examiné et jugé sain

- **Invariant de couverture.** Au dépôt, `normalizedAmount` est verrouillé et exactement autant
  de token wrappé est émis, part de frais comprise ; au rachat, la part nette seule est brûlée et
  libérée, les frais circulant en token wrappé vers le Treasury. L'offre wrappée suit la valeur
  verrouillée dans les deux sens.
- **Réentrance.** `deposit`, `depositFor`, `redeem` et `redeemFor` portent `nonReentrant`, et
  `ReentrantERC3643` exerce les deux chemins de rappel — au `transferFrom` du dépôt comme au
  `transfer` du retrait. Les deux tests passent.
- **`ROUTER_ROLE`.** Accordé au seul `AethyxGateway`, puis définitivement figé par
  `lockRouterRole` qui pointe son administration vers un rôle sans membre. Le périmètre de
  confiance ne peut plus s'élargir après déploiement. Le Gateway transmet `msg.sender` sans jamais
  prendre la garde des tokens, et n'a donc pas besoin d'être inscrit sur liste blanche ERC-3643.
- **Conformité ERC-3643.** `AssetAdapter` vérifie `isVerified` sur lui-même et `canTransfer` avant
  chaque mouvement, ce qui évite les reverts sans message des déploiements T-REX.
- **Agrégation de prix.** Médiane sur sources fraîches, quorum minimal, filtre de dispersion,
  exclusion des sources en échec. Une source morte ne bloque pas l'agrégation (voir le constat 4
  pour la seule brèche).
- **Pause.** `VaultManager` et `AethyxGateway` se gèlent indépendamment ; les deux comportements
  sont testés.
- **Échéancier immobilier.** Chaque dépôt porte sa propre échéance, balayée de la plus ancienne à
  la plus récente via un curseur — un dépôt tardif ne repousse jamais un dépôt antérieur. Correct
  en soi ; c'est le contrôle d'accès au rachat qui pose problème (constat 1).
- **Règlement du frais de stabilité.** `_settleAccrual` est appelé en tout premier dans
  `depositCollateral`, `withdrawCollateral`, `mintDebt`, `repayDebt` et `liquidate` : aucune de ces
  fonctions ne peut lire ni modifier une dette périmée, et `_collateralRatioBps` recalcule le frais
  couru à la volée pour les lectures pures (`collateralRatioBps`, `currentDebt`), sans jamais avoir
  besoin d'un appel séparé pour rester à jour. Le test `test_AccruedStabilityFeeCanTriggerLiquidation`
  vérifie que ce couru seul, sans aucun mouvement de prix, peut faire passer une position sous le
  seuil de liquidation — le comportement voulu, pas un effet de bord.
- **Séparation des rôles de frappe.** `MINTER_ROLE` (VaultManager) et `DEBT_MINTER_ROLE`
  (CDPManager) sont deux rôles distincts plutôt qu'un seul partagé, précisément pour que
  l'invariant de couverture de VaultManager et celui de dette de CDPManager restent chacun
  vérifiable indépendamment de l'autre contrat.

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
