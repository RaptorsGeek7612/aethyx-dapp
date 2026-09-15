import { readFileSync } from "node:fs";
import { network } from "hardhat";

// One-off: seed-demo-assets.ts registers a plain REAL_ESTATE_PARIS_01 market (90-day lockup,
// generic demo seeding shared with GOLD/SILVER) as a side effect of bootstrapping a brand new
// core protocol. The market that's actually meant to be live is REAL_ESTATE_PARIS_01_V8 (30-day
// lockup, deploy-real-estate-market.ts) — same treatment as every prior redeploy, see AUDIT.md
// finding 1. Freezes the demo one, same safety check as harden-legacy-real-estate.ts: only if
// nobody holds it, since setAssetActive(false) also blocks redemption.
//
//   npx hardhat run scripts/freeze-demo-real-estate-base.ts --network sepolia

const networkName = process.env.SEED_NETWORK ?? "sepolia";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;

const deployed = JSON.parse(
  readFileSync(`ignition/deployments/chain-${chainId}/deployed_addresses.json`, "utf8"),
) as Record<string, string>;
const vaultManager = await ethers.getContractAt("VaultManager", deployed["AethyxGateway#VaultManager"]);
const [admin] = await ethers.getSigners();

const assetId = ethers.id("REAL_ESTATE_PARIS_01");
const config = await vaultManager.assets(assetId);
if (config.adapter === ethers.ZeroAddress) {
  throw new Error("REAL_ESTATE_PARIS_01 isn't registered — nothing to freeze");
}
if (!config.active) {
  console.log("Already frozen");
} else {
  const supply: bigint = await (
    await ethers.getContractAt(["function totalSupply() view returns (uint256)"], config.wrappedToken)
  ).totalSupply();
  if (supply > 0n) {
    throw new Error(`REAL_ESTATE_PARIS_01 has ${ethers.formatUnits(supply, 18)} outstanding — refusing to freeze`);
  }
  await (await vaultManager.connect(admin).setAssetActive(assetId, false)).wait();
  console.log("REAL_ESTATE_PARIS_01 (demo, 90-day) frozen — REAL_ESTATE_PARIS_01_V8 is the live market");
}
