"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { TrendingUp, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { ASSETS } from "@/config/assets";
import { PortfolioAssetRow, type AssetMetrics } from "@/components/dashboard/portfolio-asset-row";
import { CoverageMeter } from "@/components/reserve/coverage-meter";
import { OracleStatusTile } from "@/components/dashboard/oracle-status-tile";
import { aggregateOracleHealth } from "@/hooks/use-asset-price";

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

  // Gross assets (wallet + whatever's locked as Credit Facility collateral) minus ioEUR debt
  // minted against them — a mint has to show up here as a deduction, not vanish, or the total
  // reads as if borrowing were free money. See feedback from 2026-09-13: "les mints doivent être
  // cohérents, et systématiquement déduits".
  const grossValue = useMemo(
    () => entries.reduce((sum, m) => sum + m.valueEur + m.cdpCollateralValueEur, 0),
    [entries],
  );
  const totalDebt = useMemo(() => entries.reduce((sum, m) => sum + m.cdpDebtValueEur, 0), [entries]);
  const totalValue = grossValue - totalDebt;

  const weightedChangePct = useMemo(() => {
    if (grossValue <= 0) return null;
    const weighted = entries.reduce(
      (sum, m) =>
        sum + (m.changeBps !== null ? (Number(m.changeBps) / 100) * (m.valueEur + m.cdpCollateralValueEur) : 0),
      0,
    );
    return weighted / grossValue;
  }, [entries, grossValue]);

  const totalLocked = useMemo(() => entries.reduce((sum, m) => sum + m.lockedNormalized, 0n), [entries]);
  const totalSupply = useMemo(() => entries.reduce((sum, m) => sum + m.wrappedSupply, 0n), [entries]);
  const coverageBps = totalSupply > 0n ? (totalLocked * 10_000n) / totalSupply : null;

  const oracleHealth = aggregateOracleHealth(entries.map((m) => m.oracleHealth));

  const formatEur = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="visible" className="space-y-5">
      <motion.div variants={fadeUp} className="glass-card glass-card-hover rounded-2xl p-6">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="live-dot relative inline-block h-1.5 w-1.5 rounded-full bg-primary text-primary" />
          Portfolio value
        </p>
        {isConnected ? (
          <div className="mt-1 flex items-baseline gap-3">
            <AnimatedNumber
              value={totalValue}
              format={formatEur}
              className="num-live bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-5xl font-semibold text-transparent"
            />
            {weightedChangePct !== null && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35, duration: 0.4 }}
                className={`pill text-sm ${weightedChangePct >= 0 ? "pill-up" : "pill-down"}`}
              >
                {weightedChangePct >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {weightedChangePct >= 0 ? "+" : ""}
                {weightedChangePct.toFixed(2)}%
              </motion.span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Connect your wallet to see your portfolio value.</p>
        )}

        {isConnected && totalDebt > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatEur(grossValue)} in assets − {formatEur(totalDebt)} in ioEUR Credit Facility debt
          </p>
        )}

        <div className="mt-5 divide-y divide-hairline">
          {ASSETS.map((asset) => (
            <PortfolioAssetRow key={asset.id} asset={asset} onMetrics={handleMetrics} />
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <CoverageMeter coverageBps={coverageBps} />
        <OracleStatusTile health={oracleHealth} />
      </motion.div>
    </motion.div>
  );
}
