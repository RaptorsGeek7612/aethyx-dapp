import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const GOLD_ASSET_ID = ethers.id("GOLD");
const DEPOSIT_FEE_BPS = 50n; // 0.5%
const REDEEM_FEE_BPS = 50n; // 0.5%
const BPS_DENOMINATOR = 10_000n;

async function deployProtocolFixture() {
  const [admin, alice, bob] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("GoldAssetFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.grantRole(await accessManager.ROUTER_ROLE(), gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);
  await accessManager.grantRole(await accessManager.PAUSER_ROLE(), admin.address);

  const goldToken = await ethers.deployContract("MockERC3643", ["Tokenized Gold", "tGOLD", 18]);

  await factory
    .connect(admin)
    .deployGoldAsset(GOLD_ASSET_ID, "Invest'Or Gold", "GLD", goldToken.target, 0n, DEPOSIT_FEE_BPS, REDEEM_FEE_BPS);

  const assetConfig = await vaultManager.assets(GOLD_ASSET_ID);
  const goldAdapter = await ethers.getContractAt("GoldAdapter", assetConfig.adapter);
  const gldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  // Issuer onboarding: whitelist every address that will ever hold the ERC-3643 token.
  // Note the Gateway is deliberately NOT whitelisted here — it never touches this token.
  await goldToken.setVerified(goldAdapter.target, true);
  await goldToken.setVerified(alice.address, true);
  await goldToken.setVerified(bob.address, true);

  await goldToken.mint(alice.address, ethers.parseUnits("1000", 18));
  await goldToken.mint(bob.address, ethers.parseUnits("1000", 18));

  return { admin, alice, bob, accessManager, treasury, vaultManager, factory, gateway, goldToken, goldAdapter, gldToken };
}

describe("Invest'Or Gateway — gold wrap end to end", function () {
  it("deposits and redeems directly through VaultManager, preserving the 1:1 invariant", async function () {
    const { alice, vaultManager, treasury, goldToken, goldAdapter, gldToken } =
      await networkHelpers.loadFixture(deployProtocolFixture);

    const depositAmount = ethers.parseUnits("100", 18);
    const expectedDepositFee = (depositAmount * DEPOSIT_FEE_BPS) / BPS_DENOMINATOR;
    const expectedMinted = depositAmount - expectedDepositFee;

    // Direct VaultManager calls pull through the adapter, so the approval target is the
    // adapter itself — not VaultManager.
    await goldToken.connect(alice).approve(goldAdapter.target, depositAmount);
    await expect(vaultManager.connect(alice).deposit(GOLD_ASSET_ID, depositAmount))
      .to.emit(vaultManager, "Deposited")
      .withArgs(GOLD_ASSET_ID, alice.address, depositAmount, expectedMinted, expectedDepositFee);

    expect(await gldToken.balanceOf(alice.address)).to.equal(expectedMinted);
    expect(await gldToken.balanceOf(treasury.target)).to.equal(expectedDepositFee);
    expect(await goldToken.balanceOf(goldAdapter.target)).to.equal(depositAmount);
    expect(await gldToken.totalSupply()).to.equal(await goldToken.balanceOf(goldAdapter.target));

    const redeemAmount = ethers.parseUnits("50", 18);
    const expectedRedeemFee = (redeemAmount * REDEEM_FEE_BPS) / BPS_DENOMINATOR;
    const expectedReleased = redeemAmount - expectedRedeemFee;

    await gldToken.connect(alice).approve(vaultManager.target, redeemAmount);
    await expect(vaultManager.connect(alice).redeem(GOLD_ASSET_ID, redeemAmount))
      .to.emit(vaultManager, "Redeemed")
      .withArgs(GOLD_ASSET_ID, alice.address, redeemAmount, expectedReleased, expectedRedeemFee);

    // Invariant holds after redemption too: total wrapped supply == total value locked.
    expect(await gldToken.totalSupply()).to.equal(await goldToken.balanceOf(goldAdapter.target));
    expect(await gldToken.balanceOf(treasury.target)).to.equal(expectedDepositFee + expectedRedeemFee);
  });

  it("deposits and redeems through the Gateway without ever custodying either token", async function () {
    const { bob, gateway, goldAdapter, vaultManager, goldToken, gldToken } =
      await networkHelpers.loadFixture(deployProtocolFixture);

    const depositAmount = ethers.parseUnits("200", 18);
    const expectedMinted = depositAmount - (depositAmount * DEPOSIT_FEE_BPS) / BPS_DENOMINATOR;

    // Through the Gateway, callers approve the same targets as a direct call would: the
    // adapter for deposits, VaultManager for redemptions. The Gateway itself never needs an
    // allowance, because depositFor/redeemFor pull straight from `bob`, not from the Gateway.
    await goldToken.connect(bob).approve(goldAdapter.target, depositAmount);
    await gateway.connect(bob).deposit(GOLD_ASSET_ID, depositAmount);

    expect(await gldToken.balanceOf(bob.address)).to.equal(expectedMinted);
    expect(await gldToken.balanceOf(gateway.target)).to.equal(0n);
    expect(await goldToken.balanceOf(gateway.target)).to.equal(0n);

    await gldToken.connect(bob).approve(vaultManager.target, expectedMinted);
    await gateway.connect(bob).redeem(GOLD_ASSET_ID, expectedMinted);

    expect(await gldToken.balanceOf(bob.address)).to.equal(0n);
    expect(await goldToken.balanceOf(gateway.target)).to.equal(0n);
  });

  it("rejects a direct call to depositFor/redeemFor from anything other than the Gateway", async function () {
    const { alice, vaultManager } = await networkHelpers.loadFixture(deployProtocolFixture);

    await expect(
      vaultManager.connect(alice).depositFor(GOLD_ASSET_ID, 1n, alice.address),
    ).to.be.revertedWithCustomError(vaultManager, "Unauthorized");
  });

  it("rejects a deposit from a depositor who isn't a verified identity", async function () {
    const { admin, vaultManager, goldToken, goldAdapter } = await networkHelpers.loadFixture(deployProtocolFixture);

    const [, , , stranger] = await ethers.getSigners();
    await goldToken.mint(stranger.address, ethers.parseUnits("10", 18));
    await goldToken.connect(stranger).approve(goldAdapter.target, ethers.parseUnits("10", 18));

    await expect(vaultManager.connect(stranger).deposit(GOLD_ASSET_ID, ethers.parseUnits("10", 18)))
      .to.be.revertedWithCustomError(goldAdapter, "ComplianceCheckFailed")
      .withArgs(stranger.address, goldAdapter.target, ethers.parseUnits("10", 18));

    // admin is unused here beyond fixture destructuring convention
    void admin;
  });

  it("only lets VaultManager call the adapter, and only VaultManager mint GLD", async function () {
    const { alice, bob, goldAdapter, gldToken } = await networkHelpers.loadFixture(deployProtocolFixture);

    await expect(goldAdapter.connect(alice).deposit(alice.address, 1n))
      .to.be.revertedWithCustomError(goldAdapter, "NotVaultManager")
      .withArgs(alice.address);

    await expect(gldToken.connect(bob).mint(bob.address, 1n)).to.be.revertedWithCustomError(gldToken, "Unauthorized");
  });

  it("blocks deposits once VaultManager is paused", async function () {
    const { admin, alice, vaultManager, goldToken, goldAdapter } = await networkHelpers.loadFixture(deployProtocolFixture);

    await vaultManager.connect(admin).pause();

    const amount = ethers.parseUnits("1", 18);
    await goldToken.connect(alice).approve(goldAdapter.target, amount);
    await expect(vaultManager.connect(alice).deposit(GOLD_ASSET_ID, amount)).to.be.revertedWithCustomError(
      vaultManager,
      "EnforcedPause",
    );
  });
});
