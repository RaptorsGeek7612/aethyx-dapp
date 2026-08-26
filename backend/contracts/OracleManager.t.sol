// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { AccessManager } from "./AccessManager.sol";
import { OracleManager } from "./OracleManager.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

contract MockPriceSource is IPriceSource {
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

/// @notice Always reverts — a broken or maliciously bricked feed, distinct from a merely stale
///         or zero-priced one. OracleManager.getPrice wraps every source call in try/catch
///         specifically so a single dead source like this can never DoS the whole aggregation.
contract RevertingPriceSource is IPriceSource {
    error AlwaysReverts();

    function latestPrice(bytes32) external pure returns (uint256, uint256) {
        revert AlwaysReverts();
    }
}

contract OracleManagerTest is Test {
    bytes32 constant GOLD = keccak256("GOLD");
    uint256 constant MAX_STALENESS = 1 hours;
    uint256 constant MAX_DEVIATION_BPS = 1000; // 10%
    uint256 constant MIN_SOURCES = 2;

    AccessManager accessManager;
    OracleManager oracle;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        oracle = new OracleManager(address(accessManager), MAX_STALENESS, MAX_DEVIATION_BPS, MIN_SOURCES);
        accessManager.grantRole(accessManager.ASSET_MANAGER_ROLE(), address(this));
    }

    function _addSource(uint256 price_) internal returns (MockPriceSource source) {
        source = new MockPriceSource();
        source.setPrice(price_, block.timestamp);
        oracle.addPriceSource(GOLD, address(source));
    }

    function test_MedianOfThreeOddSources() public {
        _addSource(100e18);
        _addSource(101e18);
        _addSource(99e18);

        (uint256 price, uint256 worstUpdatedAt) = oracle.getPrice(GOLD);
        assertEq(price, 100e18);
        assertEq(worstUpdatedAt, block.timestamp);
    }

    function test_MedianOfFourEvenSources() public {
        _addSource(100e18);
        _addSource(102e18);
        _addSource(98e18);
        _addSource(104e18);
        // sorted: 98, 100, 102, 104 -> median = (100 + 102) / 2 = 101
        (uint256 price, ) = oracle.getPrice(GOLD);
        assertEq(price, 101e18);
    }

    function test_RevertsWhenBelowMinSources() public {
        _addSource(100e18);
        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }

    function test_ExcludesStaleSource() public {
        _addSource(100e18); // will go stale once we warp past MAX_STALENESS
        vm.warp(block.timestamp + MAX_STALENESS + 1);
        _addSource(200e18); // added after the warp, still fresh

        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }

    function test_RevertsOnExcessiveDeviation() public {
        _addSource(100e18);
        _addSource(200e18); // 100% apart, well beyond the 10% max deviation
        vm.expectRevert(abi.encodeWithSelector(OracleManager.PriceDeviationTooHigh.selector, GOLD, 100e18, 200e18));
        oracle.getPrice(GOLD);
    }

    /// @notice A source that reverts on every call (feed down, bricked, deliberately malicious)
    ///         must not be able to deny service to the whole aggregation: it's excluded exactly
    ///         like a stale or zero-priced source, and the median is still produced from
    ///         whatever fresh sources remain.
    function test_ExcludesRevertingSourceWithoutBlockingAggregation() public {
        _addSource(100e18);
        _addSource(102e18);
        RevertingPriceSource brokenSource = new RevertingPriceSource();
        oracle.addPriceSource(GOLD, address(brokenSource));

        (uint256 price, ) = oracle.getPrice(GOLD);
        assertEq(price, 101e18);
    }

    /// @notice If enough sources are reverting that fresh sources fall below the quorum, the
    ///         call still reverts with InsufficientFreshSources rather than silently degrading
    ///         to a single-source (or zero-source) price.
    function test_RevertsWhenRevertingSourcesBreakQuorum() public {
        _addSource(100e18);
        RevertingPriceSource brokenSource = new RevertingPriceSource();
        oracle.addPriceSource(GOLD, address(brokenSource));

        vm.expectRevert(abi.encodeWithSelector(OracleManager.InsufficientFreshSources.selector, GOLD, 1, MIN_SOURCES));
        oracle.getPrice(GOLD);
    }
}
