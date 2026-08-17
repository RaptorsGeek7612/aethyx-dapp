import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const GOLD_ASSET_ID = ethers.id("GOLD");

async function deployOracleFixture() {
  const [admin] = await ethers.getSigners();

  const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
  const oracleManager = await ethers.deployContract("OracleManager", [
    accessManager.target,
    3600n, // maxStaleness
    500n, // maxDeviationBps (5%)
    2n, // minSources
  ]);
  const sourceA = await ethers.deployContract("ManualPriceSource", [accessManager.target]);
  const sourceB = await ethers.deployContract("ManualPriceSource", [accessManager.target]);

  await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);
  await accessManager.grantRole(await accessManager.ORACLE_UPDATER_ROLE(), admin.address);

  await oracleManager.addPriceSource(GOLD_ASSET_ID, sourceA.target);
  await oracleManager.addPriceSource(GOLD_ASSET_ID, sourceB.target);

  return { admin, accessManager, oracleManager, sourceA, sourceB };
}

describe("Price oracle — ManualPriceSource + OracleManager", function () {
  it("aggregates the median of two manually-pushed sources and emits PriceUpdated", async function () {
    const { admin, oracleManager, sourceA, sourceB } = await networkHelpers.loadFixture(deployOracleFixture);

    const priceA = ethers.parseUnits("92", 18);
    const priceB = ethers.parseUnits("94", 18);

    await expect(sourceA.connect(admin).setPrice(GOLD_ASSET_ID, priceA)).to.emit(sourceA, "PriceUpdated");
    await sourceB.connect(admin).setPrice(GOLD_ASSET_ID, priceB);

    const [storedPriceA] = await sourceA.latestPrice(GOLD_ASSET_ID);
    expect(storedPriceA).to.equal(priceA);

    const [price] = await oracleManager.getPrice(GOLD_ASSET_ID);
    expect(price).to.equal((priceA + priceB) / 2n);
  });

  it("rejects a price push from anyone without ORACLE_UPDATER_ROLE", async function () {
    const { sourceA } = await networkHelpers.loadFixture(deployOracleFixture);
    const [, stranger] = await ethers.getSigners();

    await expect(
      sourceA.connect(stranger).setPrice(GOLD_ASSET_ID, ethers.parseUnits("1", 18)),
    ).to.be.revertedWithCustomError(sourceA, "Unauthorized");
  });
});
