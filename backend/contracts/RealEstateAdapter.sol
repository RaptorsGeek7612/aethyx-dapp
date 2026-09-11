// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token immobilier ERC-3643 fractionné. Impose une durée de
///         détention minimale avant remboursement : le règlement d'une opération immobilière
///         (transfert de propriété, traitement notarial...) prend un temps réel, contrairement à
///         un actif purement numérique que l'on peut wrapper et dé-wrapper dans le même bloc.
/// @dev Chaque dépôt porte sa propre échéance, comptée depuis **sa** date. La durée est la même
///      pour tous — `lockupPeriod` est immuable, fixée au déploiement du marché — mais deux
///      dépôts effectués à deux jours d'intervalle deviennent remboursables à deux jours
///      d'intervalle. Un dépôt ultérieur ne repousse jamais un dépôt antérieur : la conception
///      d'origine stockait un unique `lockedUntil` par adresse et l'écrasait à chaque dépôt, si
///      bien qu'abonder une position presque échue la reverrouillait intégralement.
///
///      Le remboursement est donc plafonné à ce qui est arrivé à échéance, et non bloqué en tout
///      ou rien : un porteur dont la première tranche est mûre la retire pendant que la seconde
///      finit de courir.
///
/// @dev **Contournement connu et assumé.** Suivre des échéances individuelles impose de les
///      indexer sur l'adresse du déposant, et le token wrappé est un ERC-20 librement
///      transférable : un déposant échappe à sa propre échéance en envoyant ses jetons à une
///      seconde adresse qu'il contrôle, puis en remboursant depuis celle-ci, où aucune échéance
///      n'a jamais été enregistrée. Rien on-chain ne distingue ce transfert d'une vente de gré à
///      gré, qu'il faut bien laisser passer.
///
///      La seule forme non contournable — un échéancier commun au marché, où tout remboursement
///      puise dans la part déjà mûre quel qu'en soit l'auteur — a existé ici et a été écartée :
///      elle rend la contrainte réelle mais fait disparaître l'individualité des dépôts, qui est
///      précisément ce que ce marché veut exprimer. L'arbitrage est tranché en faveur de
///      l'individualité. Voir AUDIT.md, constat n°1.
contract RealEstateAdapter is AssetAdapter {
    /// @notice Le blocage propre à un dépôt.
    /// @param amount Quantité bloquée, en 18 décimales canoniques.
    /// @param unlockAt Horodatage auquel cette tranche arrive à échéance.
    struct Lock {
        uint256 amount;
        uint256 unlockAt;
    }

    /// @notice Durée de détention appliquée à chaque dépôt, en secondes. Immuable : c'est le
    ///         marché qui porte la durée, chaque dépôt qui porte sa date.
    uint256 public immutable lockupPeriod;

    /// @dev En ajout seul, par déposant. `lockupPeriod` étant immuable, `unlockAt` est croissant
    ///      le long du tableau : les échéances se balaient par l'avant et le balayage s'arrête à
    ///      la première entrée encore bloquée, sans parcourir l'historique complet.
    mapping(address depositor => Lock[]) private _locks;
    /// @dev Indice de la première entrée pas encore échue ; tout ce qui la précède a déjà été
    ///      balayé vers `maturedAmount` et n'est jamais revisité.
    mapping(address depositor => uint256 cursor) private _cursor;

    /// @notice Dépôts de ce déposant dont l'échéance n'est pas atteinte, au dernier balayage.
    ///         Préférer `lockedAmountOf` pour un chiffre à jour.
    mapping(address depositor => uint256) public lockedAmount;
    /// @notice Dépôts de ce déposant arrivés à échéance et non encore remboursés. Préférer
    ///         `maturedAmountOf` pour un chiffre à jour.
    mapping(address depositor => uint256) public maturedAmount;

    /// @notice Le remboursement porte sur plus que ce qui est arrivé à échéance pour ce compte.
    /// @param account Compte dont le remboursement est refusé.
    /// @param requested Montant normalisé que la demande voulait libérer.
    /// @param available Part de ses dépôts échue et non encore remboursée.
    /// @param nextUnlockAt Échéance de sa tranche suivante, pour indiquer combien de temps attendre.
    error StillLocked(address account, uint256 requested, uint256 available, uint256 nextUnlockAt);

    /// @param underlying_ Token immobilier ERC-3643 à prendre en garde.
    /// @param vaultManager_ VaultManager autorisé à piloter cet adaptateur.
    /// @param assetId_ Identifiant de l'actif dans le registre de VaultManager.
    /// @param lockupPeriod_ Durée de détention appliquée à chaque dépôt, en secondes.
    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_,
        uint256 lockupPeriod_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {
        lockupPeriod = lockupPeriod_;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Ouvre une tranche portant sa propre échéance, sans toucher aux précédentes.
    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        normalizedAmount = super.deposit(from, amount);
        _locks[from].push(Lock({ amount: normalizedAmount, unlockAt: block.timestamp + lockupPeriod }));
        lockedAmount[from] += normalizedAmount;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Plafonne la libération aux tranches échues du compte, plutôt que de refuser en bloc.
    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        _sweepMatured(to);

        uint256 matured = maturedAmount[to];
        // Un porteur sans aucune tranche n'est soumis à rien : le token wrappé circule librement,
        // et qui l'a acquis de gré à gré n'a jamais déposé ici. C'est aussi la porte que décrit la
        // natspec du contrat — elle est assumée, pas ignorée.
        if (lockedAmount[to] > 0 && normalizedAmount > matured) {
            revert StillLocked(to, normalizedAmount, matured, nextUnlockAt(to));
        }

        // Saturant : un remboursement peut légitimement dépasser le crédit du compte (jetons
        // acquis de gré à gré en plus de ses propres dépôts échus), et l'excédent n'est pas suivi.
        maturedAmount[to] = matured > normalizedAmount ? matured - normalizedAmount : 0;

        return super.withdraw(to, normalizedAmount);
    }

    /// @notice Dépôts de `depositor` encore dans leur période de détention, à l'instant.
    /// @param depositor Déposant interrogé.
    /// @return locked Montant encore bloqué, en 18 décimales canoniques.
    function lockedAmountOf(address depositor) external view returns (uint256 locked) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) locked += locks[i].amount;
        }
    }

    /// @notice Dépôts de `depositor` arrivés à échéance et remboursables dès maintenant.
    /// @param depositor Déposant interrogé.
    /// @return matured Montant remboursable, en 18 décimales canoniques.
    function maturedAmountOf(address depositor) external view returns (uint256 matured) {
        matured = maturedAmount[depositor];
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt <= block.timestamp) matured += locks[i].amount;
        }
    }

    /// @notice Échéance de la prochaine tranche de `depositor`, ou 0 s'il n'a rien de bloqué.
    /// @param depositor Déposant interrogé.
    /// @return Horodatage de la prochaine échéance, ou 0.
    function nextUnlockAt(address depositor) public view returns (uint256) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) return locks[i].unlockAt;
        }
        return 0;
    }

    /// @notice Calendrier restant de `depositor` : une entrée par dépôt, avec sa propre échéance.
    ///         C'est ce que lit l'interface pour dater chaque dépôt individuellement.
    /// @dev Les tranches déjà remboursées au titre de `maturedAmount` ne sont pas retirées de
    ///      cette liste. Vue non bornée, prévue pour une lecture hors chaîne.
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

    /// @dev Déplace hors de `lockedAmount` et vers `maturedAmount` toute tranche échue, en
    ///      avançant le curseur au-delà. S'arrête à la première entrée encore bloquée :
    ///      `unlockAt` étant croissant, rien de postérieur ne peut être échu plus tôt.
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
