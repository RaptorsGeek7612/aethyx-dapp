// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { GoldAdapter } from "./GoldAdapter.sol";
import { RealEstateAdapter } from "./RealEstateAdapter.sol";

/// @notice Deploys a new wrapped-token + adapter pair for an asset and registers it into
///         VaultManager in a single transaction, so the two contracts can never end up
///         mismatched or half-registered. One deploy function per adapter type that exists
///         today (gold, real estate) — a new asset class means writing a new adapter contract
///         and adding a matching deploy function here, not accepting arbitrary bytecode.
///         GLDToken is reused as the generic wrapped-ERC20 template for every asset, not just
///         gold: only its name/symbol change per deployment.
contract WrappedTokenFactory is AccessManaged {
    VaultManager public immutable vaultManager;

    event GoldAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);
    event RealEstateAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @notice Deploys a GLDToken + GoldAdapter pair for `underlying` and registers them in
    ///         VaultManager under `assetId`.
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

    /// @notice Deploys a GLDToken-shaped token + RealEstateAdapter pair for `underlying` and
    ///         registers them in VaultManager under `assetId`.
    /// @dev Same one-time role grants as deployGoldAsset are required beforehand. See
    ///      RealEstateAdapter's natspec for a limitation on routing this asset through
    ///      InvestOrGateway.
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
        RealEstateAdapter realEstateAdapter =
            new RealEstateAdapter(underlying, address(vaultManager), assetId, lockupPeriod);

        vaultManager.registerAsset(assetId, address(realEstateAdapter), address(token), depositFeeBps, redeemFeeBps);

        emit RealEstateAssetDeployed(assetId, address(realEstateAdapter), address(token));
        return (address(realEstateAdapter), address(token));
    }
}
