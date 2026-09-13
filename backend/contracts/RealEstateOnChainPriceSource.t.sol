// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { RealEstateOnChainPriceSource } from "./RealEstateOnChainPriceSource.sol";

/// @notice ERC-20 minimal, mint libre, juste pour piloter `totalSupply()` depuis un test.
contract MintableERC20 is ERC20 {
    constructor() ERC20("Mintable", "MNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RealEstateOnChainPriceSourceTest is Test {
    MintableERC20 internal wrapped;
    RealEstateOnChainPriceSource internal source;

    uint256 internal constant APPRAISAL = 235_000e18;

    function setUp() public {
        wrapped = new MintableERC20();
        source = new RealEstateOnChainPriceSource(address(wrapped), APPRAISAL);
    }

    function test_RevertsOnZeroSupply() public {
        vm.expectRevert(RealEstateOnChainPriceSource.ZeroSupply.selector);
        source.latestPrice(bytes32(0));
    }

    function test_PricePerTokenIsAppraisalDividedBySupply() public {
        wrapped.mint(address(this), 1000e18);

        (uint256 price, ) = source.latestPrice(bytes32(0));
        assertEq(price, APPRAISAL / 1000);
    }

    function test_PriceTracksSupplyChangesLiveWithoutAnyPush() public {
        wrapped.mint(address(this), 1000e18);
        (uint256 priceBefore, ) = source.latestPrice(bytes32(0));

        // Doubling the supply halves the per-token price — no operator, no push, just a read.
        wrapped.mint(address(this), 1000e18);
        (uint256 priceAfter, ) = source.latestPrice(bytes32(0));

        assertEq(priceAfter, priceBefore / 2);
    }

    function test_UpdatedAtIsAlwaysTheCurrentBlockTimestamp() public {
        wrapped.mint(address(this), 1000e18);

        vm.warp(1_000_000);
        (, uint256 updatedAt1) = source.latestPrice(bytes32(0));
        assertEq(updatedAt1, 1_000_000);

        // The whole point: staleness is structurally impossible, since nothing is ever stored.
        vm.warp(1_000_000 + 400 days);
        (, uint256 updatedAt2) = source.latestPrice(bytes32(0));
        assertEq(updatedAt2, 1_000_000 + 400 days);
    }

    function test_AssetIdArgumentIsIgnored() public {
        wrapped.mint(address(this), 1000e18);

        (uint256 priceA, ) = source.latestPrice(bytes32(uint256(1)));
        (uint256 priceB, ) = source.latestPrice(bytes32(uint256(2)));
        assertEq(priceA, priceB);
    }
}
