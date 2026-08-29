"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem, type Address, type Hex } from "viem";
import { VAULT_MANAGER_ADDRESS, isContractsConfigured } from "@/config/contracts";
import { boundedFromBlock, getLogsChunked } from "@/lib/log-range";

const DEPOSITED_EVENT = parseAbiItem(
  "event Deposited(bytes32 indexed assetId, address indexed user, uint256 underlyingAmount, uint256 mintedAmount, uint256 feeAmount)",
);
const REDEEMED_EVENT = parseAbiItem(
  "event Redeemed(bytes32 indexed assetId, address indexed user, uint256 wrappedAmount, uint256 underlyingAmount, uint256 feeAmount)",
);

export interface HistoryEntry {
  type: "deposit" | "redeem";
  assetId: Hex;
  /** underlyingAmount for a deposit, wrappedAmount for a redeem — what the user handed in. */
  amount: bigint;
  /** mintedAmount for a deposit, underlyingAmount for a redeem — what they got, net of fee. */
  received: bigint;
  fee: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
}

/** Every Deposited/Redeemed VaultManager event for the connected wallet, across every asset —
 *  there's no other on-chain record of past activity (VaultManager only tracks current state),
 *  so the event log is the only source for "what did I do and when". */
export function useTransactionHistory() {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const enabled = isContractsConfigured && Boolean(account) && Boolean(publicClient);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["transactionHistory", account, VAULT_MANAGER_ADDRESS],
    enabled,
    refetchInterval: 30_000,
    // The default (3 retries, up to ~30s backoff each) can leave the UI showing a loading
    // skeleton for the better part of a minute against a struggling RPC endpoint before settling
    // into the error state below — one retry is enough to shake off a single transient failure
    // without that wait feeling like the app is stuck.
    retry: 1,
    queryFn: async (): Promise<HistoryEntry[]> => {
      if (!publicClient || !account) return [];
      const [fromBlock, toBlock] = await Promise.all([boundedFromBlock(publicClient), publicClient.getBlockNumber()]);

      const [depositLogs, redeemLogs] = await Promise.all([
        getLogsChunked(
          publicClient,
          { address: VAULT_MANAGER_ADDRESS as Address, event: DEPOSITED_EVENT, args: { user: account } },
          fromBlock,
          toBlock,
        ),
        getLogsChunked(
          publicClient,
          { address: VAULT_MANAGER_ADDRESS as Address, event: REDEEMED_EVENT, args: { user: account } },
          fromBlock,
          toBlock,
        ),
      ]);

      const deposits: HistoryEntry[] = depositLogs.map((log) => ({
        type: "deposit",
        assetId: log.args.assetId as Hex,
        amount: log.args.underlyingAmount as bigint,
        received: log.args.mintedAmount as bigint,
        fee: log.args.feeAmount as bigint,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      }));
      const redeems: HistoryEntry[] = redeemLogs.map((log) => ({
        type: "redeem",
        assetId: log.args.assetId as Hex,
        amount: log.args.wrappedAmount as bigint,
        received: log.args.underlyingAmount as bigint,
        fee: log.args.feeAmount as bigint,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      }));

      return [...deposits, ...redeems].sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
  });

  return { entries: data ?? [], isLoading, isError, refetch };
}
