"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AuditBadge } from "@/components/reserve/audit-badge";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData } from "@/hooks/use-asset-static";
import { formatAmount } from "@/lib/format";
import { toCanonical18 } from "@/lib/decimals";
import { KIND_META } from "@/lib/asset-kind-meta";
import { Skeleton } from "@/components/ui/skeleton";

const GOOD = "#0ca30c";
const WARNING = "#fab219";
const CRITICAL = "#d03b3b";

function tierLabel(asset: AssetDefinition) {
  return asset.title.split("—")[1]?.trim() ?? asset.title;
}

function TierRow({ tier }: { tier: AssetDefinition }) {
  const { data, isLoading } = useAssetStaticData(tier);
  const lockedNormalized = toCanonical18(data.lockedRaw, data.underlyingDecimals);
  const coverageBps = data.wrappedSupply > 0n ? (lockedNormalized * 10_000n) / data.wrappedSupply : null;

  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }
  if (!data.registered) {
    return (
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{tierLabel(tier)}</span>
        <span>not registered yet</span>
      </div>
    );
  }

  const { color, Icon } =
    coverageBps === null
      ? { color: WARNING, Icon: AlertTriangle }
      : coverageBps >= 10_000n
        ? { color: GOOD, Icon: CheckCircle2 }
        : coverageBps >= 9_500n
          ? { color: WARNING, Icon: AlertTriangle }
          : { color: CRITICAL, Icon: XCircle };
  const pct = coverageBps === null ? null : Number(coverageBps) / 100;

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{tierLabel(tier)}</span>
      <span className="text-xs text-muted-foreground">
        {formatAmount(data.lockedRaw, data.underlyingDecimals)} {data.underlyingSymbol} locked ·{" "}
        {formatAmount(data.wrappedSupply, data.wrappedDecimals)} {data.wrappedSymbol} minted
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium" style={{ color }}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </span>
    </div>
  );
}

/** One card for every real-estate lock-up tier (see RealEstateManageDialog for why they're five
 *  independent on-chain markets) — each tier keeps its own coverage ratio shown individually
 *  rather than being summed into one number, since summing could mask one under-covered tier
 *  behind four fully-covered ones. */
export function ReserveRealEstateCard({
  title,
  tiers,
  index,
}: {
  title: string;
  tiers: AssetDefinition[];
  index: number;
}) {
  const Icon = KIND_META["real-estate"].icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
      className="glass-card rounded-2xl p-6"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${KIND_META["real-estate"].gradient} shadow-lg`}
        >
          <Icon className="h-5 w-5 text-black/80" strokeWidth={2.25} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{tiers.length} lock-up tiers</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {tiers.map((tier) => (
          <TierRow key={tier.id} tier={tier} />
        ))}
      </div>

      <div className="mt-4">
        <AuditBadge attestation={tiers[0]?.attestation} />
      </div>
    </motion.div>
  );
}
