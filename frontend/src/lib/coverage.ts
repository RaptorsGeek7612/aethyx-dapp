import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { STATUS_COLOR } from "@/lib/status-color";

/**
 * Locked-collateral-vs-minted-supply coverage, as a status. Shared by every view that shows the
 * figure — the Reserve page's per-asset cards and the dashboard's portfolio-wide rollup — so they
 * can't drift on where "under-covered" starts or which color says so. `null` means nothing has
 * been minted yet, which is neither covered nor under-covered.
 *
 * The icon travels with the color on purpose: the severity has to survive a reader who can't
 * separate the two hues, and a colored figure alone wouldn't.
 */
export function coverageSeverity(coverageBps: bigint | null): {
  color: string;
  label: string;
  Icon: typeof CheckCircle2;
} {
  if (coverageBps === null) return { color: STATUS_COLOR.warning, label: "No supply minted yet", Icon: AlertTriangle };
  if (coverageBps >= 10_000n) return { color: STATUS_COLOR.good, label: "Fully covered", Icon: CheckCircle2 };
  if (coverageBps >= 9_500n) return { color: STATUS_COLOR.warning, label: "Under-covered", Icon: AlertTriangle };
  return { color: STATUS_COLOR.critical, label: "Severely under-covered", Icon: XCircle };
}

/** Basis points rendered as a percentage. Two decimals is exactly the precision bps carry, so
 *  this is lossless — and it's the reason not to round any shorter: 9,960 bps is an under-covered
 *  99.60%, and a whole-number "100%" next to an under-covered warning icon would hide precisely
 *  the shortfall this page exists to surface. */
export function formatCoveragePct(coverageBps: bigint | null): string {
  return coverageBps === null ? "—" : `${(Number(coverageBps) / 100).toFixed(2)}%`;
}
