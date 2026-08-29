"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RealEstateManageDialog } from "@/components/real-estate-manage-dialog";
import type { AssetDefinition } from "@/config/assets";
import { useAssetMetrics, type AssetMetrics } from "@/hooks/use-asset-metrics";
import { aggregateOracleHealth } from "@/hooks/use-asset-price";
import { KIND_META } from "@/lib/asset-kind-meta";

/** Reports one lock-up tier's metrics up to the group row — no UI of its own, mirrors
 *  ReserveValueReporter's pattern for the same reason: hooks can't be called in a .map() at the
 *  group row's own level, so each tier gets its own tiny component instance instead. */
function TierMetricsReporter({
  tier,
  onMetrics,
}: {
  tier: AssetDefinition;
  onMetrics: (tierId: string, metrics: AssetMetrics) => void;
}) {
  const metrics = useAssetMetrics(tier);

  useEffect(() => {
    onMetrics(tier.id, metrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tier.id,
    metrics.valueEur,
    metrics.changeBps,
    metrics.lockedNormalized,
    metrics.wrappedSupply,
    metrics.oracleHealth,
  ]);

  return null;
}

/**
 * One combined row for every real-estate lock-up tier (see RealEstateManageDialog for why they're
 * five separate on-chain markets instead of one). Sums each tier's valueEur so "my portfolio"
 * reflects the whole property position regardless of which tier(s) it's split across.
 */
export function PortfolioRealEstateRow({
  title,
  tiers,
  onMetrics,
}: {
  title: string;
  tiers: AssetDefinition[];
  onMetrics: (groupId: string, metrics: AssetMetrics) => void;
}) {
  const { isConnected } = useAccount();
  const [perTier, setPerTier] = useState<Record<string, AssetMetrics>>({});
  const Icon = KIND_META["real-estate"].icon;

  const handleTierMetrics = useCallback((tierId: string, metrics: AssetMetrics) => {
    setPerTier((prev) => {
      const existing = prev[tierId];
      if (
        existing &&
        existing.valueEur === metrics.valueEur &&
        existing.lockedNormalized === metrics.lockedNormalized &&
        existing.wrappedSupply === metrics.wrappedSupply &&
        existing.oracleHealth === metrics.oracleHealth
      ) {
        return prev;
      }
      return { ...prev, [tierId]: metrics };
    });
  }, []);

  const groupId = useMemo(() => `${tiers[0]?.label ?? "real-estate"}-group`, [tiers]);
  const entries = Object.values(perTier);
  const totalValue = entries.reduce((sum, m) => sum + m.valueEur, 0);
  const totalLocked = entries.reduce((sum, m) => sum + m.lockedNormalized, 0n);
  const totalSupply = entries.reduce((sum, m) => sum + m.wrappedSupply, 0n);
  const oracleHealth = aggregateOracleHealth(entries.map((m) => m.oracleHealth));

  useEffect(() => {
    onMetrics(groupId, {
      valueEur: totalValue,
      changeBps: null,
      lockedNormalized: totalLocked,
      wrappedSupply: totalSupply,
      oracleHealth,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, totalValue, totalLocked, totalSupply, oracleHealth]);

  return (
    <div className="flex items-center gap-4 border-b border-white/5 px-1 py-3 last:border-0">
      {tiers.map((tier) => (
        <TierMetricsReporter key={tier.id} tier={tier} onMetrics={handleTierMetrics} />
      ))}

      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${KIND_META["real-estate"].gradient}`}
      >
        <Icon className="h-4 w-4 text-black/80" strokeWidth={2.25} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{tiers.length} lock-up tiers available</p>
      </div>

      <div className="hidden text-right sm:block">
        {isConnected ? (
          <p className="text-sm font-semibold tabular-nums">
            {totalValue.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
          </p>
        ) : (
          <Skeleton className="ml-auto h-4 w-16" />
        )}
      </div>

      <RealEstateManageDialog
        title={title}
        tiers={tiers}
        trigger={
          <Button size="sm" variant="outline">
            Manage
          </Button>
        }
      />
    </div>
  );
}
