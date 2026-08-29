import { keccak256, toBytes, type Hex } from "viem";

/** Matches the on-chain convention: assetId = keccak256(utf8 bytes of a human label). Reused
 *  as-is for OracleManager price lookups on priced assets — one identifier, two registries. */
export function assetIdFromLabel(label: string): Hex {
  return keccak256(toBytes(label));
}

export type AssetKind = "gold" | "silver" | "real-estate";

/** Physical-unit conversion for the reserve view: `perToken` whole underlying tokens = 1 unit. */
export interface PhysicalUnit {
  label: string;
  perToken: number;
}

/**
 * Off-chain attestation that the physical/legal asset backing the on-chain collateral is what
 * it claims to be. Unlike coverage (locked vs minted), this is NOT something the blockchain can
 * verify by itself — it's a claim about the real world, backed by a named auditor/custodian.
 * Surfaced separately in the UI so "cryptographically guaranteed" and "attested off-chain"
 * are never conflated.
 */
export interface Attestation {
  verified: boolean;
  auditor: string;
  asOf: string;
  reportUrl?: string;
}

export interface AssetDefinition {
  id: Hex;
  label: string;
  kind: AssetKind;
  title: string;
  description: string;
  physicalUnit?: PhysicalUnit;
  attestation?: Attestation;
  /** True for assets priced by OracleManager (1 underlying token == 1 gram, EUR/gram feed). */
  pricedByOracle?: boolean;
  /**
   * Static appraisal value for assets OracleManager doesn't price (real estate has no spot
   * price — see ReserveCard/AuditBadge for how this differs from an on-chain-verifiable number).
   * Per-share value = (holder's wrapped balance / wrapped total supply) * appraisalValueEur.
   */
  appraisalValueEur?: number;
}

// The five lock-up choices for the Paris real-estate asset, each deployed as its own
// RealEstateAdapter + wrapped-token market (see RealEstateAssetFactory) rather than a per-deposit
// parameter — RealEstateAdapter.lockupPeriod is set once, immutably, at deployment.
export const REAL_ESTATE_LOCKUP_TIERS = [
  { key: "15D", label: "15 days" },
  { key: "1M", label: "1 month" },
  { key: "3M", label: "3 months" },
  { key: "6M", label: "6 months" },
  { key: "1Y", label: "1 year" },
] as const;

// VaultManager has no on-chain enumeration of registered assets (a deliberate simplicity
// trade-off — see AssetAdapter.sol's lesson on the mapping-based registry). Until an indexer
// or an AssetRegistered-event-based discovery feed exists, the frontend keeps its own list of
// assets it expects to find registered. Update this after deploying a new asset via one of the
// asset factories.
export const ASSETS: AssetDefinition[] = [
  {
    id: assetIdFromLabel("GOLD"),
    label: "GOLD",
    kind: "gold",
    title: "Tokenized Gold",
    description: "Physically-backed gold, wrapped 1:1 into a freely-transferable ERC-20.",
    // 1 underlying token == 1 gram, so 1,000 tokens == 1kg. Set this to match the real
    // issuer's token denomination once a live ERC-3643 gold token is wired in.
    physicalUnit: { label: "kg", perToken: 1000 },
    pricedByOracle: true,
    attestation: {
      verified: true,
      auditor: "Independent Custodian Ltd.",
      asOf: "2026-07-01",
    },
  },
  {
    id: assetIdFromLabel("SILVER"),
    label: "SILVER",
    kind: "silver",
    title: "Tokenized Silver",
    description: "Physically-backed silver, wrapped 1:1 into a freely-transferable ERC-20.",
    physicalUnit: { label: "kg", perToken: 1000 },
    pricedByOracle: true,
    attestation: {
      verified: true,
      auditor: "Independent Custodian Ltd.",
      asOf: "2026-07-01",
    },
  },
  ...REAL_ESTATE_LOCKUP_TIERS.map((tier): AssetDefinition => ({
    id: assetIdFromLabel(`REAL_ESTATE_PARIS_01_${tier.key}`),
    label: `REAL_ESTATE_PARIS_01_${tier.key}`,
    kind: "real-estate",
    title: `Paris Property #01 — ${tier.label}`,
    description: `Fractionalized real estate, locked for ${tier.label} after deposit before redemption is allowed.`,
    // Same building tokenized across five independent lock-up markets rather than one asset
    // with a per-deposit choice (see AssetAdapter/VaultManager's fixed deposit(from, amount)
    // signature) — each market gets its own underlying token and its own slice of the
    // appraisal, so summing across all five still totals the building's real value instead of
    // multiplying it by five.
    appraisalValueEur: 235_000 / REAL_ESTATE_LOCKUP_TIERS.length,
    attestation: {
      verified: true,
      auditor: "Notaire de Paris — Étude XYZ",
      asOf: "2026-06-15",
    },
  })),
];

// Asset ids that predate a later redeploy or restructuring and are no longer in ASSETS above, but
// still show up in wallet history (VaultManager keeps every Deposited/Redeemed event forever —
// see useTransactionHistory). REAL_ESTATE_PARIS_01 was the single untiered real-estate market
// deployed by the first post-ROUTER_ROLE-fix redeploy, before it was split into the five lock-up
// tiers above; a handful of demo deposits landed on it before the split. Kept here purely so
// TransactionHistory can label those rows instead of showing "Unknown asset" — not something a
// depositor can act on going forward, so it's deliberately absent from ASSETS itself.
export const LEGACY_ASSET_LABELS: Record<Hex, string> = {
  [assetIdFromLabel("REAL_ESTATE_PARIS_01")]: "Paris Property #01 (legacy, pre-tier split)",
};
