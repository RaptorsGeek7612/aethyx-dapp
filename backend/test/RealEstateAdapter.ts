import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const REAL_ESTATE_ASSET_ID = ethers.id("REAL_ESTATE_PARIS_01");
const LOCKUP_PERIOD = 90n * 24n * 60n * 60n; // 90 days

async function deployRealEstateFixture() {
  const [admin, alice, bob] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("WrappedTokenFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.grantRole(await accessManager.ROUTER_ROLE(), gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const propertyToken = await ethers.deployContract("MockERC3643", ["Tokenized Property", "tRE", 18]);

  await factory
    .connect(admin)
    .deployRealEstateAsset(REAL_ESTATE_ASSET_ID, "Invest'Or Real Estate", "RLD", propertyToken.target, LOCKUP_PERIOD, 0n, 0n);

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

describe("RealEstateAdapter — lock-up period", function () {
  it("blocks redemption before the lock-up expires, and allows it after (direct VaultManager)", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );

    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);

    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18));
  });

  it("tracks the lock-up per real end user, not per Gateway, when routed through the Gateway", async function () {
    const { alice, bob, gateway, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);

    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await gateway.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);

    // Bob deposits right after Alice's lock-up has already expired. If the lock-up were keyed
    // on the Gateway's own address (the bug this fix resolves), Bob's fresh deposit would
    // reset a *shared* lock and incorrectly block Alice's now-eligible redemption below.
    await propertyToken.connect(bob).approve(realEstateAdapter.target, amount);
    await gateway.connect(bob).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(gateway.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");

    // Bob, having just deposited, is still correctly locked on his own account.
    await rldToken.connect(bob).approve(vaultManager.target, amount);
    await expect(gateway.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
  });
});
