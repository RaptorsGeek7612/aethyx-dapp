"use client";

import { useAccount, useReadContracts } from "wagmi";
import type { Abi, Address, Hex } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { cdpManagerAbi, cdpManagerLegacyAbi } from "@/lib/abis/cdpManagerAbi";
import { CDP_MANAGER_ADDRESS, STABLE_TOKEN_ADDRESS, isCdpConfigured, type CdpManagerRef } from "@/config/contracts";
import { ZERO_ADDRESS } from "@/hooks/use-asset-static";

const CURRENT_MANAGER: CdpManagerRef = { address: CDP_MANAGER_ADDRESS as Address, label: "Current", legacy: false };

export interface CdpPosition {
  wrappedToken: Address;
  wrappedSymbol: string;
  wrappedDecimals: number;
  stableSymbol: string;
  stableDecimals: number;
  minCollateralRatioBps: number;
  liquidationThresholdBps: number;
  /** Extra collateral, on top of the proportional share, a liquidator receives — see
   *  CDPManager.sol's liquidate() natspec. */
  liquidationBonusBps: number;
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
 * Everything the CDP page needs for one collateral type: risk parameters, a position (debt
 * live-accrued, not just its last-settled value), and the connected wallet's balances/allowances
 * — the latter always read for the *connected* wallet, not `subject`, because they answer "can
 * the person looking at this screen act", which for a liquidation lookup is a different address
 * than the position being inspected. Mirrors the two-stage shape of useAssetStaticData/
 * useAssetData — collateral config first (it carries the wrapped token address), then everything
 * that address unlocks.
 *
 * @param subject Whose position to read. Defaults to the connected wallet — pass a different
 *   address to look up any position, e.g. a liquidation target.
 * @param manager Which CDPManager instance to read — defaults to the current one. Pass a legacy
 *   ref (see CDP_MANAGERS in config/contracts.ts) to read a position left open on a superseded
 *   instance; its `collaterals` shape and field indices differ (no liquidationBonusBps), handled
 *   below via cdpManagerLegacyAbi.
 */
export function useCdpPosition(collateralId: Hex, subject?: Address, manager: CdpManagerRef = CURRENT_MANAGER) {
  const { address: connected } = useAccount();
  const account = subject ?? connected;
  // Widened to plain Abi: the legacy and current ABIs decode `collaterals` to differently-shaped
  // tuples, and letting TS infer a precise union of both makes every indexed field below resolve
  // to an unhelpful cross-shape union (e.g. bigint | boolean) instead of narrowing per branch —
  // the manual Number()/Boolean() casts below are the actual type safety here.
  const abi = (manager.legacy ? cdpManagerLegacyAbi : cdpManagerAbi) as Abi;

  const {
    data: config,
    isLoading: loadingConfig,
    refetch: refetchConfig,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: manager.address,
        abi,
        functionName: "collaterals",
        args: [collateralId],
      },
    ],
    query: { enabled: isCdpConfigured },
  });

  const collateral = config?.[0]?.result as readonly unknown[] | undefined;
  const wrappedToken = (collateral?.[0] as Address | undefined) ?? ZERO_ADDRESS;
  const minCollateralRatioBps = Number(collateral?.[1] ?? 0);
  const liquidationThresholdBps = Number(collateral?.[2] ?? 0);
  // The legacy struct has no liquidationBonusBps — every field past it shifts back by one, so
  // `active` (last field) moves from index 7 to index 6 there.
  const liquidationBonusBps = manager.legacy ? 0 : Number(collateral?.[3] ?? 0);
  const stabilityFeeBps = Number(collateral?.[manager.legacy ? 3 : 4] ?? 0);
  const active = Boolean(manager.legacy ? collateral?.[6] : collateral?.[7]);
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
        address: manager.address,
        abi,
        functionName: "positions",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      {
        address: manager.address,
        abi,
        functionName: "currentDebt",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      {
        address: manager.address,
        abi,
        functionName: "collateralRatioBps",
        args: [account ?? ZERO_ADDRESS, collateralId],
      },
      { address: wrappedToken, abi: erc20Abi, functionName: "balanceOf", args: [connected ?? ZERO_ADDRESS] },
      {
        address: wrappedToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [connected ?? ZERO_ADDRESS, manager.address],
      },
      {
        address: STABLE_TOKEN_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [connected ?? ZERO_ADDRESS],
      },
      {
        address: STABLE_TOKEN_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [connected ?? ZERO_ADDRESS, manager.address],
      },
    ],
    query: { enabled: canReadPosition, refetchInterval: 15_000 },
  });

  const position = details?.[4]?.result as readonly [bigint, bigint, bigint] | undefined;

  const data: CdpPosition = {
    wrappedToken,
    wrappedSymbol: (details?.[0]?.result as string | undefined) ?? "?",
    wrappedDecimals: Number(details?.[1]?.result ?? 18),
    stableSymbol: (details?.[2]?.result as string | undefined) ?? "ioEUR",
    stableDecimals: Number(details?.[3]?.result ?? 18),
    minCollateralRatioBps,
    liquidationThresholdBps,
    liquidationBonusBps,
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
