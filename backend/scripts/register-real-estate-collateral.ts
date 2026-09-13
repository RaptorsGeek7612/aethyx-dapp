import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Registers REAL_ESTATE_PARIS_01_V6 as a third CDP collateral type, alongside GOLD and SILVER —
// but unlike those two, it has no independent market price, only a static appraisal divided by
// however many wrapped tokens are currently in circulation (see update-real-estate-price.ts's
// header for the full reasoning). That derived price has to live in OracleManager like any other
// feed, since CDPManager.addCollateralType/_collateralRatioBps only know how to ask OracleManager
// for a price, not how to compute one themselves — so this script:
//
//   1. Registers this deployment's two ManualPriceSource instances (already used for gold/silver)
//      as price sources for this assetId too.
//   2. Pushes an initial price via update-real-estate-price.ts's own logic.
//   3. Registers the collateral type itself, with materially more conservative risk parameters
//      than gold/silver: a price that goes stale or wrong the moment someone deposits/redeems
//      without an operator noticing is a real failure mode gold/silver's live feed doesn't share,
//      so this leans harder on collateral headroom to compensate.
//
// Steps 1 only ever need to happen once — this script no-ops entirely (including re-adding price
// sources) if the collateral is already registered, checked first, before touching anything else.
//
//   REAL_ESTATE_APPRAISAL_EUR=235000 SEED_NETWORK=sepolia npx hardhat run scripts/register-real-estate-collateral.ts --network sepolia
//
// After this, run update-real-estate-price.ts again after every deposit/redeem on this market —
// registering it here does not make that maintenance step go away.

const REAL_ESTATE_LABEL = "REAL_ESTATE_PARIS_01_V6";
// More conservative than GOLD's 150%/130% (register-silver-collateral.ts, deploy-cdp.ts): the
// price behind this collateral can go stale or drift between operator updates in a way gold/
// silver's live oracle feed can't, so more headroom is asked for up front. Placeholder demo
// values, not a risk assessment.
const MIN_COLLATERAL_RATIO_BPS = 20_000n; // 200%
const LIQUIDATION_THRESHOLD_BPS = 16_000n; // 160%
const LIQUIDATION_BONUS_BPS = 1_000n; // 10% — bigger than gold/silver's, same reasoning as the ratios above
const STABILITY_FEE_BPS = 300n; // 3%/year
const DEBT_CEILING = 200_000n * 10n ** 18n; // well under the building's own appraisal

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const accessManagerAddress = deployed["InvestOrGateway#AccessManager"];
const oracleManagerAddress = deployed["InvestOrGateway#OracleManager"];
const vaultManagerAddress = deployed["InvestOrGateway#VaultManager"];
const priceSourceAddresses = [
  deployed["InvestOrGateway#priceSourcePrimary"],
  deployed["InvestOrGateway#priceSourceSecondary"],
].filter((address): address is string => Boolean(address));

const cdpRecord = JSON.parse(readFileSync(`${deploymentDir}/cdp.json`, "utf8")) as { cdpManager: string };

const [admin] = await ethers.getSigners();
console.log("Registering REAL_ESTATE_PARIS_01_V6 collateral as", admin.address, "on", networkName);

const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);
const accessManager = await ethers.getContractAt("AccessManager", accessManagerAddress);
const oracleManager = await ethers.getContractAt("OracleManager", oracleManagerAddress);
const cdpManager = await ethers.getContractAt("CDPManager", cdpRecord.cdpManager);

const assetId = ethers.id(REAL_ESTATE_LABEL);
const asset = await vaultManager.assets(assetId);
if (asset.wrappedToken === ethers.ZeroAddress) {
  throw new Error(`${REAL_ESTATE_LABEL} isn't registered in VaultManager yet`);
}

const existingCollateral = await cdpManager.collaterals(assetId);
if (existingCollateral.wrappedToken !== ethers.ZeroAddress) {
  console.log(REAL_ESTATE_LABEL, "already registered as collateral, skipping");
} else {
  // --- 1. Price sources, computed locally like deploy-cdp.ts's RISK_MANAGER_ROLE — see that
  // script's comment for why this Sepolia AccessManager's role getters can't be trusted.
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

  if (priceSourceAddresses.length === 0) {
    throw new Error("No ManualPriceSource addresses found in deployed_addresses.json");
  }
  for (const sourceAddress of priceSourceAddresses) {
    await (await oracleManager.connect(admin).addPriceSource(assetId, sourceAddress)).wait();
    console.log("Price source", sourceAddress, "added for", REAL_ESTATE_LABEL);
  }

  // --- 2. Initial price — same math as update-real-estate-price.ts, inlined so this script is a
  // single self-contained run for the operator.
  const appraisalRaw = process.env.REAL_ESTATE_APPRAISAL_EUR;
  if (!appraisalRaw) {
    throw new Error(
      "REAL_ESTATE_APPRAISAL_EUR is required — state the same figure frontend/src/config/assets.ts " +
        "uses as this market's appraisalValueEur, so the two can't silently drift apart.",
    );
  }
  const appraisalEur = ethers.parseUnits(appraisalRaw, 18);
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
  }
  console.log("Initial price pushed to", priceSourceAddresses.length, "source(s)");

  // --- 3. The collateral type itself.
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
  console.log(REAL_ESTATE_LABEL, "registered as collateral, wrapped token", asset.wrappedToken);
  console.log("\nRemember: run update-real-estate-price.ts after every deposit/redeem on this market.");
}
