// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Admin-pushable price feed: one of possibly several independent sources that
///         OracleManager aggregates by median. Stands in for a real Chainlink/Pyth wrapper
///         (see OracleManager.sol's natspec) — same IPriceSource interface, so swapping this
///         out later requires no change to OracleManager or anything reading through it.
/// @dev Every push emits PriceUpdated, which is the on-chain history a frontend replays via
///      getLogs to chart a trend or compute a 24h change — there is no separate history store.
contract ManualPriceSource is AccessManaged, IPriceSource {
    mapping(bytes32 assetId => uint256 price) public price;
    mapping(bytes32 assetId => uint256 updatedAt) public updatedAt;

    event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 updatedAt);

    constructor(address accessManager_) AccessManaged(accessManager_) {}

    /// @notice Pushes a new price for `assetId`, normalized to 18 decimals (e.g. EUR per gram
    ///         scaled by 1e18 for a gold/silver feed).
    function setPrice(bytes32 assetId, uint256 newPrice) external onlyRole(accessManager.ORACLE_UPDATER_ROLE()) {
        price[assetId] = newPrice;
        updatedAt[assetId] = block.timestamp;
        emit PriceUpdated(assetId, newPrice, block.timestamp);
    }

    function latestPrice(bytes32 assetId) external view returns (uint256, uint256) {
        return (price[assetId], updatedAt[assetId]);
    }
}
