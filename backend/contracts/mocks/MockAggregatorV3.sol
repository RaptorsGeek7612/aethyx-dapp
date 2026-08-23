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
    error FeedDown();

    uint8 private _decimals;
    string private _description;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    bool public shouldRevert;

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        _description = "MockAggregatorV3";
        _set(1, initialAnswer, block.timestamp, 1);
    }

    /*//////////////////////////////////////////////////////////////
                          CHAINLINK INTERFACE
    //////////////////////////////////////////////////////////////*/

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return 4;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (shouldRevert) revert FeedDown();
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    /*//////////////////////////////////////////////////////////////
                             TEST HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Publication normale : round incrémenté, horodatage courant.
    function push(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp, next);
    }

    /// @notice Force une donnée périmée de `age` secondes.
    function pushStale(int256 answer, uint256 age) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp - age, next);
    }

    /// @notice Round jamais finalisé : updatedAt reste à zéro.
    function pushIncomplete(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, 0, next);
    }

    /// @notice Réponse reportée d'un round antérieur (answeredInRound < roundId).
    function pushCarriedOver(int256 answer) external {
        uint80 next = _roundId + 1;
        _set(next, answer, block.timestamp, _roundId);
    }

    /// @notice Simule un feed hors service.
    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function _set(
        uint80 roundId_,
        int256 answer_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) private {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = updatedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }
}
