import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys a fresh CDPManager and re-registers GOLD and SILVER as its collateral, on top of the
// StableToken/Treasury/OracleManager already in place. Needed because CDPManager.liquidate's
// signature and CollateralConfig's shape changed (partial liquidation, liquidationBonusBps — see
// AUDIT.md finding 12) and this protocol's contracts aren't upgradeable: the old CDPManager keeps
// running exactly as before (existing positions there stay open, repayable, withdrawable, and
// liquidatable under its old two-argument liquidate), it just doesn't grow any more collateral
// types or accept anyone new — this script's whole point is to be the one everything *new* points
// at from here on.
//
// Does NOT re-register REAL_ESTATE_PARIS_01_V7 — deploy that market first with
// deploy-real-estate-market.ts, then run register-real-estate-collateral.ts, which reads the
// CDPManager address this script writes below.
//
//   EXPECTED_GOLD_PRICE_EUR_PER_GRAM=92.40 EXPECTED_SILVER_PRICE_EUR_PER_GRAM=1.05 \
//     SEED_NETWORK=sepolia hardhat run scripts/redeploy-cdp-manager.ts --network sepolia
//
// Re-running is safe: skips collateral registration for whichever of GOLD/SILVER is already on
// the CDPManager address currently on record — but note that re-running after this script has
// already deployed once will target that same new CDPManager, not deploy yet another one; delete
// its entry from cdp.json first if a second fresh instance is really what's wanted.

const GOLD_LABEL = "GOLD";
const SILVER_LABEL = "SILVER";
// Same demo values as the collaterals being replaced — placeholders, not a risk assessment.
const MIN_COLLATERAL_RATIO_BPS = 15_000n;
const LIQUIDATION_THRESHOLD_BPS = 13_000n;
const LIQUIDATION_BONUS_BPS = 500n;
const STABILITY_FEE_BPS = 200n;
const DEBT_CEILING = 1_000_000n * 10n ** 18n;
const INSURANCE_FUND_FEE_BPS = 5_000n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const accessManagerAddress = deployed["InvestOrGateway#AccessManager"];
const oracleManagerAddress = deployed["InvestOrGateway#OracleManager"];
const vaultManagerAddress = deployed["InvestOrGateway#VaultManager"];
const treasuryAddress = deployed["InvestOrGateway#Treasury"];

const cdpRecordPath = `${deploymentDir}/cdp.json`;
const previousRecord = JSON.parse(readFileSync(cdpRecordPath, "utf8")) as {
  stableToken: string;
  cdpManager: string;
};
const stableTokenAddress = previousRecord.stableToken;
const oldCdpManagerAddress = previousRecord.cdpManager;

const [admin] = await ethers.getSigners();
console.log("Redeploying CDPManager as", admin.address, "on", networkName);
console.log("Reusing StableToken at", stableTokenAddress, "— old CDPManager was", oldCdpManagerAddress);

const accessManager = await ethers.getContractAt("AccessManager", accessManagerAddress);
const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);
const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);

const cdpManager = await ethers.deployContract(
  "CDPManager",
  [accessManagerAddress, oracleManagerAddress, stableTokenAddress, treasuryAddress],
  admin,
);
await cdpManager.waitForDeployment();
const newCdpManagerAddress = await cdpManager.getAddress();
console.log("New CDPManager deployed at", newCdpManagerAddress);

// --- Roles: the new CDPManager needs DEBT_MINTER_ROLE to mint/burn StableToken; the old one keeps
// whatever it already holds, since its own open positions still need to repay and burn.
const riskManagerRole = ethers.id("RISK_MANAGER_ROLE");
if (!(await accessManager.hasRole(riskManagerRole, admin.address))) {
  await (await accessManager.connect(admin).grantRole(riskManagerRole, admin.address)).wait();
  console.log("RISK_MANAGER_ROLE granted to", admin.address);
}
const debtMinterRole = ethers.id("DEBT_MINTER_ROLE");
await (await accessManager.connect(admin).grantRole(debtMinterRole, newCdpManagerAddress)).wait();
console.log("DEBT_MINTER_ROLE granted to new CDPManager");

if ((await cdpManager.insuranceFundFeeBps()) !== INSURANCE_FUND_FEE_BPS) {
  await (await cdpManager.connect(admin).setInsuranceFundFeeBps(INSURANCE_FUND_FEE_BPS)).wait();
  console.log("insuranceFundFeeBps set to", INSURANCE_FUND_FEE_BPS);
}

// --- Re-register GOLD and SILVER, each behind the same operator-confirms-the-live-price check
// deploy-cdp.ts and register-silver-collateral.ts already use — see AUDIT.md finding 9.
async function registerCollateral(label: string, expectedPriceEnvVar: string) {
  const assetId = ethers.id(label);
  const asset = await vaultManager.assets(assetId);
  if (asset.adapter === ethers.ZeroAddress) {
    throw new Error(`${label} isn't registered in VaultManager`);
  }

  const expectedPriceRaw = process.env[expectedPriceEnvVar];
  if (!expectedPriceRaw) {
    throw new Error(`${expectedPriceEnvVar} is required before registering ${label} — see this script's header.`);
  }
  const expectedPrice = ethers.parseUnits(expectedPriceRaw, 18);
  const [livePrice] = await oracleManager.getPrice(assetId);
  const deviationBps =
    (BigInt(10_000) * (livePrice > expectedPrice ? livePrice - expectedPrice : expectedPrice - livePrice)) /
    expectedPrice;
  console.log(
    `${label} live oracle price: ${ethers.formatUnits(livePrice, 18)} — expected (confirmed by operator): ${expectedPriceRaw}`,
  );
  if (deviationBps > 2_500n) {
    throw new Error(`Live price deviates ${Number(deviationBps) / 100}% from ${expectedPriceEnvVar} — refusing.`);
  }

  await (
    await cdpManager
      .connect(admin)
      .addCollateralType(
        assetId,
        asset.wrappedToken,
        MIN_COLLATERAL_RATIO_BPS,
        LIQUIDATION_THRESHOLD_BPS,
        LIQUIDATION_BONUS_BPS,
        STABILITY_FEE_BPS,
        DEBT_CEILING,
      )
  ).wait();
  console.log(label, "registered on the new CDPManager, wrapped token", asset.wrappedToken);
}

await registerCollateral(GOLD_LABEL, "EXPECTED_GOLD_PRICE_EUR_PER_GRAM");
await registerCollateral(SILVER_LABEL, "EXPECTED_SILVER_PRICE_EUR_PER_GRAM");

writeFileSync(
  cdpRecordPath,
  JSON.stringify({ stableToken: stableTokenAddress, cdpManager: newCdpManagerAddress }, null, 2) + "\n",
);
console.log("\nWrote", cdpRecordPath, "— cdpManager now", newCdpManagerAddress);
console.log(
  "\nNext:\n" +
    `  1. Set NEXT_PUBLIC_CDP_MANAGER_ADDRESS=${newCdpManagerAddress} (frontend/.env.local and Vercel).\n` +
    "  2. Deploy REAL_ESTATE_PARIS_01_V7 (deploy-real-estate-market.ts) if not done yet, then run\n" +
    "     register-real-estate-collateral.ts — it now reads this same cdp.json, so it registers\n" +
    "     against this new CDPManager automatically.\n" +
    `  3. The old CDPManager (${oldCdpManagerAddress}) still holds any position opened against it —\n` +
    "     nothing forces that position to move, but it can no longer accept new collateral types.\n",
);
