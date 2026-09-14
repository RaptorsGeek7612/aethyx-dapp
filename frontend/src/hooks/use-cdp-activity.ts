"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem, type Address, type Hex } from "viem";
import { CDP_MANAGERS, isCdpConfigured } from "@/config/contracts";
import { boundedFromBlock, getLogsChunked } from "@/lib/log-range";
import { logsClientFor } from "@/lib/logs-client";

const COLLATERAL_DEPOSITED = parseAbiItem(
  "event CollateralDeposited(address indexed user, bytes32 indexed collateralId, uint256 amount)",
);
const COLLATERAL_WITHDRAWN = parseAbiItem(
  "event CollateralWithdrawn(address indexed user, bytes32 indexed collateralId, uint256 amount)",
);
const DEBT_MINTED = parseAbiItem("event DebtMinted(address indexed user, bytes32 indexed collateralId, uint256 amount)");
const DEBT_REPAID = parseAbiItem("event DebtRepaid(address indexed user, bytes32 indexed collateralId, uint256 amount)");
const POSITION_LIQUIDATED = parseAbiItem(
  "event PositionLiquidated(address indexed user, bytes32 indexed collateralId, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized)",
);

export type CdpActivityType = "collateral-deposit" | "collateral-withdraw" | "mint" | "repay" | "liquidated" | "liquidator";

export interface CdpActivityEntry {
  type: CdpActivityType;
  collateralId: Hex;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  /** Which CDPManager instance emitted this event — current or one of the retired ones in
   *  CDP_MANAGERS. Lets the ledger read as one history across a redeploy instead of the trail
   *  going cold at whatever block the instance changed. */
  managerAddress: Address;
}

/** Every CDPManager event for the connected wallet, across every known instance (current plus
 *  any retired ones — see CDP_MANAGERS in config/contracts.ts) — the credit facility's own side
 *  of "what did I do and when", parallel to useTransactionHistory for the Gateway's deposit/
 *  redeem events. The two are fetched separately (different contract, different event set) and
 *  merged for display, the same way the dashboard already merges per-asset metrics. */
export function useCdpActivity() {
  const { address: account } = useAccount();
  const publicClient = logsClientFor(usePublicClient());
  const enabled = isCdpConfigured && Boolean(account) && Boolean(publicClient);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cdpActivity", account, CDP_MANAGERS.map((m) => m.address)],
    enabled,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<CdpActivityEntry[]> => {
      if (!publicClient || !account) return [];
      const [fromBlock, toBlock] = await Promise.all([boundedFromBlock(publicClient), publicClient.getBlockNumber()]);

      const perManager = await Promise.all(
        CDP_MANAGERS.map(async ({ address }) => {
          const [deposits, withdrawals, mints, repayments, liquidatedOwner, liquidatedBy] = await Promise.all([
            getLogsChunked(publicClient, { address, event: COLLATERAL_DEPOSITED, args: { user: account } }, fromBlock, toBlock),
            getLogsChunked(publicClient, { address, event: COLLATERAL_WITHDRAWN, args: { user: account } }, fromBlock, toBlock),
            getLogsChunked(publicClient, { address, event: DEBT_MINTED, args: { user: account } }, fromBlock, toBlock),
            getLogsChunked(publicClient, { address, event: DEBT_REPAID, args: { user: account } }, fromBlock, toBlock),
            getLogsChunked(publicClient, { address, event: POSITION_LIQUIDATED, args: { user: account } }, fromBlock, toBlock),
            getLogsChunked(publicClient, { address, event: POSITION_LIQUIDATED, args: { liquidator: account } }, fromBlock, toBlock),
          ]);

          const entries: CdpActivityEntry[] = [
            ...deposits.map((log) => ({
              type: "collateral-deposit" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.amount as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
            ...withdrawals.map((log) => ({
              type: "collateral-withdraw" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.amount as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
            ...mints.map((log) => ({
              type: "mint" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.amount as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
            ...repayments.map((log) => ({
              type: "repay" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.amount as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
            ...liquidatedOwner.map((log) => ({
              type: "liquidated" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.debtRepaid as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
            ...liquidatedBy.map((log) => ({
              type: "liquidator" as const,
              collateralId: log.args.collateralId as Hex,
              amount: log.args.debtRepaid as bigint,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              managerAddress: address,
            })),
          ];
          return entries;
        }),
      );

      return perManager.flat().sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
  });

  return { entries: data ?? [], isLoading, isError, refetch };
}
