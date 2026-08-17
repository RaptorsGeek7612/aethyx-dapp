// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice Concrete AssetAdapter for a silver-backed ERC-3643 token. Same rationale as
///         GoldAdapter: a physical metal custodian cannot economically process arbitrarily
///         small fractional redemptions, so trades below `minAmount` are rejected before ever
///         reaching the underlying token. Kept as its own contract (rather than reusing
///         GoldAdapter under a different name) so the on-chain contract name always honestly
///         reflects the asset it custodies.
contract SilverAdapter is AssetAdapter {
    uint256 public immutable minAmount;

    error BelowMinimumAmount(uint256 amount, uint256 minAmount);

    constructor(address underlying_, address vaultManager_, bytes32 assetId_, uint256 minAmount_)
        AssetAdapter(underlying_, vaultManager_, assetId_)
    {
        minAmount = minAmount_;
    }

    function deposit(address from, uint256 amount)
        public
        override
        onlyVaultManager
        returns (uint256 normalizedAmount)
    {
        if (amount < minAmount) revert BelowMinimumAmount(amount, minAmount);
        return super.deposit(from, amount);
    }

    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        amount = _fromCanonical(normalizedAmount);
        if (amount < minAmount) revert BelowMinimumAmount(amount, minAmount);
        return super.withdraw(to, normalizedAmount);
    }
}
