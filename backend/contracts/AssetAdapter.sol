// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC3643 } from "./interfaces/IERC3643.sol";

/// @notice Abstract base for adapters that custody one specific ERC-3643 asset on behalf of
///         VaultManager. Concrete adapters (GoldAdapter, a future SilverAdapter,
///         RealEstateAdapter...) supply the underlying token and an asset identifier; this
///         contract handles the shared mechanics every adapter needs: pulling/pushing the
///         ERC-3643 token, pre-flight compliance checks, and normalizing its decimals to the
///         protocol's canonical 18.
abstract contract AssetAdapter {
    IERC3643 public immutable underlying;
    address public immutable vaultManager;
    bytes32 public immutable assetId;
    uint8 public immutable underlyingDecimals;

    error NotVaultManager(address caller);
    error AdapterNotVerified(address adapter);
    error ComplianceCheckFailed(address from, address to, uint256 amount);
    error TransferFailed();

    modifier onlyVaultManager() {
        if (msg.sender != vaultManager) revert NotVaultManager(msg.sender);
        _;
    }

    constructor(address underlying_, address vaultManager_, bytes32 assetId_) {
        underlying = IERC3643(underlying_);
        vaultManager = vaultManager_;
        assetId = assetId_;
        underlyingDecimals = IERC3643(underlying_).decimals();
    }

    /// @notice Pulls `amount` (underlying decimals) of the ERC-3643 token from `from` into
    ///         this adapter's custody.
    /// @return normalizedAmount `amount` converted to the protocol's canonical 18 decimals,
    ///         for VaultManager to mint the matching amount of wrapped token.
    function deposit(address from, uint256 amount) public virtual onlyVaultManager returns (uint256 normalizedAmount) {
        if (!underlying.isVerified(address(this))) revert AdapterNotVerified(address(this));
        if (!underlying.canTransfer(from, address(this), amount)) {
            revert ComplianceCheckFailed(from, address(this), amount);
        }
        if (!underlying.transferFrom(from, address(this), amount)) revert TransferFailed();
        return _toCanonical(amount);
    }

    /// @notice Sends the underlying ERC-3643 token equivalent to `normalizedAmount` (18
    ///         decimals) from this adapter's custody to `to`.
    /// @return amount The actual amount transferred, in the underlying token's own decimals.
    function withdraw(address to, uint256 normalizedAmount) public virtual onlyVaultManager returns (uint256 amount) {
        amount = _fromCanonical(normalizedAmount);
        if (!underlying.canTransfer(address(this), to, amount)) {
            revert ComplianceCheckFailed(address(this), to, amount);
        }
        if (!underlying.transfer(to, amount)) revert TransferFailed();
    }

    function _toCanonical(uint256 amount) internal view returns (uint256) {
        if (underlyingDecimals == 18) return amount;
        if (underlyingDecimals < 18) return amount * (10 ** uint256(18 - underlyingDecimals));
        return amount / (10 ** uint256(underlyingDecimals - 18));
    }

    function _fromCanonical(uint256 amount) internal view returns (uint256) {
        if (underlyingDecimals == 18) return amount;
        if (underlyingDecimals < 18) return amount / (10 ** uint256(18 - underlyingDecimals));
        return amount * (10 ** uint256(underlyingDecimals - 18));
    }
}
