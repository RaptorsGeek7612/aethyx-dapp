import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

async function deployTreasuryFixture() {
  const [admin, manager, outsider, recipient] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
  await accessManager.grantRole(await accessManager.TREASURY_MANAGER_ROLE(), manager.address);

  const feeToken = await ethers.deployContract("GLDToken", ["Invest'Or Gold", "GLD", accessManager.target]);
  await accessManager.grantRole(await accessManager.MINTER_ROLE(), admin.address);
  await feeToken.connect(admin).mint(treasury.target, ethers.parseUnits("50", 18));

  return { admin, manager, outsider, recipient, accessManager, treasury, feeToken };
}

describe("Treasury", function () {
  it("lets an address holding TREASURY_MANAGER_ROLE withdraw accumulated ERC-20 fees", async function () {
    const { manager, recipient, treasury, feeToken } = await networkHelpers.loadFixture(deployTreasuryFixture);

    const amount = ethers.parseUnits("50", 18);
    await expect(treasury.connect(manager).withdraw(feeToken.target, recipient.address, amount))
      .to.emit(treasury, "Withdrawn")
      .withArgs(feeToken.target, recipient.address, amount);

    expect(await feeToken.balanceOf(recipient.address)).to.equal(amount);
    expect(await feeToken.balanceOf(treasury.target)).to.equal(0n);
  });

  it("rejects an ERC-20 withdrawal from anyone without TREASURY_MANAGER_ROLE", async function () {
    const { outsider, recipient, accessManager, treasury, feeToken } =
      await networkHelpers.loadFixture(deployTreasuryFixture);

    const role = await accessManager.TREASURY_MANAGER_ROLE();
    await expect(treasury.connect(outsider).withdraw(feeToken.target, recipient.address, 1n))
      .to.be.revertedWithCustomError(treasury, "Unauthorized")
      .withArgs(outsider.address, role);
  });

  it("lets an address holding TREASURY_MANAGER_ROLE withdraw accumulated ETH", async function () {
    const { admin, manager, recipient, treasury } = await networkHelpers.loadFixture(deployTreasuryFixture);

    const amount = ethers.parseEther("2");
    await admin.sendTransaction({ to: treasury.target, value: amount });

    const balanceBefore = await ethers.provider.getBalance(recipient.address);

    await expect(treasury.connect(manager).withdrawEth(recipient.address, amount))
      .to.emit(treasury, "EthWithdrawn")
      .withArgs(recipient.address, amount);

    expect(await ethers.provider.getBalance(treasury.target)).to.equal(0n);
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(balanceBefore + amount);
  });

  it("rejects an ETH withdrawal from anyone without TREASURY_MANAGER_ROLE", async function () {
    const { admin, outsider, recipient, accessManager, treasury } =
      await networkHelpers.loadFixture(deployTreasuryFixture);

    await admin.sendTransaction({ to: treasury.target, value: ethers.parseEther("1") });

    const role = await accessManager.TREASURY_MANAGER_ROLE();
    await expect(treasury.connect(outsider).withdrawEth(recipient.address, ethers.parseEther("1")))
      .to.be.revertedWithCustomError(treasury, "Unauthorized")
      .withArgs(outsider.address, role);
  });
});
