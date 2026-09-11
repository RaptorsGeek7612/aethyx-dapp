// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token immobilier ERC-3643 fractionné. N'ajoute aucune
///         règle à la mécanique générique : l'immobilier se dépose et se rachète exactement
///         comme l'or et l'argent.
/// @dev Gardé comme contrat distinct, bien qu'il n'ajoute rien pour l'instant, pour la même
///      raison que SilverAdapter existe à côté de GoldAdapter : le nom du contrat on-chain doit
///      refléter honnêtement l'actif dont il a la garde, et c'est ici que se grefferait toute
///      règle propre à l'immobilier introduite plus tard.
///
///      Une version antérieure imposait une durée de détention minimale avant rachat, au motif
///      que le règlement d'une opération immobilière prend un temps réel. Elle a été retirée : le
///      produit a tranché en faveur d'un actif qui se comporte comme les autres. Deux générations
///      de cette règle figurent dans l'historique — un blocage par adresse, puis un échéancier
///      global au marché — ainsi que la faille du premier, contournable par auto-transfert. Voir
///      AUDIT.md, constat n°1, et le commit qui accompagne ce retrait.
contract RealEstateAdapter is AssetAdapter {
    /// @param underlying_ Token immobilier ERC-3643 à prendre en garde.
    /// @param vaultManager_ VaultManager autorisé à piloter cet adaptateur.
    /// @param assetId_ Identifiant de l'actif dans le registre de VaultManager.
    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {}
}
