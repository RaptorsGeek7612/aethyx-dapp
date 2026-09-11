// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Interface minimale pour interagir avec un token permissionné ERC-3643 (T-REX).
/// @dev Ne couvre que la surface ERC-20 et les vérifications de conformité dont les
///      implémentations d'AssetAdapter ont besoin pour faire entrer et sortir les tokens du
///      coffre en toute sécurité. Les opérations réservées à l'émetteur (mint, forcedTransfer,
///      gel, gestion des agents) sont délibérément exclues : ce code n'agit jamais qu'en tant
///      que détenteur du token, jamais en tant qu'émetteur.
interface IERC3643 {
    /// @notice Vrai si `userAddress` possède une identité on-chain vérifiée, reconnue par
    ///         l'Identity Registry de ce token. C'est un prérequis pour détenir ou recevoir
    ///         le token.
    /// @dev L'adresse du contrat AssetAdapter lui-même doit satisfaire cette vérification —
    ///      arrangement pris hors chaîne avec l'émetteur du token — avant qu'un dépôt puisse
    ///      aboutir.
    /// @param userAddress Adresse dont on vérifie l'identité.
    /// @return Vrai si l'identité est vérifiée.
    function isVerified(address userAddress) external view returns (bool);

    /// @notice Nombre de décimales du token.
    /// @return Décimales déclarées par le token.
    function decimals() external view returns (uint8);

    /// @notice Solde de `account`.
    /// @param account Adresse interrogée.
    /// @return Solde, dans les décimales du token.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Offre totale en circulation.
    /// @return Offre totale, dans les décimales du token.
    function totalSupply() external view returns (uint256);

    /// @notice Montant que `spender` est autorisé à dépenser pour le compte de `owner`.
    /// @param owner Propriétaire des tokens.
    /// @param spender Adresse autorisée à dépenser.
    /// @return Montant restant autorisé.
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice Transfère `amount` tokens de l'appelant vers `to`.
    /// @param to Destinataire.
    /// @param amount Quantité transférée.
    /// @return Vrai si le transfert a réussi.
    function transfer(address to, uint256 amount) external returns (bool);

    /// @notice Transfère `amount` tokens de `from` vers `to`, en consommant l'allowance.
    /// @param from Adresse débitée.
    /// @param to Destinataire.
    /// @param amount Quantité transférée.
    /// @return Vrai si le transfert a réussi.
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /// @notice Vérification préalable : un transfert de `amount` de `from` vers `to`
    ///         passerait-il actuellement les règles d'identité et de conformité de ce token ?
    /// @dev Les adaptateurs doivent l'appeler avant toute tentative de transferFrom : sur la
    ///      plupart des déploiements T-REX, un échec de conformité revert sans message
    ///      exploitable.
    /// @param from Adresse qui serait débitée.
    /// @param to Destinataire envisagé.
    /// @param amount Quantité envisagée.
    /// @return Vrai si le transfert passerait les règles de conformité.
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);

    /// @notice Autorise `spender` à dépenser `amount` tokens de l'appelant.
    /// @param spender Adresse autorisée.
    /// @param amount Montant autorisé.
    /// @return Vrai si l'autorisation a été enregistrée.
    function approve(address spender, uint256 amount) external returns (bool);
}
