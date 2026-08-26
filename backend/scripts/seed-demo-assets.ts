import { readFileSync } from "node:fs";
import { network } from "hardhat";

// Deploys demo MockERC3643 tokens for Gold/Silver/Real Estate, registers them via the asset
// factories, whitelists the relevant addresses, and mints demo balances — everything the core
// InvestOrGateway Ignition module deliberately leaves out (it only deploys protocol
// infrastructure, never demo assets/data). Run after `hardhat ignition deploy` against the
// same network: `hardhat run scripts/seed-demo-assets.ts --network localhost`.
// Set SEED_NETWORK to target a different network (e.g. `sepolia`) already deployed via Ignition.

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;

const deployed = JSON.parse(
  readFileSync(`ignition/deployments/chain-${chainId}/deployed_addresses.json`, "utf8"),
) as Record<string, string>;

const vaultManagerAddress = deployed["InvestOrGateway#VaultManager"];
const goldFactoryAddress = deployed["InvestOrGateway#GoldAssetFactory"];
const silverFactoryAddress = deployed["InvestOrGateway#SilverAssetFactory"];
const realEstateFactoryAddress = deployed["InvestOrGateway#RealEstateAssetFactory"];

const [admin] = await ethers.getSigners();
console.log("Seeding demo assets as", admin.address);

const vaultManager = await ethers.getContractAt("VaultManager", vaultManagerAddress);
const goldFactory = await ethers.getContractAt("GoldAssetFactory", goldFactoryAddress);
const silverFactory = await ethers.getContractAt("SilverAssetFactory", silverFactoryAddress);
const realEstateFactory = await ethers.getContractAt("RealEstateAssetFactory", realEstateFactoryAddress);

async function deployMockToken(name: string, symbol: string) {
  const token = await ethers.deployContract("MockERC3643", [name, symbol, 18], admin);
  await token.waitForDeployment();
  return token;
}

async function seedMetal(
  label: "GOLD" | "SILVER",
  tokenName: string,
  tokenSymbol: string,
  wrappedName: string,
  wrappedSymbol: string,
) {
  const assetId = ethers.id(label);
  const existing = await vaultManager.assets(assetId);
  if (existing.adapter !== ethers.ZeroAddress) {
    console.log(label, "already registered, skipping deploy, topping up balance only");
    const existingAdapter = await ethers.getContractAt("AssetAdapter", existing.adapter);
    const underlying = await ethers.getContractAt("MockERC3643", await existingAdapter.underlying());
    await (await underlying.mint(admin.address, ethers.parseUnits("2000", 18))).wait();
    return;
  }

  const underlying = await deployMockToken(tokenName, tokenSymbol);
  console.log(label, "underlying deployed at", underlying.target);

  const deployTx =
    label === "GOLD"
      ? await goldFactory
          .connect(admin)
          .deployGoldAsset(assetId, wrappedName, wrappedSymbol, underlying.target, 0n, 50n, 50n)
      : await silverFactory
          .connect(admin)
          .deploySilverAsset(assetId, wrappedName, wrappedSymbol, underlying.target, 0n, 50n, 50n);
  await deployTx.wait();

  const config = await vaultManager.assets(assetId);
  console.log(label, "registered — adapter", config.adapter, "wrappedToken", config.wrappedToken);

  await (await underlying.setVerified(config.adapter, true)).wait();
  await (await underlying.setVerified(admin.address, true)).wait();
  await (await underlying.mint(admin.address, ethers.parseUnits("2000", 18))).wait();
  console.log(label, "admin whitelisted and funded with 2000", tokenSymbol);
}

await seedMetal("GOLD", "Tokenized Gold", "tGOLD", "Invest'Or Gold", "GLD");
await seedMetal("SILVER", "Tokenized Silver", "tSLV", "Invest'Or Silver", "SLD");

const realEstateAssetId = ethers.id("REAL_ESTATE_PARIS_01");
const existingRealEstate = await vaultManager.assets(realEstateAssetId);
if (existingRealEstate.adapter !== ethers.ZeroAddress) {
  console.log("REAL_ESTATE already registered, skipping");
} else {
  const propertyToken = await deployMockToken("Tokenized Property", "tRE");
  console.log("REAL_ESTATE underlying deployed at", propertyToken.target);

  const lockupPeriod = 90n * 24n * 60n * 60n;
  const deployTx = await realEstateFactory
    .connect(admin)
    .deployRealEstateAsset(
      realEstateAssetId,
      "Invest'Or Real Estate",
      "RLD",
      propertyToken.target,
      lockupPeriod,
      0n,
      0n,
    );
  await deployTx.wait();

  const config = await vaultManager.assets(realEstateAssetId);
  console.log("REAL_ESTATE registered — adapter", config.adapter, "wrappedToken", config.wrappedToken);

  await (await propertyToken.setVerified(config.adapter, true)).wait();
  await (await propertyToken.setVerified(admin.address, true)).wait();
  await (await propertyToken.mint(admin.address, ethers.parseUnits("2", 18))).wait();
  console.log("REAL_ESTATE admin whitelisted and funded with 2 tRE");
}

console.log("Demo seeding complete.");
