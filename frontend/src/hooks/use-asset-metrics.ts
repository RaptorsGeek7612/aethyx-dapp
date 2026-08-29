"use client";

import type { AssetDefinition } from "@/config/assets";
import { useAssetData } from "@/hooks/use-asset-data";
import { useAssetPrice, type OracleHealth } from "@/hooks/use-asset-price";
import { usePriceHistory } from "@/hooks/use-price-history";
import { computeValuation } from "@/lib/valuation";
import { toCanonical18 } from "@/lib/decimals";

export interface AssetMetrics {
  valueEur: number;
  changeBps: bigint | null;
  lockedNormalized: bigint;
  wrappedSupply: bigint;
  oracleHealth: OracleHealth;
}

/** One asset's contribution to a portfolio summary — the connected wallet's holding, valued at
 *  the live oracle price (gold/silver) or static appraisal share (real estate), plus the pieces
 *  a coverage/oracle-health rollup needs. Shared by PortfolioAssetRow and the real-estate group
 *  row so both compute "my portfolio" the same way. */
export function useAssetMetrics(asset: AssetDefinition): AssetMetrics {
  const { data } = useAssetData(asset);
  const { price, health } = useAssetPrice(asset.id, asset.pricedByOracle);
  const { changeBps } = usePriceHistory(asset.id, asset.pricedByOracle, asset.title);
  const { valueEur } = computeValuation(asset, data, price);
  const lockedNormalized = toCanonical18(data.lockedRaw, data.underlyingDecimals);

  return { valueEur, changeBps, lockedNormalized, wrappedSupply: data.wrappedSupply, oracleHealth: health };
}
