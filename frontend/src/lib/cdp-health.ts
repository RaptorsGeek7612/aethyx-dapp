import { ShieldCheck, AlertTriangle, Siren, MinusCircle } from "lucide-react";
import { STATUS_COLOR } from "@/lib/status-color";

/**
 * Position health, derived the same way CDPManager itself gates actions: healthy above
 * `minCollateralRatioBps` (where minting/opening is allowed), a shrinking-margin warning between
 * that and `liquidationThresholdBps`, liquidatable below it. Mirrors `coverageSeverity` in
 * lib/coverage.ts — same shape, same rule that the icon travels with the color.
 */
export function cdpHealthSeverity(
  ratioBps: bigint,
  noDebtSentinel: bigint,
  minCollateralRatioBps: number,
  liquidationThresholdBps: number,
): { color: string; label: string; Icon: typeof ShieldCheck } {
  if (ratioBps === noDebtSentinel)
    return { color: STATUS_COLOR.neutral, label: "No debt outstanding", Icon: MinusCircle };
  if (ratioBps < BigInt(liquidationThresholdBps))
    return { color: STATUS_COLOR.critical, label: "Liquidatable", Icon: Siren };
  if (ratioBps < BigInt(minCollateralRatioBps)) {
    return { color: STATUS_COLOR.warning, label: "Below target ratio", Icon: AlertTriangle };
  }
  return { color: STATUS_COLOR.good, label: "Healthy", Icon: ShieldCheck };
}

/** Basis points as a percentage, one decimal — a collateral ratio reads naturally as "230.4%",
 *  unlike coverage's two decimals where the last digit was the whole point. */
export function formatRatioPct(ratioBps: bigint, noDebtSentinel: bigint): string {
  if (ratioBps === noDebtSentinel) return "—";
  return `${(Number(ratioBps) / 100).toFixed(1)}%`;
}
