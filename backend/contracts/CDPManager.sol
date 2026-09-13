// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { OracleManager } from "./OracleManager.sol";
import { StableToken } from "./StableToken.sol";

/// @notice Positions de dette collatéralisée (CDP) : un déposant verrouille un token wrappé
///         d'AETHYX (GLD, SLD, RLD...) et emprunte contre lui le stablecoin de dette du
///         protocole, dans la limite d'un ratio de collatéralisation minimal fixé par type de
///         collatéral. La dette accumule un frais de stabilité continu, en points de base par
///         an. Une position dont la valeur du collatéral tombe sous le seuil de liquidation —
///         que ce soit par une chute de prix ou par l'accumulation du frais de stabilité — peut
///         être liquidée, en tout ou partie, par n'importe qui : le liquidateur rembourse tout
///         ou partie de la dette (frais compris) et reçoit en échange une part proportionnelle
///         du collatéral, majorée du bonus de liquidation du collatéral concerné.
/// @dev Liquidation partielle, pas aux enchères : un liquidateur choisit combien de dette
///      rembourser (jusqu'au total dû) et reçoit `collateralAmount * debtToRepay / debtAmount`
///      de collatéral, majoré de `liquidationBonusBps`. Rembourser l'intégralité de la dette
///      reste possible et se comporte comme l'ancienne liquidation totale — c'est le cas
///      particulier `debtToRepay == debtAmount` de la même formule, sans perte d'arrondi.
///      Déployable via `ignition/modules/CDP.ts` (réseau neuf) ou `scripts/deploy-cdp.ts`
///      (retrofit sur un déploiement existant), et câblé côté frontend sur la page `/cdp` — voir
///      backend/AUDIT.md, constats n°8 (fonds d'assurance, voir `insuranceFundFeeBps`) et n°9,
///      pour ce que ça couvre et ce qui reste ouvert malgré ça.
contract CDPManager is AccessManaged, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Configuration d'un type de collatéral enregistré.
    /// @param wrappedToken Token wrappé accepté en collatéral (GLDToken, SLDToken, RLDToken...).
    /// @param minCollateralRatioBps Ratio minimal exigé pour ouvrir ou augmenter une dette, en
    ///        points de base (15 000 = 150 %).
    /// @param liquidationThresholdBps Ratio en dessous duquel une position devient liquidable,
    ///        en points de base. Toujours strictement inférieur à minCollateralRatioBps : c'est
    ///        cet écart qui laisse une marge de sécurité entre "on ne peut plus emprunter
    ///        davantage" et "on peut se faire liquider".
    /// @param stabilityFeeBps Frais de stabilité annuel, en points de base, accumulé en continu
    ///        sur la dette de chaque position (voir `_currentDebt`).
    /// @param liquidationBonusBps Part supplémentaire de collatéral, au-delà de la part
    ///        strictement proportionnelle à la dette remboursée, que reçoit un liquidateur — son
    ///        incitation à agir, et ce qui fait qu'une liquidation partielle rapproche
    ///        effectivement la position de la santé plutôt que de simplement la réduire à
    ///        proportion égale. Plafonné à la valeur du collatéral restant : voir `liquidate`.
    /// @param debtCeiling Dette totale maximale empruntable contre ce collatéral, tous
    ///        emprunteurs confondus.
    /// @param totalDebt Dette totale actuellement due contre ce collatéral, frais de stabilité
    ///        déjà réglés inclus.
    /// @param active Faux si le collatéral est gelé : ouverture et augmentation de position
    ///        sont alors refusées, remboursement et liquidation restent possibles.
    struct CollateralConfig {
        IERC20 wrappedToken;
        uint16 minCollateralRatioBps;
        uint16 liquidationThresholdBps;
        uint16 liquidationBonusBps;
        uint16 stabilityFeeBps;
        uint256 debtCeiling;
        uint256 totalDebt;
        bool active;
    }

    /// @notice Position ouverte par un utilisateur sur un type de collatéral donné.
    /// @param collateralAmount Collatéral verrouillé, en 18 décimales (les tokens wrappés sont
    ///        déjà normalisés par VaultManager, aucune conversion de décimales n'est nécessaire
    ///        ici).
    /// @param debtAmount Dette due au dernier règlement du frais de stabilité, en 18 décimales
    ///        de stablecoin — voir `_currentDebt` pour la dette réellement due à l'instant présent.
    /// @param lastAccrualTimestamp Horodatage du dernier règlement du frais de stabilité.
    struct Position {
        uint256 collateralAmount;
        uint256 debtAmount;
        uint256 lastAccrualTimestamp;
    }

    /// @dev Dénominateur des points de base : 10 000 bps = 100 %.
    uint256 private constant BPS_DENOMINATOR = 10_000;
    /// @dev Base annuelle sur laquelle `stabilityFeeBps` est exprimé.
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    /// @notice Rôle habilité à enregistrer un collatéral et à en ajuster les paramètres de
    ///         risque. Calculé localement plutôt que lu via `accessManager.RISK_MANAGER_ROLE()` :
    ///         la valeur est identique (même chaîne, même `keccak256`), mais un `AccessManager`
    ///         déjà déployé avant l'ajout de ce rôle à son code source n'expose pas ce getter,
    ///         alors que `hasRole`/`grantRole` — hérités d'`AccessControl` — fonctionnent pour
    ///         n'importe quelle valeur `bytes32`, connue de ce contrat ou non. Se fier au getter
    ///         externe rendait CDPManager undeployable contre un tel AccessManager préexistant.
    bytes32 public constant RISK_MANAGER_ROLE = keccak256("RISK_MANAGER_ROLE");

    /// @notice Registre des prix consulté pour valoriser chaque collatéral.
    OracleManager public immutable oracleManager;

    /// @notice Stablecoin de dette émis contre le collatéral verrouillé ici.
    StableToken public immutable stableToken;

    /// @notice Destinataire de la part du frais de stabilité qui n'alimente pas le fonds
    ///         d'assurance, mintée au fil de l'eau — voir `insuranceFundFeeBps`.
    address public immutable treasury;

    /// @notice Part du frais de stabilité affectée au fonds d'assurance plutôt qu'au Treasury, en
    ///         points de base, appliquée uniformément à tous les collatéraux. Zéro par défaut :
    ///         le fonds ne se remplit qu'une fois cette valeur explicitement fixée par
    ///         `setInsuranceFundFeeBps`. Voir `backend/AUDIT.md`, constat n°8.
    uint16 public insuranceFundFeeBps;

    /// @notice Solde du fonds d'assurance, en 18 décimales de stablecoin, détenu par ce contrat
    ///         lui-même. Alimenté par `_settleAccrual`, mobilisé par `liquidate` pour compléter
    ///         un liquidateur dont le collatéral reçu ne couvre pas la dette remboursée.
    uint256 public insuranceFundBalance;

    /// @notice Registre des types de collatéral, indexé par identifiant.
    /// @dev Réutilise volontairement les mêmes identifiants que VaultManager/OracleManager
    ///      (ex. "GOLD", "REAL_ESTATE_PARIS_01_V6") plutôt que d'introduire un espace de noms
    ///      séparé : la valorisation d'ici interroge `oracleManager.getPrice(collateralId)`
    ///      directement avec cet identifiant. Voir la mise en garde dans `addCollateralType`.
    mapping(bytes32 collateralId => CollateralConfig config) public collaterals;

    /// @notice Positions ouvertes, indexées par emprunteur puis par collatéral.
    mapping(address user => mapping(bytes32 collateralId => Position position)) public positions;

    /// @notice Émis lorsqu'un nouveau type de collatéral est enregistré.
    /// @param collateralId Identifiant du collatéral, partagé avec VaultManager/OracleManager.
    /// @param wrappedToken Token wrappé accepté en collatéral.
    /// @param minCollateralRatioBps Ratio minimal à l'émission, en points de base.
    /// @param liquidationThresholdBps Seuil de liquidation, en points de base.
    /// @param liquidationBonusBps Bonus de liquidation, en points de base.
    /// @param stabilityFeeBps Frais de stabilité annuel, en points de base.
    /// @param debtCeiling Plafond de dette totale contre ce collatéral.
    event CollateralTypeAdded(
        bytes32 indexed collateralId,
        address indexed wrappedToken,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    );
    /// @notice Émis lorsqu'un collatéral est gelé ou réactivé.
    /// @param collateralId Collatéral concerné.
    /// @param active Nouvel état.
    event CollateralActiveSet(bytes32 indexed collateralId, bool active);
    /// @notice Émis lorsque les paramètres de risque d'un collatéral changent.
    /// @param collateralId Collatéral concerné.
    /// @param minCollateralRatioBps Nouveau ratio minimal, en points de base.
    /// @param liquidationThresholdBps Nouveau seuil de liquidation, en points de base.
    /// @param liquidationBonusBps Nouveau bonus de liquidation, en points de base.
    /// @param stabilityFeeBps Nouveau frais de stabilité annuel, en points de base.
    /// @param debtCeiling Nouveau plafond de dette totale.
    event CollateralParamsSet(
        bytes32 indexed collateralId,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    );
    /// @notice Émis à chaque dépôt de collatéral.
    /// @param user Déposant.
    /// @param collateralId Collatéral déposé.
    /// @param amount Quantité déposée, en 18 décimales.
    event CollateralDeposited(address indexed user, bytes32 indexed collateralId, uint256 amount);
    /// @notice Émis à chaque retrait de collatéral.
    /// @param user Emprunteur.
    /// @param collateralId Collatéral retiré.
    /// @param amount Quantité retirée, en 18 décimales.
    event CollateralWithdrawn(address indexed user, bytes32 indexed collateralId, uint256 amount);
    /// @notice Émis à chaque émission de dette.
    /// @param user Emprunteur.
    /// @param collateralId Collatéral garantissant la dette émise.
    /// @param amount Quantité de stablecoin émise, en 18 décimales.
    event DebtMinted(address indexed user, bytes32 indexed collateralId, uint256 amount);
    /// @notice Émis à chaque remboursement de dette.
    /// @param user Emprunteur.
    /// @param collateralId Collatéral concerné.
    /// @param amount Quantité de stablecoin remboursée, en 18 décimales.
    event DebtRepaid(address indexed user, bytes32 indexed collateralId, uint256 amount);
    /// @notice Émis chaque fois que le frais de stabilité accumulé depuis le dernier règlement
    ///         est réglé sur une position — à chaque dépôt, retrait, emprunt, remboursement ou
    ///         liquidation la concernant.
    /// @param user Emprunteur dont la position accumule le frais.
    /// @param collateralId Collatéral concerné.
    /// @param feeAmount Frais réglé, ajouté à la dette de la position et réparti entre le
    ///        Treasury et le fonds d'assurance selon `insuranceFundFeeBps` — voir
    ///        `InsuranceFundFunded` pour la part qui va au fonds.
    event StabilityFeeAccrued(address indexed user, bytes32 indexed collateralId, uint256 feeAmount);
    /// @notice Émis lorsque `insuranceFundFeeBps` change.
    /// @param insuranceFundFeeBps Nouvelle part du frais de stabilité affectée au fonds, en
    ///        points de base.
    event InsuranceFundFeeBpsSet(uint16 insuranceFundFeeBps);
    /// @notice Émis chaque fois qu'un règlement de frais de stabilité alimente le fonds
    ///         d'assurance — la part de `StabilityFeeAccrued` régie par `insuranceFundFeeBps`.
    /// @param collateralId Collatéral dont l'accumulation a alimenté le fonds.
    /// @param amount Montant minté au fonds, en 18 décimales de stablecoin.
    event InsuranceFundFunded(bytes32 indexed collateralId, uint256 amount);
    /// @notice Émis lorsqu'une position est liquidée.
    /// @param user Emprunteur liquidé.
    /// @param collateralId Collatéral concerné.
    /// @param liquidator Adresse ayant déclenché la liquidation et remboursé la dette.
    /// @param debtRepaid Dette totale remboursée par le liquidateur, frais de stabilité inclus.
    /// @param collateralSeized Collatéral total transféré au liquidateur.
    event PositionLiquidated(
        address indexed user,
        bytes32 indexed collateralId,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralSeized
    );
    /// @notice Émis en plus de `PositionLiquidated` lorsque le collatéral saisi valait, au prix
    ///         constaté au moment de la liquidation, moins que la dette qu'il vient de couvrir —
    ///         voir `backend/AUDIT.md`, constat n°8. Le fonds d'assurance comble jusqu'à
    ///         `coveredByInsuranceFund` de cet écart au profit du liquidateur, dans la limite de
    ///         son solde ; `shortfall - coveredByInsuranceFund` reste à sa charge.
    /// @param user Emprunteur dont la position a laissé un manque.
    /// @param collateralId Collatéral concerné.
    /// @param shortfall Écart total, en 18 décimales de stablecoin, entre la dette remboursée et
    ///        la valeur du collatéral saisi au prix constaté.
    /// @param coveredByInsuranceFund Part de `shortfall` compensée au liquidateur depuis le fonds
    ///        d'assurance.
    event BadDebtRealized(
        address indexed user,
        bytes32 indexed collateralId,
        uint256 shortfall,
        uint256 coveredByInsuranceFund
    );

    /// @notice Le collatéral est inconnu ou gelé.
    /// @param collateralId Collatéral concerné.
    error CollateralNotActive(bytes32 collateralId);
    /// @notice Cet identifiant de collatéral est déjà pris.
    /// @param collateralId Identifiant déjà enregistré.
    error CollateralAlreadyRegistered(bytes32 collateralId);
    /// @notice Le seuil de liquidation proposé n'est pas strictement inférieur au ratio minimal,
    ///         ou l'un des deux ne dépasse pas 100 %.
    /// @param minCollateralRatioBps Ratio minimal proposé.
    /// @param liquidationThresholdBps Seuil de liquidation proposé.
    error InvalidRiskParams(uint16 minCollateralRatioBps, uint16 liquidationThresholdBps);
    /// @notice Le bonus de liquidation proposé ferait dépasser 100 % de collatéral supplémentaire,
    ///         ou rendrait le seuil de liquidation majoré du bonus supérieur au ratio minimal —
    ///         une position tout juste sous le seuil de liquidation ne pourrait alors jamais
    ///         couvrir le bonus promis, même avant toute perte de valeur du collatéral.
    /// @param liquidationBonusBps Bonus proposé, en points de base.
    error InvalidLiquidationBonus(uint16 liquidationBonusBps);
    /// @notice La liquidation demande de rembourser zéro dette, ou plus que la dette due.
    /// @param debtToRepay Montant demandé.
    /// @param debtAmount Dette due.
    error InvalidLiquidationAmount(uint256 debtToRepay, uint256 debtAmount);
    /// @notice Un frais de stabilité supérieur à 100 % par an a été demandé.
    /// @param stabilityFeeBps Valeur refusée, en points de base.
    error StabilityFeeTooHigh(uint16 stabilityFeeBps);
    /// @notice Une part du frais de stabilité supérieure à 100 % a été demandée pour le fonds
    ///         d'assurance.
    /// @param insuranceFundFeeBps Valeur refusée, en points de base.
    error InsuranceFundFeeTooHigh(uint16 insuranceFundFeeBps);
    /// @notice Le plafond de dette du collatéral serait dépassé.
    /// @param collateralId Collatéral concerné.
    /// @param wouldBeTotalDebt Dette totale qui résulterait de l'opération.
    /// @param debtCeiling Plafond en vigueur.
    error DebtCeilingExceeded(bytes32 collateralId, uint256 wouldBeTotalDebt, uint256 debtCeiling);
    /// @notice L'opération ferait tomber la position sous son ratio minimal.
    /// @param collateralId Collatéral concerné.
    /// @param wouldBeRatioBps Ratio qui résulterait de l'opération.
    /// @param minCollateralRatioBps Ratio minimal exigé.
    error RatioTooLow(bytes32 collateralId, uint256 wouldBeRatioBps, uint256 minCollateralRatioBps);
    /// @notice Le retrait ou le remboursement demandé dépasse ce que la position détient.
    /// @param available Quantité disponible.
    /// @param requested Quantité demandée.
    error InsufficientPosition(uint256 available, uint256 requested);
    /// @notice La position ciblée est encore au-dessus de son seuil de liquidation.
    /// @param collateralId Collatéral concerné.
    /// @param ratioBps Ratio actuel de la position.
    /// @param liquidationThresholdBps Seuil de liquidation en vigueur.
    error PositionHealthy(bytes32 collateralId, uint256 ratioBps, uint256 liquidationThresholdBps);
    /// @notice La position ciblée n'a aucune dette à liquider.
    /// @param user Emprunteur ciblé.
    /// @param collateralId Collatéral concerné.
    error NoDebt(address user, bytes32 collateralId);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param oracleManager_ Registre de prix consulté pour valoriser les collatéraux.
    /// @param stableToken_ Stablecoin de dette émis et brûlé par ce contrat.
    /// @param treasury_ Destinataire du frais de stabilité accumulé.
    constructor(
        address accessManager_,
        address oracleManager_,
        address stableToken_,
        address treasury_
    ) AccessManaged(accessManager_) {
        oracleManager = OracleManager(oracleManager_);
        stableToken = StableToken(stableToken_);
        treasury = treasury_;
    }

    /// @notice Enregistre un nouveau type de collatéral.
    /// @dev `collateralId` doit être le même identifiant que celui sous lequel le prix de ce
    ///      collatéral est enregistré dans `oracleManager`, et ce prix doit être libellé dans le
    ///      même étalon que la parité nominale du stablecoin — exactement le piège documenté
    ///      dans le README pour GOLD (euros par gramme) contre GOLD_USD_OZ (dollars par once) :
    ///      enregistrer ici un identifiant dont le prix n'est pas dans le bon étalon surdimensionnerait
    ///      ou sous-dimensionnerait silencieusement toutes les positions ouvertes dessus.
    /// @param collateralId Identifiant du collatéral, partagé avec VaultManager/OracleManager.
    /// @param wrappedToken Token wrappé accepté en collatéral.
    /// @param minCollateralRatioBps Ratio minimal à l'émission, en points de base.
    /// @param liquidationThresholdBps Seuil de liquidation, en points de base.
    /// @param liquidationBonusBps Bonus de liquidation, en points de base.
    /// @param stabilityFeeBps Frais de stabilité annuel, en points de base.
    /// @param debtCeiling Plafond de dette totale contre ce collatéral.
    function addCollateralType(
        bytes32 collateralId,
        address wrappedToken,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    ) external onlyRole(RISK_MANAGER_ROLE) {
        if (address(collaterals[collateralId].wrappedToken) != address(0)) {
            revert CollateralAlreadyRegistered(collateralId);
        }
        _validateRiskParams(minCollateralRatioBps, liquidationThresholdBps, liquidationBonusBps);
        _validateStabilityFee(stabilityFeeBps);

        collaterals[collateralId] = CollateralConfig({
            wrappedToken: IERC20(wrappedToken),
            minCollateralRatioBps: minCollateralRatioBps,
            liquidationThresholdBps: liquidationThresholdBps,
            liquidationBonusBps: liquidationBonusBps,
            stabilityFeeBps: stabilityFeeBps,
            debtCeiling: debtCeiling,
            totalDebt: 0,
            active: true
        });
        emit CollateralTypeAdded(
            collateralId,
            wrappedToken,
            minCollateralRatioBps,
            liquidationThresholdBps,
            liquidationBonusBps,
            stabilityFeeBps,
            debtCeiling
        );
    }

    /// @notice Gèle ou réactive un collatéral. Un collatéral gelé refuse toute nouvelle
    ///         ouverture ou augmentation de position ; remboursement et liquidation restent
    ///         possibles sur les positions déjà ouvertes.
    /// @param collateralId Collatéral concerné.
    /// @param active Nouvel état souhaité.
    function setCollateralActive(bytes32 collateralId, bool active) external onlyRole(RISK_MANAGER_ROLE) {
        collaterals[collateralId].active = active;
        emit CollateralActiveSet(collateralId, active);
    }

    /// @notice Met à jour les paramètres de risque d'un collatéral déjà enregistré.
    /// @param collateralId Collatéral concerné.
    /// @param minCollateralRatioBps Nouveau ratio minimal, en points de base.
    /// @param liquidationThresholdBps Nouveau seuil de liquidation, en points de base.
    /// @param liquidationBonusBps Nouveau bonus de liquidation, en points de base.
    /// @param stabilityFeeBps Nouveau frais de stabilité annuel, en points de base.
    /// @param debtCeiling Nouveau plafond de dette totale.
    function setCollateralParams(
        bytes32 collateralId,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    ) external onlyRole(RISK_MANAGER_ROLE) {
        _validateRiskParams(minCollateralRatioBps, liquidationThresholdBps, liquidationBonusBps);
        _validateStabilityFee(stabilityFeeBps);
        CollateralConfig storage config = collaterals[collateralId];
        config.minCollateralRatioBps = minCollateralRatioBps;
        config.liquidationThresholdBps = liquidationThresholdBps;
        config.liquidationBonusBps = liquidationBonusBps;
        config.stabilityFeeBps = stabilityFeeBps;
        config.debtCeiling = debtCeiling;
        emit CollateralParamsSet(
            collateralId,
            minCollateralRatioBps,
            liquidationThresholdBps,
            liquidationBonusBps,
            stabilityFeeBps,
            debtCeiling
        );
    }

    /// @notice Fixe la part du frais de stabilité affectée au fonds d'assurance plutôt qu'au
    ///         Treasury, en points de base. S'applique à toute accumulation future sur tous les
    ///         collatéraux — voir `_settleAccrual` et `backend/AUDIT.md`, constat n°8.
    /// @param insuranceFundFeeBps_ Nouvelle part, en points de base (10 000 = 100 % du frais).
    function setInsuranceFundFeeBps(uint16 insuranceFundFeeBps_) external onlyRole(RISK_MANAGER_ROLE) {
        if (insuranceFundFeeBps_ > BPS_DENOMINATOR) revert InsuranceFundFeeTooHigh(insuranceFundFeeBps_);
        insuranceFundFeeBps = insuranceFundFeeBps_;
        emit InsuranceFundFeeBpsSet(insuranceFundFeeBps_);
    }

    /// @notice Suspend dépôt, retrait, émission et remboursement sur tous les collatéraux.
    function pause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _pause();
    }

    /// @notice Lève la suspension posée par `pause`.
    function unpause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _unpause();
    }

    /// @notice Verrouille `amount` du token wrappé de `collateralId` dans la position de
    ///         l'appelant. Exige que l'appelant ait approuvé ce contrat pour au moins `amount`.
    /// @param collateralId Collatéral déposé.
    /// @param amount Quantité déposée, en 18 décimales.
    function depositCollateral(bytes32 collateralId, uint256 amount) external whenNotPaused nonReentrant {
        CollateralConfig storage config = collaterals[collateralId];
        if (!config.active) revert CollateralNotActive(collateralId);

        Position storage position = positions[msg.sender][collateralId];
        _settleAccrual(msg.sender, collateralId, position);

        config.wrappedToken.safeTransferFrom(msg.sender, address(this), amount);
        position.collateralAmount += amount;

        emit CollateralDeposited(msg.sender, collateralId, amount);
    }

    /// @notice Retire `amount` du collatéral de la position de l'appelant, à condition que ce
    ///         qui reste couvre toujours sa dette au ratio minimal du collatéral.
    /// @param collateralId Collatéral retiré.
    /// @param amount Quantité retirée, en 18 décimales.
    function withdrawCollateral(bytes32 collateralId, uint256 amount) external whenNotPaused nonReentrant {
        Position storage position = positions[msg.sender][collateralId];
        _settleAccrual(msg.sender, collateralId, position);
        if (amount > position.collateralAmount) revert InsufficientPosition(position.collateralAmount, amount);

        position.collateralAmount -= amount;
        _requireHealthy(collateralId, position, collaterals[collateralId].minCollateralRatioBps);

        collaterals[collateralId].wrappedToken.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, collateralId, amount);
    }

    /// @notice Emprunte `amount` de stablecoin contre le collatéral déjà verrouillé par
    ///         l'appelant sur `collateralId`.
    /// @param collateralId Collatéral garantissant l'emprunt.
    /// @param amount Quantité de stablecoin à émettre, en 18 décimales.
    function mintDebt(bytes32 collateralId, uint256 amount) external whenNotPaused nonReentrant {
        CollateralConfig storage config = collaterals[collateralId];
        if (!config.active) revert CollateralNotActive(collateralId);

        Position storage position = positions[msg.sender][collateralId];
        _settleAccrual(msg.sender, collateralId, position);

        position.debtAmount += amount;
        _requireHealthy(collateralId, position, config.minCollateralRatioBps);

        uint256 wouldBeTotalDebt = config.totalDebt + amount;
        if (wouldBeTotalDebt > config.debtCeiling) {
            revert DebtCeilingExceeded(collateralId, wouldBeTotalDebt, config.debtCeiling);
        }
        config.totalDebt = wouldBeTotalDebt;

        stableToken.mint(msg.sender, amount);

        emit DebtMinted(msg.sender, collateralId, amount);
    }

    /// @notice Rembourse `amount` de la dette de l'appelant sur `collateralId`, frais de
    ///         stabilité accumulé inclus. Exige que l'appelant ait approuvé ce contrat pour au
    ///         moins `amount` de stablecoin.
    /// @param collateralId Collatéral concerné.
    /// @param amount Quantité de stablecoin remboursée, en 18 décimales.
    function repayDebt(bytes32 collateralId, uint256 amount) external whenNotPaused nonReentrant {
        Position storage position = positions[msg.sender][collateralId];
        _settleAccrual(msg.sender, collateralId, position);
        if (amount > position.debtAmount) revert InsufficientPosition(position.debtAmount, amount);

        position.debtAmount -= amount;
        collaterals[collateralId].totalDebt -= amount;

        stableToken.burnFrom(msg.sender, amount);

        emit DebtRepaid(msg.sender, collateralId, amount);
    }

    /// @notice Liquide tout ou partie de la position de `user` sur `collateralId` : l'appelant
    ///         rembourse `debtToRepay` (jusqu'à la dette due, frais de stabilité accumulé inclus)
    ///         et reçoit en échange la part de collatéral proportionnelle, majorée du bonus de
    ///         liquidation du collatéral. Réservé aux positions passées sous le seuil de
    ///         liquidation. Exige que l'appelant ait approuvé ce contrat pour au moins
    ///         `debtToRepay`.
    /// @dev Liquidation partielle, pas aux enchères. `debtToRepay == debtAmount` (liquidation
    ///      totale) est le cas particulier de la même formule proportionnelle et ne perd rien à
    ///      l'arrondi : `collateralAmount * debtAmount / debtAmount == collateralAmount` exactement.
    ///      Le bonus est plafonné au collatéral réellement disponible — une position dont la
    ///      valeur du collatéral ne couvre déjà plus la dette (avant même le bonus) donne tout ce
    ///      qui reste, et le manque, bonus compris, tombe dans le fonds d'assurance dans la limite
    ///      de son solde. `BadDebtRealized` rend visible ce qui, au-delà, reste à la charge du
    ///      liquidateur. Voir `backend/AUDIT.md`, constat n°8.
    /// @param user Emprunteur dont la position est liquidée.
    /// @param collateralId Collatéral concerné.
    /// @param debtToRepay Dette à rembourser, en 18 décimales — jusqu'à la dette due.
    function liquidate(address user, bytes32 collateralId, uint256 debtToRepay) external whenNotPaused nonReentrant {
        Position storage position = positions[user][collateralId];
        _settleAccrual(user, collateralId, position);
        if (position.debtAmount == 0) revert NoDebt(user, collateralId);

        uint256 ratioBps = _collateralRatioBps(collateralId, position);
        uint16 liquidationThresholdBps = collaterals[collateralId].liquidationThresholdBps;
        if (ratioBps >= liquidationThresholdBps) {
            revert PositionHealthy(collateralId, ratioBps, liquidationThresholdBps);
        }
        if (debtToRepay == 0 || debtToRepay > position.debtAmount) {
            revert InvalidLiquidationAmount(debtToRepay, position.debtAmount);
        }

        uint256 debtRepaid = debtToRepay;
        // Proportional share of the position's collateral for the debt actually being repaid,
        // majorée du bonus. Capped at what the position actually still holds: a deeply underwater
        // position can't hand out more collateral than it has, bonus or not.
        uint256 collateralSeized = (position.collateralAmount * debtRepaid) / position.debtAmount;
        collateralSeized += (collateralSeized * collaterals[collateralId].liquidationBonusBps) / BPS_DENOMINATOR;
        if (collateralSeized > position.collateralAmount) {
            collateralSeized = position.collateralAmount;
        }

        // Computed before any state change below, at the same price `ratioBps` above was already
        // judged against.
        (uint256 price, ) = oracleManager.getPrice(collateralId);
        uint256 collateralValue = (collateralSeized * price) / 1e18;

        uint256 coveredByInsuranceFund = 0;
        if (collateralValue < debtRepaid) {
            uint256 shortfall = debtRepaid - collateralValue;
            coveredByInsuranceFund = shortfall < insuranceFundBalance ? shortfall : insuranceFundBalance;
            if (coveredByInsuranceFund > 0) {
                insuranceFundBalance -= coveredByInsuranceFund;
            }
            emit BadDebtRealized(user, collateralId, shortfall, coveredByInsuranceFund);
        }

        position.debtAmount -= debtRepaid;
        position.collateralAmount -= collateralSeized;
        collaterals[collateralId].totalDebt -= debtRepaid;

        stableToken.burnFrom(msg.sender, debtRepaid);
        if (coveredByInsuranceFund > 0) {
            stableToken.transfer(msg.sender, coveredByInsuranceFund);
        }
        collaterals[collateralId].wrappedToken.safeTransfer(msg.sender, collateralSeized);

        emit PositionLiquidated(user, collateralId, msg.sender, debtRepaid, collateralSeized);
    }

    /// @notice Ratio de collatéralisation actuel d'une position, frais de stabilité accumulé
    ///         depuis le dernier règlement inclus, en points de base.
    /// @param user Emprunteur.
    /// @param collateralId Collatéral concerné.
    /// @return Ratio en points de base, ou `type(uint256).max` si la position n'a aucune dette.
    function collateralRatioBps(address user, bytes32 collateralId) external view returns (uint256) {
        return _collateralRatioBps(collateralId, positions[user][collateralId]);
    }

    /// @notice Dette actuellement due par une position, frais de stabilité accumulé depuis le
    ///         dernier règlement inclus — sans muter l'état, contrairement à `_settleAccrual`.
    /// @param user Emprunteur.
    /// @param collateralId Collatéral concerné.
    /// @return Dette due à l'instant présent, en 18 décimales.
    function currentDebt(address user, bytes32 collateralId) external view returns (uint256) {
        return _currentDebt(collateralId, positions[user][collateralId]);
    }

    /// @notice Règle le frais de stabilité accumulé depuis `position.lastAccrualTimestamp` :
    ///         l'ajoute à la dette de la position et à la dette totale du collatéral, mint la
    ///         part `insuranceFundFeeBps` au fonds d'assurance et le reste au Treasury, et remet
    ///         le compteur à l'heure actuelle. Ne fait rien au-delà de la mise à jour de
    ///         l'horodatage si la position n'a aucune dette. Appelé en tout premier dans chaque
    ///         fonction qui lit ou modifie une dette, de sorte que ces fonctions n'opèrent jamais
    ///         que sur une dette à jour.
    /// @param user Titulaire de la position, pour l'événement émis.
    /// @param collateralId Collatéral concerné.
    /// @param position Position à régler.
    function _settleAccrual(address user, bytes32 collateralId, Position storage position) private {
        uint256 currentDebt_ = _currentDebt(collateralId, position);
        uint256 fee = currentDebt_ - position.debtAmount;
        if (fee > 0) {
            position.debtAmount = currentDebt_;
            collaterals[collateralId].totalDebt += fee;

            uint256 toFund = (fee * insuranceFundFeeBps) / BPS_DENOMINATOR;
            uint256 toTreasury = fee - toFund;
            if (toFund > 0) {
                stableToken.mint(address(this), toFund);
                insuranceFundBalance += toFund;
                emit InsuranceFundFunded(collateralId, toFund);
            }
            if (toTreasury > 0) {
                stableToken.mint(treasury, toTreasury);
            }
            emit StabilityFeeAccrued(user, collateralId, fee);
        }
        position.lastAccrualTimestamp = block.timestamp;
    }

    /// @notice Calcule la dette d'une position à l'instant présent, frais de stabilité couru
    ///         depuis `position.lastAccrualTimestamp` inclus, sans muter l'état.
    /// @dev Intérêt simple, non composé : le frais court linéairement sur `debtAmount` tel qu'il
    ///      était au dernier règlement, plutôt que de composer en continu. Plus simple à auditer
    ///      qu'un index de taux à la Maker, au prix d'un frais légèrement sous-estimé sur une
    ///      position qui resterait très longtemps sans être touchée.
    /// @param collateralId Collatéral concerné.
    /// @param position Position dont on calcule la dette.
    /// @return Dette due à l'instant présent, en 18 décimales.
    function _currentDebt(bytes32 collateralId, Position storage position) private view returns (uint256) {
        if (position.debtAmount == 0) return 0;
        uint256 elapsed = block.timestamp - position.lastAccrualTimestamp;
        if (elapsed == 0) return position.debtAmount;
        uint16 stabilityFeeBps = collaterals[collateralId].stabilityFeeBps;
        uint256 fee = (position.debtAmount * stabilityFeeBps * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return position.debtAmount + fee;
    }

    /// @notice Revert si, compte tenu de son état actuel, `position` ne couvre pas sa dette au
    ///         ratio `requiredRatioBps`. Ne fait rien si la position n'a aucune dette : un
    ///         collatéral non emprunté n'a pas besoin d'être couvert.
    /// @param collateralId Collatéral concerné.
    /// @param position Position à vérifier.
    /// @param requiredRatioBps Ratio minimal exigé, en points de base.
    function _requireHealthy(bytes32 collateralId, Position storage position, uint16 requiredRatioBps) private view {
        if (position.debtAmount == 0) return;
        uint256 ratioBps = _collateralRatioBps(collateralId, position);
        if (ratioBps < requiredRatioBps) revert RatioTooLow(collateralId, ratioBps, requiredRatioBps);
    }

    /// @notice Calcule le ratio de collatéralisation d'une position, dette actuelle
    ///         (`_currentDebt`) incluse.
    /// @param collateralId Collatéral concerné, transmis tel quel à `oracleManager.getPrice`.
    /// @param position Position dont on calcule le ratio.
    /// @return Ratio en points de base, ou `type(uint256).max` si la position n'a aucune dette.
    function _collateralRatioBps(bytes32 collateralId, Position storage position) private view returns (uint256) {
        uint256 debt = _currentDebt(collateralId, position);
        if (debt == 0) return type(uint256).max;
        (uint256 price, ) = oracleManager.getPrice(collateralId);
        uint256 collateralValue = (position.collateralAmount * price) / 1e18;
        return (collateralValue * BPS_DENOMINATOR) / debt;
    }

    /// @notice Refuse des paramètres de risque incohérents : le seuil de liquidation doit rester
    ///         strictement sous le ratio minimal, les deux doivent dépasser 100 %, et le bonus de
    ///         liquidation ne doit pas dépasser 100 % ni faire dépasser au seuil de liquidation
    ///         majoré du bonus le ratio minimal lui-même — sans quoi une position tout juste sous
    ///         le seuil ne pourrait jamais couvrir le bonus promis, même avant toute chute de prix.
    /// @param minCollateralRatioBps Ratio minimal proposé.
    /// @param liquidationThresholdBps Seuil de liquidation proposé.
    /// @param liquidationBonusBps Bonus de liquidation proposé.
    function _validateRiskParams(
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps
    ) private pure {
        if (liquidationThresholdBps <= BPS_DENOMINATOR || minCollateralRatioBps <= liquidationThresholdBps) {
            revert InvalidRiskParams(minCollateralRatioBps, liquidationThresholdBps);
        }
        uint256 thresholdWithBonus =
            uint256(liquidationThresholdBps) +
                (uint256(liquidationThresholdBps) * liquidationBonusBps) / BPS_DENOMINATOR;
        if (liquidationBonusBps > BPS_DENOMINATOR || thresholdWithBonus > minCollateralRatioBps) {
            revert InvalidLiquidationBonus(liquidationBonusBps);
        }
    }

    /// @notice Refuse tout frais de stabilité annuel supérieur à 100 %.
    /// @param stabilityFeeBps Frais proposé, en points de base.
    function _validateStabilityFee(uint16 stabilityFeeBps) private pure {
        if (stabilityFeeBps > BPS_DENOMINATOR) revert StabilityFeeTooHigh(stabilityFeeBps);
    }
}
