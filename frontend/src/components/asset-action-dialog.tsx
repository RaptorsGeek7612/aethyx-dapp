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
import { TrendingUp, TrendingDown } from "lucide-react";
import type { AssetDefinition } from "@/config/assets";
import { useAssetData, type AssetOnChainData } from "@/hooks/use-asset-data";
import { useAssetPrice, type OracleHealth } from "@/hooks/use-asset-price";
import { usePriceHistory } from "@/hooks/use-price-history";
import { useWrapActions, type WrapStep } from "@/hooks/use-wrap-actions";
import { useNow } from "@/hooks/use-now";
import { computeValuation } from "@/lib/valuation";
import { formatAmount, formatCountdown, formatDuration, safeParseUnits } from "@/lib/format";
import { CANONICAL_DECIMALS } from "@/lib/decimals";

const STEP_LABEL: Partial<Record<WrapStep, string>> = {
  approving: "Approving…",
  submitting: "Confirm in wallet…",
  confirming: "Waiting for confirmation…",
};

/** Single-asset deposit/redeem dialog — the one Manage entry point for every asset kind,
 *  real estate included. */
export function AssetActionDialog({ asset, trigger }: { asset: AssetDefinition; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="glass-card sm:max-w-md">
        <AssetDialogHeader asset={asset} />
        <AssetActionForm asset={asset} />
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

  const now = useNow(30_000);
  const nowSeconds = BigInt(Math.floor(now / 1000));

  // Real estate paces how fast collateral can leave the market, not who may take it out (see
  // RealEstateAdapter.sol): every deposit adds a tranche that matures on its own schedule, and
  // any redemption — whoever makes it — draws on the pool that has already matured. So the cap
  // is a property of the market, identical for every holder, and it only bites while some of
  // the market's collateral is still inside its lock-up.
  const hasLockedTranches = data.lockedNow !== null && data.lockedNow > 0n;
  const maturedAmount = data.maturedNow ?? 0n;
  // The adapter checks the amount it is asked to release, which is net of the redeem fee.
  const redeemNetPreview = redeemAmountBn ? redeemAmountBn - redeemFeePreview : 0n;
  const exceedsMatured = hasLockedTranches && redeemNetPreview > maturedAmount;
  const nothingRedeemable = hasLockedTranches && maturedAmount === 0n;

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
        <MyHoldingSummary asset={asset} data={data} price={price} priceHealth={health} changeBps={changeBps} />
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
              {/* Read off the adapter's immutable lockupPeriod, not chosen here: the holding
                  period is a property of the market being deposited into. */}
              {data.lockupPeriod !== null && (
                <div className="flex justify-between">
                  <span>Lock-up before redemption</span>
                  <span>{formatDuration(data.lockupPeriod)}</span>
                </div>
              )}
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

            {hasLockedTranches && data.lockedNow !== null && (
              <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
                <p className="pb-0.5 font-medium">This market&apos;s collateral</p>
                <div className="flex justify-between">
                  <span>Redeemable now</span>
                  <span className="tabular-nums">
                    {formatAmount(maturedAmount, CANONICAL_DECIMALS)} {data.wrappedSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Still locked</span>
                  <span className="tabular-nums">
                    {formatAmount(data.lockedNow, CANONICAL_DECIMALS)} {data.wrappedSymbol}
                  </span>
                </div>
                <LockSchedule schedule={data.lockSchedule} symbol={data.wrappedSymbol} nowSeconds={nowSeconds} />
              </div>
            )}

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
              disabled={!redeemAmountBn || busy || !data.active || exceedsMatured}
              onClick={handleRedeem}
            >
              {busy
                ? stepLabel
                : nothingRedeemable
                  ? "Locked"
                  : exceedsMatured
                    ? "Exceeds what has matured"
                    : `Redeem ${data.wrappedSymbol}`}
            </Button>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

/**
 * One row per deposit still on the market's books, each with its own countdown — never a single
 * merged total. Deposits don't accumulate into one schedule on-chain (RealEstateAdapter pushes a
 * fresh Lock per deposit and sweeps them front-to-back), so one aggregated unlock date would
 * misrepresent a market fed by several deposits: the earliest tranche frees up on its own
 * regardless of anything deposited later.
 *
 * These are the market's tranches, not the viewer's own, because the gate is market-wide —
 * showing "your" schedule would promise a redemption date the adapter does not honour.
 */
function LockSchedule({
  schedule,
  symbol,
  nowSeconds,
}: {
  schedule: readonly { amount: bigint; unlockAt: bigint }[] | null;
  symbol: string;
  nowSeconds: bigint;
}) {
  const pending = (schedule ?? []).filter((tranche) => tranche.unlockAt > nowSeconds);
  if (pending.length === 0) return null;

  return (
    <div className="space-y-1 border-t border-primary/20 pt-1.5">
      <p className="opacity-80">
        {pending.length === 1 ? "1 deposit still locked" : `${pending.length} deposits still locked`} across this
        market, each on its own schedule:
      </p>
      {pending.map((tranche, index) => (
        <div key={`${tranche.unlockAt}-${index}`} className="flex justify-between gap-3 opacity-90">
          <span className="tabular-nums">
            {formatAmount(tranche.amount, CANONICAL_DECIMALS)} {symbol}
          </span>
          <span className="shrink-0 tabular-nums" title={new Date(Number(tranche.unlockAt) * 1000).toLocaleString()}>
            frees up in {formatCountdown(tranche.unlockAt, nowSeconds)}
          </span>
        </div>
      ))}
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
