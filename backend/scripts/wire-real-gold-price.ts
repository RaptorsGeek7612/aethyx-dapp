import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Switches GOLD from two fully-manual ManualPriceSource entries to a real Chainlink XAU/USD feed
// converted into EUR/gram — closing (for gold specifically) the centralization risk AUDIT.md
// flags: "le prix affiché est celui que l'administrateur veut bien pousser, et la médiane de deux
// sources tenues par la même main n'apporte aucune protection réelle."
//
// No Chainlink EUR/USD feed was found deployed on Sepolia testnet (checked directly on-chain
// against several candidate addresses; only mainnet ones exist) — so the EUR leg of the
// conversion is still a manually-pushed rate, same trust model as today's gold price. What
// changes: the commodity price itself now tracks the real market automatically; only a currency
// exchange rate remains administered, a materially smaller trust surface than the full price.
//
// Deploys two ChainlinkGoldEurPerGramPriceSource instances (same twin-instance-for-quorum pattern
// RealEstateOnChainPriceSource already uses), both wired to the existing real Chainlink XAU/USD
// wrapper and to priceSourcePrimary for the EUR/USD leg. Pushes the EUR/USD rate, registers both
// new sources under GOLD, sanity-checks the resulting price against an operator-confirmed value,
// and only then removes the two old manual GOLD sources — refusing to remove them if the new
// sources disagree with what the operator expects, the same deviation guard deploy-cdp.ts and
// redeploy-cdp-manager.ts already use before ever writing.
//
//   EXPECTED_EUR_USD_RATE=1.08 EXPECTED_GOLD_PRICE_EUR_PER_GRAM=127.90 SEED_NETWORK=sepolia \
//     npx hardhat run scripts/wire-real-gold-price.ts --network sepolia
//
// Re-running is safe: each step below is skipped once it's already done, checked directly
// on-chain rather than assumed from a local record file.

const GOLD_LABEL = "GOLD";
const EUR_USD_RATE_LABEL = "EUR_USD_RATE";
// Deployed once, ad hoc, wrapping the real Sepolia XAU/USD Chainlink feed
// (0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea) — see backend/README.md's "ChainlinkPriceSource
// sur Sepolia" section. Not in deployed_addresses.json because it was never part of the Ignition
// module.
const CHAINLINK_XAU_USD_SOURCE = "0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A";
// How far the newly-computed GOLD price may deviate from the operator's own expectation before
// this script refuses to remove the old manual sources — same 2,500 bps (25%) tolerance
// redeploy-cdp-manager.ts uses for its own operator-confirmed-price check.
const MAX_DEVIATION_BPS = 2_500n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const accessManagerAddress = deployed["InvestOrGateway#AccessManager"];
const oracleManagerAddress = deployed["InvestOrGateway#OracleManager"];
const priceSourcePrimaryAddress = deployed["InvestOrGateway#priceSourcePrimary"];
const priceSourceSecondaryAddress = deployed["InvestOrGateway#priceSourceSecondary"];

const [admin] = await ethers.getSigners();
console.log("Wiring the real gold price as", admin.address, "on", networkName);

const accessManager = await ethers.getContractAt("AccessManager", accessManagerAddress);
const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);
const priceSourcePrimary = await ethers.getContractAt("ManualPriceSource", priceSourcePrimaryAddress);

const goldAssetId = ethers.id(GOLD_LABEL);
const eurUsdRateAssetId = ethers.id(EUR_USD_RATE_LABEL);

const assetManagerRole = ethers.id("ASSET_MANAGER_ROLE");
if (!(await accessManager.hasRole(assetManagerRole, admin.address))) {
  await (await accessManager.connect(admin).grantRole(assetManagerRole, admin.address)).wait();
  console.log("ASSET_MANAGER_ROLE granted to", admin.address);
}
const oracleUpdaterRole = ethers.id("ORACLE_UPDATER_ROLE");
if (!(await accessManager.hasRole(oracleUpdaterRole, admin.address))) {
  await (await accessManager.connect(admin).grantRole(oracleUpdaterRole, admin.address)).wait();
  console.log("ORACLE_UPDATER_ROLE granted to", admin.address);
}

// --- 1. The EUR/USD rate, operator-confirmed like every other price this session pushes. ------
const expectedEurUsdRaw = process.env.EXPECTED_EUR_USD_RATE;
if (!expectedEurUsdRaw) {
  throw new Error("EXPECTED_EUR_USD_RATE is required — the current USD price of 1 EUR, e.g. 1.08.");
}
const eurUsdRate = ethers.parseUnits(expectedEurUsdRaw, 18);
await (await priceSourcePrimary.connect(admin).setPrice(eurUsdRateAssetId, eurUsdRate)).wait();
console.log(`EUR/USD rate pushed: ${expectedEurUsdRaw} (1 EUR = ${expectedEurUsdRaw} USD)`);

// --- 2. Deploy the two new sources, reusing a prior run's if this script already did so. -------
const recordPath = `${deploymentDir}/gold-price-source.json`;
const priorRun = (() => {
  try {
    return JSON.parse(readFileSync(recordPath, "utf8")) as { sourceOne: string; sourceTwo: string };
  } catch {
    return null;
  }
})();

let sourceOne: string;
let sourceTwo: string;
if (priorRun) {
  sourceOne = priorRun.sourceOne;
  sourceTwo = priorRun.sourceTwo;
  console.log("Reusing previously-deployed sources:", sourceOne, sourceTwo);
} else {
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
  sourceOne = await one.getAddress();
  sourceTwo = await two.getAddress();
  console.log("Deployed two new sources:", sourceOne, sourceTwo);
  writeFileSync(recordPath, JSON.stringify({ sourceOne, sourceTwo }, null, 2) + "\n");
}

// --- 3. Prove what they report before registering or touching anything live. -------------------
const readOnlySourceOne = await ethers.getContractAt("ChainlinkGoldEurPerGramPriceSource", sourceOne);
const [computedPrice] = await readOnlySourceOne.latestPrice(ethers.ZeroHash);
console.log("New sources compute GOLD at:", ethers.formatUnits(computedPrice, 18), "EUR/gram");

const expectedGoldPriceRaw = process.env.EXPECTED_GOLD_PRICE_EUR_PER_GRAM;
if (!expectedGoldPriceRaw) {
  throw new Error(
    "EXPECTED_GOLD_PRICE_EUR_PER_GRAM is required — confirm the computed price above looks right " +
      "before this script removes the old manual sources. Check a live gold price in EUR/gram " +
      "independently, then pass that number back here.",
  );
}
const expectedGoldPrice = ethers.parseUnits(expectedGoldPriceRaw, 18);
const deviationBps =
  (10_000n *
    (computedPrice > expectedGoldPrice ? computedPrice - expectedGoldPrice : expectedGoldPrice - computedPrice)) /
  expectedGoldPrice;
if (deviationBps > MAX_DEVIATION_BPS) {
  throw new Error(
    `Computed price deviates ${Number(deviationBps) / 100}% from ${expectedGoldPriceRaw} — refusing to remove the ` +
      "manual sources. Check EXPECTED_EUR_USD_RATE and EXPECTED_GOLD_PRICE_EUR_PER_GRAM for a mistake before retrying.",
  );
}
console.log(`Within tolerance of the operator-confirmed price (${Number(deviationBps) / 100}% deviation).`);

// --- 4. Register the two new sources under GOLD, then retire the two manual ones. --------------
// removePriceSource reverts SourceNotRegistered if the address isn't currently registered under
// this assetId — simulated via staticCall (no state change, no gas) to check idempotently
// whether a prior run already completed this step, rather than trusting the local record file
// for something this consequential.
const primaryStillRegistered = await oracleManager.removePriceSource
  .staticCall(goldAssetId, priceSourcePrimaryAddress)
  .then(() => true)
  .catch(() => false);

if (primaryStillRegistered) {
  await (await oracleManager.connect(admin).addPriceSource(goldAssetId, sourceOne)).wait();
  await (await oracleManager.connect(admin).addPriceSource(goldAssetId, sourceTwo)).wait();
  console.log("Registered both new sources under GOLD");

  await (await oracleManager.connect(admin).removePriceSource(goldAssetId, priceSourcePrimaryAddress)).wait();
  await (await oracleManager.connect(admin).removePriceSource(goldAssetId, priceSourceSecondaryAddress)).wait();
  console.log("Removed the two manual sources from GOLD");
} else {
  console.log("Already switched over on a previous run — nothing left to do.");
}

const [finalPrice, finalUpdatedAt] = await oracleManager.getPrice(goldAssetId);
console.log(
  "\nOracleManager.getPrice(GOLD) now:",
  ethers.formatUnits(finalPrice, 18),
  "EUR/gram, updatedAt",
  new Date(Number(finalUpdatedAt) * 1000).toISOString(),
);
console.log(
  "\nGOLD's price now tracks the real Sepolia XAU/USD feed automatically. Re-push " +
    "EXPECTED_EUR_USD_RATE via priceSourcePrimary.setPrice(keccak256('EUR_USD_RATE'), ...) " +
    "whenever the EUR/USD rate needs updating — nothing else about this wiring changes.",
);
