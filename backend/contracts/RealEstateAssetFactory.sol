// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { RealEstateAdapter } from "./RealEstateAdapter.sol";

/// @notice Deploys a GLDToken-shaped token + RealEstateAdapter pair for a real-estate market
///         and registers it into VaultManager in a single transaction.
/// @dev See GoldAssetFactory's natspec for why this is a separate contract rather than one
///      factory handling every adapter type. See RealEstateAdapter's natspec for a limitation
///      on routing this asset through InvestOrGateway.
contract RealEstateAssetFactory is AccessManaged {
    VaultManager public immutable vaultManager;

    event RealEstateAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @dev Requires two one-time, protocol-wide grants already in place in AccessManager:
    ///      MINTER_ROLE for `vaultManager` and FACTORY_ROLE for this contract.
    function deployRealEstateAsset(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        address underlying,
        uint256 lockupPeriod,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) returns (address adapter, address wrappedToken) {
        GLDToken token = new GLDToken(name, symbol, address(accessManager));
        RealEstateAdapter realEstateAdapter = new RealEstateAdapter(
            underlying,
            address(vaultManager),
            assetId,
            lockupPeriod
        );

        vaultManager.registerAsset(assetId, address(realEstateAdapter), address(token), depositFeeBps, redeemFeeBps);

        emit RealEstateAssetDeployed(assetId, address(realEstateAdapter), address(token));
        return (address(realEstateAdapter), address(token));
    }
}
