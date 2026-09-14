// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { AccessManager } from "./AccessManager.sol";
import { OracleManager } from "./OracleManager.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Source de prix pilotable à la main, pour poser exactement la valeur et la fraîcheur
///         que chaque test veut faire agréger.
contract MockPriceSource is IPriceSource {
    /// @notice Prix que cette source renverra.
    uint256 public price;
    /// @notice Horodatage que cette source renverra.
    uint256 public updatedAt;

    /// @notice Fixe le prix et sa fraîcheur.
    /// @param price_ Prix à renvoyer, en 18 décimales.
    /// @param updatedAt_ Horodatage à renvoyer.
    function setPrice(uint256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
    }

    /// @inheritdoc IPriceSource
    function latestPrice(bytes32) external view returns (uint256, uint256) {
        return (price, updatedAt);
    }
}

/// @notice Revert systématiquement — un flux hors service ou volontairement brisé, à distinguer
///         d'un flux simplement périmé ou à prix nul. OracleManager.getPrice enveloppe chaque
///         appel de source dans un try/catch précisément pour qu'une seule source morte comme
///         celle-ci ne puisse jamais bloquer toute l'agrégation.
contract RevertingPriceSource is IPriceSource {
    /// @notice Seule issue possible d'un appel à cette source.
    error AlwaysReverts();

    /// @inheritdoc IPriceSource
    function latestPrice(bytes32) external pure returns (uint256, uint256) {
        revert AlwaysReverts();
    }
}

/// @notice Tests d'agrégation d'OracleManager : médiane, quorum de sources fraîches, exclusion
///         des sources périmées ou en échec, et garde-fou sur la dispersion des prix.
contract OracleManagerTest is Test {
    /// @dev Actif unique utilisé par tous les tests.
    bytes32 constant GOLD = keccak256("GOLD");
    /// @dev Ancienneté au-delà de laquelle une source est ignorée.
    uint256 constant MAX_STALENESS = 1 hours;
    /// @dev Dispersion maximale tolérée entre le plus bas et le plus haut prix retenu : 10 %.
    uint256 constant MAX_DEVIATION_BPS = 1000;
    /// @dev Quorum : nombre minimal de sources fraîches exigé pour agréger.
    uint256 constant MIN_SOURCES = 2;

    AccessManager accessManager;
    OracleManager oracle;

    /// @notice Déploie un oracle neuf par test et s'octroie ASSET_MANAGER_ROLE pour pouvoir y
    ///         enregistrer des sources.
    function setUp() public {
        accessManager = new AccessManager(address(this));
        oracle = new OracleManager(address(accessManager), MAX_STALENESS, MAX_DEVIATION_BPS, MIN_SOURCES);
        accessManager.grantRole(accessManager.ASSET_MANAGER_ROLE(), address(this));
    }

    /// @notice Déploie une source au prix donné, fraîche à l'instant, et l'enregistre sur GOLD.
    /// @param price_ Prix que la source publiera.
    /// @return source Source déployée et enregistrée.
    function _addSource(uint256 price_) internal returns (MockPriceSource source) {
        source = new MockPriceSource();
        source.setPrice(price_, block.timestamp);
        oracle.addPriceSource(GOLD, address(source));
    }

    /// @notice Nombre impair de sources : la médiane est la valeur centrale.
    function test_MedianOfThreeOddSources() public {
        _addSource(100e18);
        _addSource(101e18);
        _addSource(99e18);

        (uint256 price, uint256 worstUpdatedAt) = oracle.getPrice(GOLD);
        assertEq(price, 100e18);
        assertEq(worstUpdatedAt, block.timestamp);
    }

    /// @notice Nombre pair de sources : la médiane est la moyenne des deux valeurs centrales.
    function test_MedianOfFourEvenSources() public {
        _addSource(100e18);
        _addSource(102e18);
        _addSource(98e18);
        _addSource(104e18);
        // triées : 98, 100, 102, 104 -> médiane = (100 + 102) / 2 = 101
        (uint256 price, ) = oracle.getPrice(GOLD);
        assertEq(price, 101e18);
    }

    /// @notice Sous le quorum, l'oracle refuse de publier un prix plutôt que d'en produire un
    ///         reposant sur une source unique.
    function test_RevertsWhenBelowMinSources() public {
        _addSource(100e18);
        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }

    /// @notice Une source périmée est exclue, ce qui peut faire tomber sous le quorum.
    function test_ExcludesStaleSource() public {
        _addSource(100e18); // deviendra périmée dès qu'on dépassera MAX_STALENESS
        vm.warp(block.timestamp + MAX_STALENESS + 1);
        _addSource(200e18); // ajoutée après le saut dans le temps, donc encore fraîche

        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }

    /// @notice Des sources trop dispersées font échouer l'agrégation : mieux vaut pas de prix
    ///         du tout qu'une médiane entre deux valeurs inconciliables.
    function test_RevertsOnExcessiveDeviation() public {
        _addSource(100e18);
        _addSource(200e18); // 100 % d'écart, très au-delà des 10 % tolérés
        vm.expectRevert(abi.encodeWithSelector(OracleManager.PriceDeviationTooHigh.selector, GOLD, 100e18, 200e18));
        oracle.getPrice(GOLD);
    }

    /// @notice Une source qui revert à chaque appel (flux hors service, brisé, délibérément
    ///         malveillant) ne doit pas pouvoir refuser le service à toute l'agrégation : elle
    ///         est exclue exactement comme une source périmée ou à prix nul, et la médiane est
    ///         tout de même produite à partir des sources fraîches restantes.
    function test_ExcludesRevertingSourceWithoutBlockingAggregation() public {
        _addSource(100e18);
        _addSource(102e18);
        RevertingPriceSource brokenSource = new RevertingPriceSource();
        oracle.addPriceSource(GOLD, address(brokenSource));

        (uint256 price, ) = oracle.getPrice(GOLD);
        assertEq(price, 101e18);
    }

    /// @notice Si assez de sources sont en échec pour que les sources fraîches tombent sous le
    ///         quorum, l'appel revert bien avec InsufficientFreshSources plutôt que de dégrader
    ///         silencieusement vers un prix à une seule source, ou à aucune.
    function test_RevertsWhenRevertingSourcesBreakQuorum() public {
        _addSource(100e18);
        RevertingPriceSource brokenSource = new RevertingPriceSource();
        oracle.addPriceSource(GOLD, address(brokenSource));

        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }

    /// @notice AUDIT.md finding 4: a source claiming an updatedAt in the future must be excluded
    ///         like any other malformed reading, not crash the whole aggregation. Before the fix,
    ///         `block.timestamp - updatedAt` underflowed inside the try's `returns` block — which
    ///         runs in getPrice's own context, so the underflow reverted getPrice entirely instead
    ///         of being caught by `catch`. Reproduced here directly with a source vm.warp put in
    ///         the future relative to the block getPrice is called in, rather than mocking the
    ///         source dishonestly — the fix must hold against a source that is merely stale in the
    ///         other direction from what maxStaleness checks, not just against the exact bug.
    function test_ExcludesSourceClaimingFutureTimestampWithoutReverting() public {
        MockPriceSource future = new MockPriceSource();
        future.setPrice(100e18, block.timestamp + 1 days);
        oracle.addPriceSource(GOLD, address(future));
        _addSource(200e18);

        // Below MIN_SOURCES once the future-dated source is correctly excluded — proves it was
        // excluded, not merely that the call happened not to revert.
        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }
}
