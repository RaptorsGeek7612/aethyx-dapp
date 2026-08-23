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

    /// @notice Deliberately orphaned admin role for ROUTER_ROLE: nobody holds it, nobody ever
    ///         will, since nothing ever grants it. Once `lockRouterRole` points ROUTER_ROLE's
    ///         admin here, ROUTER_ROLE becomes permanently fixed to whatever it was granted to
    ///         — not even DEFAULT_ADMIN_ROLE can grant or revoke it afterwards. This is what
    ///         keeps the trust perimeter described in ROUTER_ROLE's own natspec from growing
    ///         after deployment.
    bytes32 public constant ROUTER_ROLE_ADMIN = keccak256("ROUTER_ROLE_ADMIN");

    error RouterAlreadySet();

    /// @param initialAdmin Should be a multisig or timelock in production, not an EOA:
    ///        this address can grant and revoke every role above, including itself.
    constructor(address initialAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    /// @notice One-time setup: grants ROUTER_ROLE to `gateway`, then permanently locks it by
    ///         pointing its role-admin at ROUTER_ROLE_ADMIN, a role with no members. Deployed
    ///         separately from the constructor because AccessManager must exist before
    ///         InvestOrGateway can be deployed (it takes this contract's address), so the
    ///         gateway's address isn't known yet at construction time.
    /// @dev Order matters: granting before locking is what lets the role be granted at all —
    ///      swap the two calls and ROUTER_ROLE would be born with no members and no way to
    ///      ever gain one.
    function lockRouterRole(address gateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (getRoleAdmin(ROUTER_ROLE) == ROUTER_ROLE_ADMIN) revert RouterAlreadySet();
        _grantRole(ROUTER_ROLE, gateway);
        _setRoleAdmin(ROUTER_ROLE, ROUTER_ROLE_ADMIN);
    }
}
