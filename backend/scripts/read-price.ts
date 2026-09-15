import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Reads the current aggregated price OracleManager returns for one asset — read-only, no
// transaction sent. Useful to get the value an operator should confirm before deploy-cdp.ts
// registers a new collateral type (see AUDIT.md, finding 9): read it here first, then pass the
// same number back as EXPECTED_GOLD_PRICE_EUR_PER_GRAM.
//
//   PRICE_ASSET_ID=GOLD SEED_NETWORK=sepolia npx hardhat run scripts/read-price.ts --network sepolia
//
// PRICE_ASSET_ID defaults to GOLD; SEED_NETWORK defaults to localhost — same convention as
// deploy-cdp.ts and seed-demo-assets.ts.

const assetIdLabel = process.env.PRICE_ASSET_ID ?? "GOLD";
const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;

const deployed = JSON.parse(
  readFileSync(`ignition/deployments/chain-${chainId}/deployed_addresses.json`, "utf8"),
) as Record<string, string>;
const oracleManagerAddress = deployed["AethyxGateway#OracleManager"];

const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);
const [price, updatedAt] = await oracleManager.getPrice(ethers.id(assetIdLabel));

console.log(`${assetIdLabel} price:`, ethers.formatUnits(price, 18));
console.log("last updated at", new Date(Number(updatedAt) * 1000).toISOString());
