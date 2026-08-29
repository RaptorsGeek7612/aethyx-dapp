"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { TrendingUp, TrendingDown } from "lucide-react";
import { ASSETS } from "@/config/assets";
import { PortfolioAssetRow, type AssetMetrics } from "@/components/dashboard/portfolio-asset-row";
import { PortfolioRealEstateRow } from "@/components/dashboard/portfolio-real-estate-row";
import { CoverageMeter } from "@/components/reserve/coverage-meter";
import { OracleStatusTile } from "@/components/dashboard/oracle-status-tile";
import { aggregateOracleHealth } from "@/hooks/use-asset-price";

const NON_REAL_ESTATE_ASSETS = ASSETS.filter((asset) => asset.kind !== "real-estate");
const REAL_ESTATE_TIERS = ASSETS.filter((asset) => asset.kind === "real-estate");

export function PortfolioSummary() {
  const { isConnected } = useAccount();
  const [metrics, setMetrics] = useState<Record<string, AssetMetrics>>({});

  const handleMetrics = useCallback((assetId: string, m: AssetMetrics) => {
    setMetrics((prev) => {
      const existing = prev[assetId];
      if (
        existing &&
        existing.valueEur === m.valueEur &&
        existing.changeBps === m.changeBps &&
        existing.lockedNormalized === m.lockedNormalized &&
        existing.wrappedSupply === m.wrappedSupply &&
        existing.oracleHealth === m.oracleHealth
      ) {
        return prev;
      }
      return { ...prev, [assetId]: m };
    });
  }, []);

  const entries = Object.values(metrics);

  const totalValue = useMemo(() => entries.reduce((sum, m) => sum + m.valueEur, 0), [entries]);

  const weightedChangePct = useMemo(() => {
    if (totalValue <= 0) return null;
    const weighted = entries.reduce(
      (sum, m) => sum + (m.changeBps !== null ? (Number(m.changeBps) / 100) * m.valueEur : 0),
      0,
    );
    return weighted / totalValue;
  }, [entries, totalValue]);

  const totalLocked = useMemo(() => entries.reduce((sum, m) => sum + m.lockedNormalized, 0n), [entries]);
  const totalSupply = useMemo(() => entries.reduce((sum, m) => sum + m.wrappedSupply, 0n), [entries]);
  const coverageBps = totalSupply > 0n ? (totalLocked * 10_000n) / totalSupply : null;

  const oracleHealth = aggregateOracleHealth(entries.map((m) => m.oracleHealth));

  return (
    <div className="space-y-5">
      <div className="glass-card rounded-2xl p-6">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Portfolio value</p>
        {isConnected ? (
          <div className="mt-1 flex items-baseline gap-3">
            <p className="text-5xl font-semibold tracking-tight">
              {totalValue.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
            </p>
            {weightedChangePct !== null && (
              <span
                className={`flex items-center gap-1 text-sm font-medium ${weightedChangePct >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {weightedChangePct >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {weightedChangePct >= 0 ? "+" : ""}
                {weightedChangePct.toFixed(2)}%
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Connect your wallet to see your portfolio value.</p>
        )}

        <div className="mt-5 divide-y divide-white/5">
          {NON_REAL_ESTATE_ASSETS.map((asset) => (
            <PortfolioAssetRow key={asset.id} asset={asset} onMetrics={handleMetrics} />
          ))}
          {REAL_ESTATE_TIERS.length > 0 && (
            <PortfolioRealEstateRow title="Paris Property #01" tiers={REAL_ESTATE_TIERS} onMetrics={handleMetrics} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <CoverageMeter coverageBps={coverageBps} />
        <OracleStatusTile health={oracleHealth} />
      </div>
    </div>
  );
}
