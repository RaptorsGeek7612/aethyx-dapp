// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token immobilier ERC-3643 fractionné. Ajoute une durée
///         de détention minimale avant rachat : le règlement d'une opération immobilière
///         (transfert de propriété, traitement notarial...) prend un temps réel, contrairement
///         à un actif purement numérique que l'on peut wrapper et dé-wrapper dans le même bloc.
/// @dev La contrainte porte sur le **collatéral du marché**, pas sur les adresses. Chaque dépôt
///      alimente une réserve commune qui mûrit après `lockupPeriod`, et tout rachat — quel qu'en
///      soit l'auteur — puise dans la part déjà mûre.
///
///      Une version antérieure indexait le blocage sur l'adresse qui rachète, en exemptant qui
///      n'avait jamais déposé afin de ne pas pénaliser un acheteur de marché secondaire. Le token
///      wrappé étant librement transférable, cette exemption était indistinguable d'un
///      auto-transfert : un déposant échappait à son propre blocage en envoyant ses tokens à une
///      seconde adresse qu'il contrôlait, puis en rachetant depuis celle-ci. Le blocage ne
///      contraignait donc personne. Voir AUDIT.md, constat n°1.
///
///      Cadencer la sortie du collatéral plutôt que filtrer les adresses ferme ce contournement
///      sans rien retirer au wrap : le token wrappé reste intégralement transférable à tout
///      instant, seule sa conversion en sous-jacent suit le rythme que le règlement immobilier
///      impose réellement.
///
///      La durée elle-même n'est pas un choix laissé au déposant : `lockupPeriod` est immuable,
///      fixée une fois pour toutes au déploiement du marché. C'est la façon dont un protocole
///      DeFi exprime normalement une période de détention — une propriété du contrat dans lequel
///      on dépose. Une interface peut la lire et l'afficher, elle n'a pas à la proposer.
contract RealEstateAdapter is AssetAdapter {
    /// @notice Le blocage propre à un dépôt. Chaque dépôt mûrit selon son propre calendrier ; un
    ///         dépôt ultérieur ne repousse jamais un dépôt antérieur.
    /// @param amount Quantité bloquée, en 18 décimales canoniques.
    /// @param unlockAt Horodatage auquel cette tranche mûrit.
    struct Lock {
        uint256 amount;
        uint256 unlockAt;
    }

    /// @notice Durée de détention imposée à chaque dépôt, en secondes. Immuable : c'est le
    ///         marché qui porte la durée, pas le dépôt.
    uint256 public immutable lockupPeriod;

    /// @dev Calendrier du marché, en ajout seul, tous déposants confondus. `lockupPeriod` étant
    ///      immuable, `unlockAt` est croissant le long de ce tableau : les échéances se balaient
    ///      donc par l'avant et le balayage s'arrête à la première entrée encore bloquée.
    Lock[] private _locks;
    /// @dev Indice de la première entrée pas encore mûre ; tout ce qui la précède a déjà été
    ///      balayé vers `maturedAmount` et n'est jamais revisité. Le coût du balayage est donc
    ///      amorti sur l'ensemble des dépôts, même si un appelant isolé peut en absorber
    ///      plusieurs d'un coup après une longue période sans rachat.
    uint256 private _cursor;

    /// @notice Collatéral du marché (18 décimales canoniques) dont le blocage n'a pas encore
    ///         expiré, tel qu'au dernier balayage. Préférer `lockedAmountNow` pour un chiffre
    ///         à jour.
    uint256 public lockedAmount;
    /// @notice Collatéral du marché (18 décimales canoniques) dont le blocage a expiré et qui
    ///         n'a pas encore été racheté. Préférer `maturedAmountNow` pour un chiffre à jour.
    /// @dev Invariant : `lockedAmount + maturedAmount` égale le collatéral normalisé détenu par
    ///      cet adaptateur, donc l'offre du token wrappé. Aucun rachat n'est définitivement
    ///      bloqué : tout ce qui est déposé finit par mûrir.
    uint256 public maturedAmount;

    /// @notice Le rachat porte sur plus de collatéral que le marché n'en a de mûr.
    /// @param requested Montant normalisé que la demande de rachat voulait libérer.
    /// @param available Collatéral mûr et non encore racheté, à l'échelle du marché.
    /// @param nextUnlockAt Échéance de la tranche suivante, pour qu'un appelant puisse indiquer
    ///        combien de temps attendre.
    error StillLocked(uint256 requested, uint256 available, uint256 nextUnlockAt);

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
    /// @dev Ajoute au calendrier du marché une tranche portant sa propre échéance.
    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        normalizedAmount = super.deposit(from, amount);
        _locks.push(Lock({ amount: normalizedAmount, unlockAt: block.timestamp + lockupPeriod }));
        lockedAmount += normalizedAmount;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Plafonne la libération au collatéral mûr du marché. Le contrôle ne dépend pas de
    ///      `to` : c'est ce qui empêche de contourner le blocage en transférant le token wrappé
    ///      vers une autre adresse avant de racheter.
    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        _sweepMatured();

        uint256 matured = maturedAmount;
        if (normalizedAmount > matured) {
            revert StillLocked(normalizedAmount, matured, nextUnlockAt());
        }
        maturedAmount = matured - normalizedAmount;

        return super.withdraw(to, normalizedAmount);
    }

    /// @notice Collatéral du marché encore dans sa période de blocage, à l'instant.
    /// @return locked Montant encore bloqué, en 18 décimales canoniques.
    function lockedAmountNow() external view returns (uint256 locked) {
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt > block.timestamp) locked += _locks[i].amount;
        }
    }

    /// @notice Collatéral du marché ayant purgé son blocage et rachetable dès maintenant.
    /// @return matured Montant rachetable, en 18 décimales canoniques.
    function maturedAmountNow() external view returns (uint256 matured) {
        matured = maturedAmount;
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt <= block.timestamp) matured += _locks[i].amount;
        }
    }

    /// @notice Échéance de la prochaine tranche du marché, ou 0 si rien n'est bloqué.
    /// @return Horodatage de la prochaine échéance, ou 0.
    function nextUnlockAt() public view returns (uint256) {
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt > block.timestamp) return _locks[i].unlockAt;
        }
        return 0;
    }

    /// @notice Calendrier restant du marché, pour une interface qui montre ce qui se libère et
    ///         quand. Les tranches déjà rachetées au titre de `maturedAmount` ne sont pas
    ///         retirées de cette liste.
    /// @dev Vue non bornée : sa taille croît avec le nombre de dépôts non encore balayés. Prévue
    ///      pour une lecture hors chaîne, jamais pour un appel depuis un autre contrat.
    /// @return schedule Tranches restantes, dans l'ordre croissant d'échéance.
    function lockSchedule() external view returns (Lock[] memory schedule) {
        uint256 start = _cursor;
        schedule = new Lock[](_locks.length - start);
        for (uint256 i = start; i < _locks.length; ++i) {
            schedule[i - start] = _locks[i];
        }
    }

    /// @dev Déplace hors de `lockedAmount` et vers `maturedAmount` toute tranche dont le blocage
    ///      a expiré, en avançant le curseur au-delà. S'arrête à la première entrée encore
    ///      bloquée : `unlockAt` étant croissant, rien de postérieur ne peut être mûr plus tôt.
    function _sweepMatured() private {
        uint256 i = _cursor;
        uint256 swept;

        while (i < _locks.length && _locks[i].unlockAt <= block.timestamp) {
            swept += _locks[i].amount;
            unchecked {
                ++i;
            }
        }

        if (swept > 0) {
            _cursor = i;
            lockedAmount -= swept;
            maturedAmount += swept;
        }
    }
}
