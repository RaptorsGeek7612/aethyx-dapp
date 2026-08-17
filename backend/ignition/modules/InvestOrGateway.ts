import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id as keccakId, parseUnits } from "ethers";

/// Deploys the whole Invest'Or Gateway protocol core (no asset registered yet — that's done
/// afterwards by calling one of the asset factories' deploy function, e.g.
/// GoldAssetFactory.deployGoldAsset, once a real ERC-3643 token address is known) and wires up
/// every cross-contract role grant.
export default buildModule("InvestOrGateway", (m) => {
  // In production this should be a multisig/timelock, never a plain EOA — see AccessManager's
  // constructor natspec. Defaults to the first Hardhat account for local/test deployments.
  const initialAdmin = m.getParameter("initialAdmin", m.getAccount(0));

  // OracleManager aggregation defaults: 1h staleness window, 5% max deviation between
  // sources, at least 2 fresh sources required to produce a price.
  const maxStaleness = m.getParameter("maxStaleness", 3600n);
  const maxDeviationBps = m.getParameter("maxDeviationBps", 500n);
  const minSources = m.getParameter("minSources", 2n);

  const accessManager = m.contract("AccessManager", [initialAdmin]);
  const treasury = m.contract("Treasury", [accessManager]);
  const vaultManager = m.contract("VaultManager", [accessManager, treasury]);
  // One factory per adapter type — see GoldAssetFactory.sol's natspec: a single factory
  // embedding every adapter's creation bytecode blew past the EIP-170 24,576-byte limit.
  const goldAssetFactory = m.contract("GoldAssetFactory", [accessManager, vaultManager]);
  const silverAssetFactory = m.contract("SilverAssetFactory", [accessManager, vaultManager]);
  const realEstateAssetFactory = m.contract("RealEstateAssetFactory", [accessManager, vaultManager]);
  const oracleManager = m.contract("OracleManager", [accessManager, maxStaleness, maxDeviationBps, minSources]);
  const gateway = m.contract("InvestOrGateway", [accessManager, vaultManager]);

  // Protocol-wide grants — see the natspec in AccessManager.sol for what each role unlocks.
  const minterRole = m.staticCall(accessManager, "MINTER_ROLE", [], 0, { id: "readMinterRole" });
  m.call(accessManager, "grantRole", [minterRole, vaultManager], { id: "grantMinterRoleToVaultManager" });

  const factoryRole = m.staticCall(accessManager, "FACTORY_ROLE", [], 0, { id: "readFactoryRole" });
  m.call(accessManager, "grantRole", [factoryRole, goldAssetFactory], { id: "grantFactoryRoleToGoldFactory" });
  m.call(accessManager, "grantRole", [factoryRole, silverAssetFactory], { id: "grantFactoryRoleToSilverFactory" });
  m.call(accessManager, "grantRole", [factoryRole, realEstateAssetFactory], {
    id: "grantFactoryRoleToRealEstateFactory",
  });

  const routerRole = m.staticCall(accessManager, "ROUTER_ROLE", [], 0, { id: "readRouterRole" });
  m.call(accessManager, "grantRole", [routerRole, gateway], { id: "grantRouterRoleToGateway" });

  const assetManagerRole = m.staticCall(accessManager, "ASSET_MANAGER_ROLE", [], 0, { id: "readAssetManagerRole" });
  const grantAssetManagerRoleToAdmin = m.call(accessManager, "grantRole", [assetManagerRole, initialAdmin], {
    id: "grantAssetManagerRoleToAdmin",
  });

  const pauserRole = m.staticCall(accessManager, "PAUSER_ROLE", [], 0, { id: "readPauserRole" });
  m.call(accessManager, "grantRole", [pauserRole, initialAdmin], { id: "grantPauserRoleToAdmin" });

  const treasuryManagerRole = m.staticCall(accessManager, "TREASURY_MANAGER_ROLE", [], 0, {
    id: "readTreasuryManagerRole",
  });
  m.call(accessManager, "grantRole", [treasuryManagerRole, initialAdmin], { id: "grantTreasuryManagerRoleToAdmin" });

  const oracleUpdaterRole = m.staticCall(accessManager, "ORACLE_UPDATER_ROLE", [], 0, {
    id: "readOracleUpdaterRole",
  });
  const grantOracleUpdaterRoleToAdmin = m.call(accessManager, "grantRole", [oracleUpdaterRole, initialAdmin], {
    id: "grantOracleUpdaterRoleToAdmin",
  });

  // Two independent, admin-pushable price feeds per priced asset (gold, silver) so
  // OracleManager's median-of-sources aggregation (minSources=2 by default) has real,
  // distinct sources to reconcile instead of a single trusted feed.
  const goldAssetId = keccakId("GOLD");
  const silverAssetId = keccakId("SILVER");

  const priceSourcePrimary = m.contract("ManualPriceSource", [accessManager], { id: "priceSourcePrimary" });
  const priceSourceSecondary = m.contract("ManualPriceSource", [accessManager], { id: "priceSourceSecondary" });

  const addGoldSourcePrimary = m.call(oracleManager, "addPriceSource", [goldAssetId, priceSourcePrimary], {
    id: "addGoldSourcePrimary",
    after: [grantAssetManagerRoleToAdmin],
  });
  const addGoldSourceSecondary = m.call(oracleManager, "addPriceSource", [goldAssetId, priceSourceSecondary], {
    id: "addGoldSourceSecondary",
    after: [grantAssetManagerRoleToAdmin],
  });
  const addSilverSourcePrimary = m.call(oracleManager, "addPriceSource", [silverAssetId, priceSourcePrimary], {
    id: "addSilverSourcePrimary",
    after: [grantAssetManagerRoleToAdmin],
  });
  const addSilverSourceSecondary = m.call(oracleManager, "addPriceSource", [silverAssetId, priceSourceSecondary], {
    id: "addSilverSourceSecondary",
    after: [grantAssetManagerRoleToAdmin],
  });

  // Seed demo prices (EUR per gram, 18 decimals) so the UI isn't staring at an empty oracle
  // right after deploy. Push fresh values again before any live demo — OracleManager rejects
  // stale sources.
  const initialGoldPricePerGram = m.getParameter("initialGoldPricePerGram", parseUnits("92", 18));
  const initialSilverPricePerGram = m.getParameter("initialSilverPricePerGram", parseUnits("1.05", 18));

  m.call(priceSourcePrimary, "setPrice", [goldAssetId, initialGoldPricePerGram], {
    id: "seedGoldPricePrimary",
    after: [grantOracleUpdaterRoleToAdmin, addGoldSourcePrimary],
  });
  m.call(priceSourceSecondary, "setPrice", [goldAssetId, initialGoldPricePerGram], {
    id: "seedGoldPriceSecondary",
    after: [grantOracleUpdaterRoleToAdmin, addGoldSourceSecondary],
  });
  m.call(priceSourcePrimary, "setPrice", [silverAssetId, initialSilverPricePerGram], {
    id: "seedSilverPricePrimary",
    after: [grantOracleUpdaterRoleToAdmin, addSilverSourcePrimary],
  });
  m.call(priceSourceSecondary, "setPrice", [silverAssetId, initialSilverPricePerGram], {
    id: "seedSilverPriceSecondary",
    after: [grantOracleUpdaterRoleToAdmin, addSilverSourceSecondary],
  });

  return {
    accessManager,
    treasury,
    vaultManager,
    goldAssetFactory,
    silverAssetFactory,
    realEstateAssetFactory,
    oracleManager,
    gateway,
    priceSourcePrimary,
    priceSourceSecondary,
  };
});
