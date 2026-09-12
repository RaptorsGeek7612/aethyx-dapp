import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import AethyxGatewayModule from "./AethyxGateway.js";

/// Deploys the CDP module (StableToken + CDPManager) for a brand-new network, alongside the core
/// protocol: `hardhat ignition deploy ignition/modules/CDP.ts` pulls in AethyxGatewayModule via
/// `m.useModule` and deploys it too if this deployment doesn't already have it, or reuses it
/// unchanged if it does — the same composition Ignition uses to let one module build on another
/// without redeploying it twice.
///
/// No collateral is registered here, on purpose — CDPManager.addCollateralType needs a wrapped
/// token address, and none exists yet at this point (the core module deploys infrastructure
/// only; see its own natspec). Retrofitting CDP onto a network that already has AethyxGateway's
/// infrastructure deployed under a *different* Ignition run — Sepolia today — isn't this module's
/// job either: see backend/scripts/deploy-cdp.ts, which reads that deployment's addresses
/// directly instead of composing modules, and also registers GOLD once StableToken/CDPManager
/// exist.
export default buildModule("CDP", (m) => {
  const { accessManager, oracleManager, treasury } = m.useModule(AethyxGatewayModule);

  // Must match AethyxGatewayModule's own `initialAdmin` parameter if that one was overridden via
  // a parameters file — Ignition has no way to read one module's resolved parameter from another.
  const initialAdmin = m.getParameter("initialAdmin", m.getAccount(0));

  const stableToken = m.contract("StableToken", ["AETHYX Stable EUR", "ioEUR", accessManager]);
  const cdpManager = m.contract("CDPManager", [accessManager, oracleManager, stableToken, treasury]);

  // Same pattern as AethyxGatewayModule's own protocol-wide grants — see AccessManager.sol's
  // natspec for what each role unlocks.
  const riskManagerRole = m.staticCall(accessManager, "RISK_MANAGER_ROLE", [], 0, { id: "readRiskManagerRole" });
  m.call(accessManager, "grantRole", [riskManagerRole, initialAdmin], { id: "grantRiskManagerRoleToAdmin" });

  const debtMinterRole = m.staticCall(accessManager, "DEBT_MINTER_ROLE", [], 0, { id: "readDebtMinterRole" });
  m.call(accessManager, "grantRole", [debtMinterRole, cdpManager], { id: "grantDebtMinterRoleToCdpManager" });

  return { stableToken, cdpManager };
});
