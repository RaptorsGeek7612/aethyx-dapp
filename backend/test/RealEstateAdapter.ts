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
  const factory = await ethers.deployContract("RealEstateAssetFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.lockRouterRole(gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const propertyToken = await ethers.deployContract("MockERC3643", ["Tokenized Property", "tRE", 18]);

  await factory
    .connect(admin)
    .deployRealEstateAsset(
      REAL_ESTATE_ASSET_ID,
      "Invest'Or Real Estate",
      "RLD",
      propertyToken.target,
      LOCKUP_PERIOD,
      0n,
      0n,
    );

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

  it("meters the market's collateral, not the Gateway's address, when routed through the Gateway", async function () {
    const { alice, bob, gateway, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);

    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await gateway.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);

    // Bob deposits once Alice's tranche has already matured. His fresh, still-locked tranche
    // must not eat into the matured pool Alice is entitled to draw on.
    await propertyToken.connect(bob).approve(realEstateAdapter.target, amount);
    await gateway.connect(bob).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(gateway.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");

    // Alice's redemption drained the matured pool; Bob's own tranche is still locked, so there
    // is nothing left for him to draw on yet.
    await rldToken.connect(bob).approve(vaultManager.target, amount);
    await expect(gateway.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
  });

  it("gives each deposit its own maturity: a later deposit never postpones an earlier one", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const first = ethers.parseUnits("100", 18);
    const second = ethers.parseUnits("40", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, first + second);

    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, first);
    // Top up most of the way through the first deposit's lock-up. Under the previous
    // single-lockedUntil design this re-locked the *whole* position for another full period.
    await networkHelpers.time.increase(LOCKUP_PERIOD - 100n);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, second);

    await networkHelpers.time.increase(101n);

    // The first deposit has now matured on its own schedule; the second has not.
    expect(await realEstateAdapter.maturedAmountNow()).to.equal(first);
    expect(await realEstateAdapter.lockedAmountNow()).to.equal(second);

    await rldToken.connect(alice).approve(vaultManager.target, first + second);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, first + 1n)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, first)).to.emit(vaultManager, "Redeemed");

    // ...and the second deposit still has to wait out the rest of its own period.
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, second)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
    await networkHelpers.time.increase(LOCKUP_PERIOD);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, second)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18));
  });

  it("reports the next tranche's unlock time while an earlier one is already redeemable", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("10", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount * 2n);

    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    const secondDepositAt = BigInt(await networkHelpers.time.latest());

    expect(await realEstateAdapter.nextUnlockAt()).to.be.greaterThan(0n);

    // One second short of the second tranche: a tranche is redeemable *at* unlockAt, not after,
    // so stopping exactly on it would mature both and leave nothing to point a countdown at.
    await networkHelpers.time.increase(LOCKUP_PERIOD - 1n);

    // Only the second tranche is left locked, so that is what the countdown must point at.
    expect(await realEstateAdapter.nextUnlockAt()).to.equal(secondDepositAt + LOCKUP_PERIOD);
    expect((await realEstateAdapter.lockSchedule()).length).to.equal(2);
  });

  it("cannot be escaped by moving the wrapped token to another address before redeeming", async function () {
    const { alice, bob, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    // The escape the previous per-address design allowed: send the freely-transferable wrapped
    // token to a second address and redeem from there, where no lock had ever been recorded.
    // Nothing on-chain distinguishes that from a genuine secondary-market sale, which is exactly
    // why the gate cannot be keyed on who is redeeming.
    await rldToken.connect(alice).transfer(bob.address, amount);
    await rldToken.connect(bob).approve(vaultManager.target, amount);

    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
    expect(await propertyToken.balanceOf(bob.address)).to.equal(ethers.parseUnits("1000", 18));

    // Once the market's collateral has matured, that same holder redeems freely: the lock-up
    // paces the collateral's exit, it never singles out a holder.
    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);
    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
    expect(await propertyToken.balanceOf(bob.address)).to.equal(ethers.parseUnits("1100", 18));
  });

  it("keeps the wrapped token transferable while its collateral is still locked", async function () {
    const { alice, bob, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    // The whole point of the wrap: the ERC-20 circulates even while the underlying cannot yet be
    // released. Only redemption is metered, never transfer.
    await rldToken.connect(alice).transfer(bob.address, amount);
    expect(await rldToken.balanceOf(bob.address)).to.equal(amount);
    expect(await rldToken.balanceOf(alice.address)).to.equal(0n);
    expect(await realEstateAdapter.lockedAmountNow()).to.equal(amount);
  });
});
