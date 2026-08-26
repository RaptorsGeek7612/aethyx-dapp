import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const GOLD_ASSET_ID = ethers.id("GOLD");

// VaultManager and InvestOrGateway each hold their own independent Pausable state (see both
// contracts' pause()/unpause()). This matters operationally: pausing the Gateway freezes the
// user-facing entry point without needing to also pause VaultManager (and vice versa) — e.g. to
// investigate a suspicious pattern of Gateway traffic while still allowing direct VaultManager
// integrations to keep running, or the reverse.
async function deployProtocolFixture() {
  const [admin, alice, outsider] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("GoldAssetFactory", [accessManager.target, vaultManager.target]);
  const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.lockRouterRole(gateway.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);
  await accessManager.grantRole(await accessManager.PAUSER_ROLE(), admin.address);

  const goldToken = await ethers.deployContract("MockERC3643", ["Tokenized Gold", "tGOLD", 18]);

  await factory.connect(admin).deployGoldAsset(GOLD_ASSET_ID, "Invest'Or Gold", "GLD", goldToken.target, 0n, 0n, 0n);

  const assetConfig = await vaultManager.assets(GOLD_ASSET_ID);
  const goldAdapter = await ethers.getContractAt("GoldAdapter", assetConfig.adapter);
  const gldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  await goldToken.setVerified(goldAdapter.target, true);
  await goldToken.setVerified(alice.address, true);
  await goldToken.mint(alice.address, ethers.parseUnits("1000", 18));

  return { admin, alice, outsider, accessManager, vaultManager, gateway, goldToken, goldAdapter, gldToken };
}

describe("Pause / freeze controls", function () {
  it("blocks redeem, not just deposit, once VaultManager is paused", async function () {
    const { admin, alice, vaultManager, goldToken, goldAdapter, gldToken } =
      await networkHelpers.loadFixture(deployProtocolFixture);

    const amount = ethers.parseUnits("10", 18);
    await goldToken.connect(alice).approve(goldAdapter.target, amount);
    await vaultManager.connect(alice).deposit(GOLD_ASSET_ID, amount);

    await vaultManager.connect(admin).pause();

    await gldToken.connect(alice).approve(vaultManager.target, amount);
    await expect(vaultManager.connect(alice).redeem(GOLD_ASSET_ID, amount)).to.be.revertedWithCustomError(
      vaultManager,
      "EnforcedPause",
    );
  });

  it("restores deposit and redeem once VaultManager is unpaused", async function () {
    const { admin, alice, vaultManager, goldToken, goldAdapter } =
      await networkHelpers.loadFixture(deployProtocolFixture);

    await vaultManager.connect(admin).pause();
    await vaultManager.connect(admin).unpause();

    const amount = ethers.parseUnits("10", 18);
    await goldToken.connect(alice).approve(goldAdapter.target, amount);
    await expect(vaultManager.connect(alice).deposit(GOLD_ASSET_ID, amount)).to.not.revert(ethers);
  });

  it("rejects pause/unpause from anyone without PAUSER_ROLE", async function () {
    const { outsider, accessManager, vaultManager } = await networkHelpers.loadFixture(deployProtocolFixture);

    const role = await accessManager.PAUSER_ROLE();
    await expect(vaultManager.connect(outsider).pause())
      .to.be.revertedWithCustomError(vaultManager, "Unauthorized")
      .withArgs(outsider.address, role);
  });

  it("freezes the Gateway independently of VaultManager: paused Gateway blocks deposits even while VaultManager stays live", async function () {
    const { admin, alice, vaultManager, gateway, goldToken, goldAdapter } =
      await networkHelpers.loadFixture(deployProtocolFixture);

    await gateway.connect(admin).pause();

    const amount = ethers.parseUnits("10", 18);
    await goldToken.connect(alice).approve(goldAdapter.target, amount);

    await expect(gateway.connect(alice).deposit(GOLD_ASSET_ID, amount)).to.be.revertedWithCustomError(
      gateway,
      "EnforcedPause",
    );

    // VaultManager itself was never paused — a direct call still goes through.
    await expect(vaultManager.connect(alice).deposit(GOLD_ASSET_ID, amount)).to.not.revert(ethers);
  });

  it("rejects pause/unpause on the Gateway from anyone without PAUSER_ROLE", async function () {
    const { outsider, accessManager, gateway } = await networkHelpers.loadFixture(deployProtocolFixture);

    const role = await accessManager.PAUSER_ROLE();
    await expect(gateway.connect(outsider).pause())
      .to.be.revertedWithCustomError(gateway, "Unauthorized")
      .withArgs(outsider.address, role);
  });
});
