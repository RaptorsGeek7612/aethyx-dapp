# AETHYX Gateway — frontend

dApp Next.js pour envelopper et racheter les classes d'actifs d'AETHYX Gateway, et consulter
en direct les données de réserve et d'oracle. Voir le [README racine](../README.md) pour
l'architecture du protocole auquel cette interface s'adresse.

## Pile technique

Next.js 16 (App Router, Turbopack) + TypeScript, [wagmi v2](https://wagmi.sh) pour les lectures
et écritures on-chain, [viem](https://viem.sh) comme client sous-jacent, et
[RainbowKit](https://rainbowkit.com) pour la connexion de portefeuille (MetaMask, portefeuilles
mobiles via WalletConnect, portefeuilles injectés). Mise en forme par Tailwind CSS v4 et les
composants shadcn/ui (`src/components/ui/`).

> `AGENTS.md`, dans ce répertoire, signale que cette version majeure de Next.js comporte des
> ruptures par rapport aux conventions antérieures — consulte `node_modules/next/dist/docs/`
> avant de supposer que les API familières s'appliquent encore.

## Installation

```shell
npm install
cp .env.local.example .env.local
```

À renseigner dans `.env.local` :

| Variable | D'où elle vient |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Gratuit sur [cloud.walletconnect.com](https://cloud.walletconnect.com) — nécessaire uniquement aux portefeuilles mobiles via WalletConnect ; MetaMask et les portefeuilles injectés fonctionnent sans. |
| `NEXT_PUBLIC_GATEWAY_ADDRESS`, `NEXT_PUBLIC_VAULT_MANAGER_ADDRESS`, `NEXT_PUBLIC_ORACLE_MANAGER_ADDRESS` | Depuis `backend/ignition/deployments/chain-<id>/deployed_addresses.json`, après exécution d'Ignition (voir le README backend). |
| `NEXT_PUBLIC_PRICE_SOURCE_ADDRESSES` | `priceSourcePrimary,priceSourceSecondary` séparées par une virgule, issues du même déploiement — servent à rejouer l'historique des événements `PriceUpdated` pour le graphique de prix, puisque `OracleManager.getPrice` ne renvoie que l'agrégat courant. |

Laissées vides, l'interface s'affiche quand même : elle se signale comme « non configurée » (voir
`src/config/contracts.ts`) au lieu de planter, et la CI construit sans aucun `.env.local`.

## Lancer

```shell
npm run dev     # http://localhost:3000
npm run build   # build de production
npm run start   # sert le build de production
```

## Lint, format, typecheck

```shell
npm run lint           # eslint (eslint-config-next core-web-vitals + typescript)
npm run format         # prettier --write
npm run format:check   # vérification en mode CI, sans écriture
npx tsc --noEmit       # typecheck
```

Tout ce qui précède s'exécute en CI à chaque push et chaque PR — voir
[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Structure

- `src/app/page.tsx` — tableau de bord d'enveloppement et de rachat : portefeuille, dialogue
  d'action par actif.
- `src/app/reserve/page.tsx` — couverture de la réserve et prix d'oracle, par actif.
- `src/config/` — configuration wagmi (`wagmi.ts`), adresses de contrats issues de
  l'environnement (`contracts.ts`), métadonnées d'actifs (`assets.ts`).
- `src/hooks/` — lectures basées sur wagmi (données d'actif, prix, historique) et le flux
  d'écriture d'enveloppement et de rachat (`use-wrap-actions.ts`).
- `src/lib/abis/` — fragments d'ABI sélectionnés à la main, contrat par contrat (et non la sortie
  complète du compilateur), pour que le bundle n'embarque que ce que l'interface appelle
  réellement.

### L'immobilier n'a pas de sélecteur de durée

La durée de blocage n'est pas un choix offert au déposant : `RealEstateAdapter.lockupPeriod` est
immuable et appartient au marché dans lequel on dépose. L'interface la lit sur l'adaptateur et
l'affiche en lecture seule dans l'onglet de dépôt — elle ne la propose pas.

L'immobilier emprunte donc exactement le même chemin que l'or et l'argent : `AssetActionDialog`,
`PortfolioAssetRow`, `ReserveCard`. Les composants qui existaient pour regrouper cinq marchés par
durée ont disparu.

Côté rachat, les dépôts ne se fondent jamais en un échéancier unique : l'adaptateur enregistre une
tranche par dépôt et les purge de la plus ancienne à la plus récente. L'interface lit
`lockSchedule()` et affiche une ligne par dépôt encore bloqué, avec son propre décompte — la
tranche la plus ancienne se libère à son heure, quoi qu'on ait déposé ensuite.

Ce calendrier est celui du **marché**, pas du porteur qui le consulte, parce que le plafond de
rachat l'est aussi. Afficher « ton » échéancier promettrait une date que l'adaptateur n'honore
pas : c'est la réserve mûre du marché qui autorise un rachat, identique pour tous.

## Déploiement

En ligne sur **[investor-gateway.vercel.app](https://investor-gateway.vercel.app)**. Pour
redéployer :

```shell
npm run build
npx vercel deploy
```

Les variables d'environnement vivent dans les réglages du projet Vercel, pas dans un fichier
versionné — définis-les ou mets-les à jour avec `npx vercel env add <NOM> production` (la valeur
est demandée de façon interactive), ou via le tableau de bord. Un build ne prend en compte une
variable nouvellement ajoutée qu'au déploiement *suivant* ; force-en un avec
`npx vercel --prod --force` si tu viens d'en changer une.
