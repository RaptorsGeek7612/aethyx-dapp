import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Pushes REAL_ESTATE_PARIS_01_V6's current per-token price (its static appraisal ÷ total wrapped
// supply right now) to both of OracleManager's registered ManualPriceSource feeds — the same two
// instances gold/silver already use, just a different assetId.
//
// Unlike gold/silver, this number isn't an independent market price: it moves every time someone
// deposits into or redeems from this market, since that changes the supply it's divided by. Re-run
// this script after every such deposit/redeem, and at least once per OracleManager.maxStaleness
// window (1h on this deployment) even if nobody has — otherwise getPrice(REAL_ESTATE_PARIS_01_V6)
// starts reverting for being stale, the same failure mode gold/silver's live feed already has (see
// ReserveTotal's "too few fresh sources" warning on the frontend).
//
//   REAL_ESTATE_APPRAISAL_EUR=235000 SEED_NETWORK=sepolia npx hardhat run scripts/update-real-estate-price.ts --network sepolia
//
// REAL_ESTATE_APPRAISAL_EUR must match frontend/src/config/assets.ts's appraisalValueEur for this
// market exactly — the two aren't linked on-chain, so this is the one place they can silently
// drift apart if changed in only one of them.

const REAL_ESTATE_LABEL = "REAL_ESTATE_PARIS_01_V8";

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const vaultManagerAddress = deployed["AethyxGateway#VaultManager"];
const priceSourceAddresses = [
  deployed["AethyxGateway#priceSourcePrimary"],
  deployed["AethyxGateway#priceSourceSecondary"],
].filter((address): address is string => Boolean(address));

if (priceSourceAddresses.length === 0) {
  throw new Error("No ManualPriceSource addresses found in deployed_addresses.json");
}

const appraisalRaw = process.env.REAL_ESTATE_APPRAISAL_EUR;
if (!appraisalRaw) {
  throw new Error(
    "REAL_ESTATE_APPRAISAL_EUR is required — state the same figure frontend/src/config/assets.ts uses " +
      "as this market's appraisalValueEur, so the two can't silently drift apart.",
  );
}
const appraisalEur = ethers.parseUnits(appraisalRaw, 18);

const [admin] = await ethers.getSigners();
const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);

const assetId = ethers.id(REAL_ESTATE_LABEL);
const asset = await vaultManager.assets(assetId);
if (asset.wrappedToken === ethers.ZeroAddress) {
  throw new Error(`${REAL_ESTATE_LABEL} isn't registered in VaultManager`);
}

// Every wrapped RWA token in this deployment uses 18 decimals (see transaction-history.tsx's
// same assumption on the frontend) — supply is already 18dp, matching appraisalEur's own scale.
const wrapped = await ethers.getContractAt(["function totalSupply() view returns (uint256)"], asset.wrappedToken);
const supply = await wrapped.totalSupply();
if (supply === 0n) {
  throw new Error(`${REAL_ESTATE_LABEL} has zero supply right now — nothing to price yet.`);
}

const pricePerToken = (appraisalEur * 10n ** 18n) / supply;
console.log(
  `${REAL_ESTATE_LABEL}: ${appraisalRaw} EUR ÷ ${ethers.formatUnits(supply, 18)} tokens = ` +
    `${ethers.formatUnits(pricePerToken, 18)} EUR/token`,
);

for (const sourceAddress of priceSourceAddresses) {
  const source = await ethers.getContractAt("ManualPriceSource", sourceAddress);
  await (await source.connect(admin).setPrice(assetId, pricePerToken)).wait();
  console.log("Pushed to", sourceAddress);
}

console.log("\nDone. Re-run this after the next deposit/redeem on this market, or within the hour if not.");
