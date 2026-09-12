import { CheckCircle2, AlertTriangle, Loader2, HelpCircle } from "lucide-react";
import type { OracleHealth } from "@/hooks/use-asset-price";
import { STATUS_COLOR } from "@/lib/status-color";

const META: Record<OracleHealth, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  healthy: { label: "Healthy", color: STATUS_COLOR.good, Icon: CheckCircle2 },
  unavailable: { label: "Degraded", color: STATUS_COLOR.warning, Icon: AlertTriangle },
  loading: { label: "Syncing…", color: STATUS_COLOR.neutral, Icon: Loader2 },
  "not-priced": { label: "Not configured", color: STATUS_COLOR.neutral, Icon: HelpCircle },
};

export function OracleStatusTile({ health }: { health: OracleHealth }) {
  const { label, color, Icon } = META[health];

  return (
    <div className="panel p-4">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Oracle status</span>
      <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tracking-tight" style={{ color }}>
        <Icon className={`h-5 w-5 ${health === "loading" ? "animate-spin" : ""}`} aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {health === "healthy"
          ? "Median of fresh, independent sources"
          : health === "unavailable"
            ? "Too few fresh sources to aggregate"
            : "Waiting on price sources"}
      </p>
    </div>
  );
}
