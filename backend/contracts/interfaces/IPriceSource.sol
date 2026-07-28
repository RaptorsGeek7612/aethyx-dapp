// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Common interface every price feed adapter (Chainlink, Pyth, manual push...) must
///         implement so OracleManager can aggregate across them interchangeably.
interface IPriceSource {
    /// @notice Latest known price for `assetId`, normalized to 18 decimals.
    /// @return price 0 if no price is known yet for this asset on this source.
    /// @return updatedAt Timestamp the price was last updated on this source.
    function latestPrice(bytes32 assetId) external view returns (uint256 price, uint256 updatedAt);
}
