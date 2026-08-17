"use client";

import { useReadContract } from "wagmi";
import type { Address, Hex } from "viem";
import { oracleManagerAbi } from "@/lib/abis/oracleManagerAbi";
import { ORACLE_MANAGER_ADDRESS, isOracleConfigured } from "@/config/contracts";

export type OracleHealth = "loading" | "healthy" | "unavailable" | "not-priced";

/**
 * Reads OracleManager.getPrice(assetId) — EUR per gram, 18 decimals. OracleManager already
 * excludes stale sources and reverts if too few fresh ones remain (see OracleManager.sol), so
 * a successful read is by construction fresh: "healthy" just means the call didn't revert.
 */
export function useAssetPrice(assetId: Hex, pricedByOracle: boolean | undefined) {
  const enabled = isOracleConfigured && Boolean(pricedByOracle);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: ORACLE_MANAGER_ADDRESS as Address,
    abi: oracleManagerAbi,
    functionName: "getPrice",
    args: [assetId],
    query: { enabled, refetchInterval: 30_000 },
  });

  const price = data?.[0] ?? 0n;
  const worstUpdatedAt = data?.[1] ?? 0n;

  let health: OracleHealth;
  if (!pricedByOracle) health = "not-priced";
  else if (isError) health = "unavailable";
  else if (data) health = "healthy";
  else health = "loading";

  return { price, worstUpdatedAt, isLoading, health, refetch };
}
