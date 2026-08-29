import type { PublicClient } from "viem";
import { DEPLOYMENT_BLOCK, LOG_LOOKBACK_BLOCKS } from "@/config/contracts";

/** A `fromBlock` for getLogs that never reaches back to the chain's genesis — see
 *  DEPLOYMENT_BLOCK's comment in config/contracts.ts for why that matters. */
export async function boundedFromBlock(publicClient: PublicClient): Promise<bigint> {
  if (DEPLOYMENT_BLOCK !== null) return DEPLOYMENT_BLOCK;
  const current = await publicClient.getBlockNumber();
  return current > LOG_LOOKBACK_BLOCKS ? current - LOG_LOOKBACK_BLOCKS : 0n;
}
