import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// Deploys the whole Invest'Or Gateway protocol core (no asset registered yet — that's done
/// afterwards by calling WrappedTokenFactory.deployGoldAsset once a real ERC-3643 gold token
/// address is known) and wires up every cross-contract role grant.
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
  const wrappedTokenFactory = m.contract("WrappedTokenFactory", [accessManager, vaultManager]);
  const oracleManager = m.contract("OracleManager", [accessManager, maxStaleness, maxDeviationBps, minSources]);
  const gateway = m.contract("InvestOrGateway", [accessManager, vaultManager]);

  // Protocol-wide grants — see the natspec in AccessManager.sol for what each role unlocks.
  const minterRole = m.staticCall(accessManager, "MINTER_ROLE", [], 0, { id: "readMinterRole" });
  m.call(accessManager, "grantRole", [minterRole, vaultManager], { id: "grantMinterRoleToVaultManager" });

  const factoryRole = m.staticCall(accessManager, "FACTORY_ROLE", [], 0, { id: "readFactoryRole" });
  m.call(accessManager, "grantRole", [factoryRole, wrappedTokenFactory], { id: "grantFactoryRoleToFactory" });

  const routerRole = m.staticCall(accessManager, "ROUTER_ROLE", [], 0, { id: "readRouterRole" });
  m.call(accessManager, "grantRole", [routerRole, gateway], { id: "grantRouterRoleToGateway" });

  const assetManagerRole = m.staticCall(accessManager, "ASSET_MANAGER_ROLE", [], 0, { id: "readAssetManagerRole" });
  m.call(accessManager, "grantRole", [assetManagerRole, initialAdmin], { id: "grantAssetManagerRoleToAdmin" });

  const pauserRole = m.staticCall(accessManager, "PAUSER_ROLE", [], 0, { id: "readPauserRole" });
  m.call(accessManager, "grantRole", [pauserRole, initialAdmin], { id: "grantPauserRoleToAdmin" });

  const treasuryManagerRole = m.staticCall(accessManager, "TREASURY_MANAGER_ROLE", [], 0, {
    id: "readTreasuryManagerRole",
  });
  m.call(accessManager, "grantRole", [treasuryManagerRole, initialAdmin], { id: "grantTreasuryManagerRoleToAdmin" });

  const oracleUpdaterRole = m.staticCall(accessManager, "ORACLE_UPDATER_ROLE", [], 0, {
    id: "readOracleUpdaterRole",
  });
  m.call(accessManager, "grantRole", [oracleUpdaterRole, initialAdmin], { id: "grantOracleUpdaterRoleToAdmin" });

  return { accessManager, treasury, vaultManager, wrappedTokenFactory, oracleManager, gateway };
});
