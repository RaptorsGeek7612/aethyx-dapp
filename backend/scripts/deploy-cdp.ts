import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys the CDP module (StableToken + CDPManager) on top of an already-deployed core protocol,
// wires up its roles, and registers GOLD as its first collateral type. Everything the core
// InvestOrGateway Ignition module deliberately leaves out, in the same spirit as
// seed-demo-assets.ts and deploy-real-estate-market.ts: the core module never grows contracts
// that weren't part of the original protocol.
//
//   EXPECTED_GOLD_PRICE_EUR_PER_GRAM=92.40 hardhat run scripts/deploy-cdp.ts --network localhost
//
// Set SEED_NETWORK to target a different network (e.g. `sepolia`) already deployed via Ignition.
// Re-running is safe: each step is skipped if it has already been done.
//
// EXPECTED_GOLD_PRICE_EUR_PER_GRAM is required before addCollateralType runs — see AUDIT.md,
// finding 9: nothing on-chain stops registering a collateral whose oracle price is denominated
// in the wrong unit (the GOLD-vs-GOLD_USD_OZ trap the README documents for VaultManager applies
// here too), so the operator states the price they expect in the unit they expect it in, and the
// script refuses to proceed if the live oracle reading is more than 25% off from it.

const GOLD_ASSET_ID_LABEL = "GOLD";
// 150 % to open or increase a position, liquidatable below 130 % — see CDPManager.sol's natspec
// for why the gap between the two matters. Placeholder demo values, not a risk assessment.
const MIN_COLLATERAL_RATIO_BPS = 15_000n;
const LIQUIDATION_THRESHOLD_BPS = 13_000n;
// 2%/year, linear, minted to Treasury as it accrues — see CDPManager.sol's _currentDebt natspec.
const STABILITY_FEE_BPS = 200n;
const DEBT_CEILING = 1_000_000n * 10n ** 18n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const accessManagerAddress = deployed["InvestOrGateway#AccessManager"];
const oracleManagerAddress = deployed["InvestOrGateway#OracleManager"];
const vaultManagerAddress = deployed["InvestOrGateway#VaultManager"];
const treasuryAddress = deployed["InvestOrGateway#Treasury"];

const [admin] = await ethers.getSigners();
console.log("Deploying CDP module as", admin.address, "on", networkName);

const accessManager = await ethers.getContractAt("AccessManager", accessManagerAddress);
const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);
const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);

// --- 1. StableToken + CDPManager, or the ones already recorded from a previous run -------------
const cdpRecordPath = `${deploymentDir}/cdp.json`;
const cdpRecord = existsSync(cdpRecordPath)
  ? (JSON.parse(readFileSync(cdpRecordPath, "utf8")) as { stableToken?: string; cdpManager?: string })
  : {};

if (!cdpRecord.stableToken || !cdpRecord.cdpManager) {
  const stableToken = await ethers.deployContract(
    "StableToken",
    ["AETHYX Stable EUR", "ioEUR", accessManagerAddress],
    admin,
  );
  await stableToken.waitForDeployment();
  cdpRecord.stableToken = await stableToken.getAddress();
  console.log("StableToken deployed at", cdpRecord.stableToken);

  const cdpManager = await ethers.deployContract(
    "CDPManager",
    [accessManagerAddress, oracleManagerAddress, cdpRecord.stableToken, treasuryAddress],
    admin,
  );
  await cdpManager.waitForDeployment();
  cdpRecord.cdpManager = await cdpManager.getAddress();
  console.log("CDPManager deployed at", cdpRecord.cdpManager);

  writeFileSync(cdpRecordPath, JSON.stringify(cdpRecord, null, 2) + "\n");
} else {
  console.log("StableToken/CDPManager already deployed — reusing", cdpRecord.stableToken, cdpRecord.cdpManager);
}

const cdpManager = await ethers.getContractAt("CDPManager", cdpRecord.cdpManager!);

// --- 2. Roles ------------------------------------------------------------------------------------
const riskManagerRole = await accessManager.RISK_MANAGER_ROLE();
if (!(await accessManager.hasRole(riskManagerRole, admin.address))) {
  await (await accessManager.connect(admin).grantRole(riskManagerRole, admin.address)).wait();
  console.log("RISK_MANAGER_ROLE granted to", admin.address);
} else {
  console.log("RISK_MANAGER_ROLE already held by", admin.address);
}

const debtMinterRole = await accessManager.DEBT_MINTER_ROLE();
if (!(await accessManager.hasRole(debtMinterRole, cdpManager.target))) {
  await (await accessManager.connect(admin).grantRole(debtMinterRole, cdpManager.target)).wait();
  console.log("DEBT_MINTER_ROLE granted to CDPManager");
} else {
  console.log("DEBT_MINTER_ROLE already held by CDPManager");
}

// --- 3. GOLD as the first collateral type ---------------------------------------------------------
//
// Reuses VaultManager's own GOLD wrapped token and the same assetId under which its price is
// registered in OracleManager — see CDPManager.addCollateralType's natspec on why the id must
// match a price feed denominated in the same unit as the stablecoin's nominal peg (EUR here,
// same trap as GOLD vs GOLD_USD_OZ documented in the README).
const goldAssetId = ethers.id(GOLD_ASSET_ID_LABEL);
const goldAsset = await vaultManager.assets(goldAssetId);
if (goldAsset.adapter === ethers.ZeroAddress) {
  throw new Error(`${GOLD_ASSET_ID_LABEL} isn't registered in VaultManager yet — run seed-demo-assets.ts first`);
}

const existingCollateral = await cdpManager.collaterals(goldAssetId);
if (existingCollateral.wrappedToken === ethers.ZeroAddress) {
  const expectedPriceRaw = process.env.EXPECTED_GOLD_PRICE_EUR_PER_GRAM;
  if (!expectedPriceRaw) {
    throw new Error(
      "EXPECTED_GOLD_PRICE_EUR_PER_GRAM is required before registering a new collateral type — " +
        "see this script's header comment and AUDIT.md finding 9. Example: " +
        "EXPECTED_GOLD_PRICE_EUR_PER_GRAM=92.40",
    );
  }
  const expectedPrice = ethers.parseUnits(expectedPriceRaw, 18);
  const [livePrice] = await oracleManager.getPrice(goldAssetId);
  const deviationBps =
    (BigInt(10_000) * (livePrice > expectedPrice ? livePrice - expectedPrice : expectedPrice - livePrice)) /
    expectedPrice;
  console.log(
    `${GOLD_ASSET_ID_LABEL} live oracle price: ${ethers.formatUnits(livePrice, 18)} — expected (confirmed by operator): ${expectedPriceRaw}`,
  );
  if (deviationBps > 2_500n) {
    throw new Error(
      `Live price deviates ${Number(deviationBps) / 100}% from EXPECTED_GOLD_PRICE_EUR_PER_GRAM — ` +
        "refusing to register. This is exactly the failure mode finding 9 describes: a collateral " +
        "id whose price isn't in the unit you think it's in (e.g. GOLD_USD_OZ instead of GOLD). " +
        "Double-check the assetId and the expected value before overriding.",
    );
  }

  await (
    await cdpManager
      .connect(admin)
      .addCollateralType(
        goldAssetId,
        goldAsset.wrappedToken,
        MIN_COLLATERAL_RATIO_BPS,
        LIQUIDATION_THRESHOLD_BPS,
        STABILITY_FEE_BPS,
        DEBT_CEILING,
      )
  ).wait();
  console.log(GOLD_ASSET_ID_LABEL, "registered as collateral, wrapped token", goldAsset.wrappedToken);
} else {
  console.log(GOLD_ASSET_ID_LABEL, "already registered as collateral, skipping");
}

console.log("\nCDP module ready:");
console.log("  StableToken", cdpRecord.stableToken);
console.log("  CDPManager ", cdpRecord.cdpManager);
console.log(
  `\nNext: approve CDPManager for GLD, then cdpManager.depositCollateral(${GOLD_ASSET_ID_LABEL} id, amount) and mintDebt(...) — no frontend wiring yet.`,
);
