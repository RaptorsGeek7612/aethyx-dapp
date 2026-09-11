import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";

/**
 * Sepolia endpoint used *only* for eth_getLogs. It is deliberately not the one wagmi's contract
 * reads go through, because no free endpoint measured for this app does both jobs:
 *
 * | endpoint   | 75 batched reads in one POST | getLogs over the full history |
 * |------------|------------------------------|-------------------------------|
 * | publicnode | 200, 75 replies, 163 ms      | caps at 50k blocks, and **silently returns []** past ~50k |
 * | tenderly   | 429, counts each batched call| 6 events, 177 ms, whole range in one call |
 *
 * publicnode prunes to roughly the last 50,000 blocks (~7 days): `eth_getCode` at an older block
 * answers "state ... is pruned", and a log query reaching further back comes back as an empty
 * array rather than an error — indistinguishable from "this wallet has no activity", which is
 * exactly how the deployed Activity panel came to show nothing while the deposits it was missing
 * sat 92,000 blocks back. Tenderly's public gateway returns those same six deposits in a single
 * unchunked call, with permissive CORS and a working preflight, but throttles a burst — which is
 * fine here, because the history hooks make a handful of calls, not seventy-five.
 *
 * Override with NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL. A keyed archive endpoint (Alchemy's or
 * Infura's free tier) is the durable answer; these public defaults are what works without an
 * account. Whatever you point this at, check it against the app's real block range — a lone curl
 * over a recent range is exactly the test that missed this.
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
