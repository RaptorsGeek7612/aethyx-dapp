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

/** A contract-configured duration in seconds, in the coarsest unit that divides it exactly —
 *  "1 year" rather than "365 days". Lock-up periods are set in whole days/months/years, so an
 *  exact division is the normal case; anything else falls back to days. */
export function formatDuration(seconds: bigint): string {
  const units: [bigint, string][] = [
    [31_536_000n, "year"],
    [2_592_000n, "month"],
    [604_800n, "week"],
    [86_400n, "day"],
    [3_600n, "hour"],
    [60n, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0n) {
      const count = seconds / size;
      return `${count} ${name}${count === 1n ? "" : "s"}`;
    }
  }
  if (seconds >= 86_400n) return `${seconds / 86_400n} days`;
  return `${seconds} seconds`;
}
