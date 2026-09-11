import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const REAL_ESTATE_ASSET_ID = ethers.id("REAL_ESTATE_PARIS_01");

// Real estate deposits and redeems exactly like gold and silver: no holding period, no per-market
// metering, nothing the generic AssetAdapter does not already do. These tests pin that down —
// two earlier designs put a lock-up here (one keyed on the depositor's address, one on the
// market's collateral) and both are gone, so a regression that quietly reintroduces one should
// fail here rather than surface as a stuck redemption.
async function deployRealEstateFixture() {
  const [admin, alice, bob] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("RealEstateAssetFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.lockRouterRole(gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const propertyToken = await ethers.deployContract("MockERC3643", ["Tokenized Property", "tRE", 18]);

  await factory
    .connect(admin)
    .deployRealEstateAsset(REAL_ESTATE_ASSET_ID, "Invest'Or Real Estate", "RLD", propertyToken.target, 0n, 0n);

  const assetConfig = await vaultManager.assets(REAL_ESTATE_ASSET_ID);
  const realEstateAdapter = await ethers.getContractAt("RealEstateAdapter", assetConfig.adapter);
  const rldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  await propertyToken.setVerified(realEstateAdapter.target, true);
  await propertyToken.setVerified(alice.address, true);
  await propertyToken.setVerified(bob.address, true);
  await propertyToken.mint(alice.address, ethers.parseUnits("1000", 18));
  await propertyToken.mint(bob.address, ethers.parseUnits("1000", 18));

  return { admin, alice, bob, gateway, vaultManager, propertyToken, realEstateAdapter, rldToken };
}

describe("RealEstateAdapter", function () {
  it("redeems in the same block as the deposit, with no holding period", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18));
  });

  it("lets a secondary-market holder redeem what they never deposited", async function () {
    const { alice, bob, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).transfer(bob.address, amount);
    await rldToken.connect(bob).approve(vaultManager.target, amount);

    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(bob.address)).to.equal(ethers.parseUnits("1100", 18));
  });

  it("does not expose any lock-up surface", async function () {
    const { realEstateAdapter } = await networkHelpers.loadFixture(deployRealEstateFixture);

    // Both retired designs are gone: neither the per-address one nor the market-wide one.
    const surface = realEstateAdapter.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.format("sighash"));
    for (const gone of [
      "lockupPeriod()",
      "lockedUntil(address)",
      "lockedAmountOf(address)",
      "lockedAmountNow()",
      "maturedAmountNow()",
      "nextUnlockAt()",
      "lockSchedule()",
    ]) {
      expect(surface, `${gone} should be gone`).to.not.include(gone);
    }
  });

  it("deposits and redeems through the Gateway like any other asset", async function () {
    const { alice, gateway, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("50", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await gateway.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    expect(await rldToken.balanceOf(alice.address)).to.equal(amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(gateway.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18));
  });
});
