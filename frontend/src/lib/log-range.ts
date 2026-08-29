import type { AbiEvent, Log, PublicClient } from "viem";
import { DEPLOYMENT_BLOCK, LOG_LOOKBACK_BLOCKS } from "@/config/contracts";

/** A `fromBlock` for getLogs that never reaches back to the chain's genesis — see
 *  DEPLOYMENT_BLOCK's comment in config/contracts.ts for why that matters. */
export async function boundedFromBlock(publicClient: PublicClient): Promise<bigint> {
  if (DEPLOYMENT_BLOCK !== null) return DEPLOYMENT_BLOCK;
  const current = await publicClient.getBlockNumber();
  return current > LOG_LOOKBACK_BLOCKS ? current - LOG_LOOKBACK_BLOCKS : 0n;
}

// Conservative even against stingy public RPC endpoints — e.g. Alchemy's free tier caps
// eth_getLogs at a 10-block range (unusable for this app's multi-thousand-block history window,
// hence not using it here — see wagmi.ts), while thirdweb's public Sepolia endpoint (the default
// this app actually uses) allows 1000. 400 clears that with margin.
const CHUNK_SIZE = 400n;
// Parallel in-flight chunk requests. High enough to keep total wall-clock time reasonable over a
// multi-week block range, low enough not to look like a burst attack to a rate limiter.
const CONCURRENCY = 5;

/**
 * getLogs over [fromBlock, toBlock], transparently split into CHUNK_SIZE-block windows and
 * fetched with bounded concurrency. A single unchunked call over more than a handful of blocks
 * fails outright on several real Sepolia RPC providers (see CHUNK_SIZE's comment) — this is what
 * makes usePriceHistory/useTransactionHistory's queries actually succeed against them instead of
 * silently returning nothing.
 */
export async function getLogsChunked<const event extends AbiEvent>(
  publicClient: PublicClient,
  params: { address: `0x${string}`; event: event; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log<bigint, number, false, event>[]> {
  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = start + CHUNK_SIZE - 1n > toBlock ? toBlock : start + CHUNK_SIZE - 1n;
    ranges.push([start, end]);
  }

  const results: Log<bigint, number, false, event>[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(([start, end]) =>
        // viem's getLogs overloads are a discriminated union precise enough that a generically
        // typed params object can't satisfy any single branch — the function signature above is
        // what keeps this call site type-safe for callers; this cast just clears an internal
        // TS limitation, not a real type hole.
        publicClient.getLogs({ ...params, fromBlock: start, toBlock: end } as Parameters<PublicClient["getLogs"]>[0]),
      ),
    );
    for (const chunk of batchResults) results.push(...(chunk as unknown as Log<bigint, number, false, event>[]));
  }

  return results;
}
