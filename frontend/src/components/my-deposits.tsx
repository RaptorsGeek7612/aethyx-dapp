"use client";

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import type { AssetDefinition } from "@/config/assets";
import { useAssetPositions } from "@/hooks/use-asset-positions";
import { useLockSchedule } from "@/hooks/use-lock-schedule";
import { useNow } from "@/hooks/use-now";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount, formatCountdown } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";

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
  const { tranches } = useLockSchedule(asset);
  const nowSeconds = BigInt(Math.floor(useNow(30_000) / 1000));

  if (isLoading) return <Skeleton className="shimmer h-16 w-full rounded-xl" />;
  if (isError || positions.length === 0) return null;

  const open = positions.filter((position) => position.remaining > 0n);
  const drift = walletBalance - totalRemaining;

  // Maturity is a market-wide pool now (AUDIT.md finding 1: a per-depositor schedule was
  // reversible by self-transfer), so it can no longer be attributed to any one numbered position
  // below — the previous "align the tail of both lists" trick assumed `tranches` was this
  // wallet's own schedule, which stopped being true the moment it became the whole market's. What
  // *can* still be said accurately, from the same tranches this hook already fetched, is the
  // pool's aggregate state.
  const lockedTotal = tranches.reduce((sum, t) => (t.unlockAt > nowSeconds ? sum + t.amount : sum), 0n);
  const nextUnlockAt = tranches.find((t) => t.unlockAt > nowSeconds)?.unlockAt;

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">My deposits</p>
        <p className="text-[11px] text-muted-foreground">
          {positions.length} {positions.length === 1 ? "deposit" : "deposits"}
        </p>
      </div>

      <motion.div
        variants={staggerContainer(0.05)}
        initial="hidden"
        animate="visible"
        className="mt-2 space-y-1 text-xs"
      >
        {positions.map((position) => {
          const spent = position.remaining === 0n;

          return (
            <motion.a
              key={position.transactionHash}
              variants={fadeUp}
              href={`https://sepolia.etherscan.io/tx/${position.transactionHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/5 ${
                spent ? "text-muted-foreground line-through decoration-1" : ""
              }`}
            >
              <span className="num w-5 shrink-0 opacity-50">#{position.number}</span>

              <span className="num flex-1 truncate">
                {formatAmount(position.remaining, 18)} / {formatAmount(position.received, 18)} {symbol}
              </span>
            </motion.a>
          );
        })}
      </motion.div>

      <div className="mt-2 flex justify-between border-t border-hairline pt-2 text-xs font-medium">
        <span>{open.length === positions.length ? "Total" : `Total across ${open.length} open`}</span>
        <span className="num">
          {formatAmount(totalRemaining, 18)} {symbol}
        </span>
      </div>

      {tranches.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          {asset.title}&apos;s lock-up is market-wide, not per deposit: {formatAmount(lockedTotal, 18)} {symbol} is
          still locked across every depositor
          {nextUnlockAt !== undefined && <>, next unlock in {formatCountdown(nextUnlockAt, nowSeconds)}</>}. A
          redemption draws from whatever the whole market has matured, not from your own deposits specifically.
        </p>
      )}

      {drift !== 0n && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Your wallet holds {formatAmount(walletBalance, 18)} {symbol}, {drift > 0n ? "more" : "less"} than the{" "}
          {formatAmount(totalRemaining, 18)} above. {symbol} is a freely transferable ERC-20, so tokens moved in or out
          of this wallet leave no deposit record. Redemptions are attributed to the oldest deposit first.
        </p>
      )}
    </div>
  );
}
