import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";

/**
 * Sepolia endpoint used *only* for eth_getLogs. It is deliberately not the one wagmi's contract
 * reads go through, because no endpoint measured for this app does both jobs.
 *
 * Measured over this app's real history (block 11573900 to head, ~105k blocks) and its real
 * regime — six getLogsChunked queries per 30s refresh: Deposited and Redeemed on VaultManager,
 * plus PriceUpdated on both price sources for the two oracle-priced assets:
 *
 * | endpoint          | getLogs range cap | requests/cycle | refused | result                   |
 * |-------------------|-------------------|----------------|---------|--------------------------|
 * | tenderly (public) | none reached      | 6              | 0%      | 32 events, stable        |
 * | infura (free key) | 10,000            | 66             | 20.7%   | 24-30 events, unstable   |
 * | alchemy (free key)| 10                | ~10,500        | -       | unusable                 |
 * | publicnode        | 50,000            | -              | -       | silently [] past ~50k    |
 *
 * The keyed free tiers are worse than the unkeyed public gateway, not better — the opposite of
 * what this file and .env.local.example previously claimed. Alchemy's free plan caps eth_getLogs
 * at a 10-block range (it says so in its own error message), and Infura's 10,000-block cap turns
 * each query into 11 requests, at which point its rate limiter refuses one in five. A refused
 * chunk is a dropped event: the per-cycle counts above vary because the data went missing, which
 * is the same silent loss this file exists to prevent, arriving by a different route.
 *
 * "Archive" is also the wrong word for what this app needs. Tenderly and Alchemy's free tier both
 * prune *state* — eth_getCode at the deployment block returns empty on both — yet Tenderly serves
 * the full log history in one call. How deep an endpoint indexes *logs* is a separate guarantee
 * from whether it keeps historical state, and only the former matters here.
 *
 * Override with NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL. Test a candidate over the app's *full* block
 * range and at its sustained request rate: a recent-range curl is the check that missed
 * publicnode's pruning, and a single full-range curl is the check that would have cleared Infura.
 */
const LOGS_RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL || "https://sepolia.gateway.tenderly.co";

let cached: PublicClient | null = null;

/** Shared across both history hooks so they reuse one transport rather than one client each. */
export function getLogsClient(): PublicClient {
  cached ??= createPublicClient({
    chain: sepolia,
    // No batching: these are a few large getLogs calls, and the endpoint that serves them counts
    // every call inside a batched POST against its rate limit.
    transport: http(LOGS_RPC_URL),
  });
  return cached;
}

/**
 * The client the history hooks should use: the dedicated logs endpoint on Sepolia, and whatever
 * wagmi is already connected to anywhere else — a local Hardhat node serves its own logs fine,
 * and pointing that at a Sepolia endpoint would break local development outright.
 */
export function logsClientFor(connected: PublicClient | undefined): PublicClient | undefined {
  if (!connected) return undefined;
  return connected.chain?.id === sepolia.id ? getLogsClient() : connected;
}
