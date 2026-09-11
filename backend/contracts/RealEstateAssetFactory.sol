// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { RealEstateAdapter } from "./RealEstateAdapter.sol";

/// @notice Déploie un couple token de forme GLDToken + RealEstateAdapter pour un marché
///         immobilier et l'enregistre dans VaultManager en une seule transaction.
/// @dev Voir la natspec de GoldAssetFactory pour la raison d'un contrat distinct plutôt que
///      d'une fabrique unique prenant en charge tous les types d'adaptateurs.
contract RealEstateAssetFactory is AccessManaged {
    /// @notice VaultManager dans lequel les actifs déployés sont enregistrés.
    VaultManager public immutable vaultManager;

    /// @notice Émis lorsqu'un marché immobilier a été déployé et enregistré.
    /// @param assetId Identifiant du nouvel actif.
    /// @param adapter Adaptateur déployé.
    /// @param wrappedToken Token wrappé déployé.
    event RealEstateAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param vaultManager_ VaultManager dans lequel enregistrer les actifs déployés.
    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @notice Déploie et enregistre un marché immobilier complet en une transaction.
    /// @dev Suppose déjà en place deux attributions uniques à l'échelle du protocole dans
    ///      AccessManager : MINTER_ROLE pour `vaultManager` et FACTORY_ROLE pour ce contrat.
    /// @param assetId Identifiant à attribuer au nouvel actif.
    /// @param name Nom du token wrappé.
    /// @param symbol Symbole du token wrappé.
    /// @param underlying Token immobilier ERC-3643 sous-jacent.
    /// @param depositFeeBps Frais de dépôt, en points de base.
    /// @param redeemFeeBps Frais de rachat, en points de base.
    /// @return adapter Adaptateur déployé.
    /// @return wrappedToken Token wrappé déployé.
    function deployRealEstateAsset(
        bytes32 assetId,
        string calldata name,
        string calldata symbol,
        address underlying,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) returns (address adapter, address wrappedToken) {
        GLDToken token = new GLDToken(name, symbol, address(accessManager));
        RealEstateAdapter realEstateAdapter = new RealEstateAdapter(underlying, address(vaultManager), assetId);

        vaultManager.registerAsset(assetId, address(realEstateAdapter), address(token), depositFeeBps, redeemFeeBps);

        emit RealEstateAssetDeployed(assetId, address(realEstateAdapter), address(token));
        return (address(realEstateAdapter), address(token));
    }
}
