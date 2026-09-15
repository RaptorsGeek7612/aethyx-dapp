import { writeFileSync } from "node:fs";
import { network } from "hardhat";

// One-off recovery for the 2026-09-15 core protocol redeploy: wire-real-gold-price.ts found a
// gold-price-source.json left over from the *previous* deployment (same chain id, different
// protocol instance) and reused those old ChainlinkGoldEurPerGramPriceSource addresses instead of
// deploying fresh ones. Those old sources read the EUR/USD leg from the *old* priceSourcePrimary,
// which nobody has refreshed today, and the new OracleManager still had the Ignition module's
// default 1h staleness window — so GOLD ended up with 2 registered-but-permanently-stale sources
// and getPrice(GOLD) reverting InsufficientFreshSources(0 found, 2 required).
//
// This script: restores the 30-day staleness window the live Sepolia deployment always runs with
// (see backend/README.md's "Fraîcheur des prix" section — nothing pushes prices on a schedule in
// this demo), removes the two stale sources, deploys two fresh ones tied to the new
// priceSourcePrimary, and registers them.
//
//   EXPECTED_EUR_USD_RATE=1.157 EXPECTED_GOLD_PRICE_EUR_PER_GRAM=122 SEED_NETWORK=sepolia \
//     npx hardhat run scripts/fix-gold-oracle-wiring.ts --network sepolia

import { readFileSync } from "node:fs";

const STALE_SOURCES = ["0x210Fa1Da88E3a3aD16910E1a07d1330327eA86e8", "0x89aF3c2623473e1d8b900d0F8F029E1832A669a9"];
const CHAINLINK_XAU_USD_SOURCE = "0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A";
const GOLD_LABEL = "GOLD";
const EUR_USD_RATE_LABEL = "EUR_USD_RATE";
const THIRTY_DAYS_SECONDS = 2_592_000n;
const MAX_DEVIATION_BPS = 2_500n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const oracleManagerAddress = deployed["AethyxGateway#OracleManager"];
const priceSourcePrimaryAddress = deployed["AethyxGateway#priceSourcePrimary"];

const [admin] = await ethers.getSigners();
console.log("Fixing GOLD oracle wiring as", admin.address, "on", networkName);

const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);
const priceSourcePrimary = await ethers.getContractAt("ManualPriceSource", priceSourcePrimaryAddress);
const goldAssetId = ethers.id(GOLD_LABEL);
const eurUsdRateAssetId = ethers.id(EUR_USD_RATE_LABEL);

// --- 1. Restore the 30-day staleness window every live Sepolia deployment runs with -------------
const currentConfig = await oracleManager.config();
if (currentConfig.maxStaleness !== THIRTY_DAYS_SECONDS) {
  await (
    await oracleManager
      .connect(admin)
      .setConfig(THIRTY_DAYS_SECONDS, currentConfig.maxDeviationBps, currentConfig.minSources)
  ).wait();
  console.log("maxStaleness set to 30 days (was", currentConfig.maxStaleness.toString(), "seconds)");
} else {
  console.log("maxStaleness already 30 days");
}

// --- 2. Remove the two stale sources reused from the old deployment ------------------------------
for (const stale of STALE_SOURCES) {
  const stillRegistered = await oracleManager.removePriceSource
    .staticCall(goldAssetId, stale)
    .then(() => true)
    .catch(() => false);
  if (stillRegistered) {
    await (await oracleManager.connect(admin).removePriceSource(goldAssetId, stale)).wait();
    console.log("Removed stale source", stale);
  } else {
    console.log("Stale source", stale, "already not registered");
  }
}

// --- 3. Push a fresh EUR/USD rate onto the *new* priceSourcePrimary ------------------------------
const expectedEurUsdRaw = process.env.EXPECTED_EUR_USD_RATE;
if (!expectedEurUsdRaw) {
  throw new Error("EXPECTED_EUR_USD_RATE is required — the current USD price of 1 EUR, e.g. 1.157.");
}
const eurUsdRate = ethers.parseUnits(expectedEurUsdRaw, 18);
await (await priceSourcePrimary.connect(admin).setPrice(eurUsdRateAssetId, eurUsdRate)).wait();
console.log(`EUR/USD rate pushed: ${expectedEurUsdRaw}`);

// --- 4. Deploy two fresh sources tied to the new priceSourcePrimary ------------------------------
const one = await ethers.deployContract(
  "ChainlinkGoldEurPerGramPriceSource",
  [CHAINLINK_XAU_USD_SOURCE, priceSourcePrimaryAddress, eurUsdRateAssetId],
  admin,
);
await one.waitForDeployment();
const two = await ethers.deployContract(
  "ChainlinkGoldEurPerGramPriceSource",
  [CHAINLINK_XAU_USD_SOURCE, priceSourcePrimaryAddress, eurUsdRateAssetId],
  admin,
);
await two.waitForDeployment();
const sourceOne = await one.getAddress();
const sourceTwo = await two.getAddress();
console.log("Deployed two fresh sources:", sourceOne, sourceTwo);

const readOnlySourceOne = await ethers.getContractAt("ChainlinkGoldEurPerGramPriceSource", sourceOne);
const [computedPrice] = await readOnlySourceOne.latestPrice(ethers.ZeroHash);
console.log("New sources compute GOLD at:", ethers.formatUnits(computedPrice, 18), "EUR/gram");

const expectedGoldPriceRaw = process.env.EXPECTED_GOLD_PRICE_EUR_PER_GRAM;
if (!expectedGoldPriceRaw) {
  throw new Error("EXPECTED_GOLD_PRICE_EUR_PER_GRAM is required — confirm the computed price above looks right.");
}
const expectedGoldPrice = ethers.parseUnits(expectedGoldPriceRaw, 18);
const deviationBps =
  (10_000n *
    (computedPrice > expectedGoldPrice ? computedPrice - expectedGoldPrice : expectedGoldPrice - computedPrice)) /
  expectedGoldPrice;
if (deviationBps > MAX_DEVIATION_BPS) {
  throw new Error(
    `Computed price deviates ${Number(deviationBps) / 100}% from ${expectedGoldPriceRaw} — refusing to register.`,
  );
}
console.log(`Within tolerance (${Number(deviationBps) / 100}% deviation).`);

// --- 5. Register the two fresh sources under GOLD ------------------------------------------------
await (await oracleManager.connect(admin).addPriceSource(goldAssetId, sourceOne)).wait();
await (await oracleManager.connect(admin).addPriceSource(goldAssetId, sourceTwo)).wait();
console.log("Registered both fresh sources under GOLD");

writeFileSync(`${deploymentDir}/gold-price-source.json`, JSON.stringify({ sourceOne, sourceTwo }, null, 2) + "\n");

const [finalPrice, finalUpdatedAt] = await oracleManager.getPrice(goldAssetId);
console.log(
  "\nOracleManager.getPrice(GOLD) now:",
  ethers.formatUnits(finalPrice, 18),
  "EUR/gram, updatedAt",
  new Date(Number(finalUpdatedAt) * 1000).toISOString(),
);
