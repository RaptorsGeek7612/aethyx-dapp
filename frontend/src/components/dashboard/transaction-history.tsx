"use client";

import { useAccount } from "wagmi";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";
import { useTransactionHistory, type HistoryEntry } from "@/hooks/use-transaction-history";
import { ASSETS, LEGACY_ASSET_LABELS } from "@/config/assets";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const SEPOLIA_EXPLORER_TX = "https://sepolia.etherscan.io/tx/";

function assetTitle(assetId: HistoryEntry["assetId"]) {
  return ASSETS.find((a) => a.id === assetId)?.title ?? LEGACY_ASSET_LABELS[assetId] ?? "Unknown asset";
}

// Every wrapped and underlying token in this deployment uses 18 decimals (GLDToken always mints
// at 18; MockERC3643 demo tokens were all deployed with 18 too) — safe to format history amounts
// without an extra per-asset decimals lookup for each row.
function formatEntryAmount(amount: bigint) {
  return Number(formatUnits(amount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function TransactionHistory() {
  const { isConnected } = useAccount();
  const { entries, isLoading, isError, refetch } = useTransactionHistory();

  return (
    <div className="glass-card rounded-2xl p-6">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Activity</p>

      {!isConnected ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Connect your wallet to see your deposit and redeem history.
        </p>
      ) : isLoading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 p-3 text-sm text-muted-foreground">
          <span>Couldn&apos;t load activity — the RPC endpoint didn&apos;t respond in time.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No deposits or redemptions yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-white/5">
          {entries.map((entry) => (
            <a
              key={entry.transactionHash}
              href={`${SEPOLIA_EXPLORER_TX}${entry.transactionHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 py-3 text-sm transition-colors hover:bg-white/5"
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  entry.type === "deposit" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {entry.type === "deposit" ? (
                  <ArrowDownToLine className="h-4 w-4" />
                ) : (
                  <ArrowUpFromLine className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {entry.type === "deposit" ? "Deposit" : "Redeem (burn)"} — {assetTitle(entry.assetId)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatEntryAmount(entry.amount)} in · {formatEntryAmount(entry.received)} received
                  {entry.fee > 0n && <> · fee {formatEntryAmount(entry.fee)}</>}
                </p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
