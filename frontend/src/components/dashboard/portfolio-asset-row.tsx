"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { TrendingUp, TrendingDown, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AssetActionDialog } from "@/components/asset-action-dialog";
import { MyDeposits } from "@/components/my-deposits";
import type { AssetDefinition } from "@/config/assets";
import { useAssetData } from "@/hooks/use-asset-data";
import { useAssetMetrics, type AssetMetrics } from "@/hooks/use-asset-metrics";
import { useCdpPosition } from "@/hooks/use-cdp";
import { useAssetPrice } from "@/hooks/use-asset-price";
import { isCdpConfigured } from "@/config/contracts";
import { formatAmount } from "@/lib/format";
import { KIND_META } from "@/lib/asset-kind-meta";

export type { AssetMetrics };

export function PortfolioAssetRow({
  asset,
  onMetrics,
}: {
  asset: AssetDefinition;
  onMetrics: (assetId: string, metrics: AssetMetrics) => void;
}) {
  const { isConnected } = useAccount();
  const { data } = useAssetData(asset);
  const metrics = useAssetMetrics(asset);
  const { valueEur, changeBps } = metrics;
  const Icon = KIND_META[asset.kind].icon;

  useEffect(() => {
    onMetrics(asset.id, metrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    asset.id,
    metrics.valueEur,
    metrics.changeBps,
    metrics.lockedNormalized,
    metrics.wrappedSupply,
    metrics.oracleHealth,
    metrics.cdpCollateralValueEur,
    metrics.cdpDebtValueEur,
  ]);

  if (!data.registered) return null;

  const grams = asset.kind !== "real-estate" ? Number(data.wrappedBalance) / 10 ** data.wrappedDecimals : null;

  return (
    <div className="rule py-3">
      <div className="flex items-center gap-4 px-1">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${KIND_META[asset.kind].gradient}`}
        >
          <Icon className="h-4 w-4 text-black/80" strokeWidth={2.25} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{asset.title}</p>
          <p className="text-xs text-muted-foreground">
            {isConnected ? formatAmount(data.wrappedBalance, data.wrappedDecimals) : "—"} {data.wrappedSymbol}
            {grams !== null && isConnected && ` · ${grams.toLocaleString(undefined, { maximumFractionDigits: 1 })} g`}
          </p>
        </div>

        <div className="hidden text-right sm:block">
          {isConnected ? (
            <p className="num text-sm font-semibold">
              {(valueEur + metrics.cdpCollateralValueEur).toLocaleString(undefined, {
                style: "currency",
                currency: "EUR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          ) : (
            <Skeleton className="ml-auto h-4 w-16" />
          )}
          {changeBps !== null && (
            <p className={`pill mt-1 ${changeBps >= 0n ? "pill-up" : "pill-down"}`}>
              {changeBps >= 0n ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {(Number(changeBps) / 100).toFixed(2)}%
            </p>
          )}
        </div>

        <AssetActionDialog
          asset={asset}
          trigger={
            <Button size="sm" variant="outline">
              Manage
            </Button>
          }
        />
      </div>

      {/* Every asset, the same way: the row's figure is the fungible total, and this is what it is
          made of. Shown inline rather than behind the Manage dialog, because a holding built from
          several deposits reads as one merged number everywhere else. */}
      {isConnected && (
        <div className="mt-2.5 space-y-1.5 pl-[3.25rem] pr-1">
          <MyDeposits asset={asset} walletBalance={data.wrappedBalance} symbol={data.wrappedSymbol} />
          <CdpCollateralNote asset={asset} />
        </div>
      )}
    </div>
  );
}

/** Gold/silver locked into the Credit Facility leaves the wallet balance shown above — this is
 *  the "where did the rest of it go" answer, exact down to the token and its euro value, so it
 *  doesn't read as missing next to a wallet balance that no longer includes it (the row total
 *  above adds it straight back in, via useAssetMetrics' cdpCollateralValueEur). */
function CdpCollateralNote({ asset }: { asset: AssetDefinition }) {
  const { registered, data } = useCdpPosition(asset.id);
  const { price, health } = useAssetPrice(asset.id, asset.pricedByOracle);

  if (!isCdpConfigured || !asset.pricedByOracle || !registered || data.collateralAmount === 0n) return null;

  const units = Number(data.collateralAmount) / 10 ** data.wrappedDecimals;
  const valueEur = health === "healthy" ? units * (Number(price) / 1e18) : null;

  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Lock className="h-3 w-3 shrink-0" aria-hidden />
      {formatAmount(data.collateralAmount, data.wrappedDecimals)} {data.wrappedSymbol}
      {valueEur !== null &&
        ` (${valueEur.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}{" "}
      of this is locked as Credit Facility collateral.
    </p>
  );
}
