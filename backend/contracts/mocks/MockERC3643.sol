// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Doublure minimale d'un vrai token ERC-3643 T-REX, pour les tests uniquement. Tient
///         une liste blanche d'identités vérifiées et un interrupteur global de conformité,
///         afin que les tests puissent exercer les vérifications préalables d'AssetAdapter sans
///         embarquer toute la pile T-REX.
/// @dev La conformité est appliquée à la fois dans `canTransfer` (la vue préalable qu'appelle
///      AssetAdapter) et dans `_update` (le transfert réel), à l'image d'un vrai token T-REX
///      qui refuserait un transfert non conforme même si l'appelant avait sauté la
///      vérification préalable.
contract MockERC3643 is ERC20 {
    /// @dev Décimales arbitraires, pour tester la normalisation d'AssetAdapter.
    uint8 private immutable _customDecimals;

    /// @notice Liste blanche des identités vérifiées.
    mapping(address => bool) public verified;
    /// @notice Interrupteur global de conformité : à faux, tout transfert est refusé.
    bool public complianceOk = true;

    /// @param name_ Nom du token.
    /// @param symbol_ Symbole du token.
    /// @param decimals_ Décimales à exposer.
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _customDecimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    /// @notice Émet des tokens de test, sans aucun contrôle d'accès.
    /// @param to Destinataire.
    /// @param amount Quantité à émettre.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Inscrit ou retire `account` de la liste blanche.
    /// @param account Adresse concernée.
    /// @param verifiedStatus Nouvel état de vérification.
    function setVerified(address account, bool verifiedStatus) external {
        verified[account] = verifiedStatus;
    }

    /// @notice Bascule l'interrupteur global de conformité.
    /// @param ok Faux pour faire échouer tous les transferts.
    function setComplianceOk(bool ok) external {
        complianceOk = ok;
    }

    /// @notice Vrai si `userAddress` figure sur la liste blanche.
    /// @param userAddress Adresse interrogée.
    /// @return Vrai si l'identité est vérifiée.
    function isVerified(address userAddress) external view returns (bool) {
        return verified[userAddress];
    }

    /// @notice Vérification préalable de conformité, quantité ignorée.
    /// @param from Adresse qui serait débitée.
    /// @param to Destinataire envisagé.
    /// @return Vrai si les deux parties sont vérifiées et la conformité active.
    function canTransfer(address from, address to, uint256) external view returns (bool) {
        return complianceOk && verified[from] && verified[to];
    }

    /// @inheritdoc ERC20
    /// @dev Rejoue la vérification de conformité sur le transfert réel, en laissant passer
    ///      l'émission et la destruction (`from` ou `to` nul).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(complianceOk && verified[from] && verified[to], "MockERC3643: compliance check failed");
        }
        super._update(from, to, value);
    }
}
