"use client";

import { motion } from "framer-motion";
import { AuditBadge } from "@/components/reserve/audit-badge";
import { realEstateTierLabel, type AssetDefinition } from "@/config/assets";
import { useAssetStaticData } from "@/hooks/use-asset-static";
import { formatAmount } from "@/lib/format";
import { toCanonical18 } from "@/lib/decimals";
import { coverageSeverity, formatCoveragePct } from "@/lib/coverage";
import { KIND_META } from "@/lib/asset-kind-meta";
import { Skeleton } from "@/components/ui/skeleton";

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
        <span>{realEstateTierLabel(tier)}</span>
        <span>not registered yet</span>
      </div>
    );
  }

  // Same thresholds and palette as the full CoverageMeter the other reserve cards show — a tier
  // must not read as healthier here than it would in its own card.
  const { color, label, Icon } = coverageSeverity(coverageBps);

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{realEstateTierLabel(tier)}</span>
      <span className="text-xs text-muted-foreground">
        {formatAmount(data.lockedRaw, data.underlyingDecimals)} {data.underlyingSymbol} locked ·{" "}
        {formatAmount(data.wrappedSupply, data.wrappedDecimals)} {data.wrappedSymbol} minted
      </span>
      {/* The icon shape and the color both encode severity; the title carries it as text too, so
          it isn't lost on a color-blind reader or a screen reader. */}
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium" style={{ color }} title={label}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{label}: </span>
        {formatCoveragePct(coverageBps)}
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

      {/* Every tier is the same building under the same notarial attestation (they differ only in
          lock-up length), so one badge covers all five rather than repeating it per row. */}
      <div className="mt-4">
        <AuditBadge attestation={tiers[0]?.attestation} />
      </div>
    </motion.div>
  );
}
