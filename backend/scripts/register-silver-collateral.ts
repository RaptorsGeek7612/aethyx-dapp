import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Registers SILVER as a second CDP collateral type, alongside GOLD (see deploy-cdp.ts) — same
// risk parameters, same operator-confirmed-price safety check (AUDIT.md finding 9), just a
// different asset. Kept as its own script rather than folded into deploy-cdp.ts because it's a
// one-time addition to an already-deployed CDPManager, not part of the module's initial rollout.
//
//   EXPECTED_SILVER_PRICE_EUR_PER_GRAM=0.95 SEED_NETWORK=sepolia npx hardhat run scripts/register-silver-collateral.ts --network sepolia
//
// Read the live price first with:
//   PRICE_ASSET_ID=SILVER SEED_NETWORK=sepolia npx hardhat run scripts/read-price.ts --network sepolia
//
// Re-running is safe: skips if SILVER is already registered.

const SILVER_ASSET_ID_LABEL = "SILVER";
// Same demo values as GOLD in deploy-cdp.ts — placeholders, not a risk assessment.
const MIN_COLLATERAL_RATIO_BPS = 15_000n;
const LIQUIDATION_THRESHOLD_BPS = 13_000n;
const LIQUIDATION_BONUS_BPS = 500n;
const STABILITY_FEE_BPS = 200n;
const DEBT_CEILING = 1_000_000n * 10n ** 18n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const oracleManagerAddress = deployed["InvestOrGateway#OracleManager"];
const vaultManagerAddress = deployed["InvestOrGateway#VaultManager"];

const cdpRecord = JSON.parse(readFileSync(`${deploymentDir}/cdp.json`, "utf8")) as {
  stableToken: string;
  cdpManager: string;
};

const [admin] = await ethers.getSigners();
console.log("Registering SILVER collateral as", admin.address, "on", networkName);

const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);
const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);
const cdpManager = await ethers.getContractAt("CDPManager", cdpRecord.cdpManager);

const silverAssetId = ethers.id(SILVER_ASSET_ID_LABEL);
const silverAsset = await vaultManager.assets(silverAssetId);
if (silverAsset.adapter === ethers.ZeroAddress) {
  throw new Error(`${SILVER_ASSET_ID_LABEL} isn't registered in VaultManager yet — run seed-demo-assets.ts first`);
}

const existingCollateral = await cdpManager.collaterals(silverAssetId);
if (existingCollateral.wrappedToken !== ethers.ZeroAddress) {
  console.log(SILVER_ASSET_ID_LABEL, "already registered as collateral, skipping");
} else {
  const expectedPriceRaw = process.env.EXPECTED_SILVER_PRICE_EUR_PER_GRAM;
  if (!expectedPriceRaw) {
    throw new Error(
      "EXPECTED_SILVER_PRICE_EUR_PER_GRAM is required before registering a new collateral type — " +
        "see this script's header comment and AUDIT.md finding 9. Read the live price first with " +
        "read-price.ts, then pass that number back here.",
    );
  }
  const expectedPrice = ethers.parseUnits(expectedPriceRaw, 18);
  const [livePrice] = await oracleManager.getPrice(silverAssetId);
  const deviationBps =
    (BigInt(10_000) * (livePrice > expectedPrice ? livePrice - expectedPrice : expectedPrice - livePrice)) /
    expectedPrice;
  console.log(
    `${SILVER_ASSET_ID_LABEL} live oracle price: ${ethers.formatUnits(livePrice, 18)} — expected (confirmed by operator): ${expectedPriceRaw}`,
  );
  if (deviationBps > 2_500n) {
    throw new Error(
      `Live price deviates ${Number(deviationBps) / 100}% from EXPECTED_SILVER_PRICE_EUR_PER_GRAM — ` +
        "refusing to register. This is exactly the failure mode finding 9 describes: a collateral " +
        "id whose price isn't in the unit you think it's in. Double-check the assetId and the " +
        "expected value before overriding.",
    );
  }

  await (
    await cdpManager
      .connect(admin)
      .addCollateralType(
        silverAssetId,
        silverAsset.wrappedToken,
        MIN_COLLATERAL_RATIO_BPS,
        LIQUIDATION_THRESHOLD_BPS,
        LIQUIDATION_BONUS_BPS,
        STABILITY_FEE_BPS,
        DEBT_CEILING,
      )
  ).wait();
  console.log(SILVER_ASSET_ID_LABEL, "registered as collateral, wrapped token", silverAsset.wrappedToken);
}
