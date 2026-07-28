// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManager } from "../AccessManager.sol";

/// @notice Base contract for anything that needs to gate a function behind a role held in
///         the shared AccessManager.
/// @dev Inherit this instead of OpenZeppelin's AccessControl directly: it keeps role storage
///      in one place (AccessManager) so permissions can be granted, revoked or rotated across
///      the whole protocol without touching each contract individually.
abstract contract AccessManaged {
    
    AccessManager public immutable accessManager;

    error Unauthorized(address account, bytes32 role);

    constructor(address accessManager_) {
        accessManager = AccessManager(accessManager_);
    }

    modifier onlyRole(bytes32 role) {
        if (!accessManager.hasRole(role, msg.sender)) {
            revert Unauthorized(msg.sender, role);
        }
        _;
    }
}
