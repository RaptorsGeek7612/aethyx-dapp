"use client";

import { motion } from "framer-motion";
import { Lock, Package } from "lucide-react";
import { StatTile } from "@/components/reserve/stat-tile";
import { CoverageMeter } from "@/components/reserve/coverage-meter";
import { AuditBadge } from "@/components/reserve/audit-badge";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData } from "@/hooks/use-asset-static";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import { toCanonical18 } from "@/lib/decimals";
import { KIND_META } from "@/lib/asset-kind-meta";

export function ReserveCard({ asset, index }: { asset: AssetDefinition; index: number }) {
  const { data, isLoading } = useAssetStaticData(asset);
  const Icon = KIND_META[asset.kind].icon;

  const lockedNormalized = toCanonical18(data.lockedRaw, data.underlyingDecimals);
  const coverageBps = data.wrappedSupply > 0n ? (lockedNormalized * 10_000n) / data.wrappedSupply : null;

  const reserveValue = asset.physicalUnit
    ? (() => {
        const wholeTokens = Number(data.lockedRaw) / 10 ** data.underlyingDecimals;
        const amount = wholeTokens / asset.physicalUnit.perToken;
        return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${asset.physicalUnit.label}`;
      })()
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
      className="glass-card rounded-2xl p-6"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${KIND_META[asset.kind].gradient} shadow-lg`}
        >
          <Icon className="h-5 w-5 text-black/80" strokeWidth={2.25} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{asset.title}</h3>
          <p className="text-xs text-muted-foreground">{data.registered ? data.wrappedSymbol : asset.label}</p>
        </div>
      </div>

      {!data.registered && !isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">This asset isn&apos;t registered on VaultManager yet.</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3">
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
            value={`${formatCompactAmount(data.wrappedSupply, data.wrappedDecimals)} ${data.wrappedSymbol}`}
            sublabel={`${formatAmount(data.wrappedSupply, data.wrappedDecimals)} ${data.wrappedSymbol}`}
            loading={isLoading}
          />
          <CoverageMeter coverageBps={coverageBps} loading={isLoading} />
          <div className="col-span-2">
            <AuditBadge attestation={asset.attestation} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
