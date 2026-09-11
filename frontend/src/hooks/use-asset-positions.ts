"use client";

import { useMemo } from "react";
import type { Hex } from "viem";
import type { AssetDefinition } from "@/config/assets";
import { useTransactionHistory } from "@/hooks/use-transaction-history";

export interface Position {
  /** 1-based, in the order the deposits happened. */
  number: number;
  /** Wrapped tokens this deposit minted. */
  received: bigint;
  /** What is left of it once redemptions have been attributed, oldest first. */
  remaining: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
}

/**
 * One entry per deposit the connected wallet made into `asset`, rebuilt from VaultManager's
 * Deposited/Redeemed events — the only record of past activity, since the contracts keep current
 * state only.
 *
 * The wrapped token is a plain ERC-20 and therefore fungible: 5 GLD minted by one deposit and 2
 * by another are the same 7 GLD afterwards, with nothing on-chain tying any of it back to either
 * deposit. So `remaining` is a *display convention*, not a fact the chain can confirm:
 * redemptions are attributed to the oldest deposit first, the same order the retired lock-up used
 * to release tranches in. Any other order would be equally defensible, which is exactly why the
 * UI states the convention rather than presenting these as separately redeemable contracts.
 *
 * Transfers are invisible here for the same reason — they emit no VaultManager event — so the
 * wallet's actual balance can differ from the sum of `remaining`. The caller is expected to show
 * that difference rather than hide it.
 */
export function useAssetPositions(asset: AssetDefinition) {
  const { entries, isLoading, isError, refetch } = useTransactionHistory();

  const positions = useMemo(() => {
    const mine = entries.filter((entry) => entry.assetId === asset.id);
    const deposits = mine
      .filter((entry) => entry.type === "deposit")
      .sort((a, b) => Number(a.blockNumber - b.blockNumber));

    // `amount` on a redeem is the wrapped amount handed in, fee included — the whole of it leaves
    // the holder, so that is what a deposit's remaining balance has to absorb.
    const redeemed = mine.filter((entry) => entry.type === "redeem").reduce((sum, entry) => sum + entry.amount, 0n);

    const result: Position[] = [];
    let toAttribute = redeemed;
    for (const [index, deposit] of deposits.entries()) {
      const consumed = toAttribute > deposit.received ? deposit.received : toAttribute;
      toAttribute -= consumed;
      result.push({
        number: index + 1,
        received: deposit.received,
        remaining: deposit.received - consumed,
        blockNumber: deposit.blockNumber,
        transactionHash: deposit.transactionHash,
      });
    }
    return result;
  }, [entries, asset.id]);

  const totalDeposited = positions.reduce((sum, p) => sum + p.received, 0n);
  const totalRemaining = positions.reduce((sum, p) => sum + p.remaining, 0n);

  return { positions, totalDeposited, totalRemaining, isLoading, isError, refetch };
}
