"use client";

import { useMemo, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, TriangleAlert } from "lucide-react";
import { formatUnits } from "viem";
import { useTransactionHistory, type HistoryEntry } from "@/hooks/use-transaction-history";
import { useCdpActivity, type CdpActivityEntry } from "@/hooks/use-cdp-activity";
import { ASSETS, LEGACY_ASSET_LABELS } from "@/config/assets";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const SEPOLIA_EXPLORER_TX = "https://sepolia.etherscan.io/tx/";

function assetTitle(assetId: HistoryEntry["assetId"]) {
  return ASSETS.find((a) => a.id === assetId)?.title ?? LEGACY_ASSET_LABELS[assetId] ?? "Unknown asset";
}

// Every wrapped and underlying token in this deployment uses 18 decimals (GLDToken always mints
// at 18; MockERC3643 demo tokens were all deployed with 18 too, and so does the CDP module's own
// GLD/ioEUR pair) — safe to format history amounts without an extra per-asset decimals lookup for
// each row.
function formatEntryAmount(amount: bigint) {
  return Number(formatUnits(amount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

type LedgerRow =
  | { origin: "gateway"; blockNumber: bigint; transactionHash: HistoryEntry["transactionHash"]; entry: HistoryEntry }
  | {
      origin: "cdp";
      blockNumber: bigint;
      transactionHash: CdpActivityEntry["transactionHash"];
      entry: CdpActivityEntry;
    };

const CDP_ROW_META: Record<CdpActivityEntry["type"], { label: string; direction: "in" | "out" | "alert" }> = {
  "collateral-deposit": { label: "Lock collateral", direction: "in" },
  "collateral-withdraw": { label: "Unlock collateral", direction: "out" },
  mint: { label: "Borrow ioEUR", direction: "in" },
  repay: { label: "Repay ioEUR", direction: "out" },
  liquidated: { label: "Position liquidated", direction: "alert" },
  liquidator: { label: "Liquidation executed", direction: "alert" },
};

export function TransactionHistory() {
  const { isConnected } = useAccount();
  const gateway = useTransactionHistory();
  const cdp = useCdpActivity();

  const rows = useMemo<LedgerRow[]>(() => {
    const gatewayRows: LedgerRow[] = gateway.entries.map((entry) => ({
      origin: "gateway",
      blockNumber: entry.blockNumber,
      transactionHash: entry.transactionHash,
      entry,
    }));
    const cdpRows: LedgerRow[] = cdp.entries.map((entry) => ({
      origin: "cdp",
      blockNumber: entry.blockNumber,
      transactionHash: entry.transactionHash,
      entry,
    }));
    return [...gatewayRows, ...cdpRows].sort((a, b) => Number(b.blockNumber - a.blockNumber));
  }, [gateway.entries, cdp.entries]);

  const isLoading = gateway.isLoading || cdp.isLoading;
  // Either feed erroring is enough to say so — a half-populated ledger reads as complete
  // otherwise, hiding exactly the gap a depositor would want flagged.
  const isError = gateway.isError || cdp.isError;
  const refetch = () => {
    gateway.refetch();
    cdp.refetch();
  };

  return (
    <div className="glass-card rounded-2xl p-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>

      {!isConnected ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Connect your wallet to see your deposit, redeem, and credit facility history.
        </p>
      ) : isLoading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <div className="panel mt-3 flex items-center justify-between gap-3 p-3 text-sm text-muted-foreground">
          <span>Couldn&apos;t load activity: the RPC endpoint didn&apos;t respond in time.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-hairline">
          {rows.map((row) =>
            row.origin === "gateway" ? (
              <GatewayRow key={row.transactionHash} entry={row.entry} />
            ) : (
              <CdpRow key={`${row.transactionHash}-${row.entry.type}`} entry={row.entry} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LedgerLink({
  transactionHash,
  tone,
  icon,
  title,
  subtitle,
}: {
  transactionHash: string;
  tone: "in" | "out" | "alert";
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <a
      href={`${SEPOLIA_EXPLORER_TX}${transactionHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hairline"
    >
      <div
        className={`panel flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tone === "in" ? "text-primary" : tone === "alert" ? "text-status-critical" : "text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

function GatewayRow({ entry }: { entry: HistoryEntry }) {
  return (
    <LedgerLink
      transactionHash={entry.transactionHash}
      tone={entry.type === "deposit" ? "in" : "out"}
      icon={
        entry.type === "deposit" ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />
      }
      title={`${entry.type === "deposit" ? "Deposit" : "Redeem (burn)"} · ${assetTitle(entry.assetId)}`}
      subtitle={`${formatEntryAmount(entry.amount)} in · ${formatEntryAmount(entry.received)} received${
        entry.fee > 0n ? ` · fee ${formatEntryAmount(entry.fee)}` : ""
      }`}
    />
  );
}

function CdpRow({ entry }: { entry: CdpActivityEntry }) {
  const meta = CDP_ROW_META[entry.type];
  return (
    <LedgerLink
      transactionHash={entry.transactionHash}
      tone={meta.direction}
      icon={
        meta.direction === "alert" ? (
          <TriangleAlert className="h-4 w-4" />
        ) : meta.direction === "in" ? (
          <ArrowDownToLine className="h-4 w-4" />
        ) : (
          <ArrowUpFromLine className="h-4 w-4" />
        )
      }
      title={`${meta.label} · ${assetTitle(entry.collateralId)}`}
      subtitle={`${formatEntryAmount(entry.amount)} ${entry.type === "mint" || entry.type === "repay" ? "ioEUR" : entry.type.startsWith("liquidat") ? "debt repaid" : "collateral"}`}
    />
  );
}
