# Audit de sécurité — AETHYX Gateway

**Date** : 11 septembre 2026, étendu le 12 septembre 2026 au module CDP, à une passe de
vérification Sourcify sur l'ensemble des contrats déployés (constats 10 et 11), le 13-14 septembre
2026 à la liquidation partielle et au marché immobilier à échéancier commun (constat n°12,
redéploiement du constat n°1), puis le 14 septembre 2026 aux constats 2-6 du protocole cœur
(corrigés en source, pas encore déployés — voir chaque constat)
**Périmètre** : les 23 fichiers de `backend/contracts/` à `c6c1f48` pour les constats 1 à 7 ; les
26 fichiers à `078176a` pour les constats 8 et 9, qui ajoutent `CDPManager.sol` et `StableToken.sol`
**Nature** : revue interne par lecture de code, non une attestation par un tiers indépendant
**Déploiement examiné** : Sepolia, `VaultManager` `0x63C5bACc…6b53` ; module CDP redéployé le
13 septembre 2026, `CDPManager` `0x5BB42b98…D8c8C` (précédent : `0xA3C28Deb…2F1d`, toujours
accessible pour ses positions déjà ouvertes) — voir `backend/README.md#module-cdp`

## Synthèse

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | L'échéance immobilière se contourne par auto-transfert | **Élevée** | **Corrigé et déployé** (2026-09-14) — échéancier commun au marché, `REAL_ESTATE_PARIS_01_V7` |
| 2 | Frais réglables jusqu'à 100 % | **Moyenne** | **Corrigé en source** (2026-09-14) — plafond `MAX_FEE_BPS = 500`, pas encore déployé |
| 3 | Rachat de poussière : destruction sans contrepartie | **Faible** | **Corrigé en source** (2026-09-14) — revert sur troncature à zéro, pas encore déployé |
| 4 | `getPrice` revert sur horodatage futur, hors `try/catch` | **Faible** | **Corrigé en source** (2026-09-14) — garde `updatedAt > block.timestamp`, pas encore déployé |
| 5 | Valeur de retour de `transferFrom` ignorée | **Faible** | **Corrigé en source** (2026-09-14) — `SafeERC20`, pas encore déployé |
| 6 | `registerAsset` ne vérifie pas la cohérence de l'`assetId` | **Faible** | **Corrigé en source** (2026-09-14) — `AssetIdMismatch`, pas encore déployé |
| 7 | Les fabriques figent le bytecode de leur adaptateur | **Moyenne** | **Corrigé** — fabrique redéployée, ancienne révoquée |
| 8 | Liquidation du CDP sans socialisation de la mauvaise dette | **Moyenne à élevée selon paramètres** | **Mitigé** — fonds d'assurance alimenté par une part du frais de stabilité (`setInsuranceFundFeeBps`), mobilisé à la liquidation |
| 9 | `addCollateralType` ne vérifie pas l'étalon du prix enregistré | **Faible à élevée selon l'erreur** | **Mitigé** — `deploy-cdp.ts` exige et vérifie une confirmation |
| 10 | `CDPManager`/`StableToken` undeployable contre un `AccessManager` préexistant | **Élevée** | **Corrigé** — rôles calculés localement plutôt que lus sur l'instance fournie |
| 11 | `RealEstateAssetFactory` V6 ne se vérifie pas sur Sourcify | **Non exploitable** | **Résolu** (2026-09-13) — soumission directe à l'API Sourcify, `exact_match` |
| 12 | `CDPManager` ne liquidait qu'en totalité | **Amélioration** | **Résolu et déployé** (2026-09-13) — liquidation partielle, nouveau `CDPManager` |

Aucun constat critique. Le constat 1 invalidait une propriété que le protocole annonce ; il est
corrigé et déployé. Le constat 7, découvert en tentant ce déploiement, expliquait pourquoi deux
générations de correctifs n'avaient jamais atteint la chaîne. Les constats 8 et 9 portent sur le
module CDP, déployé depuis, et mitigés plutôt qu'exploités : latents par construction jusque-là,
pas encore par chance. Le constat 10, découvert en tentant *ce* déploiement, est le pendant du
constat 7 pour les rôles plutôt que pour le bytecode d'une fabrique.

Mise à jour du 12 septembre 2026 (soir) : le constat 8 est passé de « décision produit en
attente » à « mitigé » — un fonds d'assurance, alimenté par une part configurable du frais de
stabilité, comble désormais tout ou partie du manque d'une liquidation en bad debt. Voir la
section dédiée ci-dessous pour ce que ça couvre et ce qui reste hors de sa portée. Le constat 10
a été découvert et corrigé dans la foulée, en tentant effectivement ce déploiement.

Marché en vigueur : `REAL_ESTATE_PARIS_01_V7`, adaptateur `0x53E62D4A…586E` (échéancier commun au
marché, constat n°1), fabrique `0xa830F1B1…Da10`, enregistré comme collatéral CDP sur le nouveau
`CDPManager` (constat n°12).

Mise à jour du 14 septembre 2026 : les constats 2, 3, 4, 5 et 6 sont corrigés en source (chacun
suit la recommandation de sa propre section, chacun testé — 94 tests passent, contre 85 avant
cette passe) mais **aucun n'est déployé sur Sepolia**. Contrairement au module CDP (constat n°12),
ces correctifs touchent `VaultManager.sol`, `AssetAdapter.sol` et `OracleManager.sol` — le
protocole cœur, pas un module ajouté séparément — et ces contrats ne sont pas plus mutables sur
place que les autres. Les déployer demande de redéployer GOLD, SILVER et le marché immobilier en
cours ensemble, plus de reconfigurer le module CDP par-dessus (qui les référence par adresse) :
une opération nettement plus large qu'un redéploiement ciblé, volontairement pas entreprise dans
cette même session sans décision explicite de le faire.

Durcissement appliqué par `scripts/harden-legacy-real-estate.ts` : le `FACTORY_ROLE` de la fabrique
remplacée `0x0d759a29…92cE` est révoqué, et cinq des sept marchés supersédés sont gelés. Deux
restent actifs — `REAL_ESTATE_PARIS_01` (0,1 en circulation) et `REAL_ESTATE_PARIS_01_15D` (0,2) —
parce que `setAssetActive(false)` bloque aussi le rachat : les geler enfermerait le collatéral de
leurs porteurs. Un blocage contournable est un moindre mal que des fonds irrécupérables. Les fermer
suppose d'obtenir d'abord le rachat de ces porteurs, puis de relancer le script.

---

## 1. L'échéance immobilière se contourne par auto-transfert — **Élevée** · résolu (2026-09-13)

> **Mise à jour — l'arbitrage a été retranché en faveur de la sécurité.** Trois versions de ce
> mécanisme se sont succédé : échéancier commun au marché (implémenté, déployé) → écarté au
> profit d'une échéance par dépôt pour préserver l'individualité des dépôts (constat rouvert
> délibérément, voir l'historique conservé ci-dessous) → **échéancier commun rétabli**, cette fois
> pour de bon, la sécurité l'emportant sur l'individualité. `RealEstateAdapter.sol` porte
> aujourd'hui un pool commun au marché : chaque dépôt ouvre sa propre tranche dans un calendrier
> partagé, mais tout remboursement puise dans la part déjà mûre du pool entier, quel qu'en soit
> l'auteur — un auto-transfert vers une seconde adresse ne change plus rien, puisque cette seconde
> adresse puise dans la même réserve que la première.
>
> Conséquence assumée : les dépôts perdent leur individualité (deux dépôts à deux jours
> d'intervalle ne sont plus remboursables à deux jours d'intervalle isolément, mais quand le pool
> commun le permet). `lockedAmountOf(address)`/`maturedAmountOf(address)`/`nextUnlockAt(address)`/
> `lockSchedule(address)` ont disparu au profit de `lockedAmountNow()`/`maturedAmountNow()`/
> `nextUnlockAt()`/`lockSchedule()`, sans argument — signatures différentes plutôt qu'un
> comportement qui change en silence sous la même ABI.
>
> Déployé comme `REAL_ESTATE_PARIS_01_V7` le 2026-09-14 (adaptateur
> `0x53E62D4A5a432A94e38b0D9d61E4Ca0cAF09586E`, token wrappé `0x2Cf65cf7b62e3A510d6Ec0c267Fa357d1CD9193B`,
> voir `scripts/deploy-real-estate-market.ts`), tous deux vérifiés `exact_match` sur Sourcify ;
> `V6` et les versions antérieures restent enregistrées et actives sur `VaultManager` — le frontend
> ne les référence plus, mais quiconque détient déjà leur token wrappé peut encore les utiliser,
> avec le contournement d'origine intact sur ces versions-là spécifiquement.
>
> `CDPManager` a aussi changé (voir constat n°12 : liquidation partielle) et a été redéployé le
> même jour : `V7` est enregistré comme collatéral sur le nouveau `CDPManager`
> (`0x5BB42b987e7F777699f48F4354c1642ed14D8c8C`). `V6` était enregistré comme collatéral sur
> l'ancien `CDPManager` (`0xA3C28Deb0E34086cA7b69AD26c19Dcf78BbA2F1d`, dette nulle à ce jour) ;
> il n'a pas été migré ni désactivé là-bas — la même position que pour GOLD/SILVER (constat n°12) :
> l'ancien contrat n'accepte plus de nouveau collatéral mais gère toujours ce qui y est déjà.
>
> Le test qui documentait le contournement comme accepté (`test/RealEstateAdapter.ts`, « documents
> the accepted escape ») a été remplacé par des tests qui vérifient l'inverse : l'auto-transfert
> échoue avant maturité du pool, et le pool est bien partagé entre déposants indépendants — pas
> seulement au sein d'un même compte.
>
> Historique conservé ci-dessous tel quel : c'est la description exacte du compromis qui a été
> temporairement en vigueur, et la raison pour laquelle il a fallu choisir entre les deux
> directions plutôt que les avoir simultanément reste valable.

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

## 2. Frais réglables jusqu'à 100 % — **Moyenne** · corrigé (2026-09-14)

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

**Statut.** Corrigé en source : `MAX_FEE_BPS = 500` (5 %) borne désormais `_validateFees`,
appelée par `registerAsset` et `setAssetFees`. `FeeTooHigh` se déclenche au-delà, y compris pour
un `ASSET_MANAGER_ROLE` compromis. Testé (`test_RegisterAssetRevertsAboveMaxFeeBps`,
`test_SetAssetFeesRevertsAboveMaxFeeBps`, `test_RegisterAssetAcceptsFeeExactlyAtCap` dans
`VaultManager.t.sol`). Pas de timelock ajouté : à 500 bps le pire cas (un rachat coûte 5 % au
lieu de 0) n'a plus besoin d'une fenêtre de sortie, contrairement au cas à 100 % d'origine.
**Pas encore déployé** — `VaultManager` n'est pas mutable sur place ; ce correctif n'atteint
Sepolia qu'avec un redéploiement complet du protocole cœur, une opération bien plus large que le
redéploiement ciblé du module CDP (constat n°12) puisqu'elle implique de remigrer GOLD, SILVER et
le marché immobilier en cours.

---

## 3. Rachat de poussière : destruction sans contrepartie — **Faible** · corrigé (2026-09-14)

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

**Recommandation.** Faire échouer un retrait dont le montant converti tombe à zéro alors que le
montant demandé ne l'était pas, et ajouter un cas de test sur la poussière pour chaque nombre de
décimales déjà couvert.

**Statut.** Corrigé en source : `withdraw` revert désormais `DustWithdrawal(normalizedAmount)`
quand la conversion tronque un montant non nul à zéro, avant tout transfert. Testé
(`test_RedeemRevertsOnDustAmount`, et `test_RedeemStillSucceedsAboveDustThreshold` pour confirmer
que le rachat normal, au-dessus du seuil de troncature, n'est pas affecté). Toujours latent sur
Sepolia — les trois sous-jacents déployés restent en 18 décimales, où `_fromCanonical` est
l'identité — mais le correctif est en place avant qu'un sous-jacent à moins de 18 décimales soit
jamais enregistré. **Pas encore déployé**, même contrainte que le constat n°2 : `AssetAdapter`
n'est pas mutable sur place.

---

## 4. `getPrice` revert sur horodatage futur, hors `try/catch` — **Faible** · corrigé (2026-09-14)

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

**Statut.** Corrigé en source exactement comme recommandé. Testé
(`test_ExcludesSourceClaimingFutureTimestampWithoutReverting` dans `OracleManager.t.sol` :
une source datée dans le futur est exclue de l'agrégation sans faire échouer `getPrice`, prouvé en
faisant tomber le quorum sous `minSources` une fois cette source retranchée). **Pas encore
déployé** — `OracleManager` n'est pas mutable sur place, même contrainte que les constats n°2 et 3.

---

## 5. Valeur de retour de `transferFrom` ignorée — **Faible** · corrigé (2026-09-14)

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

**Statut.** Corrigé en source : `VaultManager` utilise désormais `SafeERC20` pour ce transfert
(`using SafeERC20 for IWrappedToken`, implicitement convertible vers `IERC20` — même schéma que
`Treasury.sol`). Testé directement (`test_RedeemRevertsWhenWrappedTokenFeeTransferReturnsFalse`
dans `VaultManager.t.sol`, avec un token wrappé de test dont `transferFrom` renvoie `false` sans
jamais revert — exactement le scénario que `GLDToken` ne peut pas reproduire puisqu'il revert
déjà) : le rachat échoue franchement au lieu de laisser les frais impayés en silence. **Pas
encore déployé**, même contrainte que les constats n°2, 3 et 4.

---

## 6. `registerAsset` ne vérifie pas la cohérence de l'`assetId` — **Faible** · corrigé (2026-09-14)

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

**Statut.** Corrigé en source exactement comme recommandé, avec une nouvelle erreur dédiée
`AssetIdMismatch(assetId, adapterAssetId)` plutôt qu'une erreur générique. Testé
(`test_RegisterAssetRevertsOnAssetIdMismatch`, `test_RegisterAssetSucceedsWhenAssetIdMatches`).
**Pas encore déployé**, même contrainte que les constats n°2, 3, 4 et 5.

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

## 8. Liquidation du CDP sans socialisation de la mauvaise dette — **Moyenne à élevée selon paramètres** · mitigé

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

**Décision retenue.** Le fonds d'assurance — la première direction listée ci-dessus, celle qui
demandait le moins de changement puisque le frais de stabilité existe déjà.

**Mitigation appliquée.** `CDPManager.insuranceFundFeeBps` fixe, en points de base et
uniformément sur tous les collatéraux, la part de chaque règlement de frais de stabilité
(`_settleAccrual`) qui va au fonds plutôt qu'au Treasury — mintée directement au contrat, qui
tient sa propre comptabilité dans `insuranceFundBalance`. Zéro par défaut : le fonds ne se remplit
qu'une fois `setInsuranceFundFeeBps` explicitement appelé par `RISK_MANAGER_ROLE`.

À la liquidation, si le collatéral saisi vaut moins que la dette remboursée, `liquidate` puise
dans `insuranceFundBalance` — dans la limite de ce qu'il contient — et transfère ce complément au
liquidateur en plus du collatéral, réduisant d'autant sa perte. `BadDebtRealized` porte désormais
deux montants : `shortfall`, l'écart total, et `coveredByInsuranceFund`, la part que le fonds a
absorbée ; ce qui reste (`shortfall - coveredByInsuranceFund`) demeure à la charge du liquidateur,
exactement comme avant cette mitigation. Testé par
`test_InsuranceFundFeeSplitsStabilityFeeBetweenFundAndTreasury` (répartition à l'accumulation) et
`test_InsuranceFundCoversShortfallOnLiquidation` (couverture partielle d'un manque de 40e18 par un
fonds qui n'en contient que 10e18).

**Ce que ça ne couvre pas.** Le fonds est plafonné à ce qu'il a accumulé : un manque supérieur à
son solde reste partiellement non couvert, et un fonds encore vide au moment d'un premier
effondrement de prix (le cas typique d'un déploiement neuf) ne compense rien du tout. La part
`insuranceFundFeeBps` est un paramètre de risque comme un autre — un `RISK_MANAGER_ROLE` compromis
ou négligent peut la remettre à zéro, ou ne jamais l'avoir fixée. Ce n'est pas une garantie de
solvabilité, seulement une réserve qui s'accumule avec le temps et amortit les manques dans sa
limite.

**Statut.** Mitigé. `deploy-cdp.ts` fixe une part par défaut au déploiement — voir son
constant `INSURANCE_FUND_FEE_BPS`.

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
explicitement par l'opérateur, sur le modèle de ce que `scripts/deploy-real-estate-market.ts` fait
déjà pour vérifier le bytecode d'une fabrique avant d'écrire quoi que ce soit.

**Mitigation appliquée.** `deploy-cdp.ts` exige désormais la variable d'environnement
`EXPECTED_GOLD_PRICE_EUR_PER_GRAM` avant d'appeler `addCollateralType` : elle relit le prix courant
sur `OracleManager`, le compare à la valeur annoncée par l'opérateur, et refuse d'enregistrer le
collatéral au-delà de 25 % d'écart — précisément l'ordre de grandeur qui sépare l'euro par gramme
du dollar par once. Vérifié : un prix dans le bon étalon avec une dérive plausible passe, un prix
du mauvais étalon (rapport d'environ ×30) est rejeté. Le contrôle porte sur le *prix*, pas sur
l'identité du token ; il attrape l'erreur d'étalon, pas une erreur d'`assetId` qui resterait dans
le bon ordre de grandeur par coïncidence — un opérateur pressé reste la dernière ligne de défense
pour ce second cas.

**Statut.** Mitigé pour `GOLD`, le seul collatéral que `deploy-cdp.ts` enregistre à ce jour.

---

## 10. `CDPManager`/`StableToken` étaient undeployable contre un `AccessManager` préexistant — **Élevée** · corrigé

**Localisation** : `CDPManager.sol` (5 sites) et `StableToken.mint`, découvert en tentant le
déploiement Sepolia du module CDP.

**Description.** `CDPManager` et `StableToken` lisaient `RISK_MANAGER_ROLE` et `DEBT_MINTER_ROLE`
via un appel externe — `accessManager.RISK_MANAGER_ROLE()`, `accessManager.DEBT_MINTER_ROLE()` —
plutôt que de les calculer localement. Ces deux constantes ont été ajoutées à `AccessManager.sol`
après que l'`AccessManager` de Sepolia (`0x177528950CD48409c5bC74a8B9A1e280c7e8072f`) a été déployé :
son bytecode ne les expose donc pas. Vérifié par balayage de sélecteurs : `RISK_MANAGER_ROLE()` et
`DEBT_MINTER_ROLE()` absents, `ASSET_MANAGER_ROLE()`, `PAUSER_ROLE()`, `hasRole`, `grantRole`
présents.

**Conséquence.** Chaque appel à `addCollateralType`, `setCollateralActive`, `setCollateralParams`,
`setInsuranceFundFeeBps` (CDPManager) ou `mint` (StableToken) commence par cet appel externe pour
déterminer *quel* rôle vérifier. Sur un `AccessManager` qui n'expose pas le getter, cet appel
revert et fait échouer la fonction entière — pas seulement au déploiement : en permanence, à
chaque invocation. Concrètement, le module CDP entier était inutilisable une fois pointé sur
l'`AccessManager` déjà déployé, alors qu'`addCollateralType` avait déjà procédé aux deux
déploiements de `StableToken` et `CDPManager` avant d'échouer sur l'octroi des rôles — capital et
gas dépensés pour deux contrats qui restaient bloqués.

**Ce que ça n'est pas.** Pas un problème de stockage des rôles : `hasRole`/`grantRole`, hérités
d'`AccessControl`, fonctionnent pour n'importe quelle valeur `bytes32`, que cet `AccessManager`
la connaisse nommément ou non — c'est uniquement le *getter de convenance* qui manquait.
Redéployer l'`AccessManager` (et donc tout le protocole cœur qui pointe dessus de façon immuable)
n'était ni nécessaire ni souhaitable.

**Correction.** `RISK_MANAGER_ROLE` (`CDPManager`) et `DEBT_MINTER_ROLE` (`StableToken`) sont
désormais des `bytes32 public constant` calculées localement (`keccak256("RISK_MANAGER_ROLE")`,
identique bit à bit à ce que retourne un `AccessManager` neuf) plutôt que lues sur l'instance
fournie au constructeur. `deploy-cdp.ts` fait de même côté script (`ethers.id(...)` plutôt que
`await accessManager.RISK_MANAGER_ROLE()`). Aucun changement de comportement sur un déploiement
neuf — la valeur est identique — seulement la suppression d'une dépendance inutile au bytecode
exact de l'`AccessManager` ciblé.

**Statut.** Corrigé avant tout déploiement Sepolia réussi du module ; aucune position ni fonds
utilisateur n'était en jeu.

---

## 11. `RealEstateAssetFactory` V6 ne se vérifie pas sur Sourcify — **Non exploitable** · résolu

**Localisation** : `0x1cd0c39Df0135895b39cDf4f617b387607689B9D` (fabrique du marché
`REAL_ESTATE_PARIS_01_V6`), découvert en vérifiant a posteriori l'ensemble des contrats déployés
sur Sourcify.

**Description.** `npx hardhat verify sourcify` échoue sur cette adresse avec
`HHE80009: bytecode does not match`, alors que `StableToken`, `CDPManager`, l'adaptateur et le
token que cette même fabrique a déployés (`RealEstateAdapter` et `RLD`, tous deux à l'adresse
enregistrée dans `real_estate_market.json`) se vérifient sans problème contre le code source
actuel. Diagnostic mené avant d'abandonner :

- Comparaison de longueur (le test que `deploy-real-estate-market.ts` utilise déjà pour détecter
  une fabrique périmée, voir constat n°7) : identique, 17 181 octets des deux côtés.
- Diff octet par octet entre le bytecode compilé localement et le bytecode on-chain : 235 octets
  diffèrent, répartis en plusieurs plages.
- Comparaison à `immutableReferences` (les emplacements que le compilateur lui-même déclare comme
  variables `immutable`, donc censés différer légitimement d'un déploiement à l'autre) : sept des
  plages diffèrent exactement aux emplacements attendus des deux immuables du contrat
  (`accessManager` hérité d'`AccessManaged`, `vaultManager` propre à la fabrique).
- Il reste 32 octets de différence à un emplacement qui n'est *pas* un immuable déclaré, plus la
  queue de métadonnées CBOR en fin de bytecode (qui diffère normalement d'une compilation à
  l'autre et que Sourcify ignore habituellement, mais que le contrôle local de `hardhat-verify`
  ne semble pas retrancher avant de comparer).

**Ce que ça n'est pas.** Pas une répétition du constat n°7 : une fabrique réellement périmée
émettrait un adaptateur ou un token différents de ce que dit le code source actuel — or
`RealEstateAdapter` et `RLD`, produits par cette fabrique, se sont tous les deux vérifiés avec
succès contre le code actuel. Ce que la fabrique a produit est prouvé correct ; c'est la
vérification de la fabrique *elle-même* qui échoue, sans qu'on sache dire si la cause est un
détail de compilation (réglages d'optimiseur, ordre de résolution des imports) propre à ce
contrat, ou une limite du contrôle local de `hardhat-verify` sur la troncature des métadonnées.

**Statut.** Résolu (2026-09-13) en suivant la piste laissée ouverte ci-dessus : une soumission
directe à `POST /v2/verify/{chainId}/{address}` de l'API Sourcify, avec le `stdJsonInput` complet
tiré de `artifacts/build-info/` et `contractIdentifier: "project/contracts/RealEstateAssetFactory.sol:RealEstateAssetFactory"`,
a produit un **match complet** (`creationMatch`/`runtimeMatch`: `"match"`, pas seulement
`"partial"`) — confirmant que les 32 octets non expliqués provenaient bien d'une limite du
contrôle local de `hardhat-verify` (`HHE80009`), pas d'un écart réel entre le bytecode déployé et
le code source. Le comparateur de Sourcify lui-même n'a jamais vu de différence une fois la
requête effectivement soumise ; `hardhat-verify` refusait simplement de tenter l'envoi. Contrat
vérifié : https://repo.sourcify.dev/11155111/0x1cd0c39Df0135895b39cDf4f617b387607689B9D

---

## 12. `CDPManager` ne liquidait qu'en totalité — **Amélioration** · résolu (2026-09-13)

**Contexte.** La première version de `CDPManager` (voir sa natspec) n'implémentait qu'une
liquidation totale, délibérément : « squelette de première version, volontairement simplifié ».
Un liquidateur devait détenir la dette entière d'une position pour agir du tout, ce qui exclut
quiconque n'a pas cette somme, et concentre tout le collatéral saisi sur un seul liquidateur au
lieu de le répartir entre plusieurs.

**Changement.** `liquidate(user, collateralId, debtToRepay)` prend désormais un montant : le
liquidateur choisit combien de dette rembourser (jusqu'à la dette due) et reçoit
`collateralAmount * debtToRepay / debtAmount` de collatéral, majoré d'un nouveau
`liquidationBonusBps` par collatéral — son incitation à agir. Rembourser l'intégralité de la dette
reste possible et se comporte exactement comme l'ancienne liquidation totale : c'est le cas
particulier `debtToRepay == debtAmount` de la même formule, sans perte d'arrondi
(`collateralAmount * debtAmount / debtAmount == collateralAmount`).

Le bonus est plafonné au collatéral réellement détenu par la position : une liquidation (totale ou
partielle) sur une position déjà bien sous sa valeur d'origine donne tout ce qui reste, sans
dépasser. Le manque au-delà, bonus compris, retombe dans le fonds d'assurance (constat n°8),
inchangé.

`addCollateralType`/`setCollateralParams` valident maintenant que
`liquidationThresholdBps * (1 + liquidationBonusBps) ≤ minCollateralRatioBps` : sans cette borne,
une position tout juste sous le seuil de liquidation ne pourrait jamais couvrir le bonus promis,
même avant toute chute de prix. Nouvelle erreur `InvalidLiquidationBonus`.

**Ce qui ne change pas.** Toujours pas d'enchères — un appelant propose son propre prix (celui de
l'oracle au moment de l'appel), il ne le fixe pas. Une seule liquidation ne garantit pas non plus
le retour à un ratio sain : retirer du collatéral majoré d'un bonus, à prix constant, baisse
mécaniquement le ratio restant plutôt que de le remonter (démontré dans
`test_PartialLiquidationSeizesProportionalCollateralPlusBonus`) — une position très dégradée peut
demander plusieurs liquidations partielles, ou une totale, avant d'être saine ou fermée. C'est le
comportement attendu des protocoles de prêt comparables (Aave, Compound), pas une régression.

**Statut.** Résolu, testé (`test_PartialLiquidationSeizesProportionalCollateralPlusBonus`,
`test_LiquidationBonusCappedAtRemainingCollateral`, `test_LiquidateRevertsOnZeroDebtToRepay`,
`test_LiquidateRevertsWhenDebtToRepayExceedsDebt`,
`test_AddCollateralTypeRevertsWhenLiquidationBonusTooHigh`), et **déployé** (2026-09-13, via
`scripts/redeploy-cdp-manager.ts`) : la signature de `liquidate` et la forme de
`CollateralConfig` ayant changé — ce qui casse l'ABI du `CDPManager` déjà en place sur Sepolia —
et ces contrats n'étant pas mis à niveau sur place, un nouveau `CDPManager` a été déployé à
`0x5BB42b987e7F777699f48F4354c1642ed14D8c8C`, vérifié `exact_match` sur
[Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x5BB42b987e7F777699f48F4354c1642ed14D8c8C).
`GOLD` et `SILVER` y ont été réenregistrés (mêmes paramètres qu'avant), puis
`REAL_ESTATE_PARIS_01_V7` (`scripts/register-real-estate-collateral.ts`, 200 % / 160 % / 3 %/an /
10 % de bonus — voir sa propre entrée ci-dessous et constat n°1). L'ancien `CDPManager`
(`0xA3C28Deb0E34086cA7b69AD26c19Dcf78BbA2F1d`) avait encore une position GOLD ouverte
(~1,10 ioEUR de dette) au moment du redéploiement ; elle n'en migre pas automatiquement, reste
utilisable sur l'ancien contrat (remboursement, retrait, liquidation), et le frontend garde cette
instance accessible plutôt que de la faire disparaître de l'UI — voir
`frontend/src/config/contracts.ts#CDP_MANAGERS`.

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
- `ORACLE_UPDATER_ROLE` fixe les prix de `ManualPriceSource`. `SILVER` et le marché immobilier
  restent entièrement sur des sources manuelles : le prix affiché est celui que l'administrateur
  veut bien pousser, et la médiane de deux sources tenues par la même main n'apporte aucune
  protection réelle. `GOLD` a été partiellement corrigé le 14 septembre 2026
  (`scripts/wire-real-gold-price.ts`, exécuté) : ses deux sources sont désormais deux instances de
  `ChainlinkGoldEurPerGramPriceSource` (`0x210Fa1Da88E3a3aD16910E1a07d1330327eA86e8` et
  `0x89aF3c2623473e1d8b900d0F8F029E1832A669a9`), qui lisent le vrai flux Sepolia XAU/USD
  (`0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A`) et ne laissent plus qu'une conversion de devise
  (le taux EUR/USD, faute d'un flux Chainlink EUR/USD déployé sur Sepolia — vérifié directement
  on-chain contre plusieurs adresses candidates, pas seulement documenté) à la discrétion de
  l'opérateur. `OracleManager.getPrice(GOLD)` est passé de ~92 €/g (valeur manuelle statique) à
  ~127,64 €/g (marché réel au 14 septembre 2026) dès l'exécution du script, confirmé
  indépendamment on-chain et sur le site en production. Une manipulation reste possible via le
  taux de change, mais son ampleur est bornée à ce qu'un taux de change plausible peut faire
  varier — plus la latitude de fixer le prix de l'or entier à volonté.

## Limites de cet audit

Revue par lecture de code, menée par le même agent qui a modifié une partie de ces contrats dans
la même session — ce n'est pas un regard indépendant. Aucun outil d'analyse statique (Slither,
Mythril), aucun fuzzing, aucune vérification formelle n'a été exécuté. Les bibliothèques tierces
(OpenZeppelin, Chainlink) sont présumées correctes et n'ont pas été revues.

Le protocole reste du code de démonstration : sous-jacents simulés (`MockERC3643`), oracle
majoritairement manuel, administrateur EOA. Il n'est pas destiné à porter des fonds réels en
l'état, et cette revue ne change pas ce statut.
