// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { ChainlinkGoldEurPerGramPriceSource } from "./ChainlinkGoldEurPerGramPriceSource.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Pilotable-by-hand IPriceSource, reused for both legs (the USD/ounce feed and the
///         EUR/USD rate) — the same shape as OracleManager.t.sol's MockPriceSource, kept local
///         here since this test exercises composing two sources together, not aggregation.
contract StubPriceSource is IPriceSource {
    uint256 public price;
    uint256 public updatedAt;

    function setPrice(uint256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
    }

    function latestPrice(bytes32) external view returns (uint256, uint256) {
        return (price, updatedAt);
    }
}

contract RevertingStubPriceSource is IPriceSource {
    error AlwaysReverts();

    function latestPrice(bytes32) external pure returns (uint256, uint256) {
        revert AlwaysReverts();
    }
}

contract ChainlinkGoldEurPerGramPriceSourceTest is Test {
    bytes32 constant EUR_USD_RATE_ID = keccak256("EUR_USD_RATE");

    StubPriceSource usdPerOunce;
    StubPriceSource eurUsdRate;
    ChainlinkGoldEurPerGramPriceSource source;

    function setUp() public {
        usdPerOunce = new StubPriceSource();
        eurUsdRate = new StubPriceSource();
        source = new ChainlinkGoldEurPerGramPriceSource(address(usdPerOunce), address(eurUsdRate), EUR_USD_RATE_ID);
    }

    /// @notice $2,000/oz at a 1.10 USD/EUR rate: 2000/1.10 = 1818.1818...EUR/oz, divided by
    ///         31.1034768 g/oz ≈ 58.45590285...EUR/g. Expected value computed independently in
    ///         plain integer arithmetic mirroring the contract's own fixed-point division, not
    ///         hand-rounded — checked to within 1 wei of 18-decimal precision.
    function test_ConvertsUsdPerOunceToEurPerGram() public {
        usdPerOunce.setPrice(2000e18, block.timestamp);
        eurUsdRate.setPrice(1.10e18, block.timestamp);

        (uint256 price, ) = source.latestPrice(bytes32(0));
        assertApproxEqAbs(price, 58455902852050873676, 1);
    }

    /// @notice Reproduces the reasoning check by hand: at parity (1 EUR = 1 USD), EUR/gram must
    ///         equal USD/gram exactly, with no rate-conversion rounding in the way.
    function test_AtParityEurEqualsUsd() public {
        usdPerOunce.setPrice(3110.34768e18, block.timestamp); // exactly 100 EUR/gram at parity
        eurUsdRate.setPrice(1e18, block.timestamp);

        (uint256 price, ) = source.latestPrice(bytes32(0));
        assertApproxEqAbs(price, 100e18, 1e6);
    }

    /// @notice The combined price is only as fresh as its stalest leg — reads the older of the
    ///         two timestamps, not the newer one, so OracleManager's staleness filter can't be
    ///         fooled by refreshing only one side.
    function test_UpdatedAtIsTheOlderOfTheTwoLegs() public {
        usdPerOunce.setPrice(2000e18, 1000);
        eurUsdRate.setPrice(1.1e18, 500);

        (, uint256 updatedAt) = source.latestPrice(bytes32(0));
        assertEq(updatedAt, 500);
    }

    /// @notice A rate that was never pushed (ManualPriceSource's zero default) must not silently
    ///         produce an infinite or nonsensical gold price.
    function test_RevertsWhenEurUsdRateIsZero() public {
        usdPerOunce.setPrice(2000e18, block.timestamp);
        // eurUsdRate left at its zero default.
        vm.expectRevert(ChainlinkGoldEurPerGramPriceSource.ZeroEurUsdRate.selector);
        source.latestPrice(bytes32(0));
    }

    /// @notice A malformed Chainlink round (via ChainlinkPriceSource, which reverts rather than
    ///         return bad data) must propagate as a revert here too, not be swallowed — so
    ///         OracleManager's own try/catch around this whole source still excludes it exactly
    ///         like any other failing source.
    function test_RevertsWhenOunceSourceReverts() public {
        RevertingStubPriceSource brokenOunceSource = new RevertingStubPriceSource();
        ChainlinkGoldEurPerGramPriceSource brokenSource = new ChainlinkGoldEurPerGramPriceSource(
            address(brokenOunceSource),
            address(eurUsdRate),
            EUR_USD_RATE_ID
        );
        eurUsdRate.setPrice(1.1e18, block.timestamp);

        vm.expectRevert(RevertingStubPriceSource.AlwaysReverts.selector);
        brokenSource.latestPrice(bytes32(0));
    }
}
