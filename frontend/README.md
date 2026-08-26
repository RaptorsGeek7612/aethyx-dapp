# Invest'Or Gateway — frontend

Next.js dApp for wrapping/redeeming Invest'Or Gateway's asset classes and viewing live
reserve/oracle data. See the [root README](../README.md) for the protocol architecture this UI
talks to.

## Stack

Next.js 16 (App Router, Turbopack) + TypeScript, [wagmi v2](https://wagmi.sh) for on-chain
reads/writes, [viem](https://viem.sh) as the underlying client, and
[RainbowKit](https://rainbowkit.com) for wallet connection (MetaMask, WalletConnect-based mobile
wallets, injected wallets). Styling via Tailwind CSS v4 and shadcn/ui components
(`src/components/ui/`).

> `AGENTS.md` in this directory flags that this Next.js major version has breaking changes vs.
> older conventions — check `node_modules/next/dist/docs/` before assuming familiar APIs still
> apply.

## Setup

```shell
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Free at [cloud.walletconnect.com](https://cloud.walletconnect.com) — only needed for WalletConnect-based mobile wallets; MetaMask/injected wallets work without it. |
| `NEXT_PUBLIC_GATEWAY_ADDRESS`, `NEXT_PUBLIC_VAULT_MANAGER_ADDRESS`, `NEXT_PUBLIC_ORACLE_MANAGER_ADDRESS` | From `backend/ignition/deployments/chain-<id>/deployed_addresses.json` after running Ignition (see backend README). |
| `NEXT_PUBLIC_PRICE_SOURCE_ADDRESSES` | Comma-separated `priceSourcePrimary,priceSourceSecondary` from the same deployment — used to replay `PriceUpdated` event history for the price chart, since `OracleManager.getPrice` only returns the current aggregate. |

Left unset, the UI still renders — it flags itself as "not configured" (see
`src/config/contracts.ts`) instead of crashing, and CI builds with no `.env.local` at all.

## Run

```shell
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Lint, format, typecheck

```shell
npm run lint          # eslint (eslint-config-next core-web-vitals + typescript)
npm run format         # prettier --write
npm run format:check   # CI-mode check, no writes
npx tsc --noEmit       # typecheck
```

All of the above run in CI on every push/PR — see
[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Structure

- `src/app/page.tsx` — wrap/redeem dashboard: portfolio, per-asset action dialog.
- `src/app/reserve/page.tsx` — reserve coverage and oracle price view per asset.
- `src/config/` — wagmi config (`wagmi.ts`), contract addresses from env (`contracts.ts`), asset
  metadata (`assets.ts`).
- `src/hooks/` — wagmi-based reads (asset data/price/history) and the wrap/redeem write flow
  (`use-wrap-actions.ts`).
- `src/lib/abis/` — hand-picked ABI fragments per contract (not the full compiler output) so the
  bundle only ships what the UI actually calls.

## Deploy

```shell
npm run build
npx vercel deploy
```

Set the same environment variables in the Vercel project settings as in `.env.local`.
