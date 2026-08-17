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
    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      )}
      {sublabel && <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
    </div>
  );
}
