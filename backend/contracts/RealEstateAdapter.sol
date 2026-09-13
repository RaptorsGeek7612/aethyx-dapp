// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice AssetAdapter concret pour un token immobilier ERC-3643 fractionné. Impose une durée de
///         détention minimale avant remboursement : le règlement d'une opération immobilière
///         (transfert de propriété, traitement notarial...) prend un temps réel, contrairement à
///         un actif purement numérique que l'on peut wrapper et dé-wrapper dans le même bloc.
/// @dev Échéancier commun au marché, pas par déposant. Voir AUDIT.md, constat n°1, pour
///      l'historique complet de cet arbitrage : une version antérieure indexait le blocage sur
///      l'adresse du déposant, ce qui se contournait entièrement par un simple auto-transfert vers
///      une seconde adresse contrôlée par le même déposant (le token wrappé restant un ERC-20
///      librement transférable, rien on-chain ne distingue cet auto-transfert d'une vente de gré à
///      gré). La question n'est pas « qui a le droit de racheter » mais « à quelle vitesse le
///      collatéral peut sortir » — c'est le règlement immobilier qui prend du temps, pas la
///      personne. Chaque dépôt alimente donc une réserve commune qui mûrit après `lockupPeriod`,
///      et tout remboursement puise dans la part déjà mûre, quel qu'en soit l'auteur : la seconde
///      adresse d'un auto-transfert puise dans la même réserve que la première, et un acheteur de
///      marché secondaire attend la maturité du marché comme n'importe quel déposant — la
///      situation économiquement honnête, puisque le collatéral n'est réellement pas liquide avant
///      et que le calendrier est lisible on-chain avant tout achat.
///
///      Conséquence assumée : les dépôts perdent leur individualité (deux dépôts à deux jours
///      d'intervalle ne sont plus remboursables à deux jours d'intervalle, mais quand le pool
///      commun atteint le montant voulu). C'est le prix de rendre le blocage réellement
///      contraignant plutôt qu'une convention que seul un déposant non averti respecte.
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

    /// @dev En ajout seul. `lockupPeriod` étant immuable, `unlockAt` est croissant le long du
    ///      tableau : les échéances se balaient par l'avant et le balayage s'arrête à la première
    ///      entrée encore bloquée, sans parcourir l'historique complet.
    Lock[] private _locks;
    /// @dev Indice de la première entrée pas encore échue ; tout ce qui la précède a déjà été
    ///      balayé vers `maturedAmount` et n'est jamais revisité.
    uint256 private _cursor;

    /// @notice Dépôts du marché encore dans leur période de détention, au dernier balayage.
    ///         Préférer `lockedAmountNow` pour un chiffre à jour.
    uint256 public lockedAmount;
    /// @notice Dépôts du marché arrivés à échéance et non encore remboursés, au dernier balayage.
    ///         Préférer `maturedAmountNow` pour un chiffre à jour.
    uint256 public maturedAmount;

    /// @notice Le remboursement porte sur plus que ce que le pool commun a de mûr.
    /// @param requested Montant normalisé que la demande voulait libérer.
    /// @param available Part du pool échue et non encore remboursée.
    /// @param nextUnlockAt Échéance de la prochaine tranche, pour indiquer combien de temps attendre.
    error StillLocked(uint256 requested, uint256 available, uint256 nextUnlockAt);

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
    /// @dev Ouvre une tranche portant sa propre échéance dans le pool commun, sans toucher aux
    ///      précédentes.
    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        normalizedAmount = super.deposit(from, amount);
        _locks.push(Lock({ amount: normalizedAmount, unlockAt: block.timestamp + lockupPeriod }));
        lockedAmount += normalizedAmount;
    }

    /// @inheritdoc AssetAdapter
    /// @dev Plafonne la libération à ce que le pool commun a de mûr, sans égard pour qui appelle :
    ///      c'est tout l'intérêt de cette version sur la précédente indexée par déposant.
    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        _sweepMatured();

        if (normalizedAmount > maturedAmount) {
            revert StillLocked(normalizedAmount, maturedAmount, nextUnlockAt());
        }
        maturedAmount -= normalizedAmount;

        return super.withdraw(to, normalizedAmount);
    }

    /// @notice Dépôts du marché encore dans leur période de détention, à l'instant.
    /// @return locked Montant encore bloqué, en 18 décimales canoniques.
    function lockedAmountNow() external view returns (uint256 locked) {
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt > block.timestamp) locked += _locks[i].amount;
        }
    }

    /// @notice Dépôts du marché arrivés à échéance et remboursables dès maintenant.
    /// @return matured Montant remboursable, en 18 décimales canoniques.
    function maturedAmountNow() external view returns (uint256 matured) {
        matured = maturedAmount;
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt <= block.timestamp) matured += _locks[i].amount;
        }
    }

    /// @notice Échéance de la prochaine tranche du marché, ou 0 s'il n'y a plus rien de bloqué.
    /// @return Horodatage de la prochaine échéance, ou 0.
    function nextUnlockAt() public view returns (uint256) {
        for (uint256 i = _cursor; i < _locks.length; ++i) {
            if (_locks[i].unlockAt > block.timestamp) return _locks[i].unlockAt;
        }
        return 0;
    }

    /// @notice Calendrier restant du marché : une entrée par dépôt, avec sa propre échéance.
    /// @dev Les tranches déjà remboursées au titre de `maturedAmount` ne sont pas retirées de
    ///      cette liste. Vue non bornée, prévue pour une lecture hors chaîne.
    /// @return schedule Tranches restantes, dans l'ordre croissant d'échéance.
    function lockSchedule() external view returns (Lock[] memory schedule) {
        uint256 start = _cursor;
        schedule = new Lock[](_locks.length - start);
        for (uint256 i = start; i < _locks.length; ++i) {
            schedule[i - start] = _locks[i];
        }
    }

    /// @dev Déplace hors de `lockedAmount` et vers `maturedAmount` toute tranche échue, en
    ///      avançant le curseur au-delà. S'arrête à la première entrée encore bloquée :
    ///      `unlockAt` étant croissant, rien de postérieur ne peut être échu plus tôt.
    function _sweepMatured() private {
        uint256 i = _cursor;
        uint256 len = _locks.length;
        uint256 swept;

        while (i < len && _locks[i].unlockAt <= block.timestamp) {
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
