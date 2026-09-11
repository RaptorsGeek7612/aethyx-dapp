// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Source de prix alimentée par un administrateur : l'une des sources indépendantes,
///         possiblement multiples, qu'OracleManager agrège par médiane. Tient lieu de vrai
///         wrapper Chainlink/Pyth (voir la natspec d'OracleManager.sol) — même interface
///         IPriceSource, si bien que la remplacer plus tard n'exigera aucune modification
///         d'OracleManager ni de ce qui lit à travers lui.
/// @dev Chaque poussée émet PriceUpdated, qui constitue l'historique on-chain qu'un frontend
///      rejoue via getLogs pour tracer une tendance ou calculer une variation sur 24 h — il
///      n'existe aucun stockage d'historique distinct.
contract ManualPriceSource is AccessManaged, IPriceSource {
    /// @notice Dernier prix poussé pour un actif, normalisé à 18 décimales.
    mapping(bytes32 assetId => uint256 price) public price;
    /// @notice Horodatage de la dernière poussée pour un actif.
    mapping(bytes32 assetId => uint256 updatedAt) public updatedAt;

    /// @notice Émis à chaque poussée de prix ; constitue l'historique rejouable via getLogs.
    /// @param assetId Actif concerné.
    /// @param price Nouveau prix, en 18 décimales.
    /// @param updatedAt Horodatage de la poussée.
    event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 updatedAt);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    constructor(address accessManager_) AccessManaged(accessManager_) {}

    /// @notice Pousse un nouveau prix pour `assetId`, normalisé à 18 décimales (par exemple
    ///         des euros par gramme multipliés par 1e18 pour un flux or/argent).
    /// @param assetId Actif dont le prix est mis à jour.
    /// @param newPrice Nouveau prix, en 18 décimales.
    function setPrice(bytes32 assetId, uint256 newPrice) external onlyRole(accessManager.ORACLE_UPDATER_ROLE()) {
        price[assetId] = newPrice;
        updatedAt[assetId] = block.timestamp;
        emit PriceUpdated(assetId, newPrice, block.timestamp);
    }

    /// @inheritdoc IPriceSource
    function latestPrice(bytes32 assetId) external view returns (uint256, uint256) {
        return (price[assetId], updatedAt[assetId]);
    }
}
