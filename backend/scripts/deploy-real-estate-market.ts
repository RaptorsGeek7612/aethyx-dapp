import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys one real-estate market: a RealEstateAdapter plus its wrapped token, registered with
// VaultManager in a single factory call.
//
// The lock-up is not a depositor-facing choice — RealEstateAdapter.lockupPeriod is immutable, set
// once here, and the UI reads it off the adapter rather than offering it.
//
// VaultManager.registerAsset reverts with AssetAlreadyRegistered on an id it already knows, and
// there is no way to repoint an existing id at a new adapter, so every redeploy needs its own
// asset id. Bump VERSION below and the frontend's REAL_ESTATE_LABEL in config/assets.ts to match
// — the frontend derives the id from that string, so the two must not drift.
//
//   hardhat run scripts/deploy-real-estate-market.ts --network sepolia
//
// The keystore prompts for a password, so this needs a real terminal; in CI, set
// SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY as environment variables instead — they take
// precedence over the keystore.
//
// Re-running is safe: an already-registered VERSION is reported and left alone.

const VERSION = "V4";
const LOCKUP_DAYS = 30n;
const BASE_LABEL = "REAL_ESTATE_PARIS_01";
const LABEL = `${BASE_LABEL}_${VERSION}`;

// Markets to inherit the ERC-3643 underlying from, newest first. Reusing the token rather than
// minting a parallel one means a holder's untouched underlying balance still works with the new
// market; each superseded market keeps custody of whatever was already deposited against it.
const UNDERLYING_SOURCES = [`${BASE_LABEL}_V3`, BASE_LABEL];

const networkName = process.env.SEED_NETWORK ?? "sepolia";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;

const deployed = JSON.parse(
  readFileSync(`ignition/deployments/chain-${chainId}/deployed_addresses.json`, "utf8"),
) as Record<string, string>;

const vaultManager = await ethers.getContractAt("VaultManager", deployed["InvestOrGateway#VaultManager"]);
const factory = await ethers.getContractAt(
  "RealEstateAssetFactory",
  deployed["InvestOrGateway#RealEstateAssetFactory"],
);

const [admin] = await ethers.getSigners();
console.log(`Deploying ${LABEL} as`, admin.address, "on", networkName);

const assetId = ethers.id(LABEL);
const existing = await vaultManager.assets(assetId);
if (existing.adapter !== ethers.ZeroAddress) {
  console.log(LABEL, "is already registered at", existing.adapter, "— nothing to do");
  process.exit(0);
}

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

const tx = await factory
  .connect(admin)
  .deployRealEstateAsset(
    assetId,
    "Invest'Or Real Estate",
    "RLD",
    underlyingAddress,
    LOCKUP_DAYS * 24n * 60n * 60n,
    0n,
    0n,
  );
await tx.wait();

const config = await vaultManager.assets(assetId);
console.log(LABEL, "→ adapter", config.adapter, "wrapped", config.wrappedToken);

// The adapter has to be whitelisted on the ERC-3643 token before it can custody it — the same
// step seed-demo-assets.ts performs for a freshly deployed market. setVerified is MockERC3643's
// own shortcut; against a real issuer's token this is whatever their compliance flow is.
const underlying = await ethers.getContractAt("MockERC3643", underlyingAddress);
await (await underlying.setVerified(config.adapter, true)).wait();
console.log("Adapter whitelisted on", underlyingAddress);

// Prove the deployed bytecode is the market-wide adapter, not a stale artifact of the per-address
// one this replaced (see AUDIT.md finding 1). lockedAmountNow() exists only on the new adapter;
// the old one exposed lockedAmountOf(address) instead, so a wrong build fails here rather than
// going live with a lock-up that a self-transfer walks straight past.
const adapter = await ethers.getContractAt("RealEstateAdapter", config.adapter);
const lockupSeconds = await adapter.lockupPeriod();
const lockedNow = await adapter.lockedAmountNow();
if (lockupSeconds !== LOCKUP_DAYS * 24n * 60n * 60n) {
  throw new Error(`lockupPeriod reads ${lockupSeconds}s, expected ${LOCKUP_DAYS} days`);
}
console.log(`Verified: market-wide adapter, lockupPeriod ${lockupSeconds}s, ${lockedNow} locked`);

// Merge rather than overwrite, so the record keeps every generation of this market.
const outPath = `ignition/deployments/chain-${chainId}/real_estate_market.json`;
const record = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>) : {};
record[LABEL] = {
  assetId,
  adapter: config.adapter,
  wrappedToken: config.wrappedToken,
  underlying: underlyingAddress,
  lockupDays: Number(LOCKUP_DAYS),
  marketWideLockup: true,
};
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log("\nWrote", outPath);
console.log(`Next: set REAL_ESTATE_LABEL in frontend/src/config/assets.ts to ${LABEL}`);
