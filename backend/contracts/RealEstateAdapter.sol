// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token immobilier ERC-3643 fractionné. Ajoute une durée
///         de détention minimale avant rachat : le règlement d'une opération immobilière
///         (transfert de propriété, traitement notarial...) prend un temps réel, contrairement
///         à un actif purement numérique que l'on peut wrapper et dé-wrapper dans le même bloc.
/// @dev Le blocage est suivi par adresse `from`/`to`. C'est sûr pour un état propre à chaque
///      déposant même lorsque l'appel transite par InvestOrGateway : les depositFor/redeemFor
///      de VaultManager transmettent toujours l'appelant du Gateway, jamais l'adresse du
///      Gateway lui-même, si bien que cet adaptateur voit toujours l'utilisateur final réel —
///      voir VaultManager.sol et InvestOrGateway.sol.
/// @dev La durée de blocage n'est pas un choix laissé au déposant : `lockupPeriod` est
///      immuable, fixée une fois pour toutes au déploiement du marché. C'est la façon dont un
///      protocole DeFi exprime normalement une période de détention — une propriété du contrat
///      dans lequel on dépose, et non un paramètre de son dépôt. Une interface peut la lire et
///      l'afficher, elle n'a pas à la proposer.
contract RealEstateAdapter is AssetAdapter {
    /// @notice Le blocage propre à un dépôt. Chaque dépôt arrive à échéance selon son propre
    ///         calendrier ; un dépôt ultérieur ne repousse jamais un dépôt antérieur (la
    ///         conception précédente stockait un unique `lockedUntil` par adresse et l'écrasait
    ///         à chaque dépôt, de sorte qu'abonder une position presque arrivée à échéance la
    ///         reverrouillait intégralement pour une nouvelle période complète).
    /// @param amount Quantité bloquée, en 18 décimales canoniques.
    /// @param unlockAt Horodatage auquel cette tranche arrive à échéance.
    struct Lock {
        uint256 amount;
        uint256 unlockAt;
    }

    /// @notice Durée de détention imposée à chaque dépôt, en secondes. Immuable : c'est le
    ///         marché qui porte la durée, pas le dépôt.
    uint256 public immutable lockupPeriod;

    /// @dev En ajout seul, par déposant. `lockupPeriod` étant immuable, `unlockAt` est
    ///      croissant le long de ce tableau : les échéances peuvent donc être balayées par
    ///      l'avant et le balayage s'arrêter à la première entrée encore bloquée — aucun
    ///      parcours de l'historique complet.
    mapping(address depositor => Lock[]) private _locks;
    /// @dev Indice de la première entrée pas encore échue dans `_locks[depositor]` ; tout ce
    ///      qui la précède a déjà été balayé vers `maturedAmount` et n'est jamais revisité.
    mapping(address depositor => uint256 cursor) private _cursor;

    /// @notice Montant déposé (18 décimales canoniques) dont le blocage propre n'a pas encore
    ///         expiré, tel qu'au dernier balayage. Préférer `lockedAmountOf` pour un chiffre
    ///         à jour.
    mapping(address depositor => uint256) public lockedAmount;
    /// @notice Montant déposé (18 décimales canoniques) dont le blocage a expiré et qui n'a
    ///         pas encore été racheté. Préférer `maturedAmountOf` pour un chiffre à jour.
    mapping(address depositor => uint256) public maturedAmount;

    /// @notice Le rachat porte sur plus que ce qui est arrivé à échéance.
    /// @param account Compte dont le rachat est refusé.
    /// @param requested Montant normalisé que la demande de rachat voulait libérer.
    /// @param available Part des dépôts de `account` échue et non encore rachetée.
    /// @param nextUnlockAt Échéance de la tranche suivante, pour qu'un appelant puisse indiquer
    ///        combien de temps attendre.
    error StillLocked(address account, uint256 requested, uint256 available, uint256 nextUnlockAt);

    /// @param underlying_ Token immobilier ERC-3643 à prendre en garde.
    /// @param vaultManager_ VaultManager autorisé à piloter cet adaptateur.
    /// @param assetId_ Identifiant de l'actif dans le registre de VaultManager.
    /// @param lockupPeriod_ Durée de détention imposée, en secondes, figée pour ce marché.
    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_,
        uint256 lockupPeriod_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {
        lockupPeriod = lockupPeriod_;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Enregistre en plus une tranche de blocage propre à ce dépôt.
    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        normalizedAmount = super.deposit(from, amount);
        _locks[from].push(Lock({ amount: normalizedAmount, unlockAt: block.timestamp + lockupPeriod }));
        lockedAmount[from] += normalizedAmount;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Plafonne la libération à ce qui est arrivé à échéance, au lieu d'un refus global.
    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        _sweepMatured(to);

        uint256 matured = maturedAmount[to];
        // Un détenteur qui n'a rien de bloqué n'est soumis à aucune restriction : les tokens
        // wrappés sont librement transférables, donc qui les a acquis sur le marché secondaire
        // n'a jamais déposé ici et n'a aucun blocage propre à purger. Le blocage ne retient
        // jamais que les tranches non échues du déposant lui-même — jamais le rachat d'autrui.
        if (lockedAmount[to] > 0 && normalizedAmount > matured) {
            revert StillLocked(to, normalizedAmount, matured, nextUnlockAt(to));
        }

        // Saturant : un rachat peut légitimement dépasser le crédit (tokens achetés sur le
        // marché secondaire en plus de ses propres dépôts échus), et l'excédent n'est pas suivi.
        maturedAmount[to] = matured > normalizedAmount ? matured - normalizedAmount : 0;

        return super.withdraw(to, normalizedAmount);
    }

    /// @notice Dépôts de `depositor` encore dans leur propre période de blocage, à l'instant.
    /// @param depositor Déposant interrogé.
    /// @return locked Montant encore bloqué, en 18 décimales canoniques.
    function lockedAmountOf(address depositor) external view returns (uint256 locked) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) locked += locks[i].amount;
        }
    }

    /// @notice Dépôts de `depositor` ayant purgé leur blocage et rachetables dès maintenant.
    /// @param depositor Déposant interrogé.
    /// @return matured Montant rachetable, en 18 décimales canoniques.
    function maturedAmountOf(address depositor) external view returns (uint256 matured) {
        matured = maturedAmount[depositor];
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt <= block.timestamp) matured += locks[i].amount;
        }
    }

    /// @notice Échéance de la tranche suivante de `depositor`, ou 0 s'il n'a rien de bloqué.
    /// @param depositor Déposant interrogé.
    /// @return Horodatage de la prochaine échéance, ou 0.
    function nextUnlockAt(address depositor) public view returns (uint256) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) return locks[i].unlockAt;
        }
        return 0;
    }

    /// @notice Calendrier restant complet de `depositor`, pour une interface qui montre ce qui
    ///         se libère et quand. Les entrées déjà rachetées au titre de `maturedAmount` ne
    ///         sont pas retirées de cette liste.
    /// @param depositor Déposant interrogé.
    /// @return schedule Tranches restantes, dans l'ordre croissant d'échéance.
    function lockSchedule(address depositor) external view returns (Lock[] memory schedule) {
        Lock[] storage locks = _locks[depositor];
        uint256 start = _cursor[depositor];
        schedule = new Lock[](locks.length - start);
        for (uint256 i = start; i < locks.length; ++i) {
            schedule[i - start] = locks[i];
        }
    }

    /// @dev Déplace hors de `lockedAmount` et vers `maturedAmount` toute tranche dont le
    ///      blocage a expiré, en avançant le curseur au-delà. S'arrête à la première entrée
    ///      encore bloquée : `unlockAt` étant croissant, rien de postérieur ne peut être échu
    ///      plus tôt.
    /// @param depositor Déposant dont on balaie le calendrier.
    function _sweepMatured(address depositor) private {
        Lock[] storage locks = _locks[depositor];
        uint256 i = _cursor[depositor];
        uint256 swept;

        while (i < locks.length && locks[i].unlockAt <= block.timestamp) {
            swept += locks[i].amount;
            unchecked {
                ++i;
            }
        }

        if (swept > 0) {
            _cursor[depositor] = i;
            lockedAmount[depositor] -= swept;
            maturedAmount[depositor] += swept;
        }
    }
}
