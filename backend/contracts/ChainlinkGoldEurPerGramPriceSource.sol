// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Converts a real Chainlink USD/troy-ounce feed into EUR/gram — the unit `GOLD`'s two
///         `ManualPriceSource` entries and the whole frontend value model already use — so the
///         real market feed can finally be registered directly under `GOLD` instead of sitting
///         isolated under `GOLD_USD_OZ` (see backend/README.md's "ChainlinkPriceSource sur
///         Sepolia" section and AUDIT.md's centralization risks).
/// @dev Two conversions, composed: troy ounces to grams (a fixed physical constant) and USD to
///      EUR (not fixed — no Chainlink EUR/USD feed was found deployed on Sepolia testnet, unlike
///      mainnet where several exist). The EUR/USD leg is read from an `IPriceSource` — in
///      practice one of the protocol's existing `ManualPriceSource` instances, pushed under a
///      dedicated assetId — so gold's price now tracks the real commodity market automatically;
///      only the currency conversion remains administered, a materially smaller trust surface
///      than today's fully-manual gold price. If a genuine on-chain EUR/USD feed becomes
///      available on Sepolia later, swapping `eurUsdRateSource` for a `ChainlinkPriceSource`
///      wrapping it needs no change here — same `IPriceSource` interface either way.
///
///      `OracleManager.config.minSources` applies to every asset uniformly, so `GOLD` needs at
///      least two independently-agreeing sources. Two instances of this same contract, deployed
///      side by side, satisfy that quorum mechanically — they compute the identical formula from
///      the identical on-chain and pushed state, so they always agree — the same pattern already
///      used by `RealEstateOnChainPriceSource` for the real-estate market.
contract ChainlinkGoldEurPerGramPriceSource is IPriceSource {
    /// @notice Real Chainlink feed, wrapped in this protocol's IPriceSource shape, reporting
    ///         USD per troy ounce at 18 decimals.
    IPriceSource public immutable usdPerOunceSource;
    /// @notice Source of the USD-per-EUR rate — a ManualPriceSource in practice, but any
    ///         IPriceSource works.
    IPriceSource public immutable eurUsdRateSource;
    /// @notice Asset id the EUR/USD rate is pushed under on `eurUsdRateSource` — deliberately
    ///         not `GOLD` or any asset id: this is a currency rate, not an asset price, and
    ///         mixing the two registries would let an operator error register a currency rate
    ///         as if it were a collateral price or vice versa.
    bytes32 public immutable eurUsdRateAssetId;

    /// @dev One troy ounce in grams, scaled to 18 decimals: 31.1034768 * 1e18. A fixed physical
    ///      constant — unlike the currency rate, this never needs pushing or updating.
    uint256 private constant GRAMS_PER_TROY_OUNCE_18 = 31_103_476_800_000_000_000;

    /// @notice The EUR/USD rate source has never been pushed a price for `eurUsdRateAssetId` —
    ///         a rate of zero would make every downstream price infinite, so this reverts
    ///         instead, exactly like a Chainlink feed reporting a non-positive answer.
    error ZeroEurUsdRate();

    /// @param usdPerOunceSource_ IPriceSource reporting USD per troy ounce, 18 decimals — in
    ///        practice the deployed ChainlinkPriceSource wrapping the real Sepolia XAU/USD feed.
    /// @param eurUsdRateSource_ IPriceSource the USD-per-EUR rate is read from.
    /// @param eurUsdRateAssetId_ Asset id the rate is keyed under on `eurUsdRateSource_`.
    constructor(address usdPerOunceSource_, address eurUsdRateSource_, bytes32 eurUsdRateAssetId_) {
        usdPerOunceSource = IPriceSource(usdPerOunceSource_);
        eurUsdRateSource = IPriceSource(eurUsdRateSource_);
        eurUsdRateAssetId = eurUsdRateAssetId_;
    }

    /// @inheritdoc IPriceSource
    /// @dev `assetId` is ignored, same convention as ChainlinkPriceSource: this instance is
    ///      dedicated to one computed price. `updatedAt` is the older of the two legs' own
    ///      timestamps — if either the Chainlink feed or the pushed EUR/USD rate goes stale,
    ///      the combined price must read as stale too, not inherit only the fresher leg's age.
    ///      A revert from either leg (a malformed Chainlink round, see ChainlinkPriceSource)
    ///      propagates up uncaught, which is correct: OracleManager's own try/catch around each
    ///      source already treats a revert exactly like a stale or absent price.
    function latestPrice(bytes32) external view returns (uint256 price, uint256 updatedAt) {
        (uint256 usdPerOunce, uint256 updatedAtOunce) = usdPerOunceSource.latestPrice(bytes32(0));
        (uint256 usdPerEur, uint256 updatedAtRate) = eurUsdRateSource.latestPrice(eurUsdRateAssetId);
        if (usdPerEur == 0) revert ZeroEurUsdRate();

        uint256 eurPerOunce = (usdPerOunce * 1e18) / usdPerEur;
        price = (eurPerOunce * 1e18) / GRAMS_PER_TROY_OUNCE_18;
        updatedAt = updatedAtOunce < updatedAtRate ? updatedAtOunce : updatedAtRate;
    }
}
