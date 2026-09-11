"use client";

import { useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { AssetDefinition } from "@/config/assets";
import { useAssetData, type AssetOnChainData } from "@/hooks/use-asset-data";
import { useAssetPositions } from "@/hooks/use-asset-positions";
import { useAssetPrice, type OracleHealth } from "@/hooks/use-asset-price";
import { usePriceHistory } from "@/hooks/use-price-history";
import { useWrapActions, type WrapStep } from "@/hooks/use-wrap-actions";
import { computeValuation } from "@/lib/valuation";
import { formatAmount, safeParseUnits } from "@/lib/format";

const STEP_LABEL: Partial<Record<WrapStep, string>> = {
  approving: "Approving…",
  submitting: "Confirm in wallet…",
  confirming: "Waiting for confirmation…",
};

/** Single-asset deposit/redeem dialog — the one Manage entry point for every asset kind,
 *  real estate included.
 *
 *  Every opening starts from scratch: `session` increments on open and keys the form, so React
 *  discards the previous instance rather than reusing it. That resets the typed amounts, the
 *  selected tab and the in-flight step label. Relying on the dialog unmounting its own content
 *  would leave that guarantee in a third-party component's hands — a half-typed amount from the
 *  previous visit reappearing under a fresh confirmation is exactly the kind of surprise worth
 *  spending one counter to rule out. */
export function AssetActionDialog({ asset, trigger }: { asset: AssetDefinition; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSession((n) => n + 1);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="glass-card sm:max-w-md">
        <AssetDialogHeader asset={asset} />
        <AssetActionForm key={session} asset={asset} />
      </DialogContent>
    </Dialog>
  );
}

export function AssetDialogHeader({ asset }: { asset: AssetDefinition }) {
  const { data } = useAssetData(asset);
  return (
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        {asset.title}
        {data.registered && !data.active && <Badge variant="destructive">Paused</Badge>}
      </DialogTitle>
      <DialogDescription>{asset.description}</DialogDescription>
    </DialogHeader>
  );
}

/** The deposit/redeem form body for one specific asset — no Dialog/header of its own, so the
 *  parent controls those. */
export function AssetActionForm({ asset }: { asset: AssetDefinition }) {
  const { address: account } = useAccount();
  const { data, refetch } = useAssetData(asset);
  const { price, health } = useAssetPrice(asset.id, asset.pricedByOracle);
  const { changeBps } = usePriceHistory(asset.id, asset.pricedByOracle, asset.title);
  const { deposit, redeem, step } = useWrapActions();

  const [depositAmount, setDepositAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");

  const busy = step !== "idle";
  const stepLabel = STEP_LABEL[step];

  const depositAmountBn = safeParseUnits(depositAmount, data.underlyingDecimals);
  const redeemAmountBn = safeParseUnits(redeemAmount, data.wrappedDecimals);

  const depositFeePreview = depositAmountBn ? (depositAmountBn * BigInt(data.depositFeeBps)) / 10_000n : 0n;
  const redeemFeePreview = redeemAmountBn ? (redeemAmountBn * BigInt(data.redeemFeeBps)) / 10_000n : 0n;

  async function handleDeposit() {
    if (!depositAmountBn) return;
    await deposit({
      assetId: asset.id,
      amount: depositAmountBn,
      underlying: data.underlying,
      adapter: data.adapter,
      currentAllowance: data.underlyingAllowanceForAdapter,
      onSuccess: () => {
        setDepositAmount("");
        refetch();
      },
    });
  }

  async function handleRedeem() {
    if (!redeemAmountBn) return;
    await redeem({
      assetId: asset.id,
      amount: redeemAmountBn,
      wrappedToken: data.wrappedToken,
      currentAllowance: data.wrappedAllowanceForVault,
      onSuccess: () => {
        setRedeemAmount("");
        refetch();
      },
    });
  }

  return (
    <>
      {account && data.registered && (
        <>
          <MyHoldingSummary asset={asset} data={data} price={price} priceHealth={health} changeBps={changeBps} />
          <MyDeposits asset={asset} walletBalance={data.wrappedBalance} symbol={data.wrappedSymbol} />
        </>
      )}

      {!account ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Connect your wallet to continue.</p>
      ) : !data.registered ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          This asset isn&apos;t registered on VaultManager yet.
        </p>
      ) : (
        <Tabs defaultValue="deposit">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="redeem">Redeem</TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="deposit-amount">Amount ({data.underlyingSymbol})</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setDepositAmount(formatAmount(data.underlyingBalance, data.underlyingDecimals, 18))}
                >
                  Balance: {formatAmount(data.underlyingBalance, data.underlyingDecimals)}
                </button>
              </div>
              <Input
                id="deposit-amount"
                inputMode="decimal"
                placeholder="0.0"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-1 rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Protocol fee ({(data.depositFeeBps / 100).toFixed(2)}%)</span>
                <span>
                  -{formatAmount(depositFeePreview, data.underlyingDecimals)} {data.underlyingSymbol}
                </span>
              </div>
              <div className="flex justify-between font-medium text-foreground">
                <span>You receive</span>
                <span>
                  {depositAmountBn ? formatAmount(depositAmountBn - depositFeePreview, data.underlyingDecimals) : "0"}{" "}
                  {data.wrappedSymbol}
                </span>
              </div>
            </div>

            <Button className="w-full" disabled={!depositAmountBn || busy || !data.active} onClick={handleDeposit}>
              {busy ? stepLabel : `Deposit ${data.underlyingSymbol}`}
            </Button>
          </TabsContent>

          <TabsContent value="redeem" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="redeem-amount">Amount ({data.wrappedSymbol})</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setRedeemAmount(formatAmount(data.wrappedBalance, data.wrappedDecimals, 18))}
                >
                  Balance: {formatAmount(data.wrappedBalance, data.wrappedDecimals)}
                </button>
              </div>
              <Input
                id="redeem-amount"
                inputMode="decimal"
                placeholder="0.0"
                value={redeemAmount}
                onChange={(event) => setRedeemAmount(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-1 rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Protocol fee ({(data.redeemFeeBps / 100).toFixed(2)}%)</span>
                <span>
                  -{formatAmount(redeemFeePreview, data.wrappedDecimals)} {data.wrappedSymbol}
                </span>
              </div>
              <div className="flex justify-between font-medium text-foreground">
                <span>You receive</span>
                <span>
                  {redeemAmountBn ? formatAmount(redeemAmountBn - redeemFeePreview, data.underlyingDecimals) : "0"}{" "}
                  {data.underlyingSymbol}
                </span>
              </div>
            </div>

            <Button
              className="w-full"
              variant="secondary"
              disabled={!redeemAmountBn || busy || !data.active}
              onClick={handleRedeem}
            >
              {busy ? stepLabel : `Redeem ${data.wrappedSymbol}`}
            </Button>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

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
function MyDeposits({
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

function MyHoldingSummary({
  asset,
  data,
  price,
  priceHealth,
  changeBps,
}: {
  asset: AssetDefinition;
  data: AssetOnChainData;
  price: bigint;
  priceHealth: OracleHealth;
  changeBps: bigint | null;
}) {
  const { grams, valueEur } = computeValuation(asset, data, price);

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">My portfolio</p>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="text-2xl font-semibold tracking-tight">
          {formatAmount(data.wrappedBalance, data.wrappedDecimals)} {data.wrappedSymbol}
        </p>
        {changeBps !== null && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${changeBps >= 0n ? "text-emerald-400" : "text-red-400"}`}
          >
            {changeBps >= 0n ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {(Number(changeBps) / 100).toFixed(2)}% today
          </span>
        )}
      </div>
      {grams !== null && (
        <p className="text-xs text-muted-foreground">
          {grams.toLocaleString(undefined, { maximumFractionDigits: 1 })} grams
        </p>
      )}
      <p className="mt-1 text-lg font-medium text-primary">
        {valueEur.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
      </p>
      {asset.pricedByOracle && (
        <p className="mt-1 text-xs text-muted-foreground">
          {priceHealth === "healthy"
            ? `Live price: ${(Number(price) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} €/g`
            : "Oracle price unavailable"}
        </p>
      )}
    </div>
  );
}
