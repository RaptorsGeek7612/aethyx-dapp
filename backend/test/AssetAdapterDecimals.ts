import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const GOLD_ASSET_ID = ethers.id("GOLD");

// AssetAdapter normalizes every underlying to 18 canonical decimals on deposit, and back to
// the underlying's own decimals on withdrawal. Deposits/redeems through the same fixture but
// backed by a 6- and an 8-decimal underlying (the two most common ERC-20 decimal counts besides
// 18) exercise both branches of _toCanonical/_fromCanonical that the 18-decimal-only fixtures
// used elsewhere in this suite never touch.
async function deployGoldFixtureWithDecimals(underlyingDecimals: number) {
  const [admin, alice] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
  const factory = await ethers.deployContract("GoldAssetFactory", [accessManager.target, vaultManager.target]);

  await accessManager.grantRole(await accessManager.MINTER_ROLE(), vaultManager.target);
  await accessManager.grantRole(await accessManager.FACTORY_ROLE(), factory.target);
  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);

  const goldToken = await ethers.deployContract("MockERC3643", ["Tokenized Gold", "tGOLD", underlyingDecimals]);

  await factory.connect(admin).deployGoldAsset(GOLD_ASSET_ID, "Invest'Or Gold", "GLD", goldToken.target, 0n, 0n, 0n);

  const assetConfig = await vaultManager.assets(GOLD_ASSET_ID);
  const goldAdapter = await ethers.getContractAt("GoldAdapter", assetConfig.adapter);
  const gldToken = await ethers.getContractAt("GLDToken", assetConfig.wrappedToken);

  await goldToken.setVerified(goldAdapter.target, true);
  await goldToken.setVerified(alice.address, true);
  await goldToken.mint(alice.address, ethers.parseUnits("1000", underlyingDecimals));

  return { alice, vaultManager, goldToken, goldAdapter, gldToken };
}

for (const underlyingDecimals of [6, 8, 18]) {
  describe(`AssetAdapter decimal normalization — ${underlyingDecimals}-decimal underlying`, function () {
    it("mints wrapped tokens at 18 decimals and redeems back to the exact underlying amount", async function () {
      const { alice, vaultManager, goldToken, goldAdapter, gldToken } =
        await deployGoldFixtureWithDecimals(underlyingDecimals);

      const depositAmount = ethers.parseUnits("120", underlyingDecimals);
      const expectedMinted = ethers.parseUnits("120", 18);

      await goldToken.connect(alice).approve(goldAdapter.target, depositAmount);
      await vaultManager.connect(alice).deposit(GOLD_ASSET_ID, depositAmount);

      expect(await gldToken.balanceOf(alice.address)).to.equal(expectedMinted);
      expect(await goldToken.balanceOf(goldAdapter.target)).to.equal(depositAmount);

      await gldToken.connect(alice).approve(vaultManager.target, expectedMinted);
      await vaultManager.connect(alice).redeem(GOLD_ASSET_ID, expectedMinted);

      expect(await gldToken.balanceOf(alice.address)).to.equal(0n);
      expect(await goldToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", underlyingDecimals));
      expect(await goldToken.balanceOf(goldAdapter.target)).to.equal(0n);
    });
  });
}
