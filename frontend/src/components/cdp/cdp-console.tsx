"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { isAddress, type Address } from "viem";
import { TriangleAlert, Crosshair } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ASSETS } from "@/config/assets";
import { isCdpConfigured } from "@/config/contracts";
import { useCdpPosition } from "@/hooks/use-cdp";
import { useCdpActions, type CdpStep } from "@/hooks/use-cdp-actions";
import { useNow } from "@/hooks/use-now";
import { formatAmount, safeParseUnits } from "@/lib/format";
import { cdpHealthSeverity, formatRatioPct } from "@/lib/cdp-health";

const NO_DEBT_RATIO = 2n ** 256n - 1n;

// GOLD is the only collateral deploy-cdp.ts registers today — see backend/scripts/deploy-cdp.ts.
// Reusing ASSETS[0] rather than hardcoding the id keeps this in lockstep with whatever label the
// core protocol actually registers GOLD's wrapped token under.
const COLLATERAL = ASSETS[0];

const STEP_LABEL: Partial<Record<CdpStep, string>> = {
  approving: "Approving…",
  submitting: "Confirm in wallet…",
  confirming: "Waiting for confirmation…",
};

export function CdpConsole() {
  const { address: account } = useAccount();

  if (!isCdpConfigured) {
    return (
      <div
        className="hud-panel flex items-start gap-3 p-4 text-sm"
        style={{ ["--hud-accent" as string]: "var(--status-warning)" }}
      >
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
        <p className="text-muted-foreground">
          The CDP module isn&apos;t deployed on this network yet. Run{" "}
          <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs text-foreground">
            hardhat run scripts/deploy-cdp.ts
          </code>{" "}
          from <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs text-foreground">backend/</code>{" "}
          and set{" "}
          <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs text-foreground">
            NEXT_PUBLIC_CDP_MANAGER_ADDRESS
          </code>{" "}
          /{" "}
          <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs text-foreground">
            NEXT_PUBLIC_STABLE_TOKEN_ADDRESS
          </code>{" "}
          in <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs text-foreground">.env.local</code>.
        </p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="hud-panel p-10 text-center text-sm text-muted-foreground hud-scanlines">
        Connect your wallet to open the console.
      </div>
    );
  }

  return <ConnectedConsole />;
}

function ConnectedConsole() {
  const { data, registered, hasNoDebt, isLoading, refetch } = useCdpPosition(COLLATERAL.id);
  const now = useNow(1000);

  if (!registered) {
    return (
      <div className="hud-panel p-10 text-center text-sm text-muted-foreground hud-scanlines">
        {isLoading ? "Reading collateral registry…" : `${COLLATERAL.label} isn't registered as CDP collateral yet.`}
      </div>
    );
  }

  const severity = cdpHealthSeverity(
    data.ratioBps,
    NO_DEBT_RATIO,
    data.minCollateralRatioBps,
    data.liquidationThresholdBps,
  );

  // Position on a 0–300% gauge, clamped: past 300% the exact number stops mattering for "how much
  // margin is left" at a glance, which is all this bar is for — the readout above it carries the
  // precise figure.
  const gaugeMax = 30_000;
  const gaugePct = hasNoDebt ? 100 : Math.min((Number(data.ratioBps) / gaugeMax) * 100, 100);
  const liqMarkerPct = Math.min((data.liquidationThresholdBps / gaugeMax) * 100, 100);
  const minMarkerPct = Math.min((data.minCollateralRatioBps / gaugeMax) * 100, 100);

  return (
    <div className="space-y-6">
      <div className="hud-panel p-6" style={{ ["--hud-accent" as string]: severity.color }}>
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="hud-tag">
              <span
                className="live-dot relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ color: severity.color }}
              />
              {COLLATERAL.label} / IOEUR
            </span>
            <span className="hud-tag" style={{ ["--hud-accent" as string]: severity.color }}>
              <severity.Icon className="h-3 w-3" aria-hidden />
              {severity.label}
            </span>
          </div>
          <span className="hud-readout text-xs text-muted-foreground">
            {new Date(now).toISOString().slice(11, 19)} UTC
          </span>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Readout
            label="Collateral locked"
            value={`${formatAmount(data.collateralAmount, data.wrappedDecimals)}`}
            unit={data.wrappedSymbol}
          />
          <Readout
            label="Debt outstanding"
            value={formatAmount(data.currentDebt, data.stableDecimals)}
            unit={data.stableSymbol}
          />
          <Readout
            label="Collateral ratio"
            value={formatRatioPct(data.ratioBps, NO_DEBT_RATIO)}
            unit={`min ${(data.minCollateralRatioBps / 100).toFixed(0)}%`}
            accent={severity.color}
          />
        </div>

        <div className="mt-6">
          <div className="meter" style={{ ["--meter-color" as string]: severity.color }}>
            <div style={{ width: `${gaugePct}%` }} />
          </div>
          <div className="relative mt-1.5 h-3 text-[10px] text-muted-foreground">
            <span
              className="absolute -translate-x-1/2 border-l border-status-critical/70 pl-1"
              style={{ left: `${liqMarkerPct}%` }}
            >
              liq {(data.liquidationThresholdBps / 100).toFixed(0)}%
            </span>
            <span
              className="absolute -translate-x-1/2 border-l border-hairline-strong pl-1"
              style={{ left: `${minMarkerPct}%` }}
            >
              min {(data.minCollateralRatioBps / 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {data.stabilityFeeBps > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            Stability fee {(data.stabilityFeeBps / 100).toFixed(2)}%/year, accruing continuously and paid to the
            Treasury as it settles — see the <span className="hud-readout">currentDebt</span> reading above.
          </p>
        )}
      </div>

      <CommandConsole refetch={refetch} />
      <LiquidationConsole />
    </div>
  );
}

function Readout({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="hud-readout mt-1 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{unit}</p>
    </div>
  );
}

function CommandConsole({ refetch }: { refetch: () => void }) {
  const { data } = useCdpPosition(COLLATERAL.id);
  const { depositCollateral, withdrawCollateral, mintDebt, repayDebt, step } = useCdpActions();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");

  const busy = step !== "idle";
  const stepLabel = STEP_LABEL[step];

  const depositBn = safeParseUnits(depositAmount, data.wrappedDecimals);
  const withdrawBn = safeParseUnits(withdrawAmount, data.wrappedDecimals);
  const mintBn = safeParseUnits(mintAmount, data.stableDecimals);
  const repayBn = safeParseUnits(repayAmount, data.stableDecimals);

  return (
    <div className="hud-panel p-6">
      <span className="hud-corner-tr" aria-hidden />
      <span className="hud-corner-bl" aria-hidden />

      <p className="hud-readout hud-cursor text-xs text-muted-foreground">aethyx@cdp</p>

      <Tabs defaultValue="deposit" className="mt-3">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="mint">Mint</TabsTrigger>
          <TabsTrigger value="repay">Repay</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-3 pt-4">
          <AmountField
            id="cdp-deposit"
            label={`Amount (${data.wrappedSymbol})`}
            value={depositAmount}
            onChange={setDepositAmount}
            balance={data.wrappedBalance}
            decimals={data.wrappedDecimals}
            disabled={busy}
          />
          <Button
            className="w-full"
            disabled={!depositBn || busy || !data.active}
            onClick={async () => {
              if (!depositBn) return;
              await depositCollateral({
                collateralId: COLLATERAL.id,
                amount: depositBn,
                wrappedToken: data.wrappedToken,
                currentAllowance: data.wrappedAllowanceForCdp,
                onSuccess: () => {
                  setDepositAmount("");
                  refetch();
                },
              });
            }}
          >
            {busy ? stepLabel : `Lock ${data.wrappedSymbol}`}
          </Button>
        </TabsContent>

        <TabsContent value="mint" className="space-y-3 pt-4">
          <AmountField
            id="cdp-mint"
            label={`Amount (${data.stableSymbol})`}
            value={mintAmount}
            onChange={setMintAmount}
            decimals={data.stableDecimals}
            disabled={busy}
          />
          <Button
            className="w-full"
            disabled={!mintBn || busy || !data.active}
            onClick={async () => {
              if (!mintBn) return;
              await mintDebt({
                collateralId: COLLATERAL.id,
                amount: mintBn,
                onSuccess: () => {
                  setMintAmount("");
                  refetch();
                },
              });
            }}
          >
            {busy ? stepLabel : `Borrow ${data.stableSymbol}`}
          </Button>
        </TabsContent>

        <TabsContent value="repay" className="space-y-3 pt-4">
          <AmountField
            id="cdp-repay"
            label={`Amount (${data.stableSymbol})`}
            value={repayAmount}
            onChange={setRepayAmount}
            balance={data.stableBalance}
            decimals={data.stableDecimals}
            disabled={busy}
          />
          <Button
            className="w-full"
            variant="secondary"
            disabled={!repayBn || busy}
            onClick={async () => {
              if (!repayBn) return;
              await repayDebt({
                collateralId: COLLATERAL.id,
                amount: repayBn,
                currentAllowance: data.stableAllowanceForCdp,
                onSuccess: () => {
                  setRepayAmount("");
                  refetch();
                },
              });
            }}
          >
            {busy ? stepLabel : `Repay ${data.stableSymbol}`}
          </Button>
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-3 pt-4">
          <AmountField
            id="cdp-withdraw"
            label={`Amount (${data.wrappedSymbol})`}
            value={withdrawAmount}
            onChange={setWithdrawAmount}
            balance={data.collateralAmount}
            decimals={data.wrappedDecimals}
            disabled={busy}
          />
          <Button
            className="w-full"
            variant="secondary"
            disabled={!withdrawBn || busy}
            onClick={async () => {
              if (!withdrawBn) return;
              await withdrawCollateral({
                collateralId: COLLATERAL.id,
                amount: withdrawBn,
                onSuccess: () => {
                  setWithdrawAmount("");
                  refetch();
                },
              });
            }}
          >
            {busy ? stepLabel : `Unlock ${data.wrappedSymbol}`}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Anyone can call CDPManager.liquidate on any address once its ratio drops below the threshold —
 * that permissionlessness is the whole safety mechanism, so the UI needs a way to act on it that
 * doesn't require going to a block explorer. Looks up an arbitrary address's position and, when
 * it's actually liquidatable, lets the connected wallet repay its debt and take its collateral.
 */
function LiquidationConsole() {
  const { address: connected } = useAccount();
  const [target, setTarget] = useState("");
  const { liquidate, step } = useCdpActions();

  const targetAddress = isAddress(target) ? (target as Address) : undefined;
  const { data, hasNoDebt, isLoading } = useCdpPosition(COLLATERAL.id, targetAddress);

  const severity = useMemo(
    () => cdpHealthSeverity(data.ratioBps, NO_DEBT_RATIO, data.minCollateralRatioBps, data.liquidationThresholdBps),
    [data.ratioBps, data.minCollateralRatioBps, data.liquidationThresholdBps],
  );

  const busy = step !== "idle";
  const stepLabel = STEP_LABEL[step];
  const liquidatable = Boolean(targetAddress) && !hasNoDebt && data.ratioBps < BigInt(data.liquidationThresholdBps);

  return (
    <div className="hud-panel p-6" style={{ ["--hud-accent" as string]: "var(--status-critical)" }}>
      <span className="hud-corner-tr" aria-hidden />
      <span className="hud-corner-bl" aria-hidden />

      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-status-critical" aria-hidden />
        <h2 className="hud-readout text-sm font-semibold uppercase tracking-[0.08em]">Liquidation console</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Anyone can close out a position below {(data.liquidationThresholdBps / 100).toFixed(0)}% collateralization —
        look one up by address.
      </p>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="cdp-liquidate-target" className="hud-readout text-xs">
          Target address
        </Label>
        <Input
          id="cdp-liquidate-target"
          placeholder="0x…"
          value={target}
          onChange={(event) => setTarget(event.target.value.trim())}
          disabled={busy}
          className="hud-readout"
        />
      </div>

      {target && !targetAddress && <p className="mt-2 text-xs text-status-critical">Not a valid address.</p>}

      {targetAddress && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Readout
            label="Collateral"
            value={formatAmount(data.collateralAmount, data.wrappedDecimals)}
            unit={data.wrappedSymbol}
          />
          <Readout label="Debt" value={formatAmount(data.currentDebt, data.stableDecimals)} unit={data.stableSymbol} />
          <Readout
            label="Ratio"
            value={isLoading ? "…" : formatRatioPct(data.ratioBps, NO_DEBT_RATIO)}
            unit={severity.label}
            accent={severity.color}
          />
        </div>
      )}

      <Button
        className="mt-4 w-full"
        variant="secondary"
        disabled={!liquidatable || busy}
        onClick={async () => {
          if (!targetAddress) return;
          await liquidate({
            collateralId: COLLATERAL.id,
            user: targetAddress,
            debtToRepay: data.currentDebt,
            currentAllowance: data.stableAllowanceForCdp,
            onSuccess: () => setTarget(""),
          });
        }}
      >
        {busy
          ? stepLabel
          : liquidatable
            ? `Liquidate for ${formatAmount(data.currentDebt, data.stableDecimals)} ${data.stableSymbol}`
            : "Position not liquidatable"}
      </Button>
      {connected && targetAddress === connected && (
        <p className="mt-2 text-xs text-muted-foreground">That&apos;s your own address.</p>
      )}
    </div>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  balance,
  decimals,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  balance?: bigint;
  decimals: number;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="hud-readout text-xs">
          {label}
        </Label>
        {balance !== undefined && (
          <button
            type="button"
            className="hud-readout text-xs text-muted-foreground transition-colors hover:text-primary"
            onClick={() => onChange(formatAmount(balance, decimals, 18))}
          >
            avail {formatAmount(balance, decimals)}
          </button>
        )}
      </div>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="hud-readout"
      />
    </div>
  );
}
