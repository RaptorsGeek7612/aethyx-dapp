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
