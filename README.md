# Invest'Or Gateway

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
Cela les rend difficiles à utiliser dans la DeFi ordinaire. Invest'Or Gateway verrouille le
token ERC-3643 derrière un adaptateur qui, lui, *est* inscrit sur liste blanche, et émet contre
lui un ERC-20 ordinaire que n'importe qui peut détenir et échanger librement — le collatéral
sous-jacent restant intégralement adossé et rachetable 1:1 par son détenteur d'origine.

## Architecture

```
                    ┌────────────────────┐
 utilisateur ─────► │  InvestOrGateway    │  point d'entrée stable, ne détient jamais de fonds
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
| `InvestOrGateway` | Point d'entrée unique côté utilisateur (`deposit`/`redeem`). Ne détient aucun fonds ; transmet `msg.sender` tel quel à `VaultManager`. |
| `VaultManager` | Chef d'orchestre. Enregistre les adaptateurs d'actifs, applique les frais, émet et brûle les tokens wrappés. Invariant : l'offre wrappée égale toujours la valeur verrouillée. |
| `AssetAdapter` (+ `GoldAdapter`, `SilverAdapter`, `RealEstateAdapter`) | Prend en garde un actif ERC-3643, exécute les contrôles de conformité préalables, normalise les décimales à 18. |
| `*AssetFactory` (Gold/Silver/RealEstate) | Déploie ensemble un couple adaptateur + ERC-20 wrappé et l'enregistre auprès de `VaultManager`. Découpé en une fabrique par classe d'actif : une fabrique unique embarquant le bytecode de tous les adaptateurs dépassait la limite de taille EIP-170. |
| `OracleManager` | Agrège plusieurs sources de prix par actif en une médiane résistante à la manipulation ; exclut les sources périmées ou divergentes au lieu de faire confiance à un flux unique. |
| `ManualPriceSource` | Flux de prix alimenté par un administrateur, implémentant `IPriceSource` — source secondaire et moyen d'injecter des prix hostiles en test. |
| `ChainlinkPriceSource` | Enveloppe `IPriceSource` autour d'un vrai flux Chainlink `AggregatorV3Interface` — rejette les prix nuls ou négatifs, les rounds incomplets ou périmés, normalise les décimales à 18. |
| `Treasury` | Collecte le produit des frais de protocole. |

### Note sur l'immobilier : la durée de blocage appartient au contrat

`RealEstateAdapter` impose une durée de détention minimale avant rachat, parce que le règlement
d'une opération immobilière prend un temps réel. Cette durée, `lockupPeriod`, est **immuable** :
elle est fixée une fois pour toutes au déploiement du marché, et n'est jamais un paramètre du
dépôt. C'est ainsi qu'un protocole DeFi exprime normalement une période de détention — une
propriété du contrat dans lequel on dépose. L'interface la lit sur l'adaptateur et l'affiche ;
elle ne la propose pas.

La contrainte porte sur le **collatéral du marché**, pas sur les adresses : chaque dépôt alimente
une réserve commune qui mûrit après `lockupPeriod`, et tout rachat puise dans la part déjà mûre.
Cadencer la sortie du collatéral plutôt que filtrer les adresses préserve la promesse du wrap — le
token wrappé reste intégralement transférable — tout en rendant le blocage réellement contraignant.
Une conception antérieure, indexée sur l'adresse qui rachète, se contournait par un simple
auto-transfert : voir [`backend/AUDIT.md`](backend/AUDIT.md), constat n°1.

Chaque dépôt garde sa propre échéance : un dépôt ultérieur ne repousse jamais un dépôt antérieur,
et le rachat est plafonné à ce qui est mûr plutôt que bloqué en tout ou rien.

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
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network localhost
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
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network sepolia
SEED_NETWORK=sepolia npx hardhat run scripts/seed-demo-assets.ts --network sepolia
```

Déploiement Sepolia courant (`backend/ignition/deployments/chain-11155111/`), redéployé pour
inclure le verrouillage de `ROUTER_ROLE` et le durcissement d'`OracleManager` — vérifié
`exact_match` sur [Sourcify](https://sourcify.dev) :

| Contrat | Adresse |
|---|---|
| `InvestOrGateway` | `0xb2aE412cE8c8af237Df28cF1fE06599D33F08d59` |
| `VaultManager` | `0x63C5bACc8C4c8d6b18e1c909fAF4b8C5F6646b53` |
| `OracleManager` | `0x3B5d8fbF69e4672D618639437d13A09204104DF5` |
| `AccessManager` | `0x177528950CD48409c5bC74a8B9A1e280c7e8072f` |
| `Treasury` | `0xCF8D2F6ecc058555C28DCa1838F76FEf71cf9Bd9` |
| `GoldAssetFactory` | `0x6BDd2C9eEb6031b8d2aBc49b5d080cc13CA87941` |
| `SilverAssetFactory` | `0x0AFE40BC4Ae1603Ba86Af972eec1D422E9ce42f0` |
| `RealEstateAssetFactory` | `0x0d759a29967EfC713Bd44682e5A1193848d692cE` |
| `priceSourcePrimary` (ManualPriceSource) | `0x7656d3AdC0c464a8945417697Ceb78640B8a8933` |
| `priceSourceSecondary` (ManualPriceSource) | `0x21D2e5dc6D2400c460039F8597c148429d12cd2f` |
| `ChainlinkPriceSource` (vrai flux Sepolia XAU/USD) | `0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A` |

Marché immobilier courant, déployé par `scripts/deploy-real-estate-market.ts` sous l'identifiant
`REAL_ESTATE_PARIS_01_V4` (blocage de 30 jours, calendrier global) — voir
`ignition/deployments/chain-11155111/real_estate_market.json` :

| Composant | Adresse |
|---|---|
| `RealEstateAdapter` | `0x7aE821eb6e47E8A2CCAf62A309e22a3762d63700` |
| Token wrappé (`RLD`) | `0xCFBC854Fa6115DAC6B3b92C4C960dd9D77b810D8` |
| Sous-jacent ERC-3643 | `0x49CEfD290FcdCDb951E68C68cbae7400551aebf9` |
| `RealEstateAssetFactory` (redéployée) | `0xABB4C7D09bD9e7F4a5822b37405c747B13ed71aD` |

La fabrique de la table précédente (`0x0d759a29…92cE`) émettait encore l'adaptateur d'origine :
une fabrique fige le bytecode de son adaptateur au moment où elle est compilée. Voir
[`backend/AUDIT.md`](backend/AUDIT.md), constat n°7.

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

En ligne sur **[investor-gateway.vercel.app](https://investor-gateway.vercel.app)**, pointé sur le
déploiement Sepolia ci-dessus. Pour déployer le tien, avec la
[CLI Vercel](https://vercel.com/docs/cli) :

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
[`backend/AUDIT.md`](backend/AUDIT.md) : six constats, dont un de sévérité élevée sur le
contournement du blocage immobilier. À lire avant toute réutilisation de ce code.

- L'`initialAdmin` d'`AccessManager` devrait être un multisig ou un timelock en production, jamais
  un simple EOA : il peut accorder et révoquer tous les rôles, y compris le sien.
- `ROUTER_ROLE` (détenu par le seul `InvestOrGateway`) est pleinement présumé ne transmettre que
  son propre `msg.sender` immédiat — ne jamais l'accorder à quoi que ce soit susceptible de
  transmettre une adresse tierce arbitraire.
- Ceci est du code de démonstration et de testnet (`MockERC3643`, `ManualPriceSource`) — non
  audité, non destiné à porter des fonds en mainnet tel quel.
