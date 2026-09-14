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
  /**
   * Only meaningful for the CDP console (see cdp-console.tsx's resolveCollateralId). GOLD/SILVER
   * keep the same label — and so the same assetId — across every CDPManager instance a redeploy
   * creates (see AUDIT.md finding 12): the id this asset is registered under never changes, only
   * which CDPManager it's registered on. Real estate is different — each redeploy bumps VERSION
   * in deploy-real-estate-market.ts, so the *label itself* changes generation to generation
   * (finding 1: V7 fixed the self-transfer escape V6 still carries). A legacy CDPManager can
   * therefore hold a collateral registration for the *previous* label under this same building,
   * not this one — set this to that previous label so the console can still reach it under the
   * "Legacy" instance tab instead of it silently having nowhere to appear.
   */
  legacyLabel?: string;
}

// Every deposit opens its own tranche in a schedule shared by the whole market: redemption draws
// from the pool's total matured amount, not the caller's own deposits specifically — closing the
// self-transfer escape earlier versions (V6 and before) knowingly accepted. See
// RealEstateAdapter.sol and AUDIT.md finding 1's "l'arbitrage a été retranché en faveur de la
// sécurité" update for the full history.
const REAL_ESTATE_LABEL = "REAL_ESTATE_PARIS_01_V7";

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
    // REAL_ESTATE_PARIS_01_V6 — still registered as CDP collateral on the legacy CDPManager
    // (AUDIT.md finding 12's redeploy didn't migrate it). Lets the "Legacy" instance tab reach it.
    legacyLabel: "REAL_ESTATE_PARIS_01_V6",
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
// see useTransactionHistory). Several generations of real-estate market sit here:
// REAL_ESTATE_PARIS_01, the single untiered market from the first post-ROUTER_ROLE-fix redeploy;
// the five per-lock-up tiers that briefly replaced it while the lock-up was a depositor-facing
// choice; _V3, superseded because the factory that produced it still emitted the original
// adapter, whose lock-up a self-transfer walked straight past; and _V6, which — like _V3 — still
// carries that same self-transfer escape (only fixed for real in _V7's market-wide pool; see
// backend/AUDIT.md findings 1 and 7). Kept here purely so TransactionHistory can label those rows
// instead of showing "Unknown asset" — not something a depositor can act on going forward, so
// they're deliberately absent from ASSETS.
const RETIRED_LOCKUP_TIERS = ["15D", "1M", "3M", "6M", "1Y"] as const;

export const LEGACY_ASSET_LABELS: Record<Hex, string> = {
  [assetIdFromLabel("REAL_ESTATE_PARIS_01")]: "Paris Property #01 (legacy, pre-tier split)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V3")]: "Paris Property #01 (legacy, pre-market-wide lock-up)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V4")]: "Paris Property #01 (legacy, market-wide lock-up)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V5")]: "Paris Property #01 (legacy, no lock-up)",
  [assetIdFromLabel("REAL_ESTATE_PARIS_01_V6")]: "Paris Property #01 (legacy, per-deposit maturity)",
  ...Object.fromEntries(
    RETIRED_LOCKUP_TIERS.map((key) => [
      assetIdFromLabel(`REAL_ESTATE_PARIS_01_${key}`),
      `Paris Property #01 (legacy, ${key} lock-up tier)`,
    ]),
  ),
};
