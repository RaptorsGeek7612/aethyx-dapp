"use client";

import { useAccount, useReadContracts } from "wagmi";
import type { Address, Hex } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { cdpManagerAbi } from "@/lib/abis/cdpManagerAbi";
import { CDP_MANAGER_ADDRESS, STABLE_TOKEN_ADDRESS, isCdpConfigured } from "@/config/contracts";
import { ZERO_ADDRESS } from "@/hooks/use-asset-static";

export interface CdpPosition {
  wrappedToken: Address;
  wrappedSymbol: string;
  wrappedDecimals: number;
  stableSymbol: string;
  stableDecimals: number;
  minCollateralRatioBps: number;
  liquidationThresholdBps: number;
  stabilityFeeBps: number;
  active: boolean;
  /** Collateral locked by the connected wallet, in the wrapped token's own decimals. */
  collateralAmount: bigint;
  /** Debt as of the last settlement — `currentDebt` below is the number that includes whatever
   *  has accrued since, and is what the UI should always show. */
  debtAmount: bigint;
  /** Live, includes stability fee accrued since the position was last touched. */
  currentDebt: bigint;
  /** `type(uint256).max` reads back as this sentinel when the position carries no debt. */
  ratioBps: bigint;
  wrappedBalance: bigint;
  wrappedAllowanceForCdp: bigint;
  stableBalance: bigint;
  stableAllowanceForCdp: bigint;
}

const NO_DEBT_RATIO = 2n ** 256n - 1n;

/**
 * Everything the CDP page needs for one collateral type: risk parameters, the connected wallet's
 * position (debt live-accrued, not just its last-settled value), and the balances/allowances that
 * decide which actions are currently possible. Mirrors the two-stage shape of useAssetStaticData/
 * useAssetData — collateral config first (it carries the wrapped token address), then everything
 * that address unlocks.
 */
export function useCdpPosition(collateralId: Hex) {
  const { address: account } = useAccount();

  const {
    data: config,
    isLoading: loadingConfig,
    refetch: refetchConfig,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: CDP_MANAGER_ADDRESS as Address,
        abi: cdpManagerAbi,
        functionName: "collaterals",
        args: [collateralId],
      },
    ],
    query: { enabled: isCdpConfigured },
  });

  const collateral = config?.[0]?.result;
  const wrappedToken = collateral?.[0] ?? ZERO_ADDRESS;
  const minCollateralRatioBps = Number(collateral?.[1] ?? 0);
  const liquidationThresholdBps = Number(collateral?.[2] ?? 0);
  const stabilityFeeBps = Number(collateral?.[3] ?? 0);
  const active = collateral?.[6] ?? false;
  const registered = wrappedToken !== ZERO_ADDRESS;

  const canReadPosition = registered && Boolean(account);

  const {
    data: details,
    isLoading: loadingDetails,
    refetch: refetchDetails,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: wrappedToken, abi: erc20Abi, functionName: "symbol" },
      { address: wrappedToken, abi: erc20Abi, functionName: "decimals" },
      { address: STABLE_TOKEN_ADDRESS as Address, abi: erc20Abi, functionName: "symbol" },
      { address: STABLE_TOKEN_ADDRESS as Address, abi: erc20Abi, functionName: "decimals" },
      {
        address: CDP_MANAGER_ADDRESS as Address,
        abi: cdpManagerAbi,
        functionName: "positions",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      {
        address: CDP_MANAGER_ADDRESS as Address,
        abi: cdpManagerAbi,
        functionName: "currentDebt",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      {
        address: CDP_MANAGER_ADDRESS as Address,
        abi: cdpManagerAbi,
        functionName: "collateralRatioBps",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      { address: wrappedToken, abi: erc20Abi, functionName: "balanceOf", args: [account ?? ZERO_ADDRESS] },
      {
        address: wrappedToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account ?? ZERO_ADDRESS, CDP_MANAGER_ADDRESS as Address],
      },
      {
        address: STABLE_TOKEN_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account ?? ZERO_ADDRESS],
      },
      {
        address: STABLE_TOKEN_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account ?? ZERO_ADDRESS, CDP_MANAGER_ADDRESS as Address],
      },
    ],
    query: { enabled: canReadPosition, refetchInterval: 15_000 },
  });

  const position = details?.[4]?.result;

  const data: CdpPosition = {
    wrappedToken,
    wrappedSymbol: (details?.[0]?.result as string | undefined) ?? "?",
    wrappedDecimals: Number(details?.[1]?.result ?? 18),
    stableSymbol: (details?.[2]?.result as string | undefined) ?? "ioEUR",
    stableDecimals: Number(details?.[3]?.result ?? 18),
    minCollateralRatioBps,
    liquidationThresholdBps,
    stabilityFeeBps,
    active,
    collateralAmount: position?.[0] ?? 0n,
    debtAmount: position?.[1] ?? 0n,
    currentDebt: (details?.[5]?.result as bigint | undefined) ?? 0n,
    ratioBps: (details?.[6]?.result as bigint | undefined) ?? NO_DEBT_RATIO,
    wrappedBalance: (details?.[7]?.result as bigint | undefined) ?? 0n,
    wrappedAllowanceForCdp: (details?.[8]?.result as bigint | undefined) ?? 0n,
    stableBalance: (details?.[9]?.result as bigint | undefined) ?? 0n,
    stableAllowanceForCdp: (details?.[10]?.result as bigint | undefined) ?? 0n,
  };

  return {
    data,
    registered,
    hasNoDebt: data.ratioBps === NO_DEBT_RATIO,
    isLoading: loadingConfig || (canReadPosition && loadingDetails),
    refetch: () => {
      void refetchConfig();
      void refetchDetails();
    },
  };
}
