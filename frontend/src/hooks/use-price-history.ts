"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Hex } from "viem";
import { toast } from "sonner";
import { PRICE_SOURCE_ADDRESSES, isOracleConfigured } from "@/config/contracts";
import { boundedFromBlock } from "@/lib/log-range";

const PRICE_UPDATED_EVENT = parseAbiItem(
  "event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 updatedAt)",
);

const ALERT_THRESHOLD_BPS = 500n; // 5% — matches the "variation > 5% -> notification" requirement
const ONE_DAY_SECONDS = 86_400n;

export interface PricePoint {
  price: bigint;
  updatedAt: bigint;
}

/**
 * Replays every ManualPriceSource's PriceUpdated event for `assetId` to build a trend — there
 * is no separate on-chain history store (see ManualPriceSource.sol), the event log *is* the
 * history. Also raises a toast when the latest reading has moved >5% from ~24h ago.
 */
export function usePriceHistory(assetId: Hex, pricedByOracle: boolean | undefined, assetTitle: string) {
  const publicClient = usePublicClient();
  const enabled = isOracleConfigured && Boolean(pricedByOracle) && Boolean(publicClient);
  const lastAlertedPrice = useRef<bigint | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["priceHistory", assetId, PRICE_SOURCE_ADDRESSES.join(",")],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<PricePoint[]> => {
      if (!publicClient) return [];
      const fromBlock = await boundedFromBlock(publicClient);
      const logsPerSource = await Promise.all(
        PRICE_SOURCE_ADDRESSES.map((address) =>
          publicClient.getLogs({
            address,
            event: PRICE_UPDATED_EVENT,
            args: { assetId },
            fromBlock,
            toBlock: "latest",
          }),
        ),
      );
      return logsPerSource
        .flat()
        .map((log) => ({ price: log.args.price as bigint, updatedAt: log.args.updatedAt as bigint }))
        .sort((a, b) => Number(a.updatedAt - b.updatedAt));
    },
  });

  const points = data ?? [];
  const latest = points.at(-1) ?? null;
  const dayAgoCutoff = latest ? latest.updatedAt - ONE_DAY_SECONDS : null;
  const reference =
    latest && dayAgoCutoff !== null ? (points.find((p) => p.updatedAt >= dayAgoCutoff) ?? points[0]) : null;

  const changeBps =
    latest && reference && reference.price > 0n ? ((latest.price - reference.price) * 10_000n) / reference.price : null;

  useEffect(() => {
    if (!latest || changeBps === null) return;
    const absBps = changeBps < 0n ? -changeBps : changeBps;
    if (absBps >= ALERT_THRESHOLD_BPS && lastAlertedPrice.current !== latest.price) {
      lastAlertedPrice.current = latest.price;
      const direction = changeBps > 0n ? "up" : "down";
      toast.warning(`${assetTitle} moved ${direction} ${(Number(changeBps) / 100).toFixed(2)}% in 24h`);
    }
  }, [latest, changeBps, assetTitle]);

  return { points, latest, changeBps, isLoading };
}
