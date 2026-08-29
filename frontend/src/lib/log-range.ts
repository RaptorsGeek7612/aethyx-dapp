import type { AbiEvent, Log, PublicClient } from "viem";
import { DEPLOYMENT_BLOCK, LOG_LOOKBACK_BLOCKS } from "@/config/contracts";

/** A `fromBlock` for getLogs that never reaches back to the chain's genesis — see
 *  DEPLOYMENT_BLOCK's comment in config/contracts.ts for why that matters. */
export async function boundedFromBlock(publicClient: PublicClient): Promise<bigint> {
  if (DEPLOYMENT_BLOCK !== null) return DEPLOYMENT_BLOCK;
  const current = await publicClient.getBlockNumber();
  return current > LOG_LOOKBACK_BLOCKS ? current - LOG_LOOKBACK_BLOCKS : 0n;
}

// Only used as a fallback (see getLogsChunked) — conservative enough to clear even a stingy
// provider like Alchemy's free tier (10-block eth_getLogs cap).
const CHUNK_SIZE = 400n;
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
 * getLogs over [fromBlock, toBlock] — tried as a single call first, since every real RPC provider
 * this app has actually been tested against (see wagmi.ts) tolerates the app's full
 * several-thousand-block history window in one request, and that's a fraction of the requests
 * chunking always would have made. Falls back to CHUNK_SIZE-block windows with bounded
 * concurrency only if the single call fails (a stingier provider's own range limit, or a
 * transient error) — this is what makes usePriceHistory/useTransactionHistory's queries resilient
 * to whichever provider ends up configured, without paying the request-volume cost of chunking
 * against providers that never needed it.
 */
export async function getLogsChunked<const event extends AbiEvent>(
  publicClient: PublicClient,
  params: { address: `0x${string}`; event: event; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log<bigint, number, false, event>[]> {
  try {
    return await fetchLogs(publicClient, params, fromBlock, toBlock);
  } catch {
    // fall through to chunked retry below
  }

  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = start + CHUNK_SIZE - 1n > toBlock ? toBlock : start + CHUNK_SIZE - 1n;
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
