"use client";

import { motion } from "framer-motion";
import { useReadContracts } from "wagmi";
import type { Abi, Address } from "viem";
import { Lock, Package, Euro, Wallet, Landmark } from "lucide-react";
import { StatTile } from "@/components/reserve/stat-tile";
import { CoverageMeter } from "@/components/reserve/coverage-meter";
import { AuditBadge } from "@/components/reserve/audit-badge";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData } from "@/hooks/use-asset-static";
import { useAssetPrice } from "@/hooks/use-asset-price";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { cdpManagerAbi, cdpManagerLegacyAbi } from "@/lib/abis/cdpManagerAbi";
import { CDP_MANAGERS, isCdpConfigured } from "@/config/contracts";
import { ZERO_ADDRESS } from "@/hooks/use-asset-static";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import { toCanonical18 } from "@/lib/decimals";
import { KIND_META } from "@/lib/asset-kind-meta";

const formatEur = (n: number, maximumFractionDigits = 2) =>
  n.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits });

export function ReserveCard({ asset, index }: { asset: AssetDefinition; index: number }) {
  const { data, isLoading } = useAssetStaticData(asset);
  const { price: pricePerGram18, health: priceHealth } = useAssetPrice(asset.id, asset.pricedByOracle);
  const Icon = KIND_META[asset.kind].icon;

  // Not gated on asset.pricedByOracle: whichever assets CDPManager actually recognizes as
  // collateral show up here on their own, the same "ask the contract, don't hardcode the list"
  // approach the /cdp collateral selector uses. Reads every known CDPManager instance (current
  // plus any retired ones — see CDP_MANAGERS in config/contracts.ts), not just the current one:
  // a redeploy (AUDIT.md #12) doesn't move debt off the old instance, so summing only the new one
  // would under-report backing the moment anything is still open on a superseded manager.
  const { data: cdpCollaterals } = useReadContracts({
    allowFailure: true,
    contracts: CDP_MANAGERS.map(({ address, legacy }) => ({
      address,
      // Widened to plain Abi: legacy/current decode `collaterals` to differently-shaped tuples,
      // and a precise union of both makes indexed fields resolve to unhelpful cross-shape unions
      // (e.g. bigint | boolean) instead of narrowing per branch — see use-cdp.ts's useCdpPosition
      // for the same trade-off.
      abi: (legacy ? cdpManagerLegacyAbi : cdpManagerAbi) as Abi,
      functionName: "collaterals" as const,
      args: [asset.id] as const,
    })),
    // totalDebt moves with every mint/repay on this collateral, by any wallet — same "this is
    // supposed to read as live" reasoning as useAssetStaticData's tokenData query.
    query: { enabled: isCdpConfigured, refetchInterval: 30_000 },
  });
  const perManagerCollateral = CDP_MANAGERS.map((manager, index) => {
    const result = cdpCollaterals?.[index]?.result as readonly unknown[] | undefined;
    const wrappedToken = (result?.[0] as Address | undefined) ?? ZERO_ADDRESS;
    // Legacy's collaterals tuple has no liquidationBonusBps, so totalDebt sits one index earlier.
    const totalDebt = (result?.[manager.legacy ? 5 : 6] as bigint | undefined) ?? 0n;
    return { manager, wrappedToken, totalDebt, registered: wrappedToken !== ZERO_ADDRESS };
  });
  const cdpRegistered = perManagerCollateral.some((entry) => entry.registered);
  const ioEurMinted = perManagerCollateral.reduce((sum, entry) => sum + entry.totalDebt, 0n);

  const { data: cdpLockedBalances } = useReadContracts({
    allowFailure: true,
    contracts: perManagerCollateral
      .filter((entry) => entry.registered)
      .map((entry) => ({
        address: entry.wrappedToken,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [entry.manager.address] as const,
      })),
    query: { enabled: cdpRegistered, refetchInterval: 30_000 },
  });
  const cdpLockedBalance = (cdpLockedBalances ?? []).reduce((sum, entry) => sum + (entry.result ?? 0n), 0n);

  const lockedNormalized = toCanonical18(data.lockedRaw, data.underlyingDecimals);
  const coverageBps = data.wrappedSupply > 0n ? (lockedNormalized * 10_000n) / data.wrappedSupply : null;

  const reserveValue = asset.physicalUnit
    ? (() => {
        const wholeTokens = Number(data.lockedRaw) / 10 ** data.underlyingDecimals;
        const amount = wholeTokens / asset.physicalUnit.perToken;
        return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${asset.physicalUnit.label}`;
      })()
    : null;

  // Whole-reserve EUR value: oracle price × grams held for gold/silver, the full static
  // appraisal for real estate (there's only one holder of the whole building here — the reserve
  // itself — unlike the dashboard's per-wallet share of the same appraisal).
  const pricePerGramEur = Number(pricePerGram18) / 1e18;
  const reserveValueEur =
    asset.kind === "real-estate"
      ? (asset.appraisalValueEur ?? null)
      : priceHealth === "healthy"
        ? (Number(data.lockedRaw) / 10 ** data.underlyingDecimals) * pricePerGramEur
        : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
      className="glass-card glass-card-hover rounded-2xl p-6"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${KIND_META[asset.kind].gradient} shadow-lg`}
        >
          <Icon className="h-5 w-5 text-black/80" strokeWidth={2.25} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{asset.title}</h3>
          <p className="num text-xs text-muted-foreground">{data.registered ? data.wrappedSymbol : asset.label}</p>
        </div>
      </div>

      {!data.registered && !isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">This asset isn&apos;t registered on VaultManager yet.</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <StatTile
            label="Reserve value"
            icon={<Euro className="h-3 w-3" />}
            value={reserveValueEur !== null ? formatEur(reserveValueEur) : "Pricing…"}
            sublabel={
              asset.kind === "real-estate" ? "Static appraisal" : `at ${formatEur(pricePerGramEur, 2)}/g, live oracle`
            }
            loading={isLoading}
          />
          {reserveValue && (
            <StatTile label="Reserve" icon={<Package className="h-3 w-3" />} value={reserveValue} loading={isLoading} />
          )}
          <StatTile
            label={`Locked ${asset.kind !== "real-estate" ? "ERC-3643" : "underlying"}`}
            icon={<Lock className="h-3 w-3" />}
            value={`${formatCompactAmount(data.lockedRaw, data.underlyingDecimals)} ${data.underlyingSymbol}`}
            sublabel={`${formatAmount(data.lockedRaw, data.underlyingDecimals)} ${data.underlyingSymbol}`}
            loading={isLoading}
          />
          <StatTile
            label={`${data.wrappedSymbol || "Wrapped"} minted`}
            icon={<Wallet className="h-3 w-3" />}
            value={`${formatCompactAmount(data.wrappedSupply, data.wrappedDecimals)} ${data.wrappedSymbol}`}
            sublabel={`${formatAmount(data.wrappedSupply, data.wrappedDecimals)} ${data.wrappedSymbol}`}
            loading={isLoading}
          />
          <CoverageMeter coverageBps={coverageBps} loading={isLoading} />
          {cdpRegistered && (
            <div className="col-span-2">
              <StatTile
                label="ioEUR backing"
                icon={<Landmark className="h-3 w-3" />}
                value={`${formatAmount(ioEurMinted, 18)} ioEUR minted`}
                sublabel={`against ${formatAmount(cdpLockedBalance ?? 0n, data.wrappedDecimals)} ${data.wrappedSymbol} locked as collateral · ${formatAmount(data.wrappedSupply - (cdpLockedBalance ?? 0n), data.wrappedDecimals)} ${data.wrappedSymbol} still free of the ${formatAmount(data.wrappedSupply, data.wrappedDecimals)} ${data.wrappedSymbol} minted`}
                loading={isLoading}
              />
            </div>
          )}
          <div className="col-span-2">
            <AuditBadge attestation={asset.attestation} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
