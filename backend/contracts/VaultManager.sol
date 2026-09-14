// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { AssetAdapter } from "./AssetAdapter.sol";
import { IWrappedToken } from "./interfaces/IWrappedToken.sol";

/// @notice Chef d'orchestre du wrap : verrouille un actif ERC-3643 via son AssetAdapter et
///         émet l'ERC-20 wrappé correspondant, ou brûle l'ERC-20 wrappé et restitue le
///         sous-jacent. Invariant central garanti pour chaque actif enregistré : l'offre
///         totale de token wrappé égale toujours la valeur totale verrouillée dans son
///         adaptateur, exprimée dans les 18 décimales canoniques — y compris ce que le
///         Treasury détient au titre des frais. Rien n'est jamais émis sans dépôt
///         correspondant, rien n'est jamais brûlé sans libération du collatéral correspondant.
contract VaultManager is AccessManaged, Pausable, ReentrancyGuard {
    // AUDIT.md finding 5: registerAsset accepts an arbitrary wrapped-token address, and
    // IWrappedToken's transferFrom return value went unchecked below — GLDToken's OZ ERC20
    // reverts on failure so this wasn't exploitable today, but a token that returns false
    // instead of reverting would silently skip the fee transfer. SafeERC20 is already the
    // project's own pattern for tokens it doesn't control (see Treasury.sol).
    using SafeERC20 for IWrappedToken;

    /// @notice Configuration d'un actif enregistré.
    /// @param adapter Adaptateur qui a la garde du sous-jacent.
    /// @param wrappedToken Token wrappé émis contre cet actif.
    /// @param depositFeeBps Frais de dépôt, en points de base.
    /// @param redeemFeeBps Frais de rachat, en points de base.
    /// @param active Faux si l'actif est gelé : dépôts et rachats sont alors refusés.
    struct AssetConfig {
        AssetAdapter adapter;
        IWrappedToken wrappedToken;
        uint16 depositFeeBps;
        uint16 redeemFeeBps;
        bool active;
    }

    /// @dev Dénominateur des points de base : 10 000 bps = 100 %.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @dev Plafond dur sur chaque frais, en points de base — 500 bps = 5 %. Avant ce plafond,
    ///      la seule borne était 10 000 bps (100 %) : un ASSET_MANAGER_ROLE compromis ou
    ///      malveillant pouvait fixer un frais à 100 % et vider en une transaction tout dépôt ou
    ///      rachat suivant vers le Treasury (AUDIT.md constat n°2). Une borne dans le code vaut
    ///      mieux qu'une borne dans une intention.
    uint16 private constant MAX_FEE_BPS = 500;

    /// @notice Contrat qui reçoit les frais de protocole.
    address public immutable treasury;

    /// @notice Registre des actifs, indexé par identifiant.
    /// @dev Volontairement dépourvu d'énumération on-chain : un simple mapping, au prix d'une
    ///      découverte impossible depuis la chaîne. Les consommateurs (frontend, scripts)
    ///      tiennent leur propre liste des identifiants qu'ils s'attendent à trouver ici, ou
    ///      reconstituent l'ensemble depuis les événements AssetRegistered.
    mapping(bytes32 assetId => AssetConfig config) public assets;

    /// @notice Émis lorsqu'une fabrique enregistre un nouveau couple adaptateur / token.
    /// @param assetId Identifiant du nouvel actif.
    /// @param adapter Adaptateur enregistré.
    /// @param wrappedToken Token wrappé enregistré.
    event AssetRegistered(bytes32 indexed assetId, address indexed adapter, address indexed wrappedToken);
    /// @notice Émis lorsqu'un actif est gelé ou réactivé.
    /// @param assetId Actif concerné.
    /// @param active Nouvel état.
    event AssetActiveSet(bytes32 indexed assetId, bool active);
    /// @notice Émis lorsque les frais d'un actif changent.
    /// @param assetId Actif concerné.
    /// @param depositFeeBps Nouveaux frais de dépôt, en points de base.
    /// @param redeemFeeBps Nouveaux frais de rachat, en points de base.
    event AssetFeesSet(bytes32 indexed assetId, uint16 depositFeeBps, uint16 redeemFeeBps);
    /// @notice Émis à chaque dépôt réussi.
    /// @param assetId Actif déposé.
    /// @param user Déposant réel, jamais l'adresse d'un routeur.
    /// @param underlyingAmount Quantité de sous-jacent verrouillée, dans ses propres décimales.
    /// @param mintedAmount Quantité de token wrappé émise au déposant, nette de frais.
    /// @param feeAmount Part revenue au Treasury.
    event Deposited(
        bytes32 indexed assetId,
        address indexed user,
        uint256 underlyingAmount,
        uint256 mintedAmount,
        uint256 feeAmount
    );
    /// @notice Émis à chaque rachat réussi.
    /// @param assetId Actif racheté.
    /// @param user Racheteur réel, jamais l'adresse d'un routeur.
    /// @param wrappedAmount Quantité de token wrappé présentée au rachat, frais compris.
    /// @param underlyingAmount Quantité de sous-jacent restituée.
    /// @param feeAmount Part revenue au Treasury.
    event Redeemed(
        bytes32 indexed assetId,
        address indexed user,
        uint256 wrappedAmount,
        uint256 underlyingAmount,
        uint256 feeAmount
    );

    /// @notice L'actif est inconnu ou gelé.
    /// @param assetId Actif concerné.
    error AssetNotActive(bytes32 assetId);
    /// @notice Cet identifiant d'actif est déjà pris ; il n'existe aucun moyen de le repointer
    ///         vers un autre adaptateur.
    /// @param assetId Identifiant déjà enregistré.
    error AssetAlreadyRegistered(bytes32 assetId);
    /// @notice Des frais supérieurs au plafond `MAX_FEE_BPS` ont été demandés.
    /// @param feeBps Valeur refusée, en points de base.
    error FeeTooHigh(uint16 feeBps);
    /// @notice L'adaptateur fourni ne se reconnaît pas sous cet `assetId` — enregistrement
    ///         refusé plutôt que de créer un actif dont le collatéral et l'identifiant divergent.
    /// @param assetId Identifiant sous lequel l'enregistrement a été demandé.
    /// @param adapterAssetId Identifiant que l'adaptateur porte réellement.
    error AssetIdMismatch(bytes32 assetId, bytes32 adapterAssetId);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param treasury_ Contrat destinataire des frais.
    constructor(address accessManager_, address treasury_) AccessManaged(accessManager_) {
        treasury = treasury_;
    }

    /// @notice Enregistre un nouveau couple adaptateur / token wrappé sous `assetId`. Appelé
    ///         uniquement par l'une des fabriques d'actifs, juste après qu'elle a déployé les
    ///         deux contrats ensemble.
    /// @param assetId Identifiant du nouvel actif.
    /// @param adapter Adaptateur ayant la garde du sous-jacent.
    /// @param wrappedToken Token wrappé à émettre contre cet actif.
    /// @param depositFeeBps Frais de dépôt, en points de base.
    /// @param redeemFeeBps Frais de rachat, en points de base.
    function registerAsset(
        bytes32 assetId,
        address adapter,
        address wrappedToken,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.FACTORY_ROLE()) {
        if (address(assets[assetId].adapter) != address(0)) revert AssetAlreadyRegistered(assetId);
        bytes32 adapterAssetId = AssetAdapter(adapter).assetId();
        if (adapterAssetId != assetId) revert AssetIdMismatch(assetId, adapterAssetId);
        _validateFees(depositFeeBps, redeemFeeBps);

        assets[assetId] = AssetConfig({
            adapter: AssetAdapter(adapter),
            wrappedToken: IWrappedToken(wrappedToken),
            depositFeeBps: depositFeeBps,
            redeemFeeBps: redeemFeeBps,
            active: true
        });
        emit AssetRegistered(assetId, adapter, wrappedToken);
    }

    /// @notice Gèle ou réactive un actif. Un actif gelé refuse dépôts et rachats sans que le
    ///         reste du protocole soit affecté.
    /// @param assetId Actif concerné.
    /// @param active Nouvel état souhaité.
    function setAssetActive(bytes32 assetId, bool active) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        assets[assetId].active = active;
        emit AssetActiveSet(assetId, active);
    }

    /// @notice Met à jour les frais d'un actif déjà enregistré.
    /// @param assetId Actif concerné.
    /// @param depositFeeBps Nouveaux frais de dépôt, en points de base.
    /// @param redeemFeeBps Nouveaux frais de rachat, en points de base.
    function setAssetFees(
        bytes32 assetId,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        _validateFees(depositFeeBps, redeemFeeBps);
        AssetConfig storage config = assets[assetId];
        config.depositFeeBps = depositFeeBps;
        config.redeemFeeBps = redeemFeeBps;
        emit AssetFeesSet(assetId, depositFeeBps, redeemFeeBps);
    }

    /// @notice Suspend dépôts et rachats sur tous les actifs à la fois.
    function pause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _pause();
    }

    /// @notice Lève la suspension posée par `pause`.
    function unpause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _unpause();
    }

    /// @notice Dépose `amount` (décimales du sous-jacent) de l'actif ERC-3643 identifié par
    ///         `assetId`, et émet à l'appelant l'ERC-20 wrappé équivalent, net des frais de
    ///         dépôt.
    /// @param assetId Actif déposé.
    /// @param amount Quantité déposée, dans les décimales du sous-jacent.
    /// @return mintedAmount Quantité de token wrappé émise à l'appelant.
    function deposit(
        bytes32 assetId,
        uint256 amount
    ) external whenNotPaused nonReentrant returns (uint256 mintedAmount) {
        return _deposit(assetId, amount, msg.sender);
    }

    /// @notice Identique à `deposit`, mais tire depuis `depositor` et émet vers lui plutôt que
    ///         vers msg.sender.
    /// @dev Réservé à ROUTER_ROLE, détenu par le seul AethyxGateway. C'est ce qui permet au
    ///      Gateway de relayer un dépôt pour le compte de son propre appelant sans jamais
    ///      prendre lui-même la garde du token ERC-3643 : `depositor` doit toujours avoir
    ///      approuvé directement l'adaptateur de l'actif, exactement comme pour un appel
    ///      direct à `deposit`. Un routeur est pleinement présumé ne transmettre ici que son
    ///      propre msg.sender immédiat, jamais une adresse tierce arbitraire — le même niveau
    ///      de confiance que celui déjà accordé aux détenteurs de MINTER_ROLE et FACTORY_ROLE.
    /// @param assetId Actif déposé.
    /// @param amount Quantité déposée, dans les décimales du sous-jacent.
    /// @param depositor Déposant réel, pour le compte de qui le routeur agit.
    /// @return mintedAmount Quantité de token wrappé émise au déposant.
    function depositFor(
        bytes32 assetId,
        uint256 amount,
        address depositor
    ) external whenNotPaused nonReentrant onlyRole(accessManager.ROUTER_ROLE()) returns (uint256 mintedAmount) {
        return _deposit(assetId, amount, depositor);
    }

    /// @notice Brûle `wrappedAmount` du token wrappé de `assetId` détenu par l'appelant et lui
    ///         restitue l'ERC-3643 sous-jacent équivalent, net des frais de rachat. Exige que
    ///         l'appelant ait approuvé ce contrat pour au moins `wrappedAmount`.
    /// @param assetId Actif racheté.
    /// @param wrappedAmount Quantité de token wrappé présentée, frais compris.
    /// @return underlyingAmount Quantité de sous-jacent restituée.
    function redeem(
        bytes32 assetId,
        uint256 wrappedAmount
    ) external whenNotPaused nonReentrant returns (uint256 underlyingAmount) {
        return _redeem(assetId, wrappedAmount, msg.sender);
    }

    /// @notice Identique à `redeem`, mais brûle depuis `redeemer` et restitue vers lui plutôt
    ///         que vers msg.sender. Réservé à ROUTER_ROLE — voir la natspec de `depositFor`.
    /// @param assetId Actif racheté.
    /// @param wrappedAmount Quantité de token wrappé présentée, frais compris.
    /// @param redeemer Racheteur réel, pour le compte de qui le routeur agit.
    /// @return underlyingAmount Quantité de sous-jacent restituée.
    function redeemFor(
        bytes32 assetId,
        uint256 wrappedAmount,
        address redeemer
    ) external whenNotPaused nonReentrant onlyRole(accessManager.ROUTER_ROLE()) returns (uint256 underlyingAmount) {
        return _redeem(assetId, wrappedAmount, redeemer);
    }

    /// @notice Logique partagée par `deposit` et `depositFor`.
    /// @param assetId Actif déposé.
    /// @param amount Quantité déposée, dans les décimales du sous-jacent.
    /// @param depositor Déposant réel.
    /// @return mintedAmount Quantité de token wrappé émise au déposant.
    function _deposit(bytes32 assetId, uint256 amount, address depositor) private returns (uint256 mintedAmount) {
        AssetConfig storage config = assets[assetId];
        if (!config.active) revert AssetNotActive(assetId);

        uint256 normalizedAmount = config.adapter.deposit(depositor, amount);
        uint256 feeAmount = (normalizedAmount * config.depositFeeBps) / BPS_DENOMINATOR;
        mintedAmount = normalizedAmount - feeAmount;

        config.wrappedToken.mint(depositor, mintedAmount);
        // Les frais sont émis vers le Treasury plutôt que retenus sur le collatéral : l'offre
        // wrappée totale reste ainsi exactement égale à ce qui est verrouillé dans
        // l'adaptateur, frais compris, et l'invariant de couverture tient.
        if (feeAmount > 0) config.wrappedToken.mint(treasury, feeAmount);

        emit Deposited(assetId, depositor, amount, mintedAmount, feeAmount);
    }

    /// @notice Logique partagée par `redeem` et `redeemFor`.
    /// @param assetId Actif racheté.
    /// @param wrappedAmount Quantité de token wrappé présentée, frais compris.
    /// @param redeemer Racheteur réel.
    /// @return underlyingAmount Quantité de sous-jacent restituée.
    function _redeem(
        bytes32 assetId,
        uint256 wrappedAmount,
        address redeemer
    ) private returns (uint256 underlyingAmount) {
        AssetConfig storage config = assets[assetId];
        if (!config.active) revert AssetNotActive(assetId);

        uint256 feeAmount = (wrappedAmount * config.redeemFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = wrappedAmount - feeAmount;

        // La part de frais est transférée au Treasury et non brûlée : elle reste adossée au
        // collatéral qui demeure verrouillé dans l'adaptateur. Seule la part nette est brûlée,
        // et c'est exactement elle qui donne lieu à libération de sous-jacent.
        if (feeAmount > 0) config.wrappedToken.safeTransferFrom(redeemer, treasury, feeAmount);
        config.wrappedToken.burnFrom(redeemer, netAmount);

        underlyingAmount = config.adapter.withdraw(redeemer, netAmount);

        emit Redeemed(assetId, redeemer, wrappedAmount, underlyingAmount, feeAmount);
    }

    /// @notice Refuse tout taux de frais supérieur à `MAX_FEE_BPS`.
    /// @param depositFeeBps Frais de dépôt proposés, en points de base.
    /// @param redeemFeeBps Frais de rachat proposés, en points de base.
    function _validateFees(uint16 depositFeeBps, uint16 redeemFeeBps) private pure {
        if (depositFeeBps > MAX_FEE_BPS) revert FeeTooHigh(depositFeeBps);
        if (redeemFeeBps > MAX_FEE_BPS) revert FeeTooHigh(redeemFeeBps);
    }
}
