// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { AccessManager } from "./AccessManager.sol";
import { OracleManager } from "./OracleManager.sol";
import { StableToken } from "./StableToken.sol";
import { CDPManager } from "./CDPManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { Treasury } from "./Treasury.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Source de prix pilotable à la main, pour poser exactement le prix que chaque test
///         veut voir agrégé — copiée d'OracleManager.t.sol plutôt que partagée, pour que ce
///         fichier de test reste lisible seul.
contract MockPriceSource is IPriceSource {
    uint256 public price;
    uint256 public updatedAt;

    function setPrice(uint256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
    }

    /// @inheritdoc IPriceSource
    function latestPrice(bytes32) external view returns (uint256, uint256) {
        return (price, updatedAt);
    }
}

/// @notice Tests de CDPManager : ouverture de position, emprunt et remboursement au ratio,
///         retrait sous contrainte de ratio, plafond de dette, et liquidation totale d'une
///         position passée sous son seuil.
contract CDPManagerTest is Test {
    bytes32 constant GOLD = keccak256("GOLD");
    bytes32 constant SILVER = keccak256("SILVER");
    bytes32 constant FEE_TEST = keccak256("FEE_TEST");

    uint256 constant MAX_STALENESS = 1 hours;
    uint256 constant MAX_DEVIATION_BPS = 500;
    uint256 constant MIN_SOURCES = 1;

    uint16 constant MIN_COLLATERAL_RATIO_BPS = 20_000; // 200 %
    uint16 constant LIQUIDATION_THRESHOLD_BPS = 15_000; // 150 %
    uint256 constant DEBT_CEILING = 1_000_000e18;
    // Nul sur GOLD, pour que tous les tests écrits avant le frais de stabilité restent valables
    // sans changement : leurs calculs de ratio supposent une dette qui ne bouge pas seule.
    uint16 constant NO_STABILITY_FEE_BPS = 0;
    // 10 %/an sur FEE_TEST, le collatéral dédié aux tests d'accumulation.
    uint16 constant STABILITY_FEE_BPS = 1_000;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    AccessManager accessManager;
    OracleManager oracle;
    MockPriceSource priceSource;
    StableToken stableToken;
    GLDToken collateralToken;
    Treasury treasury;
    CDPManager cdp;

    /// @notice Déploie l'ensemble du protocole CDP et enregistre GOLD et FEE_TEST comme
    ///         collatéraux, tous deux à un prix de 1 (1 unité de collatéral vaut 1 unité de
    ///         stablecoin), pour que les calculs de ratio restent lisibles dans chaque test.
    ///         GOLD porte un frais de stabilité nul (tests de mécanique de base), FEE_TEST un
    ///         frais de 10 %/an (tests d'accumulation).
    function setUp() public {
        accessManager = new AccessManager(address(this));
        oracle = new OracleManager(address(accessManager), MAX_STALENESS, MAX_DEVIATION_BPS, MIN_SOURCES);
        stableToken = new StableToken("AETHYX Stable", "ioEUR", address(accessManager));
        collateralToken = new GLDToken("AETHYX Gold", "GLD", address(accessManager));
        treasury = new Treasury(address(accessManager));
        cdp = new CDPManager(address(accessManager), address(oracle), address(stableToken), address(treasury));

        accessManager.grantRole(accessManager.ASSET_MANAGER_ROLE(), address(this));
        accessManager.grantRole(accessManager.RISK_MANAGER_ROLE(), address(this));
        accessManager.grantRole(accessManager.PAUSER_ROLE(), address(this));
        accessManager.grantRole(accessManager.DEBT_MINTER_ROLE(), address(cdp));
        // Réservé exclusivement à VaultManager en production ; accordé ici au seul fin
        // d'alimenter les positions de test en collatéral sans repasser par tout le pipeline
        // ERC-3643 -> adaptateur -> VaultManager, hors périmètre de ce test.
        accessManager.grantRole(accessManager.MINTER_ROLE(), address(this));

        priceSource = new MockPriceSource();
        priceSource.setPrice(1e18, block.timestamp);
        oracle.addPriceSource(GOLD, address(priceSource));
        oracle.addPriceSource(FEE_TEST, address(priceSource));

        cdp.addCollateralType(
            GOLD,
            address(collateralToken),
            MIN_COLLATERAL_RATIO_BPS,
            LIQUIDATION_THRESHOLD_BPS,
            NO_STABILITY_FEE_BPS,
            DEBT_CEILING
        );
        cdp.addCollateralType(
            FEE_TEST,
            address(collateralToken),
            MIN_COLLATERAL_RATIO_BPS,
            LIQUIDATION_THRESHOLD_BPS,
            STABILITY_FEE_BPS,
            DEBT_CEILING
        );
    }

    /// @notice Mint `amount` de collatéral vers `user` et le fait approuver le CDPManager.
    function _fundCollateral(address user, uint256 amount) internal {
        collateralToken.mint(user, amount);
        vm.prank(user);
        collateralToken.approve(address(cdp), amount);
    }

    function test_DepositCollateral() public {
        _fundCollateral(alice, 200e18);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit CDPManager.CollateralDeposited(alice, GOLD, 200e18);
        cdp.depositCollateral(GOLD, 200e18);

        (uint256 collateralAmount, uint256 debtAmount, ) = cdp.positions(alice, GOLD);
        assertEq(collateralAmount, 200e18);
        assertEq(debtAmount, 0);
        assertEq(collateralToken.balanceOf(address(cdp)), 200e18);
    }

    function test_MintDebtAtExactlyMinRatioSucceeds() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        // 200e18 de collatéral à prix 1 valent 200e18 ; à 200 % de ratio minimal, la dette
        // empruntable au maximum est exactement 100e18.
        cdp.mintDebt(GOLD, 100e18);
        vm.stopPrank();

        (, uint256 debtAmount, ) = cdp.positions(alice, GOLD);
        assertEq(debtAmount, 100e18);
        assertEq(stableToken.balanceOf(alice), 100e18);
        assertEq(cdp.collateralRatioBps(alice, GOLD), MIN_COLLATERAL_RATIO_BPS);
        (, , , , , uint256 totalDebt, ) = cdp.collaterals(GOLD);
        assertEq(totalDebt, 100e18);
    }

    function test_MintDebtRevertsBelowMinRatio() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);

        uint256 tooMuchDebt = 100e18 + 1;
        uint256 wouldBeRatioBps = (200e18 * 10_000) / tooMuchDebt;
        vm.expectRevert(
            abi.encodeWithSelector(CDPManager.RatioTooLow.selector, GOLD, wouldBeRatioBps, MIN_COLLATERAL_RATIO_BPS)
        );
        cdp.mintDebt(GOLD, tooMuchDebt);
        vm.stopPrank();
    }

    function test_MintDebtRevertsAtDebtCeiling() public {
        cdp.setCollateralParams(GOLD, MIN_COLLATERAL_RATIO_BPS, LIQUIDATION_THRESHOLD_BPS, NO_STABILITY_FEE_BPS, 50e18);

        _fundCollateral(alice, 1_000e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 1_000e18);

        vm.expectRevert(abi.encodeWithSelector(CDPManager.DebtCeilingExceeded.selector, GOLD, 51e18, 50e18));
        cdp.mintDebt(GOLD, 51e18);
        vm.stopPrank();
    }

    function test_WithdrawCollateralRevertsBelowMinRatio() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        cdp.mintDebt(GOLD, 100e18);

        uint256 remainingAfterWithdraw = 200e18 - 1;
        uint256 wouldBeRatioBps = (remainingAfterWithdraw * 10_000) / 100e18;
        vm.expectRevert(
            abi.encodeWithSelector(CDPManager.RatioTooLow.selector, GOLD, wouldBeRatioBps, MIN_COLLATERAL_RATIO_BPS)
        );
        cdp.withdrawCollateral(GOLD, 1);
        vm.stopPrank();
    }

    function test_RepayThenWithdrawFullyClosesPosition() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        cdp.mintDebt(GOLD, 100e18);

        stableToken.approve(address(cdp), 100e18);
        cdp.repayDebt(GOLD, 100e18);
        cdp.withdrawCollateral(GOLD, 200e18);
        vm.stopPrank();

        (uint256 collateralAmount, uint256 debtAmount, ) = cdp.positions(alice, GOLD);
        assertEq(collateralAmount, 0);
        assertEq(debtAmount, 0);
        assertEq(collateralToken.balanceOf(alice), 200e18);
        assertEq(stableToken.totalSupply(), 0);
        (, , , , , uint256 totalDebt, ) = cdp.collaterals(GOLD);
        assertEq(totalDebt, 0);
    }

    function test_RepayRevertsAboveOutstandingDebt() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        cdp.mintDebt(GOLD, 100e18);

        stableToken.approve(address(cdp), 101e18);
        vm.expectRevert(abi.encodeWithSelector(CDPManager.InsufficientPosition.selector, 100e18, 101e18));
        cdp.repayDebt(GOLD, 101e18);
        vm.stopPrank();
    }

    function test_LiquidateHealthyPositionReverts() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        cdp.mintDebt(GOLD, 100e18);
        vm.stopPrank();

        uint256 ratioBps = cdp.collateralRatioBps(alice, GOLD);
        vm.expectRevert(
            abi.encodeWithSelector(CDPManager.PositionHealthy.selector, GOLD, ratioBps, LIQUIDATION_THRESHOLD_BPS)
        );
        cdp.liquidate(alice, GOLD);
    }

    function test_LiquidateRevertsWhenNoDebt() public {
        vm.expectRevert(abi.encodeWithSelector(CDPManager.NoDebt.selector, alice, GOLD));
        cdp.liquidate(alice, GOLD);
    }

    /// @notice Une chute de prix fait passer Alice sous le seuil de liquidation sans toucher à
    ///         la position de Bob, ouverte avec davantage de marge. Bob liquide Alice : il
    ///         rembourse toute sa dette et reçoit tout son collatéral, sans jamais avoir eu
    ///         besoin d'un stablecoin venu d'ailleurs que de sa propre position.
    function test_LiquidateUnderwaterPosition() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(GOLD, 200e18);
        cdp.mintDebt(GOLD, 100e18);
        vm.stopPrank();

        _fundCollateral(bob, 300e18);
        vm.startPrank(bob);
        cdp.depositCollateral(GOLD, 300e18);
        cdp.mintDebt(GOLD, 100e18);
        vm.stopPrank();

        // 200e18 de collatéral à 0,7 valent 140e18, contre 100e18 de dette : ratio 140 %, sous
        // le seuil de liquidation de 150 %. Bob, à 300e18 de collatéral pour la même dette,
        // reste à 210 %, toujours sain.
        priceSource.setPrice(0.7e18, block.timestamp);
        assertLt(cdp.collateralRatioBps(alice, GOLD), LIQUIDATION_THRESHOLD_BPS);
        assertGe(cdp.collateralRatioBps(bob, GOLD), LIQUIDATION_THRESHOLD_BPS);

        vm.startPrank(bob);
        stableToken.approve(address(cdp), 100e18);
        vm.expectEmit(true, true, true, true);
        emit CDPManager.PositionLiquidated(alice, GOLD, bob, 100e18, 200e18);
        cdp.liquidate(alice, GOLD);
        vm.stopPrank();

        (uint256 aliceCollateral, uint256 aliceDebt, ) = cdp.positions(alice, GOLD);
        assertEq(aliceCollateral, 0);
        assertEq(aliceDebt, 0);
        assertEq(collateralToken.balanceOf(bob), 200e18);
        assertEq(stableToken.balanceOf(bob), 0);
        (, , , , , uint256 totalDebt, ) = cdp.collaterals(GOLD);
        assertEq(totalDebt, 100e18); // reste la dette de Bob
    }

    function test_AddCollateralTypeRevertsOnDuplicateId() public {
        vm.expectRevert(abi.encodeWithSelector(CDPManager.CollateralAlreadyRegistered.selector, GOLD));
        cdp.addCollateralType(
            GOLD,
            address(collateralToken),
            MIN_COLLATERAL_RATIO_BPS,
            LIQUIDATION_THRESHOLD_BPS,
            NO_STABILITY_FEE_BPS,
            DEBT_CEILING
        );
    }

    function test_AddCollateralTypeRevertsWhenThresholdNotBelowMinRatio() public {
        vm.expectRevert(abi.encodeWithSelector(CDPManager.InvalidRiskParams.selector, 15_000, 15_000));
        cdp.addCollateralType(SILVER, address(collateralToken), 15_000, 15_000, NO_STABILITY_FEE_BPS, DEBT_CEILING);
    }

    function test_AddCollateralTypeRevertsWhenThresholdAtOrBelow100Percent() public {
        vm.expectRevert(abi.encodeWithSelector(CDPManager.InvalidRiskParams.selector, 15_000, 10_000));
        cdp.addCollateralType(SILVER, address(collateralToken), 15_000, 10_000, NO_STABILITY_FEE_BPS, DEBT_CEILING);
    }

    function test_AddCollateralTypeRevertsWhenStabilityFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(CDPManager.StabilityFeeTooHigh.selector, 10_001));
        cdp.addCollateralType(SILVER, address(collateralToken), 20_000, 15_000, 10_001, DEBT_CEILING);
    }

    /// @notice Sur un an exactement, un frais de 10 %/an sur 100e18 de dette accumule 10e18 : un
    ///         remboursement partiel règle ce frais au passage, le mint au Treasury et le
    ///         reflète dans la dette restante de la position.
    function test_StabilityFeeAccruesAndIsPaidToTreasuryOnRepay() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(FEE_TEST, 200e18);
        cdp.mintDebt(FEE_TEST, 100e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 365 days);
        assertEq(cdp.currentDebt(alice, FEE_TEST), 110e18);

        vm.startPrank(alice);
        stableToken.approve(address(cdp), 50e18);
        vm.expectEmit(true, true, false, true);
        emit CDPManager.StabilityFeeAccrued(alice, FEE_TEST, 10e18);
        vm.expectEmit(true, true, false, true);
        emit CDPManager.DebtRepaid(alice, FEE_TEST, 50e18);
        cdp.repayDebt(FEE_TEST, 50e18);
        vm.stopPrank();

        (, uint256 debtAmount, ) = cdp.positions(alice, FEE_TEST);
        assertEq(debtAmount, 60e18); // 100e18 + 10e18 de frais - 50e18 remboursés
        assertEq(stableToken.balanceOf(address(treasury)), 10e18);
        assertEq(stableToken.balanceOf(alice), 50e18); // 100e18 mintés - 50e18 dépensés au remboursement
        (, , , , , uint256 totalDebt, ) = cdp.collaterals(FEE_TEST);
        assertEq(totalDebt, 60e18);
    }

    /// @notice Une position ouverte bien au-dessus du seuil de liquidation peut y tomber sans
    ///         qu'aucun prix ne bouge, simplement parce que le frais de stabilité a fait grossir
    ///         sa dette au fil du temps.
    function test_AccruedStabilityFeeCanTriggerLiquidation() public {
        _fundCollateral(alice, 200e18);
        vm.startPrank(alice);
        cdp.depositCollateral(FEE_TEST, 200e18);
        cdp.mintDebt(FEE_TEST, 100e18); // ratio 200 %, largement au-dessus du seuil de 150 %
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(CDPManager.PositionHealthy.selector, FEE_TEST, 20_000, LIQUIDATION_THRESHOLD_BPS)
        );
        cdp.liquidate(alice, FEE_TEST);

        // 4 ans à 10 %/an (intérêt simple) : dette 100e18 -> 140e18, ratio 200e18*10000/140e18
        // = 14 285 bps, sous le seuil de 15 000.
        vm.warp(block.timestamp + 4 * 365 days);
        priceSource.setPrice(1e18, block.timestamp); // le flux doit rester frais après le saut

        _fundCollateral(bob, 1_000e18);
        vm.startPrank(bob);
        cdp.depositCollateral(FEE_TEST, 1_000e18);
        cdp.mintDebt(FEE_TEST, 300e18); // largement suffisant pour racheter la dette d'Alice
        stableToken.approve(address(cdp), 140e18);
        vm.expectEmit(true, true, true, true);
        emit CDPManager.PositionLiquidated(alice, FEE_TEST, bob, 140e18, 200e18);
        cdp.liquidate(alice, FEE_TEST);
        vm.stopPrank();

        (uint256 aliceCollateral, uint256 aliceDebt, ) = cdp.positions(alice, FEE_TEST);
        assertEq(aliceCollateral, 0);
        assertEq(aliceDebt, 0);
        assertEq(collateralToken.balanceOf(bob), 200e18);
        assertEq(stableToken.balanceOf(bob), 300e18 - 140e18);
        // Les 40e18 de frais réglés par la liquidation d'Alice sont allés au Treasury ; le
        // règlement de la position de Bob, lui, n'a encore jamais été déclenché.
        assertEq(stableToken.balanceOf(address(treasury)), 40e18);
    }

    function test_DepositRevertsWhenCollateralNotActive() public {
        cdp.setCollateralActive(GOLD, false);
        _fundCollateral(alice, 1e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CDPManager.CollateralNotActive.selector, GOLD));
        cdp.depositCollateral(GOLD, 1e18);
    }

    function test_OnlyCDPManagerCanMintStableToken() public {
        vm.expectRevert(
            abi.encodeWithSelector(AccessManaged.Unauthorized.selector, alice, accessManager.DEBT_MINTER_ROLE())
        );
        vm.prank(alice);
        stableToken.mint(alice, 1e18);
    }

    function test_PauseBlocksDeposit() public {
        cdp.pause();
        _fundCollateral(alice, 1e18);

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        cdp.depositCollateral(GOLD, 1e18);
    }
}
