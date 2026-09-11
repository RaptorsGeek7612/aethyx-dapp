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
// Real estate has no holding period: it deposits and redeems exactly like gold and silver. Two
// earlier designs metered redemption here — one per depositor address, one per market — and both
// were removed when the product settled on an asset that behaves like the others.
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

const VERSION = "V5";
const BASE_LABEL = "REAL_ESTATE_PARIS_01";
const LABEL = `${BASE_LABEL}_${VERSION}`;

// Markets to inherit the ERC-3643 underlying from, newest first. Reusing the token rather than
// minting a parallel one means a holder's untouched underlying balance still works with the new
// market; each superseded market keeps custody of whatever was already deposited against it.
const UNDERLYING_SOURCES = [`${BASE_LABEL}_V4`, `${BASE_LABEL}_V3`, BASE_LABEL];

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
// Compare the recorded factory's runtime code against this checkout's. Both sides must be
// *runtime* code: the creation bytecode an ethers ContractFactory carries is a different, longer
// string, and comparing one against the other makes every factory look current — which is exactly
// how a call went out to a factory whose deployRealEstateAsset still took the retired
// lockupPeriod argument. Immutables are written in place and never change the length, so equal
// lengths mean the same code and any difference means a different adapter or a different
// signature.
const recordedFactory = deployed["InvestOrGateway#RealEstateAssetFactory"];
const localRuntime = (
  JSON.parse(readFileSync("artifacts/contracts/RealEstateAssetFactory.sol/RealEstateAssetFactory.json", "utf8")) as {
    deployedBytecode: string;
  }
).deployedBytecode;
const onChainRuntime = await ethers.provider.getCode(recordedFactory);
const factoryIsCurrent = onChainRuntime.length === localRuntime.length;
console.log(
  `Recorded factory runtime ${(onChainRuntime.length - 2) / 2} bytes, this checkout ${(localRuntime.length - 2) / 2}`,
);

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
  await factory.connect(admin).deployRealEstateAsset(assetId, "Invest'Or Real Estate", "RLD", underlyingAddress, 0n, 0n)
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
// Real estate carries no holding period any more, so the adapter must expose none of the surface
// the two retired designs had. A factory still carrying either of them fails here rather than
// going live with a lock-up the product has decided against.
const adapter = await ethers.getContractAt("RealEstateAdapter", config.adapter);
const code = await ethers.provider.getCode(config.adapter);
const retired = ["lockupPeriod()", "lockedUntil(address)", "lockedAmountOf(address)", "lockedAmountNow()"];
for (const sig of retired) {
  const selector = ethers.id(sig).slice(2, 10);
  if (code.includes(selector)) throw new Error(`deployed adapter still exposes ${sig} — the factory is stale`);
}
if ((await adapter.assetId()) !== assetId) throw new Error("deployed adapter reports a different assetId");
console.log("Verified: no lock-up surface, assetId consistent");

// Merge rather than overwrite, so the record keeps every generation of this market.
const outPath = `${deploymentDir}/real_estate_market.json`;
const record = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>) : {};
record[LABEL] = {
  assetId,
  adapter: config.adapter,
  wrappedToken: config.wrappedToken,
  underlying: underlyingAddress,
  factory: factoryAddress,
  lockup: null,
};
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log("\nWrote", outPath);
console.log(`Next: set REAL_ESTATE_LABEL in frontend/src/config/assets.ts to ${LABEL}`);
