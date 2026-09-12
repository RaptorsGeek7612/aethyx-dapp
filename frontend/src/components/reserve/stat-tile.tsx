import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function StatTile({
  label,
  value,
  sublabel,
  icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="shimmer mt-2 h-7 w-24" />
      ) : (
        <p className="num-display mt-1 text-2xl font-semibold">{value}</p>
      )}
      {sublabel && <p className="num mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
    </div>
  );
}
