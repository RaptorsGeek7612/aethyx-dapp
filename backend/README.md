# Invest'Or Gateway — backend

Solidity contracts, tests, and Hardhat 3 Ignition deployment modules for the Invest'Or Gateway
protocol. See the [root README](../README.md) for the full architecture and the protocol-level
"why". This file covers day-to-day work in this directory.

## Stack

Hardhat 3 (`@nomicfoundation/hardhat-toolbox-mocha-ethers`), Solidity 0.8.35, OpenZeppelin
Contracts 5.x, `forge-std` for Solidity-side tests, ethers v6 + Mocha/Chai for TypeScript tests.

## Setup

```shell
npm install
```

## Compile, test, typecheck

```shell
npx hardhat build          # compile
npx hardhat test           # Solidity (.t.sol) + TypeScript (test/*.ts) tests
npx tsc --noEmit           # typecheck test/scripts/ignition code against the compiled ABI
```

Run just one layer:

```shell
npx hardhat test solidity
npx hardhat test mocha
```

## Lint & format

```shell
npm run lint        # solhint (contracts/) + eslint (test/, scripts/, ignition/)
npm run lint:sol     # solhint only
npm run lint:ts      # eslint only
npm run format       # prettier --write, including prettier-plugin-solidity
npm run format:check # CI-mode check, no writes
```

All four run in CI on every push/PR — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Contracts (`contracts/`)

| Contract | Role |
|---|---|
| `AccessManager` | Central `AccessControl` registry — every other contract checks roles here instead of managing its own. |
| `InvestOrGateway` | Single user-facing entry point (`deposit`/`redeem`). Holds no funds; forwards `msg.sender` straight through to `VaultManager`. |
| `VaultManager` | Orchestrator. Registers asset adapters, enforces fees, mints/burns wrapped tokens. Invariant: wrapped supply always equals value locked. Guarded by `Pausable` + `ReentrancyGuard`. |
| `AssetAdapter` (+ `GoldAdapter`, `SilverAdapter`, `RealEstateAdapter`) | Custodies one ERC-3643 asset, runs compliance pre-checks, normalizes decimals to 18. |
| `*AssetFactory` (Gold/Silver/RealEstate) | Deploys an adapter + wrapped ERC-20 pair together and registers them with `VaultManager`. One factory per asset class — a single factory embedding every adapter's bytecode exceeded the EIP-170 contract size limit. |
| `OracleManager` | Aggregates multiple price sources per asset into a manipulation-resistant median; excludes stale or divergent sources instead of trusting any single feed. |
| `ManualPriceSource` | Admin-pushable price feed implementing `IPriceSource`, used as both a secondary source and a way to inject hostile test prices. |
| `ChainlinkPriceSource` | `IPriceSource` wrapper around a real Chainlink `AggregatorV3Interface` feed — rejects negative/zero prices, incomplete or stale rounds, and normalizes the feed's decimals to 18. |
| `Treasury` | Collects protocol fee revenue; withdrawal gated behind `TREASURY_MANAGER_ROLE`. |

Mocks used only in tests live in `contracts/mocks/`: `MockERC3643` (a minimal T-REX stand-in with
a whitelist/compliance switch), `MockAggregatorV3` (reproduces Chainlink's aggregator, including
negative/stale/incomplete/reverting rounds), and `ReentrantERC3643` (a malicious underlying whose
transfer hooks try to re-enter `VaultManager`, for the reentrancy-guard tests).

## Deploy locally

```shell
npx hardhat node                                                   # separate terminal
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network localhost
npx hardhat run scripts/seed-demo-assets.ts --network localhost    # seeds demo Gold/Silver/RealEstate
```

## Deploy to Sepolia

Set the deployer key once, via the encrypted Hardhat keystore (preferred — never ends up in
cleartext on disk) or as a plain environment variable:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

`SEPOLIA_RPC_URL` works the same way — `npx hardhat keystore set SEPOLIA_RPC_URL` or an
environment variable. Environment variables take precedence over the keystore if both are set.

```shell
npx hardhat ignition deploy ignition/modules/InvestOrGateway.ts --network sepolia
SEED_NETWORK=sepolia npx hardhat run scripts/seed-demo-assets.ts --network sepolia
```

Deployed addresses land in `ignition/deployments/chain-<id>/deployed_addresses.json` — see the
root README for the current Sepolia deployment's addresses.

`ManualPriceSource` prices go stale after `maxStaleness` and `OracleManager` reverts rather than
serve a stale price. The Ignition module deploys with a 1h window, appropriate for active
development; the live Sepolia deployment has been reconfigured to 30 days
(`OracleManager.setConfig(2_592_000, maxDeviationBps, minSources)`) since nothing pushes prices on
a schedule in this demo — a 1h window just meant the UI went "unavailable" every hour until someone
manually refreshed it. Push fresh prices with:

```typescript
import { network } from "hardhat";
const { ethers } = await network.create();
const [signer] = await ethers.getSigners(); // must hold ORACLE_UPDATER_ROLE
const source = await ethers.getContractAt("ManualPriceSource", "<priceSourcePrimary address>", signer);
await source.setPrice(ethers.id("GOLD"), ethers.parseUnits("92", 18));
```

### ChainlinkPriceSource on Sepolia — a unit mismatch, not a bug

The real Sepolia XAU/USD feed (`0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea`, confirmed live on-chain)
reports USD per troy ounce. Everything else in this protocol — the `GOLD` asset's
`ManualPriceSource` entries, and the frontend's whole valuation model
(`appraisalValueEur`, `priceEurPerGram`) — is built around EUR per gram. Those are two different
units in two different currencies, off by roughly three orders of magnitude; registering the raw
feed under `GOLD` would make `OracleManager`'s deviation filter reject it outright (or, worse, if
it ever did pass, mislabel a USD/oz number as EUR/gram everywhere in the UI).

`ChainlinkPriceSource` is deployed and registered, but under its own asset id (`GOLD_USD_OZ`),
kept deliberately separate from the `GOLD` id the frontend reads. Query it directly —
`ChainlinkPriceSource.latestPrice(anyBytes32)` ignores the argument — to see the real feed working;
`OracleManager.getPrice(GOLD_USD_OZ)` will revert on `InsufficientFreshSources` since it's the only
source registered there and `minSources` is 2 by default. That revert is correct: it means no
second, unit-matched source has been added for that id, not that something is broken. Properly
wiring Chainlink into `GOLD` itself means converting units (a small on-chain conversion, or an
off-chain-priced `ManualPriceSource` kept in sync with the ounce feed) and is tracked as future
work, not done here.

## Security notes

- `AccessManager`'s `initialAdmin` should be a multisig or timelock in production, never a plain
  EOA — it can grant and revoke every role, including itself.
- `ROUTER_ROLE` (held only by `InvestOrGateway`, then permanently locked via `lockRouterRole`) is
  fully trusted to only ever forward its own immediate `msg.sender` — never grant it to anything
  that might pass through an arbitrary third-party address.
- This is demo/testnet code (`MockERC3643`, `ManualPriceSource`) — not audited, not intended for
  mainnet funds as-is.
