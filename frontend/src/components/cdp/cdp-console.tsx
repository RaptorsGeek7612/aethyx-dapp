"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { isAddress, type Address, type Hex } from "viem";
import { TriangleAlert, Crosshair, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ASSETS, type AssetDefinition } from "@/config/assets";
import { isCdpConfigured, CDP_MANAGERS, type CdpManagerRef } from "@/config/contracts";
import { useCdpPosition } from "@/hooks/use-cdp";
import { useCdpActions, type CdpStep } from "@/hooks/use-cdp-actions";
import { useNow } from "@/hooks/use-now";
import { useAssetPrice } from "@/hooks/use-asset-price";
import { formatAmount, safeParseUnits } from "@/lib/format";
import { cdpHealthSeverity, formatRatioPct } from "@/lib/cdp-health";
import { cn } from "@/lib/utils";

const NO_DEBT_RATIO = 2n ** 256n - 1n;

const formatEur = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Every oracle-priced asset is a *candidate* collateral — deploy-cdp.ts only registers GOLD today
// (see backend/scripts/deploy-cdp.ts), but the console shouldn't hardcode that: CollateralProbe
// below checks each candidate's actual on-chain registration, so a future SILVER registration
// shows up here with no frontend change. Real estate is excluded: it has no oracle spot price
// (see AuditBadge/computeValuation), which this module's liquidation math depends on.
const CDP_COLLATERAL_CANDIDATES = ASSETS.filter((asset) => asset.pricedByOracle);

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

interface CollateralStatus {
  registered: boolean;
  isLoading: boolean;
}

// `${assetId}:${managerAddress}` — one status per (candidate, CDPManager instance) pair, since
// the same asset can be registered on the current manager, a retired one, both, or neither.
function statusKey(assetId: Hex, managerAddress: string) {
  return `${assetId}:${managerAddress}`;
}

/** No UI of its own — reads one candidate's registration status on one CDPManager instance and
 *  reports it up, the same "probe reports, parent decides" shape as ReserveValueReporter/
 *  PortfolioAssetRow. Lets the selector below list every (asset, manager) pair without assuming
 *  which ones are actually live — including collateral left registered on a superseded manager
 *  (see CDP_MANAGERS in config/contracts.ts, AUDIT.md #12). */
function CollateralProbe({
  asset,
  manager,
  onStatus,
}: {
  asset: AssetDefinition;
  manager: CdpManagerRef;
  onStatus: (key: string, status: CollateralStatus) => void;
}) {
  const { registered, isLoading } = useCdpPosition(asset.id, undefined, manager);
  const key = statusKey(asset.id, manager.address);

  useEffect(() => {
    onStatus(key, { registered, isLoading });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registered, isLoading]);

  return null;
}

function ConnectedConsole() {
  const [statuses, setStatuses] = useState<Record<string, CollateralStatus>>({});
  const handleStatus = useCallback((key: string, status: CollateralStatus) => {
    setStatuses((prev) =>
      prev[key]?.registered === status.registered && prev[key]?.isLoading === status.isLoading
        ? prev
        : { ...prev, [key]: status },
    );
  }, []);

  const [selectedId, setSelectedId] = useState<Hex>(CDP_COLLATERAL_CANDIDATES[0].id);
  const selected = CDP_COLLATERAL_CANDIDATES.find((asset) => asset.id === selectedId) ?? CDP_COLLATERAL_CANDIDATES[0];

  const isAvailable = (assetId: Hex) => CDP_MANAGERS.some((m) => statuses[statusKey(assetId, m.address)]?.registered);
  const isAssetLoading = (assetId: Hex) => CDP_MANAGERS.some((m) => statuses[statusKey(assetId, m.address)]?.isLoading !== false);

  const anyLoading = CDP_COLLATERAL_CANDIDATES.some((asset) => isAssetLoading(asset.id));
  const anyRegistered = CDP_COLLATERAL_CANDIDATES.some((asset) => isAvailable(asset.id));

  // CDP_MANAGERS lists the current instance first, so this prefers it whenever the selected
  // asset is registered there too — legacy only wins when that's the sole place it still lives.
  const availableManagers = CDP_MANAGERS.filter((m) => statuses[statusKey(selected.id, m.address)]?.registered);
  const [selectedManagerAddress, setSelectedManagerAddress] = useState<string | null>(null);
  const selectedManager =
    availableManagers.find((m) => m.address === selectedManagerAddress) ?? availableManagers[0];

  return (
    <div className="space-y-6">
      {CDP_COLLATERAL_CANDIDATES.flatMap((asset) =>
        CDP_MANAGERS.map((manager) => (
          <CollateralProbe key={statusKey(asset.id, manager.address)} asset={asset} manager={manager} onStatus={handleStatus} />
        )),
      )}

      {CDP_COLLATERAL_CANDIDATES.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Collateral">
          {CDP_COLLATERAL_CANDIDATES.map((asset) => {
            const isSelected = asset.id === selectedId;
            const available = isAvailable(asset.id);
            const loading = isAssetLoading(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setSelectedId(asset.id);
                  setSelectedManagerAddress(null);
                }}
                className={cn("hud-tag cursor-pointer transition-colors", isSelected && "text-primary")}
                style={isSelected ? { ["--hud-accent" as string]: "var(--primary)" } : undefined}
              >
                {isSelected && <Check className="h-3 w-3" aria-hidden />}
                {asset.title}
                {!loading && !available && " · not available"}
              </button>
            );
          })}
        </div>
      )}

      {!anyRegistered && !anyLoading ? (
        <div className="hud-panel p-10 text-center text-sm text-muted-foreground hud-scanlines">
          No collateral is registered on this credit facility yet.
        </div>
      ) : !selectedManager ? (
        <div className="hud-panel p-10 text-center text-sm text-muted-foreground hud-scanlines">
          {isAssetLoading(selected.id)
            ? "Reading collateral registry…"
            : `${selected.label} isn't registered as eligible collateral yet — pick another above.`}
        </div>
      ) : (
        <div className="space-y-4">
          {availableManagers.length >= 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Instance:</span>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="CDPManager instance">
                {availableManagers.map((manager) => {
                  const isSelected = manager.address === selectedManager.address;
                  return (
                    <button
                      key={manager.address}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => setSelectedManagerAddress(manager.address)}
                      className={cn("hud-tag cursor-pointer transition-colors", isSelected && "text-primary")}
                      style={isSelected ? { ["--hud-accent" as string]: "var(--primary)" } : undefined}
                    >
                      {isSelected && <Check className="h-3 w-3" aria-hidden />}
                      {manager.label}
                      {manager.legacy && " (retired — repay/withdraw/liquidate only)"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <PositionConsole collateral={selected} manager={selectedManager} />
        </div>
      )}
    </div>
  );
}

function PositionConsole({ collateral, manager }: { collateral: AssetDefinition; manager: CdpManagerRef }) {
  const { data, hasNoDebt, refetch } = useCdpPosition(collateral.id, undefined, manager);
  const { price: pricePerGram18, health: priceHealth } = useAssetPrice(collateral.id, collateral.pricedByOracle);
  const now = useNow(1000);

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

  // RWA value: grams of physical collateral locked, priced at the live oracle feed (EUR/gram).
  // ioEUR is the money side, already 1:1 with EUR, so its own amount doubles as its currency value.
  const collateralGrams = Number(data.collateralAmount) / 10 ** data.wrappedDecimals;
  const collateralValueEur =
    priceHealth === "healthy" ? collateralGrams * (Number(pricePerGram18) / 1e18) : null;
  const debtValueEur = Number(data.currentDebt) / 10 ** data.stableDecimals;

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
              {collateral.label} / IOEUR
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
            label="Collateral locked (RWA)"
            value={`${formatAmount(data.collateralAmount, data.wrappedDecimals)}`}
            unit={data.wrappedSymbol}
            sub={collateralValueEur !== null ? formatEur(collateralValueEur) : "pricing…"}
          />
          <Readout
            label="Debt outstanding"
            value={formatAmount(data.currentDebt, data.stableDecimals)}
            unit={data.stableSymbol}
            sub={formatEur(debtValueEur)}
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
            Treasury as it settles. See the <span className="hud-readout">currentDebt</span> reading above.
          </p>
        )}
      </div>

      {manager.legacy && (
        <div
          className="hud-panel flex items-start gap-3 p-4 text-sm"
          style={{ ["--hud-accent" as string]: "var(--status-warning)" }}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <p className="text-muted-foreground">
            This is a retired CDPManager instance ({manager.address}) — new deposits and borrows go through the
            current instance instead. Existing collateral here can still be repaid, withdrawn, or liquidated.
          </p>
        </div>
      )}

      <CommandConsole collateral={collateral} manager={manager} refetch={refetch} />
      <LiquidationConsole collateral={collateral} manager={manager} />
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="hud-readout mt-1 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{unit}</p>
      {sub && <p className="hud-readout mt-0.5 text-xs text-foreground/70">{sub}</p>}
    </div>
  );
}

function CommandConsole({
  collateral,
  manager,
  refetch,
}: {
  collateral: AssetDefinition;
  manager: CdpManagerRef;
  refetch: () => void;
}) {
  const { data } = useCdpPosition(collateral.id, undefined, manager);
  const { depositCollateral, withdrawCollateral, mintDebt, repayDebt, step } = useCdpActions(manager);
  const { price: pricePerGram18, health: priceHealth } = useAssetPrice(collateral.id, collateral.pricedByOracle);

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

  // Every tab's headroom, derived from the same position data the readouts above already show —
  // "how much more can I do here" is the state a depositor actually wants before typing a number.
  const priceEurPerGram = Number(pricePerGram18) / 1e18;
  const collateralGrams = Number(data.collateralAmount) / 10 ** data.wrappedDecimals;
  const collateralValueEur = priceHealth === "healthy" ? collateralGrams * priceEurPerGram : null;
  const debtValueEur = Number(data.currentDebt) / 10 ** data.stableDecimals;
  const minRatio = data.minCollateralRatioBps / 10_000;

  const maxMintableEur =
    collateralValueEur !== null ? Math.max(collateralValueEur / minRatio - debtValueEur, 0) : null;
  const maxWithdrawableTokens =
    collateralValueEur !== null && priceEurPerGram > 0
      ? Math.min(Math.max(collateralValueEur - debtValueEur * minRatio, 0) / priceEurPerGram, collateralGrams)
      : null;

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
          <ActionState
            lines={[
              `Currently locked: ${formatAmount(data.collateralAmount, data.wrappedDecimals)} ${data.wrappedSymbol}${
                collateralValueEur !== null ? ` (${formatEur(collateralValueEur)})` : ""
              }`,
              !data.active && "This collateral is frozen — new deposits are refused until it's reactivated.",
              manager.legacy && "This instance is retired — deposit on the current instance instead.",
            ]}
          />
          <AmountField
            id="cdp-deposit"
            label={`Amount (${data.wrappedSymbol})`}
            value={depositAmount}
            onChange={setDepositAmount}
            balance={data.wrappedBalance}
            decimals={data.wrappedDecimals}
            disabled={busy || manager.legacy}
          />
          <Button
            className="w-full"
            disabled={!depositBn || busy || !data.active || manager.legacy}
            onClick={async () => {
              if (!depositBn) return;
              await depositCollateral({
                collateralId: collateral.id,
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
          <ActionState
            lines={[
              `Debt outstanding: ${formatAmount(data.currentDebt, data.stableDecimals)} ${data.stableSymbol}`,
              maxMintableEur !== null
                ? `Room to mint at ${(data.minCollateralRatioBps / 100).toFixed(0)}% min ratio: ${formatEur(maxMintableEur)}`
                : "Room to mint: pricing…",
              !data.active && "This collateral is frozen — new debt can't be minted against it.",
              manager.legacy && "This instance is retired — borrow on the current instance instead.",
            ]}
          />
          <AmountField
            id="cdp-mint"
            label={`Amount (${data.stableSymbol})`}
            value={mintAmount}
            onChange={setMintAmount}
            decimals={data.stableDecimals}
            disabled={busy || manager.legacy}
          />
          {mintBn !== null && mintBn > 0n && (
            <p className="hud-readout text-xs text-muted-foreground">
              ≈{" "}
              {priceEurPerGram > 0
                ? (Number(mintBn) / 10 ** data.stableDecimals / priceEurPerGram).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })
                : "…"}{" "}
              {data.wrappedSymbol} of collateral value · ratio{" "}
              {debtValueEur > 0 && collateralValueEur !== null ? `${((collateralValueEur / debtValueEur) * 100).toFixed(0)}%` : "∞"}
              {" → "}
              {collateralValueEur !== null
                ? `${((collateralValueEur / (debtValueEur + Number(mintBn) / 10 ** data.stableDecimals)) * 100).toFixed(0)}%`
                : "…"}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!mintBn || busy || !data.active || manager.legacy}
            onClick={async () => {
              if (!mintBn) return;
              await mintDebt({
                collateralId: collateral.id,
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
          <ActionState
            lines={[
              `Debt outstanding: ${formatAmount(data.currentDebt, data.stableDecimals)} ${data.stableSymbol} (${formatEur(debtValueEur)})`,
              data.currentDebt === 0n && "Nothing to repay.",
            ]}
          />
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
                collateralId: collateral.id,
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
          <ActionState
            lines={[
              `Currently locked (RWA): ${formatAmount(data.collateralAmount, data.wrappedDecimals)} ${data.wrappedSymbol}${
                collateralValueEur !== null ? ` (${formatEur(collateralValueEur)})` : ""
              }`,
              maxWithdrawableTokens !== null
                ? `Withdrawable while staying above ${(data.minCollateralRatioBps / 100).toFixed(0)}%: ${maxWithdrawableTokens.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${data.wrappedSymbol}${
                    priceHealth === "healthy" ? ` (${formatEur(maxWithdrawableTokens * priceEurPerGram)})` : ""
                  }`
                : "Withdrawable: pricing…",
            ]}
          />
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
                collateralId: collateral.id,
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
function LiquidationConsole({ collateral, manager }: { collateral: AssetDefinition; manager: CdpManagerRef }) {
  const { address: connected } = useAccount();
  const [target, setTarget] = useState("");
  const { liquidate, step } = useCdpActions(manager);

  const targetAddress = isAddress(target) ? (target as Address) : undefined;
  const { data, hasNoDebt, isLoading } = useCdpPosition(collateral.id, targetAddress, manager);
  const { price: pricePerGram18, health: priceHealth } = useAssetPrice(collateral.id, collateral.pricedByOracle);

  const targetCollateralGrams = Number(data.collateralAmount) / 10 ** data.wrappedDecimals;
  const targetCollateralValueEur =
    priceHealth === "healthy" ? targetCollateralGrams * (Number(pricePerGram18) / 1e18) : null;
  const targetDebtValueEur = Number(data.currentDebt) / 10 ** data.stableDecimals;

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
        Anyone can close out a position below {(data.liquidationThresholdBps / 100).toFixed(0)}% collateralization.
        Look one up by address.
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
            label="Collateral (RWA)"
            value={formatAmount(data.collateralAmount, data.wrappedDecimals)}
            unit={data.wrappedSymbol}
            sub={targetCollateralValueEur !== null ? formatEur(targetCollateralValueEur) : "pricing…"}
          />
          <Readout
            label="Debt"
            value={formatAmount(data.currentDebt, data.stableDecimals)}
            unit={data.stableSymbol}
            sub={formatEur(targetDebtValueEur)}
          />
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
            collateralId: collateral.id,
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

/** The state relevant to one tab's action — current numbers and headroom — surfaced above the
 *  input instead of leaving each tab as a bare field with no sense of what's actually possible. */
function ActionState({ lines }: { lines: Array<string | false | undefined> }) {
  const visible = lines.filter((line): line is string => Boolean(line));
  if (visible.length === 0) return null;
  return (
    <div className="hud-readout space-y-0.5 text-xs text-muted-foreground">
      {visible.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
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
