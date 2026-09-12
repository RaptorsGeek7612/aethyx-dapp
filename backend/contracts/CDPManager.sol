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
///         être intégralement liquidée par n'importe qui : le liquidateur rembourse toute la
///         dette (frais compris) et reçoit tout le collatéral en échange, sa marge étant l'écart
///         de prix entre le seuil de liquidation et le prix réel au moment où il agit.
/// @dev Squelette de première version, volontairement simplifié pour rester lisible avant que
///      l'architecture ne soit validée : ni liquidation partielle ni aux enchères — seule la
///      liquidation totale d'une position est implémentée, sur le même principe que le
///      compromis documenté pour l'échéance des dépôts immobiliers (voir le README, section
///      RealEstateAdapter, et backend/AUDIT.md). Ni module de déploiement Ignition dédié au
///      frais de stabilité, ni câblage frontend à ce stade.
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

    /// @notice Registre des prix consulté pour valoriser chaque collatéral.
    OracleManager public immutable oracleManager;

    /// @notice Stablecoin de dette émis contre le collatéral verrouillé ici.
    StableToken public immutable stableToken;

    /// @notice Destinataire du frais de stabilité accumulé, minté au fil de l'eau.
    address public immutable treasury;

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
    /// @param stabilityFeeBps Frais de stabilité annuel, en points de base.
    /// @param debtCeiling Plafond de dette totale contre ce collatéral.
    event CollateralTypeAdded(
        bytes32 indexed collateralId,
        address indexed wrappedToken,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
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
    /// @param stabilityFeeBps Nouveau frais de stabilité annuel, en points de base.
    /// @param debtCeiling Nouveau plafond de dette totale.
    event CollateralParamsSet(
        bytes32 indexed collateralId,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
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
    /// @param feeAmount Frais réglé, ajouté à la dette de la position et minté au Treasury.
    event StabilityFeeAccrued(address indexed user, bytes32 indexed collateralId, uint256 feeAmount);
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
    ///         voir `backend/AUDIT.md`, constat n°8. Purement informatif : aucun mécanisme ne
    ///         compense aujourd'hui le liquidateur ni ne redistribue ce manque, cet événement est
    ///         le seul signal on-chain qu'une telle liquidation a eu lieu.
    /// @param user Emprunteur dont la position a laissé un manque.
    /// @param collateralId Collatéral concerné.
    /// @param shortfall Écart, en 18 décimales de stablecoin, entre la dette remboursée et la
    ///        valeur du collatéral saisi au prix constaté.
    event BadDebtRealized(address indexed user, bytes32 indexed collateralId, uint256 shortfall);

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
    /// @notice Un frais de stabilité supérieur à 100 % par an a été demandé.
    /// @param stabilityFeeBps Valeur refusée, en points de base.
    error StabilityFeeTooHigh(uint16 stabilityFeeBps);
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
    /// @param stabilityFeeBps Frais de stabilité annuel, en points de base.
    /// @param debtCeiling Plafond de dette totale contre ce collatéral.
    function addCollateralType(
        bytes32 collateralId,
        address wrappedToken,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    ) external onlyRole(accessManager.RISK_MANAGER_ROLE()) {
        if (address(collaterals[collateralId].wrappedToken) != address(0)) {
            revert CollateralAlreadyRegistered(collateralId);
        }
        _validateRiskParams(minCollateralRatioBps, liquidationThresholdBps);
        _validateStabilityFee(stabilityFeeBps);

        collaterals[collateralId] = CollateralConfig({
            wrappedToken: IERC20(wrappedToken),
            minCollateralRatioBps: minCollateralRatioBps,
            liquidationThresholdBps: liquidationThresholdBps,
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
            stabilityFeeBps,
            debtCeiling
        );
    }

    /// @notice Gèle ou réactive un collatéral. Un collatéral gelé refuse toute nouvelle
    ///         ouverture ou augmentation de position ; remboursement et liquidation restent
    ///         possibles sur les positions déjà ouvertes.
    /// @param collateralId Collatéral concerné.
    /// @param active Nouvel état souhaité.
    function setCollateralActive(
        bytes32 collateralId,
        bool active
    ) external onlyRole(accessManager.RISK_MANAGER_ROLE()) {
        collaterals[collateralId].active = active;
        emit CollateralActiveSet(collateralId, active);
    }

    /// @notice Met à jour les paramètres de risque d'un collatéral déjà enregistré.
    /// @param collateralId Collatéral concerné.
    /// @param minCollateralRatioBps Nouveau ratio minimal, en points de base.
    /// @param liquidationThresholdBps Nouveau seuil de liquidation, en points de base.
    /// @param stabilityFeeBps Nouveau frais de stabilité annuel, en points de base.
    /// @param debtCeiling Nouveau plafond de dette totale.
    function setCollateralParams(
        bytes32 collateralId,
        uint16 minCollateralRatioBps,
        uint16 liquidationThresholdBps,
        uint16 stabilityFeeBps,
        uint256 debtCeiling
    ) external onlyRole(accessManager.RISK_MANAGER_ROLE()) {
        _validateRiskParams(minCollateralRatioBps, liquidationThresholdBps);
        _validateStabilityFee(stabilityFeeBps);
        CollateralConfig storage config = collaterals[collateralId];
        config.minCollateralRatioBps = minCollateralRatioBps;
        config.liquidationThresholdBps = liquidationThresholdBps;
        config.stabilityFeeBps = stabilityFeeBps;
        config.debtCeiling = debtCeiling;
        emit CollateralParamsSet(
            collateralId,
            minCollateralRatioBps,
            liquidationThresholdBps,
            stabilityFeeBps,
            debtCeiling
        );
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

    /// @notice Liquide intégralement la position de `user` sur `collateralId` : l'appelant
    ///         rembourse toute la dette due, frais de stabilité accumulé inclus, et reçoit en
    ///         échange tout le collatéral verrouillé. Réservé aux positions passées sous le
    ///         seuil de liquidation du collatéral. Exige que l'appelant ait approuvé ce contrat
    ///         pour au moins la dette due.
    /// @dev Liquidation totale plutôt que partielle ou aux enchères — voir la natspec de
    ///      contrat. La marge du liquidateur est l'écart, au moment où il agit, entre la valeur
    ///      du collatéral reçu et la dette remboursée ; rien ne garantit qu'elle soit positive
    ///      si le prix a chuté d'un coup sous le seuil de liquidation lui-même (dette
    ///      partiellement non couverte, ou "bad debt"). Ce cas n'est pas compensé — voir
    ///      `backend/AUDIT.md`, constat n°8 — mais `BadDebtRealized` le rend au moins visible.
    /// @param user Emprunteur dont la position est liquidée.
    /// @param collateralId Collatéral concerné.
    function liquidate(address user, bytes32 collateralId) external whenNotPaused nonReentrant {
        Position storage position = positions[user][collateralId];
        _settleAccrual(user, collateralId, position);
        if (position.debtAmount == 0) revert NoDebt(user, collateralId);

        uint256 ratioBps = _collateralRatioBps(collateralId, position);
        uint16 liquidationThresholdBps = collaterals[collateralId].liquidationThresholdBps;
        if (ratioBps >= liquidationThresholdBps) {
            revert PositionHealthy(collateralId, ratioBps, liquidationThresholdBps);
        }

        uint256 debtRepaid = position.debtAmount;
        uint256 collateralSeized = position.collateralAmount;

        // Purely observational — see BadDebtRealized's natspec. Computed before any state change
        // below, at the same price `ratioBps` above was already judged against.
        (uint256 price, ) = oracleManager.getPrice(collateralId);
        uint256 collateralValue = (collateralSeized * price) / 1e18;
        if (collateralValue < debtRepaid) {
            emit BadDebtRealized(user, collateralId, debtRepaid - collateralValue);
        }

        position.debtAmount = 0;
        position.collateralAmount = 0;
        collaterals[collateralId].totalDebt -= debtRepaid;

        stableToken.burnFrom(msg.sender, debtRepaid);
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
    ///         l'ajoute à la dette de la position et à la dette totale du collatéral, mint le
    ///         montant correspondant au Treasury, et remet le compteur à l'heure actuelle. Ne
    ///         fait rien au-delà de la mise à jour de l'horodatage si la position n'a aucune
    ///         dette. Appelé en tout premier dans chaque fonction qui lit ou modifie une dette,
    ///         de sorte que ces fonctions n'opèrent jamais que sur une dette à jour.
    /// @param user Titulaire de la position, pour l'événement émis.
    /// @param collateralId Collatéral concerné.
    /// @param position Position à régler.
    function _settleAccrual(address user, bytes32 collateralId, Position storage position) private {
        uint256 currentDebt_ = _currentDebt(collateralId, position);
        uint256 fee = currentDebt_ - position.debtAmount;
        if (fee > 0) {
            position.debtAmount = currentDebt_;
            collaterals[collateralId].totalDebt += fee;
            stableToken.mint(treasury, fee);
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
    ///         strictement sous le ratio minimal, et les deux doivent dépasser 100 %.
    /// @param minCollateralRatioBps Ratio minimal proposé.
    /// @param liquidationThresholdBps Seuil de liquidation proposé.
    function _validateRiskParams(uint16 minCollateralRatioBps, uint16 liquidationThresholdBps) private pure {
        if (liquidationThresholdBps <= BPS_DENOMINATOR || minCollateralRatioBps <= liquidationThresholdBps) {
            revert InvalidRiskParams(minCollateralRatioBps, liquidationThresholdBps);
        }
    }

    /// @notice Refuse tout frais de stabilité annuel supérieur à 100 %.
    /// @param stabilityFeeBps Frais proposé, en points de base.
    function _validateStabilityFee(uint16 stabilityFeeBps) private pure {
        if (stabilityFeeBps > BPS_DENOMINATOR) revert StabilityFeeTooHigh(stabilityFeeBps);
    }
}
