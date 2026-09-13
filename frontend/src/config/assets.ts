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

// Each real-estate deposit carries its own maturity, counted from its own date: the duration is
// the same for all, but two deposits three days apart become redeemable three days apart. The UI
// reads each tranche's unlock time off the adapter — see RealEstateAdapter.sol for the design and
// for the self-transfer escape it knowingly accepts.
const REAL_ESTATE_LABEL = "REAL_ESTATE_PARIS_01_V6";

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
  {
    id: assetIdFromLabel(REAL_ESTATE_LABEL),
    label: REAL_ESTATE_LABEL,
    kind: "real-estate",
    title: "Paris Property #01",
    description:
      "Fractionalized real estate. Deposits are locked for the market's own holding period before redemption is allowed.",
    // One market for the whole building, so this is the whole appraisal — it used to be split
    // five ways across the lock-up tiers precisely so summing them didn't multiply the building
    // by five.
    appraisalValueEur: 235_000,
    // Not "priced by oracle" in the gold/silver sense (there's no independent market price — see
    // computeValuation's real-estate branch, which never reads OracleManager). Set to true only
    // once backend/scripts/register-real-estate-collateral.ts has actually registered a price
    // source for this assetId (appraisal ÷ current supply, pushed manually — see that script's
    // header): that's what makes it show up as a CDP collateral candidate at all. Before that
    // script has run, OracleManager.getPrice reverts for this id and every consumer already
    // handles that as "unavailable", same as a stale gold/silver feed.
    pricedByOracle: true,
    attestation: {
      verified: true,
      auditor: "Notaire de Paris · Étude XYZ",
      asOf: "2026-06-15",
    },
  },
];

// Asset ids that predate a later redeploy or restructuring and are no longer in ASSETS above, but
// still show up in wallet history (VaultManager keeps every Deposited/Redeemed event forever —
// see useTransactionHistory). Three generations of real-estate market sit here:
// REAL_ESTATE_PARIS_01, the single untiered market from the first post-ROUTER_ROLE-fix redeploy;
// the five per-lock-up tiers that briefly replaced it while the lock-up was a depositor-facing
// choice; and _V3, superseded because the factory that produced it still emitted the original
// adapter, whose lock-up a self-transfer walked straight past (see backend/AUDIT.md findings 1
// and 7). Kept here purely so TransactionHistory can label those rows instead of showing
// "Unknown asset" — not something a depositor can act on going forward, so they're deliberately
// absent from ASSETS.
const RETIRED_LOCKUP_TIERS = ["15D", "1M", "3M", "6M", "1Y"] as const;

export const LEGACY_ASSET_LABELS: Record<Hex, string> = {
  [assetIdFromLabel("REAL_ESTATE_PARIS_01")]: "Paris Property #01 (legacy, pre-tier split)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V3")]: "Paris Property #01 (legacy, pre-market-wide lock-up)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V4")]: "Paris Property #01 (legacy, market-wide lock-up)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V5")]: "Paris Property #01 (legacy, no lock-up)",
  ...Object.fromEntries(
    RETIRED_LOCKUP_TIERS.map((key) => [
      assetIdFromLabel(`REAL_ESTATE_PARIS_01_${key}`),
      `Paris Property #01 (legacy, ${key} lock-up tier)`,
    ]),
  ),
};
