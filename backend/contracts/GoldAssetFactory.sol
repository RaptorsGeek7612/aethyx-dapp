// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { GoldAdapter } from "./GoldAdapter.sol";

/// @notice Deploys a GLDToken + GoldAdapter pair for a gold market and registers it into
///         VaultManager in a single transaction, so the two contracts can never end up
///         mismatched or half-registered.
/// @dev One factory per adapter type (see SilverAssetFactory, RealEstateAssetFactory) rather
///      than a single factory embedding every adapter's creation bytecode: bundling three or
///      more adapter types into one contract pushed it past the EIP-170 24,576-byte
///      deployed-code limit. Each factory holds the same FACTORY_ROLE — VaultManager only
///      cares that its caller is a trusted factory, not which one.
contract GoldAssetFactory is AccessManaged {
    VaultManager public immutable vaultManager;

    event GoldAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @dev Requires two one-time, protocol-wide grants already in place in AccessManager:
    ///      MINTER_ROLE for `vaultManager` (covers every wrapped token, not just this one) and
    ///      FACTORY_ROLE for this contract. Neither is granted here.
    function deployGoldAsset(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        address underlying,
        uint256 minAmount,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) returns (address adapter, address wrappedToken) {
        GLDToken token = new GLDToken(name, symbol, address(accessManager));
        GoldAdapter goldAdapter = new GoldAdapter(underlying, address(vaultManager), assetId, minAmount);

        vaultManager.registerAsset(assetId, address(goldAdapter), address(token), depositFeeBps, redeemFeeBps);

        emit GoldAssetDeployed(assetId, address(goldAdapter), address(token));
        return (address(goldAdapter), address(token));
    }
}
