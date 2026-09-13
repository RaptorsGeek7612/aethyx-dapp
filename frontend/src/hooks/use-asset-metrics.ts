"use client";

import type { AssetDefinition } from "@/config/assets";
import { useAssetData } from "@/hooks/use-asset-data";
import { useAssetPrice, type OracleHealth } from "@/hooks/use-asset-price";
import { usePriceHistory } from "@/hooks/use-price-history";
import { useCdpPosition } from "@/hooks/use-cdp";
import { computeValuation } from "@/lib/valuation";
import { toCanonical18 } from "@/lib/decimals";

export interface AssetMetrics {
  /** Wallet-held value only — excludes whatever of this asset is locked as CDP collateral. */
  valueEur: number;
  changeBps: bigint | null;
  lockedNormalized: bigint;
  wrappedSupply: bigint;
  oracleHealth: OracleHealth;
  /** This asset's own value currently locked as Credit Facility collateral, 0 if none/unregistered. */
  cdpCollateralValueEur: number;
  /** ioEUR debt outstanding against this specific collateral, 0 if none/unregistered. */
  cdpDebtValueEur: number;
}

/** One asset's contribution to a portfolio summary — the connected wallet's holding, valued at
 *  the live oracle price (gold/silver) or static appraisal share (real estate), plus the pieces
 *  a coverage/oracle-health rollup needs.
 *
 *  Wallet value alone understates what a depositor actually has once any of it is locked as CDP
 *  collateral (see feedback from 2026-09-13: minted debt has to be "systematically deducted" and
 *  the total has to stay coherent) — so this also reports that asset's CDP collateral value and
 *  the debt minted against it, letting the caller build a true net figure: assets (wallet + locked)
 *  minus liabilities (debt), not just whatever happens to still be sitting in the wallet. */
export function useAssetMetrics(asset: AssetDefinition): AssetMetrics {
  const { data } = useAssetData(asset);
  const { price, health } = useAssetPrice(asset.id, asset.pricedByOracle);
  const { changeBps } = usePriceHistory(asset.id, asset.pricedByOracle, asset.title);
  const { valueEur } = computeValuation(asset, data, price);
  const lockedNormalized = toCanonical18(data.lockedRaw, data.underlyingDecimals);

  const { registered: cdpRegistered, data: cdpData } = useCdpPosition(asset.id);
  const priceEurPerUnit = Number(price) / 1e18;
  const cdpCollateralUnits = Number(cdpData.collateralAmount) / 10 ** cdpData.wrappedDecimals;
  const cdpCollateralValueEur = cdpRegistered && health === "healthy" ? cdpCollateralUnits * priceEurPerUnit : 0;
  const cdpDebtValueEur = cdpRegistered ? Number(cdpData.currentDebt) / 10 ** cdpData.stableDecimals : 0;

  return {
    valueEur,
    changeBps,
    lockedNormalized,
    wrappedSupply: data.wrappedSupply,
    oracleHealth: health,
    cdpCollateralValueEur,
    cdpDebtValueEur,
  };
}
