import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

/**
 * Tests de fiabilité de l'oracle extérieur — compétence C5.
 *
 * Chaque test pousse volontairement une donnée hostile ou dégradée et vérifie que la
 * source la rejette. Le protocole ne fait confiance à aucun feed, Chainlink compris.
 */
describe("ChainlinkPriceSource — fiabilité de l'oracle extérieur", () => {
  const DECIMALS = 8n;
  const GOLD_PRICE_8 = 2_400_00000000n; // 2400 USD en 8 décimales
  const GOLD_PRICE_18 = 2_400n * 10n ** 18n;
  const GOLD_ASSET_ID = ethers.id("GOLD");

  async function deployFixture() {
    const [deployer] = await ethers.getSigners();

    const aggregator = await ethers.deployContract("MockAggregatorV3", [DECIMALS, GOLD_PRICE_8]);

    const source = await ethers.deployContract("ChainlinkPriceSource", [
      await aggregator.getAddress(),
      "Chainlink XAU/USD (Sepolia)",
    ]);

    return { aggregator, source, deployer };
  }

  describe("Cas nominal", () => {
    it("normalise le prix du feed vers 18 décimales", async () => {
      const { source } = await networkHelpers.loadFixture(deployFixture);

      const [price] = await source.latestPrice(GOLD_ASSET_ID);

      expect(price).to.equal(GOLD_PRICE_18);
    });

    it("remonte l'horodatage de publication pour le filtre de péremption", async () => {
      const { source } = await networkHelpers.loadFixture(deployFixture);

      const [, updatedAt] = await source.latestPrice(GOLD_ASSET_ID);

      expect(updatedAt).to.be.greaterThan(0n);
    });
  });

  describe("Rejet des données corrompues", () => {
    it("rejette un prix négatif", async () => {
      const { aggregator, source } = await networkHelpers.loadFixture(deployFixture);
      await aggregator.push(-1n);

      await expect(source.latestPrice(GOLD_ASSET_ID)).to.be.revertedWithCustomError(source, "NonPositiveAnswer");
    });

    it("rejette un prix nul", async () => {
      const { aggregator, source } = await networkHelpers.loadFixture(deployFixture);
      await aggregator.push(0n);

      await expect(source.latestPrice(GOLD_ASSET_ID)).to.be.revertedWithCustomError(source, "NonPositiveAnswer");
    });

    it("rejette un round jamais finalisé", async () => {
      const { aggregator, source } = await networkHelpers.loadFixture(deployFixture);
      await aggregator.pushIncomplete(GOLD_PRICE_8);

      await expect(source.latestPrice(GOLD_ASSET_ID)).to.be.revertedWithCustomError(source, "UnsetTimestamp");
    });

    it("rejette une réponse reportée d'un round antérieur", async () => {
      const { aggregator, source } = await networkHelpers.loadFixture(deployFixture);
      await aggregator.pushCarriedOver(GOLD_PRICE_8);

      await expect(source.latestPrice(GOLD_ASSET_ID)).to.be.revertedWithCustomError(source, "IncompleteRound");
    });

    it("propage l'échec quand le feed est hors service", async () => {
      const { aggregator, source } = await networkHelpers.loadFixture(deployFixture);
      await aggregator.setShouldRevert(true);

      await expect(source.latestPrice(GOLD_ASSET_ID)).to.be.revert(ethers);
    });
  });

  describe("Garde-fous au déploiement", () => {
    it("refuse une adresse d'agrégateur nulle", async () => {
      const factory = await ethers.getContractFactory("ChainlinkPriceSource");

      await expect(factory.deploy(ethers.ZeroAddress, "invalide")).to.be.revertedWithCustomError(
        factory,
        "ZeroAggregator",
      );
    });

    it("refuse un feed dont les décimales dépassent la base cible", async () => {
      const aggregator = await ethers.deployContract("MockAggregatorV3", [20n, 1n]);
      const factory = await ethers.getContractFactory("ChainlinkPriceSource");

      await expect(factory.deploy(await aggregator.getAddress(), "trop de décimales")).to.be.revertedWithCustomError(
        factory,
        "UnsupportedDecimals",
      );
    });
  });

  /**
   * Ces tests-là sont ceux qui emportent la compétence C5 : ils prouvent que la
   * défaillance d'un oracle extérieur n'emporte pas le protocole.
   */
  describe("Intégration avec OracleManager", () => {
    async function deployOracleFixture() {
      const [admin] = await ethers.getSigners();

      const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
      await accessManager.grantRole(await accessManager.ASSET_MANAGER_ROLE(), admin.address);
      await accessManager.grantRole(await accessManager.ORACLE_UPDATER_ROLE(), admin.address);

      const oracleManager = await ethers.deployContract("OracleManager", [
        accessManager.target,
        3600n, // maxStaleness
        500n, // maxDeviationBps (5%)
        2n, // minSources
      ]);

      const aggregator = await ethers.deployContract("MockAggregatorV3", [DECIMALS, GOLD_PRICE_8]);
      const chainlinkSource = await ethers.deployContract("ChainlinkPriceSource", [
        await aggregator.getAddress(),
        "Chainlink XAU/USD (Sepolia)",
      ]);
      const manualSourceA = await ethers.deployContract("ManualPriceSource", [accessManager.target]);
      const manualSourceB = await ethers.deployContract("ManualPriceSource", [accessManager.target]);

      await manualSourceA.setPrice(GOLD_ASSET_ID, ethers.parseUnits("2401", 18));
      await manualSourceB.setPrice(GOLD_ASSET_ID, ethers.parseUnits("2399", 18));

      await oracleManager.addPriceSource(GOLD_ASSET_ID, chainlinkSource.target);
      await oracleManager.addPriceSource(GOLD_ASSET_ID, manualSourceA.target);
      await oracleManager.addPriceSource(GOLD_ASSET_ID, manualSourceB.target);

      return { admin, accessManager, oracleManager, aggregator, chainlinkSource, manualSourceA, manualSourceB };
    }

    it("exclut la source défaillante de la médiane sans bloquer le protocole", async () => {
      const { oracleManager, aggregator } = await networkHelpers.loadFixture(deployOracleFixture);

      await aggregator.setShouldRevert(true);

      const [price] = await oracleManager.getPrice(GOLD_ASSET_ID);

      // Médiane des deux ManualPriceSource restantes uniquement — la Chainlink en panne
      // n'a ni participé au calcul ni fait revert tout l'appel.
      expect(price).to.equal((ethers.parseUnits("2401", 18) + ethers.parseUnits("2399", 18)) / 2n);
    });

    it("revert si le quorum de sources valides n'est plus atteint", async () => {
      const { oracleManager, aggregator, manualSourceB } = await networkHelpers.loadFixture(deployOracleFixture);

      await aggregator.setShouldRevert(true);
      await manualSourceB.setPrice(GOLD_ASSET_ID, 0n); // retire la 2e source manuelle aussi

      await expect(oracleManager.getPrice(GOLD_ASSET_ID)).to.be.revertedWithCustomError(
        oracleManager,
        "InsufficientFreshSources",
      );
    });
  });
});
