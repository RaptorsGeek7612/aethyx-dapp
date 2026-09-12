// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";

/// @notice Point d'entrée unique et stable auquel s'adresse le frontend. Ne détient aucun état
///         métier propre — soldes, configuration des frais et registre des actifs vivent tous
///         dans VaultManager — et, contrairement à un routeur DeFi classique, ne prend jamais
///         la garde du token ERC-3643 ni du token wrappé, même transitoirement : il transmet
///         `msg.sender` tel quel aux `depositFor`/`redeemFor` de VaultManager, qui tirent
///         directement depuis cette adresse et paient directement vers elle. Les appelants
///         approuvent donc toujours l'adaptateur de l'actif (pour les dépôts) ou VaultManager
///         lui-même (pour les rachats), exactement comme pour un appel direct — jamais ce
///         contrat. Parce qu'il ne détient jamais le token ERC-3643, ce contrat n'a PAS besoin
///         d'être inscrit comme identité vérifiée auprès de l'émetteur du token.
contract AethyxGateway is AccessManaged, Pausable {
    /// @notice VaultManager vers lequel tous les appels sont relayés.
    VaultManager public immutable vaultManager;

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param vaultManager_ VaultManager destinataire des appels relayés.
    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @notice Suspend ce point d'entrée. Indépendant de la pause de VaultManager : geler le
    ///         Gateway bloque les appels qui passent par lui sans toucher aux appels directs.
    function pause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _pause();
    }

    /// @notice Lève la suspension posée par `pause`.
    function unpause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _unpause();
    }

    /// @notice Dépose `amount` de l'actif ERC-3643 `assetId` pour le compte de l'appelant et
    ///         lui émet directement l'ERC-20 wrappé.
    /// @dev Exige que l'appelant ait approuvé l'adaptateur de l'actif (et non ce contrat) pour
    ///      dépenser `amount` du token ERC-3643 sous-jacent — voir VaultManager.depositFor.
    /// @param assetId Actif déposé.
    /// @param amount Quantité déposée, dans les décimales du sous-jacent.
    /// @return mintedAmount Quantité de token wrappé émise à l'appelant.
    function deposit(bytes32 assetId, uint256 amount) external whenNotPaused returns (uint256 mintedAmount) {
        return vaultManager.depositFor(assetId, amount, msg.sender);
    }

    /// @notice Rachète `wrappedAmount` de l'ERC-20 wrappé de `assetId` pour le compte de
    ///         l'appelant et lui envoie directement l'ERC-3643 sous-jacent libéré.
    /// @dev Exige que l'appelant ait approuvé VaultManager (et non ce contrat) pour dépenser
    ///      `wrappedAmount` du token wrappé — voir VaultManager.redeemFor.
    /// @param assetId Actif racheté.
    /// @param wrappedAmount Quantité de token wrappé présentée, frais compris.
    /// @return underlyingAmount Quantité de sous-jacent restituée.
    function redeem(bytes32 assetId, uint256 wrappedAmount) external whenNotPaused returns (uint256 underlyingAmount) {
        return vaultManager.redeemFor(assetId, wrappedAmount, msg.sender);
    }
}
