// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManager } from "../AccessManager.sol";

/// @notice Contrat de base pour tout ce qui doit protéger une fonction derrière un rôle détenu
///         dans l'AccessManager partagé.
/// @dev À hériter plutôt que l'AccessControl d'OpenZeppelin directement : cela garde le
///      stockage des rôles en un seul endroit (AccessManager), de sorte que les permissions
///      peuvent être accordées, révoquées ou permutées à l'échelle du protocole entier sans
///      toucher à chaque contrat individuellement.
abstract contract AccessManaged {
    /// @notice Registre des rôles partagé par tout le protocole.
    AccessManager public immutable accessManager;

    /// @notice L'appelant ne détient pas le rôle exigé par la fonction.
    /// @param account Appelant refusé.
    /// @param role Rôle qui lui manque.
    error Unauthorized(address account, bytes32 role);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    constructor(address accessManager_) {
        accessManager = AccessManager(accessManager_);
    }

    /// @notice Restreint la fonction aux détenteurs de `role`.
    /// @param role Rôle exigé de l'appelant.
    modifier onlyRole(bytes32 role) {
        if (!accessManager.hasRole(role, msg.sender)) {
            revert Unauthorized(msg.sender, role);
        }
        _;
    }
}
