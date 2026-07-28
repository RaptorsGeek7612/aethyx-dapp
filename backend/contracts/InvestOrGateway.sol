// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";

/// @notice Single, stable entry point the frontend talks to. Holds no business state of its
///         own — balances, fee config and the asset registry all live in VaultManager — and,
///         unlike a typical DeFi router, never custodies the ERC-3643 or wrapped token even
///         transiently: it forwards `msg.sender` straight through to VaultManager's
///         `depositFor`/`redeemFor`, which pull directly from and pay directly to that
///         address. Callers still approve the asset's adapter (for deposits) or VaultManager
///         itself (for redemptions) exactly as they would for a direct call — never this
///         contract. Because it never holds the ERC-3643 token, this contract does NOT need
///         to be whitelisted as a verified identity by the token issuer.
contract InvestOrGateway is AccessManaged, Pausable {
    VaultManager public immutable vaultManager;

    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    function pause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _pause();
    }

    function unpause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _unpause();
    }

    /// @notice Deposits `amount` of the ERC-3643 asset `assetId` on behalf of the caller and
    ///         mints the wrapped ERC-20 straight to them.
    /// @dev Requires the caller to have approved the asset's adapter (not this contract) to
    ///      spend `amount` of the underlying ERC-3643 token — see VaultManager.depositFor.
    function deposit(bytes32 assetId, uint256 amount) external whenNotPaused returns (uint256 mintedAmount) {
        return vaultManager.depositFor(assetId, amount, msg.sender);
    }

    /// @notice Redeems `wrappedAmount` of the wrapped ERC-20 for `assetId` on behalf of the
    ///         caller and sends the released underlying ERC-3643 straight to them.
    /// @dev Requires the caller to have approved VaultManager (not this contract) to spend
    ///      `wrappedAmount` of the wrapped token — see VaultManager.redeemFor.
    function redeem(bytes32 assetId, uint256 wrappedAmount) external whenNotPaused returns (uint256 underlyingAmount) {
        return vaultManager.redeemFor(assetId, wrappedAmount, msg.sender);
    }
}
