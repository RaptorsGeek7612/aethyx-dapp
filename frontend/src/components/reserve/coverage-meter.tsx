import { Skeleton } from "@/components/ui/skeleton";
import { coverageSeverity, formatCoveragePct } from "@/lib/coverage";

export function CoverageMeter({ coverageBps, loading }: { coverageBps: bigint | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="panel p-4">
        <Skeleton className="shimmer h-4 w-28" />
        <Skeleton className="shimmer mt-3 h-2 w-full rounded-full" />
      </div>
    );
  }

  const { color, label, Icon } = coverageSeverity(coverageBps);
  const pct = coverageBps === null ? 0 : Number(coverageBps) / 100;
  const fillWidth = Math.min(pct, 100);

  return (
    // `--meter-color` descend jusqu'à la jauge, qui en dérive elle-même son fond : une seule
    // couleur passée, deux surfaces accordées, sans calculer d'opacité dans le composant.
    <div className="panel p-4" style={{ ["--meter-color" as string]: color }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Coverage</span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </span>
      </div>
      <p className="num-display mt-1 text-2xl font-semibold">{formatCoveragePct(coverageBps)}</p>
      <div
        className="meter mt-2.5"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Collateral coverage"
      >
        <div style={{ width: `${fillWidth}%` }} />
      </div>
    </div>
  );
}
