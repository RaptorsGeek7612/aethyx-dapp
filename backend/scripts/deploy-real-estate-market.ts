import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys one real-estate market: a RealEstateAdapter plus its wrapped token, registered with
// VaultManager, and — when needed — a fresh RealEstateAssetFactory to deploy them from.
//
// Why the factory too. A factory contains its adapter's *creation bytecode*, baked in when the
// factory itself was compiled and deployed. It is immutable, so a factory deployed before an
// adapter change keeps producing the old adapter forever, no matter what the local sources say.
// The Sepolia factory from the original deployment still emits the very first RealEstateAdapter,
// the one with a single `lockedUntil` per address: every market deployed through it — including
// REAL_ESTATE_PARIS_01_V3 — carries that logic, not the per-deposit maturity of a28d556 and not
// the market-wide schedule of e01fdf0. Deploying the fix therefore means deploying a new factory
// first. See AUDIT.md finding 1.
//
// The lock-up is not a depositor-facing choice — RealEstateAdapter.lockupPeriod is immutable, set
// once here, and the UI reads it off the adapter rather than offering it.
//
// VaultManager.registerAsset reverts with AssetAlreadyRegistered on an id it already knows, and
// there is no way to repoint an existing id at a new adapter, so every redeploy needs its own
// asset id. Bump VERSION below and the frontend's REAL_ESTATE_LABEL in config/assets.ts to match
// — the frontend derives the id from that string, so the two must not drift. Deploy first, switch
// the frontend second: the reverse leaves the UI pointing at a market that does not exist yet.
//
//   hardhat run scripts/deploy-real-estate-market.ts --network sepolia
//
// The keystore prompts for a password, so this needs a real terminal; in CI, set SEPOLIA_RPC_URL
// and SEPOLIA_PRIVATE_KEY as environment variables instead — they take precedence.
//
// Re-running is safe: each step is skipped if it has already been done.

const VERSION = "V4";
const LOCKUP_DAYS = 30n;
const BASE_LABEL = "REAL_ESTATE_PARIS_01";
const LABEL = `${BASE_LABEL}_${VERSION}`;
const LOCKUP_SECONDS = LOCKUP_DAYS * 24n * 60n * 60n;

// Markets to inherit the ERC-3643 underlying from, newest first. Reusing the token rather than
// minting a parallel one means a holder's untouched underlying balance still works with the new
// market; each superseded market keeps custody of whatever was already deposited against it.
const UNDERLYING_SOURCES = [`${BASE_LABEL}_V3`, BASE_LABEL];

const networkName = process.env.SEED_NETWORK ?? "sepolia";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;

const vaultManager = await ethers.getContractAt("VaultManager", deployed["InvestOrGateway#VaultManager"]);
const accessManager = await ethers.getContractAt("AccessManager", deployed["InvestOrGateway#AccessManager"]);

const [admin] = await ethers.getSigners();
console.log(`Deploying ${LABEL} as`, admin.address, "on", networkName);

const assetId = ethers.id(LABEL);
if ((await vaultManager.assets(assetId)).adapter !== ethers.ZeroAddress) {
  console.log(LABEL, "is already registered — nothing to do");
  process.exit(0);
}

// --- 1. A factory that emits the current adapter ------------------------------------------------
//
// Compare the recorded factory's deployed code against what this checkout compiles. They differ
// in length exactly when the factory carries a different adapter; immutables are written in place
// and never change the length, so a length match means the same code.
const recordedFactory = deployed["InvestOrGateway#RealEstateAssetFactory"];
const localFactoryCode = (await ethers.getContractFactory("RealEstateAssetFactory")).bytecode;
const onChainCode = await ethers.provider.getCode(recordedFactory);
const factoryIsCurrent = onChainCode.length >= localFactoryCode.length * 0.95;

let factoryAddress = recordedFactory;
if (!factoryIsCurrent) {
  console.log("Recorded factory", recordedFactory, "predates the current adapter — deploying a new one");
  const newFactory = await ethers.deployContract(
    "RealEstateAssetFactory",
    [accessManager.target, vaultManager.target],
    admin,
  );
  await newFactory.waitForDeployment();
  factoryAddress = await newFactory.getAddress();
  console.log("New RealEstateAssetFactory at", factoryAddress);

  const factoryRole = await accessManager.FACTORY_ROLE();
  await (await accessManager.connect(admin).grantRole(factoryRole, factoryAddress)).wait();
  console.log("FACTORY_ROLE granted to", factoryAddress);

  deployed["InvestOrGateway#RealEstateAssetFactory"] = factoryAddress;
  writeFileSync(`${deploymentDir}/deployed_addresses.json`, JSON.stringify(deployed, null, 2) + "\n");
  console.log("Recorded it in", `${deploymentDir}/deployed_addresses.json`);
  console.log(
    "\n  The superseded factory still holds FACTORY_ROLE and can still register old-adapter\n" +
      "  markets. Revoke it deliberately when you are done verifying the new one:\n" +
      `    accessManager.revokeRole(FACTORY_ROLE, "${recordedFactory}")\n`,
  );
}
const factory = await ethers.getContractAt("RealEstateAssetFactory", factoryAddress);

// --- 2. The underlying to reuse -----------------------------------------------------------------
let underlyingAddress = "";
for (const sourceLabel of UNDERLYING_SOURCES) {
  const config = await vaultManager.assets(ethers.id(sourceLabel));
  if (config.adapter === ethers.ZeroAddress) continue;
  underlyingAddress = await (await ethers.getContractAt("AssetAdapter", config.adapter)).underlying();
  console.log("Reusing the underlying of", sourceLabel, "at", underlyingAddress);
  break;
}
if (underlyingAddress === "") {
  throw new Error(`none of ${UNDERLYING_SOURCES.join(", ")} is registered — no underlying token to reuse`);
}

// --- 3. The market ------------------------------------------------------------------------------
await (
  await factory
    .connect(admin)
    .deployRealEstateAsset(assetId, "Invest'Or Real Estate", "RLD", underlyingAddress, LOCKUP_SECONDS, 0n, 0n)
).wait();

const config = await vaultManager.assets(assetId);
console.log(LABEL, "→ adapter", config.adapter, "wrapped", config.wrappedToken);

// The adapter has to be whitelisted on the ERC-3643 token before it can custody it — the same
// step seed-demo-assets.ts performs for a freshly deployed market. setVerified is MockERC3643's
// own shortcut; against a real issuer's token this is whatever their compliance flow is.
const underlying = await ethers.getContractAt("MockERC3643", underlyingAddress);
await (await underlying.setVerified(config.adapter, true)).wait();
console.log("Adapter whitelisted on", underlyingAddress);

// --- 4. Prove what actually landed --------------------------------------------------------------
//
// lockedAmountNow() exists only on the market-wide adapter: the per-deposit one exposed
// lockedAmountOf(address) and the original one nothing of the sort. A factory still carrying an
// older adapter fails here rather than going live with a lock-up a self-transfer walks past.
const adapter = await ethers.getContractAt("RealEstateAdapter", config.adapter);
const lockupSeconds = await adapter.lockupPeriod();
if (lockupSeconds !== LOCKUP_SECONDS) {
  throw new Error(`lockupPeriod reads ${lockupSeconds}s, expected ${LOCKUP_SECONDS}s`);
}
const lockedNow = await adapter.lockedAmountNow();
const schedule = await adapter.lockSchedule();
console.log(
  `Verified: market-wide adapter, lockupPeriod ${lockupSeconds}s, ${lockedNow} locked, ${schedule.length} tranches`,
);

// Merge rather than overwrite, so the record keeps every generation of this market.
const outPath = `${deploymentDir}/real_estate_market.json`;
const record = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>) : {};
record[LABEL] = {
  assetId,
  adapter: config.adapter,
  wrappedToken: config.wrappedToken,
  underlying: underlyingAddress,
  factory: factoryAddress,
  lockupDays: Number(LOCKUP_DAYS),
  marketWideLockup: true,
};
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log("\nWrote", outPath);
console.log(`Next: set REAL_ESTATE_LABEL in frontend/src/config/assets.ts to ${LABEL}`);
