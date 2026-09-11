import type { AbiEvent, Log, PublicClient } from "viem";
import { DEPLOYMENT_BLOCK, LOG_LOOKBACK_BLOCKS } from "@/config/contracts";

/** A `fromBlock` for getLogs that never reaches back to the chain's genesis — see
 *  DEPLOYMENT_BLOCK's comment in config/contracts.ts for why that matters. */
export async function boundedFromBlock(publicClient: PublicClient): Promise<bigint> {
  if (DEPLOYMENT_BLOCK !== null) return DEPLOYMENT_BLOCK;
  const current = await publicClient.getBlockNumber();
  return current > LOG_LOOKBACK_BLOCKS ? current - LOG_LOOKBACK_BLOCKS : 0n;
}

// Fallback window sizes, tried largest first (see getLogsChunked). Measured caps, not guesses:
// publicnode answers a wider range with "exceed maximum block range: 50000", Infura's free tier
// with "range 105297 exceeds limit of 10000", thirdweb's public endpoint allows 1000, and
// 1rpc.io/sepolia allows 50. Starting at 45k keeps a ~100k-block history to three requests
// against the endpoint this app actually defaults to, where a flat 400 would have taken 250 —
// which is what turned a rate limit into an unloadable Activity panel. The 9k rung covers the
// 10,000-cap family, which is the most common one; it sits below that cap rather than exactly on
// it so an endpoint counting the range inclusively still accepts it.
const CHUNK_SIZES = [45_000n, 9_000n, 900n, 45n];
// Parallel in-flight chunk requests: enough to keep the fallback's wall-clock time reasonable,
// low enough not to look like a burst to the rate limiter that likely caused the fallback.
const CONCURRENCY = 3;

function toLogs<event extends AbiEvent>(chunk: unknown): Log<bigint, number, false, event>[] {
  return chunk as Log<bigint, number, false, event>[];
}

async function fetchLogs<event extends AbiEvent>(
  publicClient: PublicClient,
  params: { address: `0x${string}`; event: event; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log<bigint, number, false, event>[]> {
  // viem's getLogs overloads are a discriminated union precise enough that a generically typed
  // params object can't satisfy any single branch — the function signatures around this file are
  // what keep call sites type-safe; this cast just clears an internal TS limitation, not a real
  // type hole.
  const chunk = await publicClient.getLogs({ ...params, fromBlock, toBlock } as Parameters<PublicClient["getLogs"]>[0]);
  return toLogs<event>(chunk);
}

/**
 * getLogs over [fromBlock, toBlock], tried as a single call first: the endpoint lib/logs-client.ts
 * selects answers this app's entire history — ~100k blocks — in one request, and chunking it
 * unconditionally would turn that into hundreds. Only if that call fails does this retry in
 * windows, trying CHUNK_SIZES largest first, so an endpoint with a generous range cap is not
 * punished with the request volume a stingy one needs. If every window size also fails, the error
 * is rethrown rather than swallowed into an empty array: "no logs" and "this endpoint cannot see
 * that far back" look identical to a caller, and telling a depositor they have no activity when
 * the endpoint simply lost sight of it is the failure this whole path exists to prevent.
 */
export async function getLogsChunked<const event extends AbiEvent>(
  publicClient: PublicClient,
  params: { address: `0x${string}`; event: event; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log<bigint, number, false, event>[]> {
  try {
    return await fetchLogs(publicClient, params, fromBlock, toBlock);
  } catch (error) {
    let lastError = error;
    for (const chunkSize of CHUNK_SIZES) {
      try {
        return await fetchInChunks(publicClient, params, fromBlock, toBlock, chunkSize);
      } catch (chunkError) {
        lastError = chunkError;
      }
    }
    // Every window size failed: this is a real failure (a dead endpoint, a rate limit that
    // outlasted the retry) and not a range limit, so let the caller surface it rather than
    // returning [] — an empty array here is indistinguishable from "no activity", which is the
    // exact confusion this whole code path exists to avoid.
    throw lastError;
  }
}

async function fetchInChunks<const event extends AbiEvent>(
  publicClient: PublicClient,
  params: { address: `0x${string}`; event: event; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): Promise<Log<bigint, number, false, event>[]> {
  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    ranges.push([start, end]);
  }

  const results: Log<bigint, number, false, event>[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(([start, end]) => fetchLogs(publicClient, params, start, end)));
    for (const chunk of batchResults) results.push(...chunk);
  }

  return results;
}
