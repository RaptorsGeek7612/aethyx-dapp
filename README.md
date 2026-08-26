# Invest'Or Gateway

An ERC-3643 → ERC-20 wrap protocol: lock a permissioned, compliance-gated real-world asset
(RWA) token and mint a freely-transferable ERC-20 against it 1:1 (minus a configurable fee),
one-for-one redeemable back. Gold, silver and tokenized real estate ship as the first three
asset classes.

- **`backend/`** — Solidity contracts, tests, and Hardhat 3 Ignition deployment modules.
- **`frontend/`** — Next.js dApp for wrapping/redeeming and viewing reserve/oracle data.

## Why wrap ERC-3643 tokens?

[ERC-3643](https://eips.ethereum.org/EIPS/eip-3643) tokens (the standard used for regulated
RWA issuance) carry transfer restrictions — only whitelisted, compliance-checked addresses can
hold or move them. That makes them hard to use in ordinary DeFi. Invest'Or Gateway locks the
ERC-3643 token behind an adapter that *is* whitelisted, and mints a plain ERC-20 against it
that anyone can hold and trade freely, while the underlying collateral stays fully backed and
redeemable 1:1 by the original holder.

## Architecture

```
                    ┌────────────────────┐
   user ──────────► │  InvestOrGateway    │  stable entry point, never custodies funds
                    └─────────┬───────────┘
                              │ depositFor / redeemFor (ROUTER_ROLE)
                    ┌─────────▼───────────┐        ┌──────────────┐
                    │    VaultManager      │◄──────►│   Treasury   │  fee revenue
                    │  registry + fees +   │        └──────────────┘
                    │  mint/burn orchestr. │
                    └──┬────────────────┬──┘
                       │                │
              ┌────────▼───────┐  ┌─────▼──────────┐
              │  AssetAdapter   │  │  Wrapped ERC-20 │  one per asset (GLDToken, ...)
              │ (Gold/Silver/   │  └─────────────────┘
              │  RealEstate)    │
              └────────┬────────┘
                       │ custodies
              ┌────────▼────────┐
              │ ERC-3643 token   │  the real, compliance-gated RWA token
              └─────────────────┘

   ┌────────────────┐        ┌───────────────────────────────┐
   │  OracleManager  │◄───────│ Gold/Silver/RealEstateAsset-   │  deploy adapter + wrapped
   │  median price,  │        │ Factory                        │  token together, register
   │  staleness +    │        └───────────────────────────────┘  with VaultManager
   │  deviation gate │
   └────────▲────────┘
            │ addPriceSource
   ┌────────┴────────┐
   │ ManualPriceSource │  × N per asset (independent feeds)
   └───────────────────┘

   AccessManager — single AccessControl registry every contract above checks roles against
```

**Core contracts** (`backend/contracts/`)

| Contract | Role |
|---|---|
| `AccessManager` | Central `AccessControl` registry — every other contract checks roles here instead of managing its own. |
| `InvestOrGateway` | Single user-facing entry point (`deposit`/`redeem`). Holds no funds; forwards `msg.sender` straight through to `VaultManager`. |
| `VaultManager` | Orchestrator. Registers asset adapters, enforces fees, mints/burns wrapped tokens. Invariant: wrapped supply always equals value locked. |
| `AssetAdapter` (+ `GoldAdapter`, `SilverAdapter`, `RealEstateAdapter`) | Custodies one ERC-3643 asset, runs compliance pre-checks, normalizes decimals to 18. |
| `*AssetFactory` (Gold/Silver/RealEstate) | Deploys an adapter + wrapped ERC-20 pair together and registers them with `VaultManager`. Split into one factory per asset class — a single factory embedding every adapter's bytecode exceeded the EIP-170 contract size limit. |
| `OracleManager` | Aggregates multiple price sources per asset into a manipulation-resistant median; excludes stale or divergent sources instead of trusting any single feed. |
| `ManualPriceSource` | Admin-pushable price feed implementing `IPriceSource` — a secondary source and a way to inject hostile test prices. |
| `ChainlinkPriceSource` | `IPriceSource` wrapper around a real Chainlink `AggregatorV3Interface` feed — rejects negative/zero prices, incomplete or stale rounds, normalizes decimals to 18. |
| `Treasury` | Collects protocol fee revenue. |

## Backend — Hardhat 3

```
cd backend
npm install
npx hardhat compile
npx hardhat test              # Solidity + TypeScript tests
```

### Deploy locally

```shell
npx hardhat node                                                   # separate terminal
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network localhost
npx hardhat run scripts/seed-demo-assets.ts --network localhost    # seeds demo Gold/Silver/RealEstate
```

### Deploy to Sepolia

Set a deployer key (never commit it):

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
# or export SEPOLIA_PRIVATE_KEY / SEPOLIA_RPC_URL as env vars — env vars take precedence
```

```shell
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network sepolia
SEED_NETWORK=sepolia npx hardhat run scripts/seed-demo-assets.ts --network sepolia
```

Current Sepolia deployment (`backend/ignition/deployments/chain-11155111/`):

| Contract | Address |
|---|---|
| `InvestOrGateway` | `0x10C5FfF00b81977f4eEbe24A392d59FCb35B4287` |
| `VaultManager` | `0x9B963bf48d23434B6499593cB421f7a147041Fc2` |
| `OracleManager` | `0x5a63a28Bb0a2CFe8c47D2a2532E5713818d4b95A` |
| `AccessManager` | `0xc10B6c37Ff4041a4F1a583Ef15E9f6d2bE290237` |
| `Treasury` | `0x328A3dA508917d070FB4052d2ED62794CcA68312` |
| `GoldAssetFactory` | `0x50Ab15B0E2781b48Bd9035cB543Da0C4d1877ab5` |
| `SilverAssetFactory` | `0x04d23917f214fc2Cd80BB5e71f8327102681E91e` |
| `RealEstateAssetFactory` | `0xccf12a4a35d500C399223a1aB47e3e8D00c72793` |

## Frontend — Next.js

```shell
cd frontend
npm install
cp .env.local.example .env.local   # fill in the addresses above + a WalletConnect project id
npm run dev                        # http://localhost:3000
```

Deploy with the [Vercel CLI](https://vercel.com/docs/cli):

```shell
npm run build
npx vercel deploy
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request:

- **backend** — compile, typecheck, `hardhat test` (Solidity + TypeScript), `solhint`, `eslint`,
  `prettier --check`.
- **frontend** — `eslint`, `prettier --check`, typecheck, `next build` (with no `.env.local` —
  the build must succeed unconfigured, see `frontend/src/config/contracts.ts`).

A red build should block merge — enable branch protection on the GitHub repo (require the `CI`
status checks to pass before merging) to enforce that; it isn't configured by this workflow file
alone. Each package also exposes the same checks locally: see
[`backend/README.md`](backend/README.md#lint--format) and
[`frontend/README.md`](frontend/README.md#lint-format-typecheck).

## Security notes

- `AccessManager`'s `initialAdmin` should be a multisig or timelock in production, never a
  plain EOA — it can grant and revoke every role, including itself.
- `ROUTER_ROLE` (held only by `InvestOrGateway`) is fully trusted to only ever forward its own
  immediate `msg.sender` — never grant it to anything that might pass through an arbitrary
  third-party address.
- This is demo/testnet code (`MockERC3643`, `ManualPriceSource`) — not audited, not intended
  for mainnet funds as-is.
