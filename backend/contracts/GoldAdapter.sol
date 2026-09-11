// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token ERC-3643 adossé à de l'or. Ajoute un montant
///         minimal de dépôt et de retrait à la mécanique générique d'AssetAdapter : un
///         dépositaire d'or physique ne peut pas traiter économiquement des rachats
///         fractionnaires arbitrairement petits, si bien que les opérations sous `minAmount`
///         sont rejetées avant même d'atteindre le token sous-jacent.
contract GoldAdapter is AssetAdapter {
    /// @notice Montant minimal accepté, dans les décimales du token sous-jacent.
    uint256 public immutable minAmount;

    /// @notice L'opération porte sur moins que le minimum accepté par le dépositaire.
    /// @param amount Quantité demandée.
    /// @param minAmount Minimum exigé.
    error BelowMinimumAmount(uint256 amount, uint256 minAmount);

    /// @param underlying_ Token or ERC-3643 à prendre en garde.
    /// @param vaultManager_ VaultManager autorisé à piloter cet adaptateur.
    /// @param assetId_ Identifiant de l'actif dans le registre de VaultManager.
    /// @param minAmount_ Montant minimal accepté, dans les décimales du sous-jacent.
    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_,
        uint256 minAmount_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {
        minAmount = minAmount_;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Rejette tout dépôt sous `minAmount` avant de déléguer à l'implémentation de base.
    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        if (amount < minAmount) revert BelowMinimumAmount(amount, minAmount);
        return super.deposit(from, amount);
    }

    /// @inheritdoc AssetAdapter
    /// @dev Le minimum porte sur la quantité réellement libérée, donc la comparaison se fait
    ///      après reconversion vers les décimales du sous-jacent.
    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        amount = _fromCanonical(normalizedAmount);
        if (amount < minAmount) revert BelowMinimumAmount(amount, minAmount);
        return super.withdraw(to, normalizedAmount);
    }
}
