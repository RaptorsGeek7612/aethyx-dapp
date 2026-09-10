import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

// Redeploys the five real-estate lock-up markets against the current RealEstateAdapter, the one
// that gives each deposit its own maturity instead of re-locking the whole position on every top
// up. VaultManager.registerAsset reverts with AssetAlreadyRegistered on an id it already knows,
// and there is no way to repoint an existing id at a new adapter, so the new markets have to
// carry new asset ids — hence the LABEL_SUFFIX below, which must match the labels the frontend's
// config/assets.ts builds its ids from.
//
//   hardhat run scripts/redeploy-real-estate-tiers.ts --network sepolia
//
// Re-running is safe: any tier already registered under its new id is skipped, so an interrupted
// run can simply be run again.

const LABEL_SUFFIX = "_V2";
const TIERS = [
  { key: "15D", label: "15 days", days: 15n },
  { key: "1M", label: "1 month", days: 30n },
  { key: "3M", label: "3 months", days: 90n },
  { key: "6M", label: "6 months", days: 180n },
  { key: "1Y", label: "1 year", days: 365n },
] as const;

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
console.log("Redeploying real-estate tiers as", admin.address, "on", networkName);

const results: Record<string, { assetId: string; adapter: string; wrappedToken: string; underlying: string }> = {};

for (const tier of TIERS) {
  const oldLabel = `REAL_ESTATE_PARIS_01_${tier.key}`;
  const newLabel = `${oldLabel}${LABEL_SUFFIX}`;
  const newAssetId = ethers.id(newLabel);

  const existing = await vaultManager.assets(newAssetId);
  if (existing.adapter !== ethers.ZeroAddress) {
    console.log(newLabel, "already registered at", existing.adapter, "— skipping");
    results[newLabel] = {
      assetId: newAssetId,
      adapter: existing.adapter,
      wrappedToken: existing.wrappedToken,
      underlying: await (await ethers.getContractAt("AssetAdapter", existing.adapter)).underlying(),
    };
    continue;
  }

  // Reuse the tier's existing ERC-3643 underlying rather than minting a parallel one: the old
  // market keeps custody of whatever was already deposited against it, and reusing the token
  // means a holder's untouched ERC-3643 balance still works with the new market.
  const oldConfig = await vaultManager.assets(ethers.id(oldLabel));
  if (oldConfig.adapter === ethers.ZeroAddress) throw new Error(`${oldLabel} is not registered — nothing to mirror`);
  const oldAdapter = await ethers.getContractAt("AssetAdapter", oldConfig.adapter);
  const underlyingAddress = await oldAdapter.underlying();

  const tx = await factory
    .connect(admin)
    .deployRealEstateAsset(
      newAssetId,
      `Invest'Or Real Estate ${tier.label}`,
      `RLD-${tier.key}`,
      underlyingAddress,
      tier.days * 24n * 60n * 60n,
      0n,
      0n,
    );
  await tx.wait();

  const config = await vaultManager.assets(newAssetId);
  console.log(newLabel, "→ adapter", config.adapter, "wrapped", config.wrappedToken);

  // The adapter has to be whitelisted on the ERC-3643 token before it can custody it — the same
  // step seed-demo-assets.ts performs for a freshly deployed market.
  const underlying = await ethers.getContractAt("MockERC3643", underlyingAddress);
  await (await underlying.setVerified(config.adapter, true)).wait();
  console.log(newLabel, "adapter whitelisted on", underlyingAddress);

  results[newLabel] = {
    assetId: newAssetId,
    adapter: config.adapter,
    wrappedToken: config.wrappedToken,
    underlying: underlyingAddress,
  };
}

const outPath = `ignition/deployments/chain-${chainId}/real_estate_tiers.json`;
writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
console.log("\nWrote", outPath);
console.log("Next: set the frontend's REAL_ESTATE label suffix to", LABEL_SUFFIX, "in config/assets.ts");
