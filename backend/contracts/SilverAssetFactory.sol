// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { SilverAdapter } from "./SilverAdapter.sol";

/// @notice Deploys a GLDToken-shaped token + SilverAdapter pair for a silver market and
///         registers it into VaultManager in a single transaction.
/// @dev See GoldAssetFactory's natspec for why this is a separate contract rather than one
///      factory handling every adapter type.
contract SilverAssetFactory is AccessManaged {
    VaultManager public immutable vaultManager;

    event SilverAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @dev Requires two one-time, protocol-wide grants already in place in AccessManager:
    ///      MINTER_ROLE for `vaultManager` and FACTORY_ROLE for this contract.
    function deploySilverAsset(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        address underlying,
        uint256 minAmount,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) returns (address adapter, address wrappedToken) {
        GLDToken token = new GLDToken(name, symbol, address(accessManager));
        SilverAdapter silverAdapter = new SilverAdapter(underlying, address(vaultManager), assetId, minAmount);

        vaultManager.registerAsset(assetId, address(silverAdapter), address(token), depositFeeBps, redeemFeeBps);

        emit SilverAssetDeployed(assetId, address(silverAdapter), address(token));
        return (address(silverAdapter), address(token));
    }
}
