// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/**
 * @title MockAggregatorV3
 * @notice Reproduit l'interface Chainlink pour tester la fiabilité de l'oracle extérieur.
 * @dev Sert uniquement aux tests. Permet de forcer les cas pathologiques que Chainlink
 *      ne produira jamais sur demande : prix négatif, round incomplet, donnée périmée,
 *      feed qui revert.
 */
contract MockAggregatorV3 {
    /// @notice Le feed est déclaré hors service par `setShouldRevert`.
    error FeedDown();

    uint8 private _decimals;
    string private _description;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    /// @notice Vrai lorsque `latestRoundData` doit revert, simulant un feed hors service.
    bool public shouldRevert;

    /// @param decimals_ Décimales que le feed doit annoncer.
    /// @param initialAnswer Prix initial publié au round 1.
    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        _description = "MockAggregatorV3";
        _set(1, initialAnswer, block.timestamp, 1);
    }

    /*//////////////////////////////////////////////////////////////
                          CHAINLINK INTERFACE
    //////////////////////////////////////////////////////////////*/

    /// @notice Décimales annoncées par le feed.
    /// @return Décimales configurées à la construction.
    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @notice Libellé du feed.
    /// @return Description fixe de ce mock.
    function description() external view returns (string memory) {
        return _description;
    }

    /// @notice Version de l'interface agrégateur.
    /// @return Toujours 4, comme les agrégateurs Chainlink courants.
    function version() external pure returns (uint256) {
        return 4;
    }

    /// @notice Dernier round publié, ou revert si le feed est déclaré hors service.
    /// @return roundId Identifiant du round.
    /// @return answer Prix publié, dans les décimales du feed.
    /// @return startedAt Début du round.
    /// @return updatedAt Dernière mise à jour ; zéro si le round n'a jamais été finalisé.
    /// @return answeredInRound Round dont la réponse provient réellement.
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (shouldRevert) revert FeedDown();
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    /*//////////////////////////////////////////////////////////////
                             TEST HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Publication normale : round incrémenté, horodatage courant.
    /// @param answer Prix à publier.
    function push(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp, next);
    }

    /// @notice Force une donnée périmée de `age` secondes.
    /// @param answer Prix à publier.
    /// @param age Ancienneté à simuler, en secondes.
    function pushStale(int256 answer, uint256 age) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp - age, next);
    }

    /// @notice Round jamais finalisé : updatedAt reste à zéro.
    /// @param answer Prix à publier.
    function pushIncomplete(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, 0, next);
    }

    /// @notice Réponse reportée d'un round antérieur (answeredInRound < roundId).
    /// @param answer Prix à publier.
    function pushCarriedOver(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp, _roundId);
    }

    /// @notice Simule un feed hors service.
    /// @param value Vrai pour faire revert `latestRoundData`.
    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    /// @notice Écrit l'état d'un round en une fois.
    /// @param roundId_ Identifiant du round.
    /// @param answer_ Prix publié.
    /// @param updatedAt_ Horodatage, utilisé aussi comme `startedAt`.
    /// @param answeredInRound_ Round dont la réponse provient réellement.
    function _set(uint80 roundId_, int256 answer_, uint256 updatedAt_, uint80 answeredInRound_) private {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = updatedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }
}
