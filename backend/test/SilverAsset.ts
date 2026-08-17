import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const SILVER_ASSET_ID = ethers.id("SILVER");

async function deploySilverFixture() {
  const [admin, alice] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("SilverAssetFactory", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const silverToken = await ethers.deployContract("MockERC3643", ["Tokenized Silver", "tSLV", 18]);

  await factory
    .connect(admin)
    .deploySilverAsset(SILVER_ASSET_ID, "Invest'Or Silver", "SLD", silverToken.target, 0n, 0n, 0n);

  const assetConfig = await vaultManager.assets(SILVER_ASSET_ID);
  const silverAdapter = await ethers.getContractAt("SilverAdapter", assetConfig.adapter);
  const sldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  await silverToken.setVerified(silverAdapter.target, true);
  await silverToken.setVerified(alice.address, true);
  await silverToken.mint(alice.address, ethers.parseUnits("1000", 18));

  return { alice, vaultManager, silverToken, silverAdapter, sldToken };
}

describe("SilverAssetFactory.deploySilverAsset", function () {
  it("registers a SilverAdapter + SLD pair that deposits and redeems like any other asset", async function () {
    const { alice, vaultManager, silverToken, silverAdapter, sldToken } =
      await networkHelpers.loadFixture(deploySilverFixture);

    const amount = ethers.parseUnits("120", 18);
    await silverToken.connect(alice).approve(silverAdapter.target, amount);
    await vaultManager.connect(alice).deposit(SILVER_ASSET_ID, amount);

    expect(await sldToken.balanceOf(alice.address)).to.equal(amount);
    expect(await silverToken.balanceOf(silverAdapter.target)).to.equal(amount);

    await sldToken.connect(alice).approve(vaultManager.target, amount);
    await vaultManager.connect(alice).redeem(SILVER_ASSET_ID, amount);

    expect(await sldToken.balanceOf(alice.address)).to.equal(0n);
    expect(await silverToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18));
  });
});
