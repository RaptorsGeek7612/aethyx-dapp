import type { Address } from "viem";

// Filled in after running `hardhat ignition deploy ignition/modules/AethyxGateway.ts`
// against whichever network the frontend is pointed at (see frontend/.env.local.example).
// Left unset, the UI still renders but flags itself as "not configured" instead of crashing.
export const GATEWAY_ADDRESS = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? "") as Address | "";
export const VAULT_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? "") as Address | "";
export const ORACLE_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_ORACLE_MANAGER_ADDRESS ?? "") as Address | "";

// OracleManager has no on-chain enumeration of a price's registered sources (same mapping-based
// trade-off as VaultManager's asset registry). The frontend needs these addresses directly to
// read PriceUpdated event history for the 24h chart — OracleManager.getPrice only ever returns
// the current aggregate, never a log of past values.
const rawPriceSources = process.env.NEXT_PUBLIC_PRICE_SOURCE_ADDRESSES ?? "";
export const PRICE_SOURCE_ADDRESSES = rawPriceSources
  .split(",")
  .map((address) => address.trim())
  .filter((address): address is Address => address.length > 0) as Address[];

export const isContractsConfigured = Boolean(GATEWAY_ADDRESS && VAULT_MANAGER_ADDRESS);
export const isOracleConfigured = Boolean(ORACLE_MANAGER_ADDRESS && PRICE_SOURCE_ADDRESSES.length > 0);

// The CDP module (StableToken + CDPManager) is deployed separately from the core protocol above —
// see backend/scripts/deploy-cdp.ts — so it gets its own addresses and its own configured flag
// rather than folding into isContractsConfigured.
export const CDP_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_CDP_MANAGER_ADDRESS ?? "") as Address | "";
export const STABLE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_STABLE_TOKEN_ADDRESS ?? "") as Address | "";
export const isCdpConfigured = Boolean(CDP_MANAGER_ADDRESS && STABLE_TOKEN_ADDRESS);

// CDPManager isn't upgradeable (see AUDIT.md #12, backend/scripts/redeploy-cdp-manager.ts): a
// breaking ABI change means a fresh instance, and whatever was still open on the old one doesn't
// migrate itself. Rather than the UI dropping a superseded instance the moment a new one goes
// live — stranding anyone with an open position there — every retired CDPManager address stays
// listed here so the console can still read and act on it, clearly marked as legacy.
const rawLegacyManagers = process.env.NEXT_PUBLIC_CDP_MANAGER_LEGACY_ADDRESSES ?? "";
export const CDP_MANAGER_LEGACY_ADDRESSES = rawLegacyManagers
  .split(",")
  .map((address) => address.trim())
  .filter((address): address is Address => address.length > 0) as Address[];

// Only the *original* CDPManager (pre-AUDIT.md finding 12) uses the narrow `collaterals` shape
// (no liquidationBonusBps) and the 2-argument `liquidate` — see cdpManagerLegacyAbi's own comment.
// Every CDPManager deployed since finding 12 already has the current shape, including ones that
// later became "legacy" themselves (retired from new deposits/borrows, but not narrower ABI-wise)
// — conflating "retired" with "narrow ABI" reads the wrong tuple index on those. List addresses
// here that need the narrow ABI specifically; anything in CDP_MANAGER_LEGACY_ADDRESSES but not
// here is legacy-as-in-retired only, decoded with the current-shape ABI.
const rawLegacyAbiManagers = process.env.NEXT_PUBLIC_CDP_MANAGER_LEGACY_ABI_ADDRESSES ?? "";
export const CDP_MANAGER_LEGACY_ABI_ADDRESSES = rawLegacyAbiManagers
  .split(",")
  .map((address) => address.trim().toLowerCase())
  .filter((address): address is string => address.length > 0);

export interface CdpManagerRef {
  address: Address;
  label: string;
  /** Retired: no longer accepts new deposits/borrows, but still readable/manageable. */
  legacy: boolean;
  /** Narrow pre-finding-12 `collaterals` shape and 2-arg `liquidate` — see the const above. */
  legacyAbi: boolean;
}

// Current instance first — it's the one every selector defaults to and the only one new
// collateral types get registered on.
export const CDP_MANAGERS: CdpManagerRef[] = [
  ...(CDP_MANAGER_ADDRESS
    ? [{ address: CDP_MANAGER_ADDRESS as Address, label: "Current", legacy: false, legacyAbi: false }]
    : []),
  ...CDP_MANAGER_LEGACY_ADDRESSES.map((address, index) => ({
    address,
    label: CDP_MANAGER_LEGACY_ADDRESSES.length > 1 ? `Legacy ${index + 1}` : "Legacy",
    legacy: true,
    legacyAbi: CDP_MANAGER_LEGACY_ABI_ADDRESSES.includes(address.toLowerCase()),
  })),
];

// The block this deployment's contracts were created at, if known — every getLogs scan (price
// history, transaction history) starts here instead of the chain's genesis block. Without this,
// a naive `fromBlock: 0n` on Sepolia means scanning several million blocks on every 30s refetch,
// which a public RPC endpoint will throttle or outright fail — the actual cause of price/history
// data silently never loading rather than a contract or oracle problem.
export const DEPLOYMENT_BLOCK = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK)
  : null;

// Fallback lookback window when DEPLOYMENT_BLOCK isn't set — roughly a month of Sepolia blocks
// at its ~12s block time. Keeps the same "never scan from genesis" guarantee even if a future
// deployment forgets to set NEXT_PUBLIC_DEPLOYMENT_BLOCK.
export const LOG_LOOKBACK_BLOCKS = 200_000n;
