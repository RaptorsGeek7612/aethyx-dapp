import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const GOLD_ASSET_ID = ethers.id("GOLD");

// VaultManager.deposit/redeem are guarded by OpenZeppelin's ReentrancyGuard because both pull
// or push a token this codebase does not control: the ERC-3643 underlying. ReentrantERC3643
// stands in for a malicious (or merely buggy) real-world token whose transferFrom/transfer
// calls straight back into VaultManager mid-transfer. If the guard is doing its job, that
// reentrant call reverts and unwinds the whole outer transaction — no double mint, no asset
// released twice.
async function deployReentrancyFixture() {
  const [admin, attacker] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("GoldAssetFactory", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const maliciousToken = await ethers.deployContract("ReentrantERC3643", ["Malicious Gold", "mGOLD"]);

  await factory
    .connect(admin)
    .deployGoldAsset(GOLD_ASSET_ID, "Invest'Or Gold", "GLD", maliciousToken.target, 0n, 0n, 0n);

  const assetConfig = await vaultManager.assets(GOLD_ASSET_ID);
  const goldAdapter = await ethers.getContractAt("GoldAdapter", assetConfig.adapter);
  const gldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  await maliciousToken.setVerified(goldAdapter.target, true);
  await maliciousToken.setVerified(attacker.address, true);
  await maliciousToken.mint(attacker.address, ethers.parseUnits("1000", 18));

  return { admin, attacker, vaultManager, maliciousToken, goldAdapter, gldToken };
}

describe("VaultManager reentrancy guard", function () {
  it("blocks a reentrant deposit triggered from the underlying token's transferFrom hook", async function () {
    const { attacker, vaultManager, maliciousToken, goldAdapter, gldToken } =
      await networkHelpers.loadFixture(deployReentrancyFixture);

    const amount = ethers.parseUnits("100", 18);
    await maliciousToken.connect(attacker).approve(goldAdapter.target, amount);
    await maliciousToken.armDepositReentrancy(vaultManager.target, GOLD_ASSET_ID);

    await expect(vaultManager.connect(attacker).deposit(GOLD_ASSET_ID, amount)).to.be.revertedWithCustomError(
      vaultManager,
      "ReentrancyGuardReentrantCall",
    );

    // The whole outer transaction unwound: no GLD was minted and the attacker's balance of the
    // underlying is untouched, exactly as if the deposit had never been attempted.
    expect(await gldToken.totalSupply()).to.equal(0n);
    expect(await maliciousToken.balanceOf(attacker.address)).to.equal(ethers.parseUnits("1000", 18));
  });

  it("blocks a reentrant redeem triggered from the underlying token's transfer hook", async function () {
    const { attacker, vaultManager, maliciousToken, goldAdapter, gldToken } =
      await networkHelpers.loadFixture(deployReentrancyFixture);

    const amount = ethers.parseUnits("100", 18);
    await maliciousToken.connect(attacker).approve(goldAdapter.target, amount);
    await vaultManager.connect(attacker).deposit(GOLD_ASSET_ID, amount);
    expect(await gldToken.balanceOf(attacker.address)).to.equal(amount);

    await gldToken.connect(attacker).approve(vaultManager.target, amount);
    await maliciousToken.armWithdrawReentrancy(vaultManager.target, GOLD_ASSET_ID);

    await expect(vaultManager.connect(attacker).redeem(GOLD_ASSET_ID, amount)).to.be.revertedWithCustomError(
      vaultManager,
      "ReentrancyGuardReentrantCall",
    );

    // Unwound entirely: the wrapped token was never burned and the underlying never released.
    expect(await gldToken.balanceOf(attacker.address)).to.equal(amount);
    expect(await maliciousToken.balanceOf(goldAdapter.target)).to.equal(amount);
  });
});
