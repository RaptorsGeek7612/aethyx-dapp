import { Skeleton } from "@/components/ui/skeleton";
import { coverageSeverity, formatCoveragePct } from "@/lib/coverage";

export function CoverageMeter({ coverageBps, loading }: { coverageBps: bigint | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/5 bg-black/20 p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-2.5 w-full rounded-full" />
      </div>
    );
  }

  const { color, label, Icon } = coverageSeverity(coverageBps);
  const pct = coverageBps === null ? 0 : Number(coverageBps) / 100;
  const fillWidth = Math.min(pct, 100);

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Coverage</span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{formatCoveragePct(coverageBps)}</p>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: `${color}22` }}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${fillWidth}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
