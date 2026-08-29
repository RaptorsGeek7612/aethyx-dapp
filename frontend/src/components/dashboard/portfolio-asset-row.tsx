"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AssetActionDialog } from "@/components/asset-action-dialog";
import type { AssetDefinition } from "@/config/assets";
import { useAssetData } from "@/hooks/use-asset-data";
import { useAssetMetrics, type AssetMetrics } from "@/hooks/use-asset-metrics";
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
  ]);

  if (!data.registered) return null;

  const grams = asset.kind !== "real-estate" ? Number(data.wrappedBalance) / 10 ** data.wrappedDecimals : null;

  return (
    <div className="flex items-center gap-4 border-b border-white/5 px-1 py-3 last:border-0">
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
          <p className="text-sm font-semibold tabular-nums">
            {valueEur.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
          </p>
        ) : (
          <Skeleton className="ml-auto h-4 w-16" />
        )}
        {changeBps !== null && (
          <p
            className={`flex items-center justify-end gap-0.5 text-xs ${changeBps >= 0n ? "text-emerald-400" : "text-red-400"}`}
          >
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
  );
}
