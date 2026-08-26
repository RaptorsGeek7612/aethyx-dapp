// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice Concrete AssetAdapter for a fractionalized real-estate ERC-3643 token. Adds a
///         minimum holding period before redemption: real-estate settlement (title transfer,
///         notary processing...) takes real time, unlike a purely digital asset that can be
///         wrapped and unwrapped in the same block.
/// @dev The lock-up is tracked per `from`/`to` address. This is safe for per-depositor state
///      even when routed through InvestOrGateway: VaultManager's depositFor/redeemFor always
///      forward the Gateway's own caller, never the Gateway's address, so this adapter always
///      sees the real end user — see VaultManager.sol and InvestOrGateway.sol.
contract RealEstateAdapter is AssetAdapter {
    uint256 public immutable lockupPeriod;

    mapping(address depositor => uint256 lockedUntil) public lockedUntil;

    error StillLocked(address account, uint256 lockedUntil);

    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_,
        uint256 lockupPeriod_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {
        lockupPeriod = lockupPeriod_;
    }

    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        lockedUntil[from] = block.timestamp + lockupPeriod;
        return super.deposit(from, amount);
    }

    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        if (block.timestamp < lockedUntil[to]) revert StillLocked(to, lockedUntil[to]);
        return super.withdraw(to, normalizedAmount);
    }
}
