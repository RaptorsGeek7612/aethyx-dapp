// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Central registry of roles for the whole Invest'Or Gateway protocol.
/// @dev Every other contract (VaultManager, GLDToken, OracleManager, Treasury,
///      the asset factories, InvestOrGateway, asset adapters) holds an immutable reference
///      to this contract and checks roles here via AccessManaged, instead of managing its
///      own AccessControl. Permissions can be granted, revoked or rotated across the entire
///      protocol from a single place.
contract AccessManager is AccessControl {
    /// @notice Can register or deregister asset adapters and wrapped tokens in VaultManager.
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER_ROLE");

    /// @notice Held exclusively by VaultManager; allows minting/burning wrapped tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Can push prices into OracleManager's manual/API price source.
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    /// @notice Can withdraw accumulated protocol fees from Treasury.
    bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");

    /// @notice Can pause or unpause user-facing entry points (Gateway, VaultManager).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Held by every asset factory (GoldAssetFactory, SilverAssetFactory,
    ///         RealEstateAssetFactory...); allows registering new adapters/tokens.
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    /// @notice Held exclusively by InvestOrGateway; lets it call VaultManager's depositFor/
    ///         redeemFor on behalf of its own caller. Never grant this to anything that might
    ///         pass through an address other than its own immediate msg.sender — it is what
    ///         lets VaultManager trust an explicit depositor/redeemer address instead of only
    ///         ever using msg.sender.
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    /// @param initialAdmin Should be a multisig or timelock in production, not an EOA:
    ///        this address can grant and revoke every role above, including itself.
    constructor(address initialAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }
}
