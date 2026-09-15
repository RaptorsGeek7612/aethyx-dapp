# Hardhat + ethers project

## Project layout

```
contracts/        Solidity source files (*.sol) and unit tests (*.t.sol)
test/             TypeScript integration tests and Solidity unit tests (*.sol)
ignition/         Hardhat Ignition deployment modules
scripts/          Standalone scripts run with `hardhat run`
hardhat.config.ts
```

## Working in this project

When writing or modifying tests, configuring `hardhat.config.ts`, or interacting with the network from TypeScript, invoke the **`hardhat`** skill. It covers Solidity and TypeScript testing, how to choose between them, `forge-std` cheatcodes, the `network.create()` API, `networkHelpers`, and the compile-then-typecheck workflow. The skill itself points to the matching `hardhat-toolbox-*` skill for toolbox-specific guidance (signers, contract interaction, assertions).

## Redeploying the core protocol

Learned the hard way during the 2026-09-15 redeploy for AUDIT.md findings 2-6 — check all three
before the next one:

- **Deployment-record JSON files leak across generations.** Scripts like `wire-real-gold-price.ts`
  and `deploy-cdp.ts` cache their own progress in `ignition/deployments/chain-<id>/*.json`
  (`gold-price-source.json`, `cdp.json`), keyed only by chain id — not by which protocol
  generation produced them. After a full core redeploy, a script's idempotency check ("already
  done, skip") can find the *previous* generation's file and silently reuse its addresses instead
  of deploying fresh ones. Delete/move the stale file first.
- **`deployed_addresses.json` keys carry the Ignition module's name, not a fixed constant.** The
  module is `AethyxGateway` today (`InvestOrGateway` pre-rename); both prefixes can coexist in the
  same file after a redeploy. Every script reading `deployed["InvestOrGateway#X"]` needs updating
  to the current prefix — it won't error, it'll silently target the retired deployment. Exception:
  scripts whose whole point is managing the retired instance (`harden-legacy-real-estate.ts`,
  `redeploy-cdp-manager.ts`) should keep the old prefix.
- **Build-profile cache breaks Sourcify verification silently.** `hardhat ignition deploy` compiles
  with the `production` profile (optimizer on); plain `hardhat run scripts/*.ts` compiles with
  `default` (optimizer off) — and whichever profile a command last used stays active in
  `artifacts/` even across unrelated `hardhat run` invocations. `hardhat verify sourcify` / `hardhat
  ignition verify` compare on-chain bytecode against whatever's *currently* in `artifacts/`, so a
  mismatched profile fails with a confusing "bytecode doesn't match any local contract" (HHE80009)
  instead of a build-profile hint. Verify Ignition-deployed contracts with `--build-profile
  production`; verify standalone-script-deployed contracts with the plain default profile (`hardhat
  build --no-tests --force` for a clean one). When in doubt, compare `artifacts/.../X.json`'s
  `deployedBytecode` length against `eth_getCode` on-chain before trusting a verification attempt.

## Docs

- Hardhat 3 — https://hardhat.org/llms.txt
- ethers.js — https://docs.ethers.org/v6/
