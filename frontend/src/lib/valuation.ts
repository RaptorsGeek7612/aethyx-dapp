import type { AssetDefinition } from "@/config/assets";
import type { AssetOnChainData } from "@/hooks/use-asset-data";

export interface AssetValuation {
  /** Physical quantity in grams for gold/silver (1 underlying token == 1 gram); null for real estate. */
  grams: number | null;
  valueEur: number;
}

/**
 * Gold/silver are valued as grams-held × oracle price-per-gram. Real estate has no spot price
 * (see AuditBadge/ReserveCard for why): it's valued as the holder's pro-rata share of a static
 * appraisal, `(wrappedBalance / wrappedSupply) * appraisalValueEur`.
 */
export function computeValuation(
  asset: AssetDefinition,
  data: AssetOnChainData,
  pricePerGram18: bigint,
): AssetValuation {
  if (asset.kind === "real-estate") {
    const supply = Number(data.wrappedSupply) / 10 ** data.wrappedDecimals;
    const balance = Number(data.wrappedBalance) / 10 ** data.wrappedDecimals;
    const share = supply > 0 ? balance / supply : 0;
    return { grams: null, valueEur: (asset.appraisalValueEur ?? 0) * share };
  }

  const grams = Number(data.wrappedBalance) / 10 ** data.wrappedDecimals;
  const priceEurPerGram = Number(pricePerGram18) / 1e18;
  return { grams, valueEur: grams * priceEurPerGram };
}
