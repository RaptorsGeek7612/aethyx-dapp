# Invest'Or Gateway — backend

Contrats Solidity, tests et modules de déploiement Hardhat 3 Ignition du protocole Invest'Or
Gateway. Voir le [README racine](../README.md) pour l'architecture complète et le « pourquoi » au
niveau protocole. Ce fichier-ci couvre le travail quotidien dans ce répertoire.

## Pile technique

Hardhat 3 (`@nomicfoundation/hardhat-toolbox-mocha-ethers`), Solidity 0.8.35, OpenZeppelin
Contracts 5.x, `forge-std` pour les tests côté Solidity, ethers v6 + Mocha/Chai pour les tests
TypeScript.

## Installation

```shell
npm install
```

## Compiler, tester, typecheck

```shell
npx hardhat build          # compilation
npx hardhat test           # tests Solidity (.t.sol) + TypeScript (test/*.ts)
npx tsc --noEmit           # typecheck de test/, scripts/ et ignition/ contre l'ABI compilée
```

Pour n'exécuter qu'une seule couche :

```shell
npx hardhat test solidity
npx hardhat test mocha
```

## Lint & format

```shell
npm run lint         # solhint (contracts/) + eslint (test/, scripts/, ignition/)
npm run lint:sol     # solhint seul
npm run lint:ts      # eslint seul
npm run format       # prettier --write, avec prettier-plugin-solidity
npm run format:check # vérification en mode CI, sans écriture
```

Les quatre s'exécutent en CI à chaque push et chaque PR — voir
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Contrats (`contracts/`)

| Contrat | Rôle |
|---|---|
| `AccessManager` | Registre `AccessControl` central — tous les autres contrats y vérifient leurs rôles au lieu de gérer les leurs. |
| `InvestOrGateway` | Point d'entrée unique côté utilisateur (`deposit`/`redeem`). Ne détient aucun fonds ; transmet `msg.sender` tel quel à `VaultManager`. |
| `VaultManager` | Chef d'orchestre. Enregistre les adaptateurs d'actifs, applique les frais, émet et brûle les tokens wrappés. Invariant : l'offre wrappée égale toujours la valeur verrouillée. Protégé par `Pausable` + `ReentrancyGuard`. |
| `AssetAdapter` (+ `GoldAdapter`, `SilverAdapter`, `RealEstateAdapter`) | Prend en garde un actif ERC-3643, exécute les contrôles de conformité préalables, normalise les décimales à 18. |
| `*AssetFactory` (Gold/Silver/RealEstate) | Déploie ensemble un couple adaptateur + ERC-20 wrappé et l'enregistre auprès de `VaultManager`. Une fabrique par classe d'actif : une fabrique unique embarquant le bytecode de tous les adaptateurs dépassait la limite de taille EIP-170. |
| `OracleManager` | Agrège plusieurs sources de prix par actif en une médiane résistante à la manipulation ; exclut les sources périmées ou divergentes au lieu de faire confiance à un flux unique. |
| `ManualPriceSource` | Flux de prix alimenté par un administrateur, implémentant `IPriceSource` ; sert à la fois de source secondaire et de moyen d'injecter des prix hostiles en test. |
| `ChainlinkPriceSource` | Enveloppe `IPriceSource` autour d'un vrai flux Chainlink `AggregatorV3Interface` — rejette les prix nuls ou négatifs, les rounds incomplets ou périmés, et normalise les décimales du flux à 18. |
| `Treasury` | Collecte le produit des frais de protocole ; retrait protégé par `TREASURY_MANAGER_ROLE`. |

Les doublures utilisées uniquement en test vivent dans `contracts/mocks/` : `MockERC3643` (une
doublure T-REX minimale avec liste blanche et interrupteur de conformité), `MockAggregatorV3`
(reproduit l'agrégateur Chainlink, y compris les rounds négatifs, périmés, incomplets ou en
échec) et `ReentrantERC3643` (un sous-jacent malveillant dont les hooks de transfert tentent de
réentrer `VaultManager`, pour les tests de protection contre la réentrance).

### L'immobilier : la durée de blocage appartient au marché

`RealEstateAdapter.lockupPeriod` est immuable, fixée au déploiement du marché. Ce n'est jamais un
paramètre du dépôt, et l'interface se contente de la lire et de l'afficher.

Le blocage porte sur le **collatéral du marché**, pas sur les adresses : chaque dépôt ajoute au
calendrier commun une tranche qui mûrit après `lockupPeriod`, et `withdraw` plafonne la libération
à ce que le marché a de mûr, quel que soit le racheteur. Le token wrappé, lui, reste intégralement
transférable à tout instant — seule sa conversion en sous-jacent est cadencée.

Chaque dépôt garde sa propre échéance : un dépôt ultérieur ne repousse jamais un dépôt antérieur.

Une conception antérieure indexait le blocage sur l'adresse qui rachète, en exemptant qui n'avait
jamais déposé. Le token wrappé étant librement transférable, cette exemption s'obtenait par un
simple auto-transfert et le blocage ne contraignait personne — voir [`AUDIT.md`](AUDIT.md),
constat n°1.

## Déploiement local

```shell
npx hardhat node                                                   # dans un terminal séparé
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network localhost
npx hardhat run scripts/seed-demo-assets.ts --network localhost    # amorce les actifs de démo
```

## Déploiement sur Sepolia

Enregistre la clé de déploiement une fois pour toutes, via le keystore Hardhat chiffré
(à préférer — rien ne se retrouve en clair sur le disque) ou en variable d'environnement :

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

`SEPOLIA_RPC_URL` fonctionne de la même façon — `npx hardhat keystore set SEPOLIA_RPC_URL` ou une
variable d'environnement. Les variables d'environnement ont priorité sur le keystore si les deux
sont définies.

> `configVariable("SEPOLIA_PRIVATE_KEY")` dans `hardhat.config.ts` attend le **nom** d'une entrée
> du keystore, pas sa valeur. Y coller directement l'URL RPC ou la clé fait chercher à Hardhat une
> entrée portant ce nom, qui n'existe pas — et le déploiement échoue sur le prompt de mot de passe
> sans explication claire. Une clé privée Ethereum fait par ailleurs 64 caractères hexadécimaux
> (66 avec le préfixe `0x`) : toute autre longueur n'en est pas une.

Le déverrouillage du keystore se fait par un prompt interactif : le déploiement exige donc un vrai
terminal, il ne passera pas dans un shell non interactif ni en CI. En CI, utilise les variables
d'environnement.

```shell
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network sepolia
SEED_NETWORK=sepolia npx hardhat run scripts/seed-demo-assets.ts --network sepolia
```

Les adresses déployées atterrissent dans
`ignition/deployments/chain-<id>/deployed_addresses.json` — voir le README racine pour les adresses
du déploiement Sepolia courant.

### Déployer le marché immobilier

```shell
npx hardhat run scripts/deploy-real-estate-market.ts --network sepolia
```

Déploie un marché immobilier unique — un `RealEstateAdapter` et son token wrappé — sous
l'identifiant `REAL_ESTATE_PARIS_01_V3`, avec un blocage de 30 jours, en réutilisant le
sous-jacent ERC-3643 que détient déjà le marché antérieur. `VaultManager.registerAsset` revert sur
un identifiant déjà connu et il n'existe aucun moyen de repointer un identifiant existant vers un
nouvel adaptateur : tout nouveau marché doit donc porter un identifiant neuf, que le frontend doit
retrouver dans `frontend/src/config/assets.ts`. Le script est idempotent — relancé après un succès,
il signale que l'identifiant est déjà enregistré et ne fait rien. Le résultat est écrit dans
`ignition/deployments/chain-<id>/real_estate_market.json`.

### Fraîcheur des prix

Les prix de `ManualPriceSource` se périment après `maxStaleness`, et `OracleManager` revert plutôt
que de servir un prix périmé. Le module Ignition déploie avec une fenêtre d'une heure, adaptée au
développement actif ; le déploiement Sepolia en ligne a été reconfiguré à 30 jours
(`OracleManager.setConfig(2_592_000, maxDeviationBps, minSources)`) puisque rien ne pousse de prix
à intervalle régulier dans cette démo — une fenêtre d'une heure signifiait seulement que
l'interface passait en « indisponible » toutes les heures jusqu'à ce que quelqu'un la rafraîchisse
à la main. Pour pousser des prix frais :

```typescript
import { network } from "hardhat";
const { ethers } = await network.create();
const [signer] = await ethers.getSigners(); // doit détenir ORACLE_UPDATER_ROLE
const source = await ethers.getContractAt("ManualPriceSource", "<adresse priceSourcePrimary>", signer);
await source.setPrice(ethers.id("GOLD"), ethers.parseUnits("92", 18));
```

### ChainlinkPriceSource sur Sepolia — une incohérence d'unités, pas un bug

Le vrai flux Sepolia XAU/USD (`0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea`, confirmé actif
on-chain) publie des dollars par once troy. Tout le reste du protocole — les entrées
`ManualPriceSource` de l'actif `GOLD`, et tout le modèle de valorisation du frontend
(`appraisalValueEur`, `priceEurPerGram`) — raisonne en euros par gramme. Ce sont deux unités
différentes dans deux devises différentes, séparées par environ trois ordres de grandeur :
enregistrer le flux brut sous `GOLD` ferait rejeter la source par le filtre de dispersion
d'`OracleManager` — ou, pire, s'il venait à passer, étiquetterait partout dans l'interface un
chiffre USD/once comme un prix EUR/gramme.

`ChainlinkPriceSource` est déployé et enregistré, mais sous son propre identifiant d'actif
(`GOLD_USD_OZ`), délibérément séparé de l'identifiant `GOLD` que lit le frontend. Interroge-le
directement — `ChainlinkPriceSource.latestPrice(anyBytes32)` ignore son argument — pour voir le
vrai flux fonctionner ; `OracleManager.getPrice(GOLD_USD_OZ)` revert sur
`InsufficientFreshSources`, puisque c'est la seule source enregistrée là et que `minSources` vaut 2
par défaut. Ce revert est correct : il signifie qu'aucune seconde source, cohérente en unités, n'a
été ajoutée pour cet identifiant — pas que quelque chose est cassé. Câbler proprement Chainlink
dans `GOLD` lui-même suppose une conversion d'unités (petite conversion on-chain, ou une
`ManualPriceSource` valorisée hors chaîne et tenue synchrone avec le flux en onces) ; c'est un
travail futur, pas fait ici.

## Notes de sécurité

Revue de sécurité complète des contrats : [`AUDIT.md`](AUDIT.md).

- L'`initialAdmin` d'`AccessManager` devrait être un multisig ou un timelock en production, jamais
  un simple EOA : il peut accorder et révoquer tous les rôles, y compris le sien.
- `ROUTER_ROLE` (détenu par le seul `InvestOrGateway`, puis verrouillé définitivement via
  `lockRouterRole`) est pleinement présumé ne transmettre que son propre `msg.sender` immédiat —
  ne jamais l'accorder à quoi que ce soit susceptible de transmettre une adresse tierce arbitraire.
- Ceci est du code de démonstration et de testnet (`MockERC3643`, `ManualPriceSource`) — non
  audité, non destiné à porter des fonds en mainnet tel quel.
