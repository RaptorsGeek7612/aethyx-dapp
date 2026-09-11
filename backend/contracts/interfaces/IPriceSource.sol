// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Interface commune que toute source de prix (Chainlink, Pyth, poussée manuelle...)
///         doit implémenter pour qu'OracleManager puisse les agréger indifféremment.
interface IPriceSource {
    /// @notice Dernier prix connu pour `assetId`, normalisé à 18 décimales.
    /// @param assetId Identifiant de l'actif dont on veut le prix.
    /// @return price 0 si cette source ne connaît encore aucun prix pour cet actif.
    /// @return updatedAt Horodatage de la dernière mise à jour du prix sur cette source.
    function latestPrice(bytes32 assetId) external view returns (uint256 price, uint256 updatedAt);
}
