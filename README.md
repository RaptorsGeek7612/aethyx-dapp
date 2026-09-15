# AETHYX Gateway

Un protocole d'enveloppement ERC-3643 → ERC-20 : on verrouille un token d'actif du monde réel
(RWA) permissionné et soumis à conformité, et on émet contre lui un ERC-20 librement
transférable, à parité 1:1 (moins des frais configurables), rachetable à l'identique. L'or,
l'argent et l'immobilier tokenisé constituent les trois premières classes d'actifs.

- **`backend/`** — contrats Solidity, tests et modules de déploiement Hardhat 3 Ignition.
- **`frontend/`** — dApp Next.js pour envelopper, racheter et consulter les données de réserve
  et d'oracle.

## Pourquoi envelopper des tokens ERC-3643 ?

Les tokens [ERC-3643](https://eips.ethereum.org/EIPS/eip-3643) — le standard employé pour
l'émission de RWA régulés — portent des restrictions de transfert : seules des adresses
inscrites sur liste blanche et contrôlées en conformité peuvent les détenir ou les déplacer.
Cela les rend difficiles à utiliser dans la DeFi ordinaire. AETHYX Gateway verrouille le
token ERC-3643 derrière un adaptateur qui, lui, *est* inscrit sur liste blanche, et émet contre
lui un ERC-20 ordinaire que n'importe qui peut détenir et échanger librement — le collatéral
sous-jacent restant intégralement adossé et rachetable 1:1 par son détenteur d'origine.

## Architecture

```
                    ┌────────────────────┐
 utilisateur ─────► │  AethyxGateway    │  point d'entrée stable, ne détient jamais de fonds
                    └─────────┬───────────┘
                              │ depositFor / redeemFor (ROUTER_ROLE)
                    ┌─────────▼───────────┐        ┌──────────────┐
                    │    VaultManager      │◄──────►│   Treasury   │  produit des frais
                    │  registre + frais +  │        └──────────────┘
                    │  émission/destruction│
                    └──┬────────────────┬──┘
                       │                │
              ┌────────▼───────┐  ┌─────▼──────────┐
              │  AssetAdapter   │  │ ERC-20 wrappé   │  un par actif (GLDToken, ...)
              │ (Gold/Silver/   │  └─────────────────┘
              │  RealEstate)    │
              └────────┬────────┘
                       │ prend en garde
              ┌────────▼────────┐
              │ token ERC-3643   │  le vrai token RWA soumis à conformité
              └─────────────────┘

   ┌────────────────┐        ┌───────────────────────────────┐
   │  OracleManager  │◄───────│ Gold/Silver/RealEstateAsset-   │  déploient adaptateur + token
   │  prix médian,   │        │ Factory                        │  wrappé ensemble, puis les
   │  filtres de     │        └───────────────────────────────┘  enregistrent auprès de
   │  péremption et  │                                           VaultManager
   │  de dispersion  │
   └────────▲────────┘
            │ addPriceSource
   ┌────────┴────────┐
   │ ManualPriceSource │  × N par actif (flux indépendants)
   └───────────────────┘

   AccessManager — registre AccessControl unique où tous les contrats ci-dessus vérifient
   leurs rôles
```

**Contrats principaux** (`backend/contracts/`)

| Contrat | Rôle |
|---|---|
| `AccessManager` | Registre `AccessControl` central — tous les autres contrats y vérifient leurs rôles au lieu de gérer les leurs. |
| `AethyxGateway` | Point d'entrée unique côté utilisateur (`deposit`/`redeem`). Ne détient aucun fonds ; transmet `msg.sender` tel quel à `VaultManager`. |
| `VaultManager` | Chef d'orchestre. Enregistre les adaptateurs d'actifs, applique les frais, émet et brûle les tokens wrappés. Invariant : l'offre wrappée égale toujours la valeur verrouillée. |
| `AssetAdapter` (+ `GoldAdapter`, `SilverAdapter`, `RealEstateAdapter`) | Prend en garde un actif ERC-3643, exécute les contrôles de conformité préalables, normalise les décimales à 18. |
| `*AssetFactory` (Gold/Silver/RealEstate) | Déploie ensemble un couple adaptateur + ERC-20 wrappé et l'enregistre auprès de `VaultManager`. Découpé en une fabrique par classe d'actif : une fabrique unique embarquant le bytecode de tous les adaptateurs dépassait la limite de taille EIP-170. |
| `OracleManager` | Agrège plusieurs sources de prix par actif en une médiane résistante à la manipulation ; exclut les sources périmées ou divergentes au lieu de faire confiance à un flux unique. |
| `ManualPriceSource` | Flux de prix alimenté par un administrateur, implémentant `IPriceSource` — source secondaire et moyen d'injecter des prix hostiles en test. |
| `ChainlinkPriceSource` | Enveloppe `IPriceSource` autour d'un vrai flux Chainlink `AggregatorV3Interface` — rejette les prix nuls ou négatifs, les rounds incomplets ou périmés, normalise les décimales à 18. |
| `Treasury` | Collecte le produit des frais de protocole. |

### Note sur l'immobilier : une échéance par dépôt

`RealEstateAdapter` impose une durée de détention minimale avant remboursement, parce que le
règlement d'une opération immobilière prend un temps réel. Cette durée, `lockupPeriod`, est
**immuable** : fixée au déploiement du marché, jamais choisie au dépôt.

Mais elle est comptée **depuis la date de chaque dépôt**. Deux dépôts espacés de trois jours
deviennent remboursables à trois jours d'intervalle : un dépôt ultérieur ne repousse jamais un
dépôt antérieur, et le remboursement est plafonné aux tranches échues plutôt que bloqué en tout
ou rien. L'interface lit ce calendrier sur l'adaptateur et date chaque dépôt individuellement.

Ce choix a un coût, documenté plutôt que tu : suivre des échéances individuelles impose de les
indexer sur l'adresse du déposant, et le jeton wrappé étant librement transférable, un déposant
peut l'envoyer à une seconde adresse et rembourser depuis celle-ci sans attendre. La seule forme
non contournable — un échéancier commun au marché — supprimerait l'individualité des dépôts. Voir
[`backend/AUDIT.md`](backend/AUDIT.md), constat n°1, où l'arbitrage est consigné comme risque
accepté.

## Module CDP

Un second module, indépendant du wrap RWA ci-dessus : `CDPManager` permet de verrouiller un token
wrappé AETHYX (GLD, SLD, RLD...) en collatéral et d'emprunter contre lui `ioEUR`, un stablecoin de
dette émis par `StableToken`, jusqu'au ratio de collatéralisation minimal fixé par type de
collatéral. La dette porte un frais de stabilité continu, en points de base par an. Une position
dont la valeur du collatéral tombe sous le seuil de liquidation — par une chute de prix ou par
l'accumulation de ce frais — peut être liquidée par n'importe qui, en partie ou en totalité : le
liquidateur choisit combien de dette rembourser et reçoit le collatéral proportionnel, majoré d'un
bonus par collatéral (voir `backend/AUDIT.md`, constat n°12).

| Contrat | Rôle |
|---|---|
| `StableToken` (`ioEUR`) | Stablecoin de dette, `ERC20` + `ERC20Burnable`. Seul `CDPManager` (`DEBT_MINTER_ROLE`) peut en émettre. |
| `CDPManager` | Verrouille le collatéral, émet et rembourse la dette, liquide les positions (partiellement ou totalement) sous le seuil. |

Interface : page `/cdp` (`frontend/src/app/cdp/page.tsx`) — dépôt, retrait, emprunt, remboursement,
et une console de liquidation ouverte à quiconque. Le frontend garde toute instance `CDPManager`
retirée accessible (repay/withdraw/liquidate, pas de nouveaux dépôts/emprunts) plutôt que de la
faire disparaître de l'UI au moment d'un redéploiement — voir
`frontend/src/config/contracts.ts#CDP_MANAGERS` et `NEXT_PUBLIC_CDP_MANAGER_LEGACY_ADDRESSES`.

Redéployé le 2026-09-15 en même temps que le protocole cœur (voir ci-dessus, correctifs 2-6) par
`scripts/deploy-cdp.ts`, avec `GOLD` comme premier collatéral (150 % / 130 %, frais de stabilité
2 %/an, fonds d'assurance à 50 % du frais — voir `backend/AUDIT.md`, constat n°8). `SILVER` a suivi
aux mêmes paramètres (`scripts/register-silver-collateral.ts`), puis `REAL_ESTATE_PARIS_01_V8`
(200 % / 160 %, frais 3 %/an, bonus 10 % — plus conservateur car ce marché n'a pas de prix de
marché indépendant : son prix (estimation ÷ offre en circulation) doit être repoussé manuellement
via `scripts/update-real-estate-price.ts` après chaque dépôt/rachat sur ce marché, sous peine de
devenir obsolète) :

| Composant | Adresse |
|---|---|
| `StableToken` (`ioEUR`) | `0xFeDe98257a6B15958478F90AE2Fcf38A33Fb5020` |
| `CDPManager` (courant, depuis 2026-09-15) | `0x6cb309d980890f4d294a339c33FA50821DBBceDA` |
| `CDPManager` (retiré, sur l'ancien protocole cœur, encore accessible en lecture/gestion) | `0x5BB42b987e7F777699f48F4354c1642ed14D8c8C` |
| `CDPManager` (deux générations retirées, encore accessible) | `0xA3C28Deb0E34086cA7b69AD26c19Dcf78BbA2F1d` |

Voir [`backend/README.md`](backend/README.md#module-cdp) pour redéployer ou retrofitter ce module
sur un autre réseau : `ignition/modules/CDP.ts` compose le protocole cœur sur un réseau neuf,
`scripts/deploy-cdp.ts` retrofitte le module sur un déploiement existant.

Plusieurs constats de [`backend/AUDIT.md`](backend/AUDIT.md) portent spécifiquement sur ce module :
constat n°8 (liquidation sans socialisation de la mauvaise dette — mitigé par un fonds
d'assurance alimenté par une part configurable du frais de stabilité, mobilisé pour compléter un
liquidateur en manque, dans la limite de son solde), constat n°9 (absence de vérification de
l'étalon du prix à l'enregistrement d'un collatéral — mitigé par une confirmation opérateur avant
chaque enregistrement), constat n°10 (le premier `CDPManager` ne se déployait pas contre
l'`AccessManager` déjà en place sur Sepolia — corrigé), et constat n°12 (liquidation partielle,
ci-dessus — résolu et déployé).

## Backend — Hardhat 3

```shell
cd backend
npm install
npx hardhat compile
npx hardhat test              # tests Solidity + TypeScript
```

### Déploiement local

```shell
npx hardhat node                                                   # dans un terminal séparé
npx hardhat ignition deploy ignition/modules/AethyxGateway.ts --network localhost
npx hardhat run scripts/seed-demo-assets.ts --network localhost    # amorce les actifs de démo
```

### Déploiement sur Sepolia

Enregistre une clé de déploiement (à ne jamais committer) :

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
# ou exporte SEPOLIA_PRIVATE_KEY / SEPOLIA_RPC_URL en variables d'environnement :
# elles ont priorité sur le keystore
```

`configVariable("SEPOLIA_PRIVATE_KEY")` dans `hardhat.config.ts` attend le **nom** d'une entrée
du keystore, jamais sa valeur. Y coller directement une URL ou une clé casse la configuration et
fait chercher à Hardhat une entrée portant ce nom.

```shell
npx hardhat ignition deploy ignition/modules/AethyxGateway.ts --network sepolia
SEED_NETWORK=sepolia npx hardhat run scripts/seed-demo-assets.ts --network sepolia
```

Déploiement Sepolia courant (`backend/ignition/deployments/chain-11155111/`), redéployé le
2026-09-15 pour mettre en production les correctifs 2-6 de [`backend/AUDIT.md`](backend/AUDIT.md)
(plafond de frais, poussière de rachat, horodatage futur de l'oracle, `SafeERC20`, cohérence
`assetId`) — protocole cœur, pas mutable sur place, donc redéploiement complet plutôt que ciblé :

| Contrat | Adresse |
|---|---|
| Gateway¹ | `0x9a86fD02247AdCbBCC0d83FaABbFd0Ea936ec279` |
| `VaultManager` | `0xd3aB44E886f9ACf8109598a497F1F9d23CA98496` |
| `OracleManager` | `0x356eF62639e8Fd2c932E0c059Ed2C7Dca96AE96d` |
| `AccessManager` | `0xf9c34A30845353F7B91a6655f80c03417b1f659F` |
| `Treasury` | `0x2e93C4D449ec74B7F686903335Be4C0085d67a02` |
| `GoldAssetFactory` | `0x8e9B45B41BEa26cb2850042eE26e9f23230E2795` |
| `SilverAssetFactory` | `0x063FF031780cE9b0824bE18AC75A54d8C8AD7B2a` |
| `RealEstateAssetFactory` | `0xd6EB26771daD2FF538b4e317f3cdAdd45bCC40fA` |
| `priceSourcePrimary` (ManualPriceSource) | `0x16A1f7EF1DcEE3d8CeCBb24751869E53986634D7` |
| `priceSourceSecondary` (ManualPriceSource) | `0x304a4D91E377bFfd96822a08aCBe26c70Cc4D13c` |
| `ChainlinkPriceSource` (vrai flux Sepolia XAU/USD, réutilisé tel quel) | `0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A` |
| `ChainlinkGoldEurPerGramPriceSource` ×2 (sources actives de `GOLD`) | `0x3598965844edC09d109369a0437aceE0c05A8136`, `0x0a004F2e3c5a3cf8048CDe132829d0B08b43592b` |

¹ Ce déploiement précède le renommage en AETHYX : sur Sourcify et Etherscan, ce contrat reste
vérifié sous son nom de code source d'origine, antérieur au renommage — immuable une fois
déployé, il ne peut pas être renommé sans redéploiement complet. Le code source actuel l'appelle
`AethyxGateway` ; voir `backend/contracts/AethyxGateway.sol`.

L'ancien protocole cœur (`VaultManager` `0x63C5bACc8C4c8d6b18e1c909fAF4b8C5F6646b53` et tout ce
qui en dépendait) reste intégralement fonctionnel on-chain — le frontend cesse seulement de le
référencer, comme pour chaque génération de marché immobilier ci-dessous.

Marché immobilier courant, déployé par `scripts/deploy-real-estate-market.ts` sous l'identifiant
`REAL_ESTATE_PARIS_01_V8` (30 jours, échéancier commun au marché — voir
[`backend/AUDIT.md`](backend/AUDIT.md), constat n°1) le 2026-09-15, sur le protocole cœur ci-dessus
— voir `ignition/deployments/chain-11155111/real_estate_market.json` :

| Composant | Adresse |
|---|---|
| `RealEstateAdapter` | `0xb1b7d1f82C5A185521dE718D56CbEA8c92fEfA98` |
| Token wrappé (`RLD`) | `0x9f562dDfdBcb93cb5Bf3109437de63668FE23128` |
| Sous-jacent ERC-3643 | `0xA8a3F8cE130b2267A4f7f59bD0769Bf631A0316E` |
| `RealEstateAssetFactory` | `0xd6EB26771daD2FF538b4e317f3cdAdd45bCC40fA` (celle du protocole cœur ci-dessus) |

`REAL_ESTATE_PARIS_01_V7` et les versions antérieures restent enregistrées et actives sur
l'**ancien** `VaultManager` — le frontend ne les référence plus, mais quiconque détient déjà leur
token wrappé peut encore les utiliser. Voir [`backend/AUDIT.md`](backend/AUDIT.md), constats n°1 et
n°7, pour l'historique de ces versions.

`ChainlinkPriceSource` est enregistré dans `OracleManager` sous son propre identifiant d'actif
`GOLD_USD_OZ`, et non sous `GOLD` : le flux réel publie des dollars par once troy, tandis que les
entrées `ManualPriceSource` de `GOLD` — et tout le frontend — raisonnent en euros par gramme. Les
câbler sous le même identifiant sans conversion d'unité ferait soit échouer l'agrégation sur la
dispersion, soit étiqueter silencieusement un prix faux. Voir la section Sepolia du README backend
pour le raisonnement.

## Frontend — Next.js

```shell
cd frontend
npm install
cp .env.local.example .env.local   # renseigner les adresses ci-dessus + un project id WalletConnect
npm run dev                        # http://localhost:3000
```

En ligne sur **[aethyx-gateway.vercel.app](https://aethyx-gateway.vercel.app)**, pointé sur le
déploiement Sepolia ci-dessus (protocole cœur et module CDP inclus). Pour déployer le tien, avec
la [CLI Vercel](https://vercel.com/docs/cli) :

```shell
npm run build
npx vercel deploy
```

## Intégration continue

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) s'exécute à chaque push et chaque pull
request :

- **backend** — compilation, typecheck, `hardhat test` (Solidity + TypeScript), `solhint`,
  `eslint`, `prettier --check`.
- **frontend** — `eslint`, `prettier --check`, typecheck, `next build` (sans `.env.local` : le
  build doit réussir non configuré, voir `frontend/src/config/contracts.ts`).

La protection de branche est active sur `master` : les deux jobs ci-dessus sont des status checks
obligatoires, donc un build rouge bloque la fusion d'une PR (les administrateurs du dépôt peuvent
toujours pousser directement — c'est un comportement par défaut de GitHub, pas une faille de cette
configuration). Chaque paquet expose aussi les mêmes vérifications en local : voir
[`backend/README.md`](backend/README.md#lint--format) et
[`frontend/README.md`](frontend/README.md#lint-format-typecheck).

## Notes de sécurité

Une revue de sécurité interne des contrats est consignée dans
[`backend/AUDIT.md`](backend/AUDIT.md) : neuf constats, dont un de sévérité élevée assumé comme
risque accepté. À lire avant toute réutilisation de ce code.

- L'`initialAdmin` d'`AccessManager` devrait être un multisig ou un timelock en production, jamais
  un simple EOA : il peut accorder et révoquer tous les rôles, y compris le sien.
- `ROUTER_ROLE` (détenu par le seul `AethyxGateway`) est pleinement présumé ne transmettre que
  son propre `msg.sender` immédiat — ne jamais l'accorder à quoi que ce soit susceptible de
  transmettre une adresse tierce arbitraire.
- La liquidation du module CDP ne socialise la mauvaise dette qu'à hauteur du fonds d'assurance
  accumulé : un manque supérieur à son solde reste partiellement à la charge du liquidateur, et un
  fonds encore vide (déploiement neuf) ne compense rien. Voir `backend/AUDIT.md`, constat n°8.
- Ceci est du code de démonstration et de testnet (`MockERC3643`, `ManualPriceSource`) — non
  audité, non destiné à porter des fonds en mainnet tel quel.
