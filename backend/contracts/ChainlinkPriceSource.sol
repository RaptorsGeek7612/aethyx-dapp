// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IPriceSource } from "./interfaces/IPriceSource.sol";
import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";

/// @notice IPriceSource wrapper around a Chainlink (or Chainlink-compatible) AggregatorV3
///         feed — one instance per asset/feed pair. Rejects every shape of bad data the feed
///         can hand back instead of trusting it: a non-positive answer, a round that never
///         finalized (`updatedAt == 0`), or a stale round the aggregator proxy carries over
///         unchanged (`answeredInRound < roundId`). See OracleManager's natspec: no single
///         source, Chainlink included, is ever trusted on its own.
contract ChainlinkPriceSource is IPriceSource {
    uint256 private constant TARGET_DECIMALS = 18;

    IAggregatorV3 public immutable aggregator;
    uint256 private immutable scaleFactor;
    string public description;

    error ZeroAggregator();
    error UnsupportedDecimals(uint8 feedDecimals);
    error NonPositiveAnswer(int256 answer);
    error UnsetTimestamp();
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);

    constructor(address aggregator_, string memory description_) {
        if (aggregator_ == address(0)) revert ZeroAggregator();

        uint8 feedDecimals = IAggregatorV3(aggregator_).decimals();
        if (feedDecimals > TARGET_DECIMALS) revert UnsupportedDecimals(feedDecimals);

        aggregator = IAggregatorV3(aggregator_);
        scaleFactor = 10 ** (TARGET_DECIMALS - feedDecimals);
        description = description_;
    }

    /// @notice `assetId` is unused: a ChainlinkPriceSource wraps exactly one feed, deployed
    ///         once per asset — the same IPriceSource shape every other source exposes so
    ///         OracleManager can aggregate across them interchangeably.
    function latestPrice(bytes32) external view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer,, uint256 updatedAt_, uint80 answeredInRound) = aggregator.latestRoundData();

        if (answer <= 0) revert NonPositiveAnswer(answer);
        if (updatedAt_ == 0) revert UnsetTimestamp();
        if (answeredInRound < roundId) revert IncompleteRound(roundId, answeredInRound);

        price = uint256(answer) * scaleFactor;
        updatedAt = updatedAt_;
    }
}
