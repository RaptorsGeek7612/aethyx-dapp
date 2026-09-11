// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { VaultManager } from "./VaultManager.sol";
import { GLDToken } from "./GLDToken.sol";
import { GoldAdapter } from "./GoldAdapter.sol";

/// @notice Déploie un couple GLDToken + GoldAdapter pour un marché or et l'enregistre dans
///         VaultManager en une seule transaction, de sorte que les deux contrats ne puissent
///         jamais se retrouver dépareillés ou à moitié enregistrés.
/// @dev Une fabrique par type d'adaptateur (voir SilverAssetFactory, RealEstateAssetFactory)
///      plutôt qu'une fabrique unique embarquant le bytecode de création de tous les
///      adaptateurs : regrouper trois types d'adaptateurs ou plus dans un seul contrat le
///      faisait dépasser la limite EIP-170 de 24 576 octets de code déployé. Chaque fabrique
///      détient le même FACTORY_ROLE — VaultManager se soucie seulement que son appelant soit
///      une fabrique de confiance, pas de laquelle il s'agit.
contract GoldAssetFactory is AccessManaged {
    /// @notice VaultManager dans lequel les actifs déployés sont enregistrés.
    VaultManager public immutable vaultManager;

    /// @notice Émis lorsqu'un marché or a été déployé et enregistré.
    /// @param assetId Identifiant du nouvel actif.
    /// @param adapter Adaptateur déployé.
    /// @param wrappedToken Token wrappé déployé.
    event GoldAssetDeployed(bytes32 indexed assetId, address adapter, address wrappedToken);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param vaultManager_ VaultManager dans lequel enregistrer les actifs déployés.
    constructor(address accessManager_, address vaultManager_) AccessManaged(accessManager_) {
        vaultManager = VaultManager(vaultManager_);
    }

    /// @notice Déploie et enregistre un marché or complet en une transaction.
    /// @dev Suppose déjà en place deux attributions uniques à l'échelle du protocole dans
    ///      AccessManager : MINTER_ROLE pour `vaultManager` (il couvre tous les tokens
    ///      wrappés, pas seulement celui-ci) et FACTORY_ROLE pour ce contrat. Aucune des deux
    ///      n'est accordée ici.
    /// @param assetId Identifiant à attribuer au nouvel actif.
    /// @param name Nom du token wrappé.
    /// @param symbol Symbole du token wrappé.
    /// @param underlying Token or ERC-3643 sous-jacent.
    /// @param minAmount Montant minimal accepté, dans les décimales du sous-jacent.
    /// @param depositFeeBps Frais de dépôt, en points de base.
    /// @param redeemFeeBps Frais de rachat, en points de base.
    /// @return adapter Adaptateur déployé.
    /// @return wrappedToken Token wrappé déployé.
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
}
