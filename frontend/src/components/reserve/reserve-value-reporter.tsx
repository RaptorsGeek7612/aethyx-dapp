"use client";

import { useEffect } from "react";
import type { AssetDefinition } from "@/config/assets";
import type { AssetOnChainData } from "@/hooks/use-asset-data";
import { useAssetStaticData } from "@/hooks/use-asset-static";
import { useAssetPrice, type OracleHealth } from "@/hooks/use-asset-price";
import { computeValuation } from "@/lib/valuation";

/**
 * Computes one asset's contribution to the protocol-wide reserve total and reports it to a
 * parent via `onValue` — no UI of its own. Reuses `computeValuation`, the same math the
 * dashboard uses for a connected wallet's holdings, but with the *whole* wrapped supply standing
 * in for "balance": for gold/silver that's total grams locked × oracle price; for real estate,
 * a 100% share of the appraisal (there's only one "holder" here — the reserve itself).
 */
export function ReserveValueReporter({
  asset,
  onValue,
}: {
  asset: AssetDefinition;
  onValue: (assetId: string, valueEur: number, health: OracleHealth) => void;
}) {
  const { data: staticData } = useAssetStaticData(asset);
  const { price, health } = useAssetPrice(asset.id, asset.pricedByOracle);

  const data: AssetOnChainData = {
    ...staticData,
    underlyingBalance: 0n,
    wrappedBalance: staticData.wrappedSupply,
    underlyingAllowanceForAdapter: 0n,
    wrappedAllowanceForVault: 0n,
    lockedUntil: null,
  };
  const { valueEur } = computeValuation(asset, data, price);

  useEffect(() => {
    onValue(asset.id, staticData.registered ? valueEur : 0, health);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, valueEur, staticData.registered, health]);

  return null;
}
