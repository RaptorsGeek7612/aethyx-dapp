import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const REAL_ESTATE_ASSET_ID = ethers.id("REAL_ESTATE_PARIS_01");
const LOCKUP_PERIOD = 30n * 24n * 60n * 60n; // 30 days

async function deployRealEstateFixture() {
  const [admin, alice, bob] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("RealEstateAssetFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("AethyxGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.lockRouterRole(gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const propertyToken = await ethers.deployContract("MockERC3643", ["Tokenized Property", "tRE", 18]);

  await factory
    .connect(admin)
    .deployRealEstateAsset(
      REAL_ESTATE_ASSET_ID,
      "AETHYX Real Estate",
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

describe("RealEstateAdapter — market-wide maturity pool", function () {
  it("blocks redemption before any deposit has matured, and allows it after", async function () {
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
  });

  it("gives two deposits two different maturities in the pool's schedule, each counted from its own date", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("10", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount * 2n);

    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    const firstAt = BigInt(await networkHelpers.time.latest());

    // Three days later, a second deposit — its own tranche in the shared schedule, not merged
    // into or postponing the first one's.
    await networkHelpers.time.increase(3n * 24n * 60n * 60n);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    const secondAt = BigInt(await networkHelpers.time.latest());

    const schedule = await realEstateAdapter.lockSchedule();
    expect(schedule.length).to.equal(2);
    expect(schedule[0].unlockAt).to.equal(firstAt + LOCKUP_PERIOD);
    expect(schedule[1].unlockAt).to.equal(secondAt + LOCKUP_PERIOD);
    expect(schedule[1].unlockAt - schedule[0].unlockAt).to.equal(secondAt - firstAt);
  });

  it("releases the matured tranche from the pool while a later one is still running", async function () {
    const { alice, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const first = ethers.parseUnits("100", 18);
    const second = ethers.parseUnits("40", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, first + second);

    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, first);
    await networkHelpers.time.increase(LOCKUP_PERIOD - 100n);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, second);
    await networkHelpers.time.increase(101n);

    expect(await realEstateAdapter.maturedAmountNow()).to.equal(first);
    expect(await realEstateAdapter.lockedAmountNow()).to.equal(second);

    await rldToken.connect(alice).approve(vaultManager.target, first + second);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, first + 1n)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, first)).to.emit(vaultManager, "Redeemed");

    await networkHelpers.time.increase(LOCKUP_PERIOD);
    await expect(vaultManager.connect(alice).redeem(REAL_ESTATE_ASSET_ID, second)).to.emit(vaultManager, "Redeemed");
  });

  it("shares the matured pool across independent depositors, not just within one account", async function () {
    // The actual fix, demonstrated directly rather than only via a self-transfer: two genuinely
    // different depositors draw from the same maturity pool. Bob's own tokens redeem against
    // Alice's already-matured deposit, because the pool tracks a total, not who deposited what.
    const { alice, bob, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);
    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);

    // Bob deposits only after Alice's tranche has already matured — his own tranche is brand new
    // and would still be locked on its own.
    await propertyToken.connect(bob).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(bob).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(bob).approve(vaultManager.target, amount);
    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
  });

  it("closes the self-transfer escape: a second address draws from the same pool, not a fresh allowance", async function () {
    const { alice, bob, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await vaultManager.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    // The wrapped token stays entirely transferable — only its conversion back to the underlying
    // is metered by the shared pool, not the ERC-20 transfer itself.
    await rldToken.connect(alice).transfer(bob.address, amount);
    await rldToken.connect(bob).approve(vaultManager.target, amount);

    // Before maturity, the second address gets exactly what the first would have: nothing.
    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );

    // After maturity, it succeeds — not because the self-transfer bought anything, but because
    // the pool itself has matured and anyone holding the wrapped token can now redeem from it.
    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);
    await expect(vaultManager.connect(bob).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
  });

  it("routes deposits and redemptions through the Gateway the same way, real end user or not", async function () {
    const { alice, gateway, vaultManager, propertyToken, realEstateAdapter, rldToken } =
      await networkHelpers.loadFixture(deployRealEstateFixture);

    const amount = ethers.parseUnits("100", 18);
    await propertyToken.connect(alice).approve(realEstateAdapter.target, amount);
    await gateway.connect(alice).deposit(REAL_ESTATE_ASSET_ID, amount);

    await rldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(gateway.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.be.revertedWithCustomError(
      realEstateAdapter,
      "StillLocked",
    );

    await networkHelpers.time.increase(LOCKUP_PERIOD + 1n);
    await expect(gateway.connect(alice).redeem(REAL_ESTATE_ASSET_ID, amount)).to.emit(vaultManager, "Redeemed");
  });
});
