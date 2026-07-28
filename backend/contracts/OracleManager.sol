// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Aggregates price feeds from multiple independent sources (Chainlink, Pyth, a
///         manually-pushed source...) per asset, and exposes a single manipulation-resistant
///         median price. No single source can move the reported price on its own: a stale or
///         wildly divergent source is excluded rather than blindly trusted.
contract OracleManager is AccessManaged {
    struct Config {
        uint256 maxStaleness; // seconds a source's price can be old before being ignored
        uint256 maxDeviationBps; // max allowed gap between min and max accepted price, in bps
        uint256 minSources; // minimum number of fresh sources required to aggregate
    }

    uint256 private constant BPS_DENOMINATOR = 10_000;

    Config public config;

    mapping(bytes32 assetId => address[] sources) private _sources;

    event PriceSourceAdded(bytes32 indexed assetId, address indexed source);
    event PriceSourceRemoved(bytes32 indexed assetId, address indexed source);
    event ConfigUpdated(uint256 maxStaleness, uint256 maxDeviationBps, uint256 minSources);

    error InsufficientFreshSources(bytes32 assetId, uint256 found, uint256 required);
    error PriceDeviationTooHigh(bytes32 assetId, uint256 minPrice, uint256 maxPrice);
    error SourceNotRegistered(bytes32 assetId, address source);

    constructor(address accessManager_, uint256 maxStaleness_, uint256 maxDeviationBps_, uint256 minSources_)
        AccessManaged(accessManager_)
    {
        config = Config(maxStaleness_, maxDeviationBps_, minSources_);
    }

    function addPriceSource(bytes32 assetId, address source) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        _sources[assetId].push(source);
        emit PriceSourceAdded(assetId, source);
    }

    function removePriceSource(bytes32 assetId, address source)
        external
        onlyRole(accessManager.ASSET_MANAGER_ROLE())
    {
        address[] storage list = _sources[assetId];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == source) {
                list[i] = list[len - 1];
                list.pop();
                emit PriceSourceRemoved(assetId, source);
                return;
            }
        }
        revert SourceNotRegistered(assetId, source);
    }

    function setConfig(uint256 maxStaleness_, uint256 maxDeviationBps_, uint256 minSources_)
        external
        onlyRole(accessManager.ASSET_MANAGER_ROLE())
    {
        config = Config(maxStaleness_, maxDeviationBps_, minSources_);
        emit ConfigUpdated(maxStaleness_, maxDeviationBps_, minSources_);
    }

    /// @notice Median price across all fresh, registered sources for `assetId`, 18 decimals.
    /// @return price The aggregated median price.
    /// @return worstUpdatedAt The oldest `updatedAt` among the sources used in the aggregate,
    ///         i.e. the worst-case freshness bound callers can rely on.
    function getPrice(bytes32 assetId) external view returns (uint256 price, uint256 worstUpdatedAt) {
        address[] storage sources = _sources[assetId];
        uint256 len = sources.length;

        uint256[] memory fresh = new uint256[](len);
        uint256 freshCount;
        worstUpdatedAt = type(uint256).max;

        for (uint256 i = 0; i < len; i++) {
            (uint256 p, uint256 updatedAt) = IPriceSource(sources[i]).latestPrice(assetId);
            if (p == 0 || block.timestamp - updatedAt > config.maxStaleness) continue;
            fresh[freshCount++] = p;
            if (updatedAt < worstUpdatedAt) worstUpdatedAt = updatedAt;
        }

        if (freshCount < config.minSources) {
            revert InsufficientFreshSources(assetId, freshCount, config.minSources);
        }

        uint256[] memory prices = new uint256[](freshCount);
        for (uint256 i = 0; i < freshCount; i++) {
            prices[i] = fresh[i];
        }

        uint256 minPrice = prices[0];
        uint256 maxPrice = prices[0];
        for (uint256 i = 1; i < freshCount; i++) {
            if (prices[i] < minPrice) minPrice = prices[i];
            if (prices[i] > maxPrice) maxPrice = prices[i];
        }
        if (((maxPrice - minPrice) * BPS_DENOMINATOR) / minPrice > config.maxDeviationBps) {
            revert PriceDeviationTooHigh(assetId, minPrice, maxPrice);
        }

        price = _median(prices);
    }

    function _median(uint256[] memory prices) private pure returns (uint256) {
        uint256 n = prices.length;
        for (uint256 i = 1; i < n; i++) {
            uint256 key = prices[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > key) {
                prices[j] = prices[j - 1];
                j--;
            }
            prices[j] = key;
        }
        return n % 2 == 1 ? prices[n / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
    }
}
