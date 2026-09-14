"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ASSETS } from "@/config/assets";
import { ReserveValueReporter } from "@/components/reserve/reserve-value-reporter";
import { aggregateOracleHealth, type OracleHealth } from "@/hooks/use-asset-price";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sum of every registered asset's reserve value, in EUR — gold and silver at the live oracle
 * price, real estate at its static appraisal. Each ReserveValueReporter computes its own asset's
 * contribution (protocol-wide, not a connected wallet's) and reports it up here to total.
 */
export function ReserveTotal() {
  const [values, setValues] = useState<Record<string, number>>({});
  const [healths, setHealths] = useState<Record<string, OracleHealth>>({});

  const handleValue = useCallback((assetId: string, valueEur: number, health: OracleHealth) => {
    setValues((prev) => (prev[assetId] === valueEur ? prev : { ...prev, [assetId]: valueEur }));
    setHealths((prev) => (prev[assetId] === health ? prev : { ...prev, [assetId]: health }));
  }, []);

  const total = useMemo(() => Object.values(values).reduce((sum, v) => sum + v, 0), [values]);
  const haveAllValues = Object.keys(values).length === ASSETS.length;
  const oracleHealth = aggregateOracleHealth(Object.values(healths));
  const degraded = oracleHealth === "unavailable";

  return (
    <div className="glass-card mb-5 rounded-2xl p-6">
      {ASSETS.map((asset) => (
        <ReserveValueReporter key={asset.id} asset={asset} onValue={handleValue} />
      ))}

      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Total reserve value</p>
      {haveAllValues ? (
        <p className="num-live mt-1 bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-5xl font-semibold text-transparent">
          {total.toLocaleString(undefined, {
            style: "currency",
            currency: "EUR",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      ) : (
        <Skeleton className="mt-2 h-10 w-48" />
      )}

      {degraded ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-status-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          The gold and/or silver price feed has too few fresh sources right now. The total above excludes them until the
          oracle recovers, so it under-states actual reserve value.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Sum of collateral actually locked across every registered asset: gold and silver valued at the live oracle
          price, real estate at its static appraisal.
        </p>
      )}
    </div>
  );
}
