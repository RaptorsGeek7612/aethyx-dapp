import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys the single real-estate market that replaces the five per-lock-up tiers.
//
// The tiers existed only to let a depositor pick a holding period, because
// RealEstateAdapter.lockupPeriod is immutable and VaultManager's deposit(from, amount) has no
// room for a per-call choice. That is not how a DeFi protocol normally expresses a holding
// period: the period belongs to the contract you deposit into, and the UI reads it off the
// adapter rather than asking for it. So: one market, one lockupPeriod, no choice to make.
//
// VaultManager.registerAsset reverts with AssetAlreadyRegistered on an id it already knows, and
// there is no way to repoint an existing id at a new adapter, so the new market needs its own
// asset id — hence LABEL below, which must match what the frontend's config/assets.ts builds its
// id from (REAL_ESTATE_LABEL there).
//
//   hardhat run scripts/deploy-real-estate-market.ts --network sepolia
//
// Re-running is safe: an already-registered LABEL is reported and left alone.

const LABEL = "REAL_ESTATE_PARIS_01_V3";
const LOCKUP_DAYS = 30n;
// The market whose ERC-3643 underlying the new one reuses. Reusing it rather than minting a
// parallel token means a holder's untouched underlying balance still works with the new market;
// the old markets keep custody of whatever was already deposited against them.
const UNDERLYING_SOURCE_LABEL = "REAL_ESTATE_PARIS_01";

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
console.log("Deploying the real-estate market as", admin.address, "on", networkName);

const assetId = ethers.id(LABEL);
const existing = await vaultManager.assets(assetId);
if (existing.adapter !== ethers.ZeroAddress) {
  console.log(LABEL, "is already registered at", existing.adapter, "— nothing to do");
  process.exit(0);
}

const sourceConfig = await vaultManager.assets(ethers.id(UNDERLYING_SOURCE_LABEL));
if (sourceConfig.adapter === ethers.ZeroAddress) {
  throw new Error(`${UNDERLYING_SOURCE_LABEL} is not registered — no underlying token to reuse`);
}
const sourceAdapter = await ethers.getContractAt("AssetAdapter", sourceConfig.adapter);
const underlyingAddress = await sourceAdapter.underlying();
console.log("Reusing the underlying of", UNDERLYING_SOURCE_LABEL, "at", underlyingAddress);

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

const outPath = `ignition/deployments/chain-${chainId}/real_estate_market.json`;
writeFileSync(
  outPath,
  JSON.stringify(
    {
      [LABEL]: {
        assetId,
        adapter: config.adapter,
        wrappedToken: config.wrappedToken,
        underlying: underlyingAddress,
        lockupDays: Number(LOCKUP_DAYS),
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote", outPath);
console.log("Check that config/assets.ts still builds its real-estate id from", LABEL);
