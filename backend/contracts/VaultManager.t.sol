// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import { Test } from "forge-std/Test.sol";
import { IWrappedToken } from "./interfaces/IWrappedToken.sol";
import { AccessManager } from "./AccessManager.sol";
import { Treasury } from "./Treasury.sol";
import { VaultManager } from "./VaultManager.sol";
import { AssetAdapter } from "./AssetAdapter.sol";
import { GoldAdapter } from "./GoldAdapter.sol";
import { GLDToken } from "./GLDToken.sol";
import { MockERC3643 } from "./mocks/MockERC3643.sol";

/// @notice A wrapped token whose transferFrom always returns false instead of reverting — the
///         exact shape AUDIT.md finding 5 warns about. GLDToken (OZ ERC20) always reverts on
///         failure, so it can never exercise VaultManager's unchecked-return-value path; this
///         mock is what actually lets that path be tested.
contract FalseReturningWrappedToken is IWrappedToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burnFrom(address account, uint256 amount) external {
        balanceOf[account] -= amount;
        totalSupply -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @dev Never reverts, never actually moves anything — the "silently does nothing" failure
    ///      mode finding 5 describes for a token VaultManager doesn't control.
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @notice Tests for VaultManager/AssetAdapter fixes from AUDIT.md findings 2, 3, 5, and 6 — the
///         guardrails added on top of the deposit/redeem/registerAsset paths that findings 8-12's
///         CDP module tests don't exercise (those cover CDPManager, not the underlying wrap).
contract VaultManagerTest is Test {
    bytes32 constant GOLD_ID = keccak256("GOLD");
    address alice = address(0xA11CE);

    AccessManager accessManager;
    Treasury treasury;
    VaultManager vaultManager;
    MockERC3643 underlying;
    GoldAdapter adapter;
    GLDToken wrapped;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        treasury = new Treasury(address(accessManager));
        vaultManager = new VaultManager(address(accessManager), address(treasury));
        underlying = new MockERC3643("Tokenized Gold", "tGOLD", 18);
        adapter = new GoldAdapter(address(underlying), address(vaultManager), GOLD_ID, 0);
        wrapped = new GLDToken("AETHYX Gold", "GLD", address(accessManager));

        accessManager.grantRole(accessManager.MINTER_ROLE(), address(vaultManager));
        accessManager.grantRole(accessManager.FACTORY_ROLE(), address(this));
        accessManager.grantRole(accessManager.ASSET_MANAGER_ROLE(), address(this));

        underlying.setVerified(address(adapter), true);
        underlying.setVerified(alice, true);
    }

    // --- Finding 2: fees capped well below 100% ---------------------------------------------

    /// @notice Before this cap, ASSET_MANAGER_ROLE could set a 100% fee and take a depositor's
    ///         or redeemer's entire position in one transaction (AUDIT.md finding 2).
    function test_RegisterAssetRevertsAboveMaxFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(VaultManager.FeeTooHigh.selector, uint16(501)));
        vaultManager.registerAsset(GOLD_ID, address(adapter), address(wrapped), 501, 0);
    }

    function test_SetAssetFeesRevertsAboveMaxFeeBps() public {
        vaultManager.registerAsset(GOLD_ID, address(adapter), address(wrapped), 0, 0);
        vm.expectRevert(abi.encodeWithSelector(VaultManager.FeeTooHigh.selector, uint16(501)));
        vaultManager.setAssetFees(GOLD_ID, 0, 501);
    }

    /// @notice The cap itself is still usable, not accidentally set to zero.
    function test_RegisterAssetAcceptsFeeExactlyAtCap() public {
        vaultManager.registerAsset(GOLD_ID, address(adapter), address(wrapped), 500, 500);
        (, , uint16 depositFeeBps, uint16 redeemFeeBps, ) = vaultManager.assets(GOLD_ID);
        assertEq(depositFeeBps, 500);
        assertEq(redeemFeeBps, 500);
    }

    // --- Finding 6: adapter must agree with the id it's registered under --------------------

    /// @notice Without this check, the same adapter could end up registered under two different
    ///         ids, or an id could point at an adapter that reports a different one — either way
    ///         breaking the "one wrapped token per pool of locked collateral" invariant the whole
    ///         protocol depends on.
    function test_RegisterAssetRevertsOnAssetIdMismatch() public {
        bytes32 wrongId = keccak256("NOT_GOLD");
        vm.expectRevert(abi.encodeWithSelector(VaultManager.AssetIdMismatch.selector, wrongId, GOLD_ID));
        vaultManager.registerAsset(wrongId, address(adapter), address(wrapped), 0, 0);
    }

    function test_RegisterAssetSucceedsWhenAssetIdMatches() public {
        vaultManager.registerAsset(GOLD_ID, address(adapter), address(wrapped), 0, 0);
        (AssetAdapter registeredAdapter, , , , bool active) = vaultManager.assets(GOLD_ID);
        assertEq(address(registeredAdapter), address(adapter));
        assertTrue(active);
    }

    // --- Finding 5: a wrapped token that returns false must not go unnoticed ----------------

    /// @notice Reproduces finding 5 directly: a wrapped token that answers `false` instead of
    ///         reverting must make the redeem fail loudly (SafeERC20), not silently skip the fee
    ///         transfer while still burning the caller's tokens and releasing the collateral.
    function test_RedeemRevertsWhenWrappedTokenFeeTransferReturnsFalse() public {
        FalseReturningWrappedToken badToken = new FalseReturningWrappedToken();
        vaultManager.registerAsset(GOLD_ID, address(adapter), address(badToken), 0, 100); // 1% redeem fee

        underlying.mint(alice, 100e18);
        vm.startPrank(alice);
        underlying.approve(address(adapter), 100e18);
        vaultManager.deposit(GOLD_ID, 100e18);

        vm.expectRevert();
        vaultManager.redeem(GOLD_ID, 100e18);
        vm.stopPrank();
    }

    // --- Finding 3: a redeem that truncates to zero underlying must revert, not burn for nothing

    /// @notice A normalized amount smaller than a low-decimal underlying's conversion factor
    ///         used to burn the caller's wrapped tokens and release zero underlying, silently.
    function test_RedeemRevertsOnDustAmount() public {
        MockERC3643 sixDecUnderlying = new MockERC3643("Six-decimal asset", "SIX", 6);
        bytes32 sixId = keccak256("SIX_DECIMAL_ASSET");
        GoldAdapter sixAdapter = new GoldAdapter(address(sixDecUnderlying), address(vaultManager), sixId, 0);
        GLDToken sixWrapped = new GLDToken("Six Wrapped", "SIXW", address(accessManager));
        sixDecUnderlying.setVerified(address(sixAdapter), true);
        sixDecUnderlying.setVerified(alice, true);
        vaultManager.registerAsset(sixId, address(sixAdapter), address(sixWrapped), 0, 0);

        sixDecUnderlying.mint(alice, 1_000_000); // 1.0 unit at 6 decimals
        vm.startPrank(alice);
        sixDecUnderlying.approve(address(sixAdapter), 1_000_000);
        vaultManager.deposit(sixId, 1_000_000); // mints 1e18 wrapped (normalized)
        sixWrapped.approve(address(vaultManager), type(uint256).max);

        // 1 wei normalized: below the 1e12 conversion factor for a 6-decimal underlying, so
        // _fromCanonical truncates it to zero — must revert instead of burning for nothing.
        vm.expectRevert(abi.encodeWithSelector(AssetAdapter.DustWithdrawal.selector, uint256(1)));
        vaultManager.redeem(sixId, 1);
        vm.stopPrank();
    }

    /// @notice The fix is scoped to the truncating case only — a normalized amount that converts
    ///         to a non-zero amount still redeems exactly as before.
    function test_RedeemStillSucceedsAboveDustThreshold() public {
        MockERC3643 sixDecUnderlying = new MockERC3643("Six-decimal asset", "SIX", 6);
        bytes32 sixId = keccak256("SIX_DECIMAL_ASSET_2");
        GoldAdapter sixAdapter = new GoldAdapter(address(sixDecUnderlying), address(vaultManager), sixId, 0);
        GLDToken sixWrapped = new GLDToken("Six Wrapped", "SIXW2", address(accessManager));
        sixDecUnderlying.setVerified(address(sixAdapter), true);
        sixDecUnderlying.setVerified(alice, true);
        vaultManager.registerAsset(sixId, address(sixAdapter), address(sixWrapped), 0, 0);

        sixDecUnderlying.mint(alice, 1_000_000);
        vm.startPrank(alice);
        sixDecUnderlying.approve(address(sixAdapter), 1_000_000);
        vaultManager.deposit(sixId, 1_000_000);
        sixWrapped.approve(address(vaultManager), type(uint256).max);

        vaultManager.redeem(sixId, 1e18);
        assertEq(sixDecUnderlying.balanceOf(alice), 1_000_000);
        vm.stopPrank();
    }
}
