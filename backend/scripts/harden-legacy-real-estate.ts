import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Shuts the doors left open by the V4 migration (AUDIT.md findings 1 and 7).
//
// Two things stay reachable after a market is superseded. The retired factory keeps FACTORY_ROLE,
// so an ASSET_MANAGER_ROLE can still register markets backed by the original adapter — the one
// whose lock-up a self-transfer walks straight past. And every superseded market stays `active`,
// so anyone can still deposit into that same weak lock-up.
//
// Freezing is only safe where nobody holds the wrapped token: setAssetActive(false) blocks
// redemption as well as deposit, so freezing a market with outstanding supply would strand its
// holders' collateral. A lock-up that can be bypassed is a smaller harm than funds nobody can
// ever retrieve, so this script reads totalSupply immediately before each freeze and skips any
// market that still has holders, whatever the caller believed when they launched it.
//
//   hardhat run scripts/harden-legacy-real-estate.ts --network sepolia
//
// Re-running is safe: already-revoked roles and already-frozen markets are reported and skipped.

const CURRENT_LABEL = "REAL_ESTATE_PARIS_01_V4";
const SUPERSEDED_LABELS = [
  "REAL_ESTATE_PARIS_01_V3",
  "REAL_ESTATE_PARIS_01",
  "REAL_ESTATE_PARIS_01_15D",
  "REAL_ESTATE_PARIS_01_1M",
  "REAL_ESTATE_PARIS_01_3M",
  "REAL_ESTATE_PARIS_01_6M",
  "REAL_ESTATE_PARIS_01_1Y",
];
// The factory that emitted the original adapter, superseded by the one deployed alongside V4.
const RETIRED_FACTORY = "0x0d759a29967EfC713Bd44682e5A1193848d692cE";

const networkName = process.env.SEED_NETWORK ?? "sepolia";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;

const deployed = JSON.parse(
  readFileSync(`ignition/deployments/chain-${chainId}/deployed_addresses.json`, "utf8"),
) as Record<string, string>;

const vaultManager = await ethers.getContractAt("VaultManager", deployed["InvestOrGateway#VaultManager"]);
const accessManager = await ethers.getContractAt("AccessManager", deployed["InvestOrGateway#AccessManager"]);
const [admin] = await ethers.getSigners();
console.log("Hardening as", admin.address, "on", networkName, "\n");

// --- 1. Take FACTORY_ROLE off the retired factory ------------------------------------------------
const factoryRole = await accessManager.FACTORY_ROLE();
const currentFactory = deployed["InvestOrGateway#RealEstateAssetFactory"];
if (currentFactory.toLowerCase() === RETIRED_FACTORY.toLowerCase()) {
  throw new Error("the recorded factory is the retired one — deploy the new factory before revoking");
}
if (!(await accessManager.hasRole(factoryRole, currentFactory))) {
  throw new Error(`the current factory ${currentFactory} does not hold FACTORY_ROLE — refusing to revoke the old one`);
}
if (await accessManager.hasRole(factoryRole, RETIRED_FACTORY)) {
  await (await accessManager.connect(admin).revokeRole(factoryRole, RETIRED_FACTORY)).wait();
  console.log("FACTORY_ROLE revoked from the retired factory", RETIRED_FACTORY);
} else {
  console.log("FACTORY_ROLE already revoked from", RETIRED_FACTORY);
}

// --- 2. Freeze every superseded market that nobody holds ----------------------------------------
const erc20 = ["function totalSupply() view returns (uint256)"];
const kept: string[] = [];

for (const label of SUPERSEDED_LABELS) {
  const assetId = ethers.id(label);
  const config = await vaultManager.assets(assetId);
  if (config.adapter === ethers.ZeroAddress) {
    console.log(label.padEnd(26), "not registered — skipping");
    continue;
  }
  if (!config.active) {
    console.log(label.padEnd(26), "already frozen");
    continue;
  }

  const supply: bigint = await (await ethers.getContractAt(erc20, config.wrappedToken)).totalSupply();
  if (supply > 0n) {
    kept.push(`${label} (${ethers.formatUnits(supply, 18)} outstanding)`);
    console.log(label.padEnd(26), `LEFT ACTIVE — ${ethers.formatUnits(supply, 18)} wrapped tokens outstanding`);
    continue;
  }

  await (await vaultManager.connect(admin).setAssetActive(assetId, false)).wait();
  console.log(label.padEnd(26), "frozen (no holders)");
}

const current = await vaultManager.assets(ethers.id(CURRENT_LABEL));
if (current.adapter === ethers.ZeroAddress || !current.active) {
  throw new Error(`${CURRENT_LABEL} is not registered and active — refusing to leave the protocol with no live market`);
}
console.log(`\n${CURRENT_LABEL} is registered and active at`, current.adapter);

if (kept.length > 0) {
  console.log(
    "\n  Left active because freezing would strand their holders:\n" +
      kept.map((k) => `    ${k}`).join("\n") +
      "\n  Their lock-up is the original, bypassable one. Closing them means getting those\n" +
      "  holders to redeem first, then re-running this script.",
  );
}
