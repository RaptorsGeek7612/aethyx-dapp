// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC3643 } from "./interfaces/IERC3643.sol";

/// @notice Base abstraite des adaptateurs qui prennent en garde un actif ERC-3643 précis pour
///         le compte de VaultManager. Les adaptateurs concrets (GoldAdapter, SilverAdapter,
///         RealEstateAdapter...) fournissent le token sous-jacent et un identifiant d'actif ;
///         ce contrat assure la mécanique commune dont chaque adaptateur a besoin : tirer et
///         pousser le token ERC-3643, les vérifications de conformité préalables, et la
///         normalisation de ses décimales vers les 18 décimales canoniques du protocole.
abstract contract AssetAdapter {
    /// @notice Token ERC-3643 dont cet adaptateur a la garde.
    IERC3643 public immutable underlying;
    /// @notice Seul contrat autorisé à déclencher dépôts et retraits sur cet adaptateur.
    address public immutable vaultManager;
    /// @notice Identifiant de l'actif dans le registre de VaultManager.
    bytes32 public immutable assetId;
    /// @notice Décimales du token sous-jacent, lues une fois à la construction.
    uint8 public immutable underlyingDecimals;

    /// @notice L'appelant n'est pas le VaultManager.
    /// @param caller Appelant refusé.
    error NotVaultManager(address caller);
    /// @notice L'adaptateur lui-même n'est pas vérifié auprès du token ERC-3643, il ne peut
    ///         donc pas en prendre la garde.
    /// @param adapter Adresse de l'adaptateur non vérifié.
    error AdapterNotVerified(address adapter);
    /// @notice Les règles de conformité du token refusent ce transfert.
    /// @param from Adresse débitée.
    /// @param to Destinataire.
    /// @param amount Quantité refusée.
    error ComplianceCheckFailed(address from, address to, uint256 amount);
    /// @notice Le token sous-jacent a renvoyé false au lieu de transférer.
    error TransferFailed();
    /// @notice La conversion vers les décimales du sous-jacent a tronqué un montant non nul à
    ///         zéro — le rachat brûlerait du token wrappé sans rien restituer en échange.
    /// @param normalizedAmount Montant demandé, en 18 décimales canoniques.
    error DustWithdrawal(uint256 normalizedAmount);

    /// @notice Restreint la fonction au seul VaultManager.
    modifier onlyVaultManager() {
        if (msg.sender != vaultManager) revert NotVaultManager(msg.sender);
        _;
    }

    /// @param underlying_ Token ERC-3643 à prendre en garde.
    /// @param vaultManager_ VaultManager autorisé à piloter cet adaptateur.
    /// @param assetId_ Identifiant de l'actif dans le registre de VaultManager.
    constructor(address underlying_, address vaultManager_, bytes32 assetId_) {
        underlying = IERC3643(underlying_);
        vaultManager = vaultManager_;
        assetId = assetId_;
        underlyingDecimals = IERC3643(underlying_).decimals();
    }

    /// @notice Tire `amount` (décimales du sous-jacent) du token ERC-3643 depuis `from` vers
    ///         la garde de cet adaptateur.
    /// @param from Déposant dont les tokens sont tirés.
    /// @param amount Quantité déposée, dans les décimales du sous-jacent.
    /// @return normalizedAmount `amount` converti vers les 18 décimales canoniques du
    ///         protocole, pour que VaultManager émette la quantité correspondante de token
    ///         wrappé.
    function deposit(address from, uint256 amount) public virtual onlyVaultManager returns (uint256 normalizedAmount) {
        if (!underlying.isVerified(address(this))) revert AdapterNotVerified(address(this));
        if (!underlying.canTransfer(from, address(this), amount)) {
            revert ComplianceCheckFailed(from, address(this), amount);
        }
        if (!underlying.transferFrom(from, address(this), amount)) revert TransferFailed();
        return _toCanonical(amount);
    }

    /// @notice Envoie à `to` l'équivalent en token ERC-3643 sous-jacent de `normalizedAmount`
    ///         (18 décimales), pris sur la garde de cet adaptateur.
    /// @param to Destinataire du sous-jacent.
    /// @param normalizedAmount Quantité à libérer, en 18 décimales canoniques.
    /// @return amount Quantité réellement transférée, dans les décimales du token sous-jacent.
    function withdraw(address to, uint256 normalizedAmount) public virtual onlyVaultManager returns (uint256 amount) {
        amount = _fromCanonical(normalizedAmount);
        // AUDIT.md finding 3: for an underlying with fewer than 18 decimals, _fromCanonical is a
        // truncating division. A normalized amount smaller than the conversion factor rounds to
        // zero — without this check, VaultManager would still burn the caller's wrapped tokens
        // and transfer nothing back. Only the truncation-to-zero case reverts; every other
        // amount already round-trips exactly (see AssetAdapterDecimals.ts).
        if (amount == 0 && normalizedAmount != 0) revert DustWithdrawal(normalizedAmount);
        if (!underlying.canTransfer(address(this), to, amount)) {
            revert ComplianceCheckFailed(address(this), to, amount);
        }
        if (!underlying.transfer(to, amount)) revert TransferFailed();
    }

    /// @notice Convertit une quantité exprimée dans les décimales du sous-jacent vers les 18
    ///         décimales canoniques du protocole.
    /// @param amount Quantité dans les décimales du sous-jacent.
    /// @return Quantité équivalente en 18 décimales.
    function _toCanonical(uint256 amount) internal view returns (uint256) {
        if (underlyingDecimals == 18) return amount;
        if (underlyingDecimals < 18) return amount * (10 ** uint256(18 - underlyingDecimals));
        return amount / (10 ** uint256(underlyingDecimals - 18));
    }

    /// @notice Conversion inverse de `_toCanonical` : des 18 décimales canoniques vers les
    ///         décimales du sous-jacent.
    /// @param amount Quantité en 18 décimales.
    /// @return Quantité équivalente dans les décimales du sous-jacent.
    function _fromCanonical(uint256 amount) internal view returns (uint256) {
        if (underlyingDecimals == 18) return amount;
        if (underlyingDecimals < 18) return amount / (10 ** uint256(18 - underlyingDecimals));
        return amount * (10 ** uint256(underlyingDecimals - 18));
    }
}
