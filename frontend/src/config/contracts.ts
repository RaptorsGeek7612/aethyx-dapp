import type { Address } from "viem";

// Filled in after running `hardhat ignition deploy ignition/modules/InvestOrGateway.ts`
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
