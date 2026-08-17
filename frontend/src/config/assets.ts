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
    id: assetIdFromLabel("REAL_ESTATE_PARIS_01"),
    label: "REAL_ESTATE_PARIS_01",
    kind: "real-estate",
    title: "Paris Property #01",
    description: "Fractionalized real estate, subject to a minimum holding period on redemption.",
    appraisalValueEur: 235_000,
    attestation: {
      verified: true,
      auditor: "Notaire de Paris — Étude XYZ",
      asOf: "2026-06-15",
    },
  },
];
