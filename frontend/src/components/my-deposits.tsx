"use client";

import type { AssetDefinition } from "@/config/assets";
import { useAssetPositions } from "@/hooks/use-asset-positions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount } from "@/lib/format";

/**
 * One line per deposit, under the running total — what the holding is made of, not just how big
 * it is. Rebuilt from VaultManager's events, since the wrapped ERC-20 itself is fungible and
 * remembers nothing about where each token came from.
 *
 * That fungibility is stated rather than papered over: "remaining" attributes redemptions to the
 * oldest deposit first, a convention this UI picks, and a wallet balance that disagrees with the
 * total is shown as its own line instead of being quietly reconciled away — a transfer in or out
 * emits no VaultManager event, so it cannot appear as a deposit row.
 */
export function MyDeposits({
  asset,
  walletBalance,
  symbol,
}: {
  asset: AssetDefinition;
  walletBalance: bigint;
  symbol: string;
}) {
  const { positions, totalRemaining, isLoading, isError } = useAssetPositions(asset);

  if (isLoading) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (isError || positions.length === 0) return null;

  const open = positions.filter((position) => position.remaining > 0n);
  const drift = walletBalance - totalRemaining;

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">My deposits</p>
        <p className="text-[11px] text-muted-foreground">
          {positions.length} {positions.length === 1 ? "deposit" : "deposits"}
        </p>
      </div>

      <div className="mt-2 space-y-1 text-xs">
        {positions.map((position) => (
          <a
            key={position.transactionHash}
            href={`https://sepolia.etherscan.io/tx/${position.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-between gap-3 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5 ${
              position.remaining === 0n ? "text-muted-foreground line-through decoration-1" : ""
            }`}
          >
            <span className="shrink-0 tabular-nums opacity-70">#{position.number}</span>
            <span className="truncate opacity-70">block {position.blockNumber.toString()}</span>
            <span className="shrink-0 tabular-nums">
              {formatAmount(position.remaining, 18)} / {formatAmount(position.received, 18)} {symbol}
            </span>
          </a>
        ))}
      </div>

      <div className="mt-2 flex justify-between border-t border-white/5 pt-2 text-xs font-medium">
        <span>{open.length === positions.length ? "Total" : `Total across ${open.length} open`}</span>
        <span className="tabular-nums">
          {formatAmount(totalRemaining, 18)} {symbol}
        </span>
      </div>

      {drift !== 0n && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Your wallet holds {formatAmount(walletBalance, 18)} {symbol}, {drift > 0n ? "more" : "less"} than the{" "}
          {formatAmount(totalRemaining, 18)} above — {symbol} is a freely transferable ERC-20, so tokens moved in or out
          of this wallet leave no deposit record. Redemptions are attributed to the oldest deposit first.
        </p>
      )}
    </div>
  );
}
