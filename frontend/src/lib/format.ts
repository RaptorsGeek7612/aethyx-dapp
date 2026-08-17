import { formatUnits, parseUnits } from "viem";

export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 4): string {
  const formatted = formatUnits(value, decimals);
  const [whole, frac = ""] = formatted.split(".");
  if (!frac) return whole;
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function safeParseUnits(value: string, decimals: number): bigint | null {
  if (!value || Number.isNaN(Number(value))) return null;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Auto-compact formatting for a stat-tile value: 1,284 / 12.9K / 4.2M. */
export function formatCompactAmount(raw: bigint, decimals: number): string {
  const value = Number(formatUnits(raw, decimals));
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function formatCountdown(targetSeconds: bigint, nowSeconds: bigint): string {
  const remaining = targetSeconds - nowSeconds;
  if (remaining <= 0n) return "unlocked";
  const days = remaining / 86_400n;
  const hours = (remaining % 86_400n) / 3_600n;
  const minutes = (remaining % 3_600n) / 60n;
  if (days > 0n) return `${days}d ${hours}h`;
  if (hours > 0n) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
