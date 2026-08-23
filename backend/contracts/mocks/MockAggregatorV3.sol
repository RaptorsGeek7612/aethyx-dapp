// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice Minimal Chainlink AggregatorV3Interface test double. Lets tests drive every
///         failure mode ChainlinkPriceSource has to defend against: a negative or zero
///         answer, a round that never finalized, a round the aggregator proxy carries over
///         unchanged from an earlier answer, and the feed reverting outright.
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 private immutable _decimals;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    bool private _shouldRevert;

    constructor(uint8 decimals_, int256 initialAnswer_) {
        _decimals = decimals_;
        push(initialAnswer_);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @notice Normal update: a fully finalized round with a fresh timestamp.
    function push(int256 answer_) public {
        _roundId += 1;
        _answer = answer_;
        _updatedAt = block.timestamp;
        _answeredInRound = _roundId;
    }

    /// @notice A round that started but was never answered — Chainlink reports `updatedAt`
    ///         as 0 in this case.
    function pushIncomplete(int256 answer_) external {
        _roundId += 1;
        _answer = answer_;
        _updatedAt = 0;
        _answeredInRound = _roundId;
    }

    /// @notice A round the aggregator proxy carries over unchanged from an earlier, stale
    ///         answer — `answeredInRound` lags behind the current `roundId`.
    function pushCarriedOver(int256 answer_) external {
        _roundId += 1;
        _answer = answer_;
        _updatedAt = block.timestamp;
        _answeredInRound = _roundId - 1;
    }

    function setShouldRevert(bool shouldRevert_) external {
        _shouldRevert = shouldRevert_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (_shouldRevert) revert("MockAggregatorV3: feed down");
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }
}
