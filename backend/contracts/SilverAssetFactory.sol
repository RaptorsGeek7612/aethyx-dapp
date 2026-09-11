// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { SilverAdapter } from "./SilverAdapter.sol";

/// @notice Déploie un couple token de forme GLDToken + SilverAdapter pour un marché argent et
///         l'enregistre dans VaultManager en une seule transaction.
/// @dev Voir la natspec de GoldAssetFactory pour la raison d'un contrat distinct plutôt que
///      d'une fabrique unique prenant en charge tous les types d'adaptateurs.
contract SilverAssetFactory is AccessManaged {
    /// @notice VaultManager dans lequel les actifs déployés sont enregistrés.
    VaultManager public immutable vaultManager;

    /// @notice Émis lorsqu'un marché argent a été déployé et enregistré.
    /// @param assetId Identifiant du nouvel actif.
    /// @param adapter Adaptateur déployé.
    /// @param wrappedToken Token wrappé déployé.
    event SilverAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param vaultManager_ VaultManager dans lequel enregistrer les actifs déployés.
    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @notice Déploie et enregistre un marché argent complet en une transaction.
    /// @dev Suppose déjà en place deux attributions uniques à l'échelle du protocole dans
    ///      AccessManager : MINTER_ROLE pour `vaultManager` et FACTORY_ROLE pour ce contrat.
    /// @param assetId Identifiant à attribuer au nouvel actif.
    /// @param name Nom du token wrappé.
    /// @param symbol Symbole du token wrappé.
    /// @param underlying Token argent ERC-3643 sous-jacent.
    /// @param minAmount Montant minimal accepté, dans les décimales du sous-jacent.
    /// @param depositFeeBps Frais de dépôt, en points de base.
    /// @param redeemFeeBps Frais de rachat, en points de base.
    /// @return adapter Adaptateur déployé.
    /// @return wrappedToken Token wrappé déployé.
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
