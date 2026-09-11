"use client";

import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { vaultManagerAbi } from "@/lib/abis/vaultManagerAbi";
import { assetAdapterAbi } from "@/lib/abis/assetAdapterAbi";
import { realEstateAdapterAbi } from "@/lib/abis/realEstateAdapterAbi";
import { VAULT_MANAGER_ADDRESS, isContractsConfigured } from "@/config/contracts";
import type { AssetDefinition } from "@/config/assets";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface AssetStaticData {
  adapter: Address;
  wrappedToken: Address;
  depositFeeBps: number;
  redeemFeeBps: number;
  active: boolean;
  registered: boolean;
  underlying: Address;
  underlyingDecimals: number;
  wrappedDecimals: number;
  wrappedSymbol: string;
  underlyingSymbol: string;
  /** underlying.balanceOf(adapter) — the collateral actually locked on-chain right now. */
  lockedRaw: bigint;
  /** wrappedToken.totalSupply() */
  wrappedSupply: bigint;
  /**
   * Real estate only: the market's holding period in seconds, read off its immutable
   * `RealEstateAdapter.lockupPeriod`. null for every other asset, and for a real-estate market
   * whose adapter predates the field. The depositor never picks this — it belongs to whichever
   * market they deposit into — so the UI only ever displays it.
   */
  lockupPeriod: bigint | null;
  /**
   * Real estate only: the market's collateral that has cleared its lock-up and can be redeemed
   * right now, across every holder. The gate is market-wide, not per holder — see
   * RealEstateAdapter.sol — so this is what actually caps any redemption.
   */
  maturedNow: bigint | null;
  /** Real estate only: the market's collateral still inside its lock-up. */
  lockedNow: bigint | null;
  /** Real estate only: when the market's next tranche matures; 0n when nothing is locked. */
  nextUnlockAt: bigint | null;
  /**
   * Real estate only: one entry per deposit still on the market's books, each with its own
   * maturity. Deposits never merge into one schedule — a later one gets its own entry rather
   * than extending an earlier one.
   */
  lockSchedule: readonly { amount: bigint; unlockAt: bigint }[] | null;
}

/**
 * Everything about an asset that doesn't depend on a connected wallet: registry config,
 * decimals/symbols, and the two numbers a proof-of-reserve view needs (locked collateral vs
 * wrapped supply). Shared by the deposit/redeem dialog and the reserve page — wagmi/react-query
 * dedupes identical calls, so using this in both places costs no extra RPC round trips.
 */
export function useAssetStaticData(asset: AssetDefinition) {
  const {
    data: config,
    isLoading: loadingConfig,
    refetch: refetchConfig,
  } = useReadContract({
    address: VAULT_MANAGER_ADDRESS as Address,
    abi: vaultManagerAbi,
    functionName: "assets",
    args: [asset.id],
    query: { enabled: isContractsConfigured },
  });

  const adapter = config?.[0] ?? ZERO_ADDRESS;
  const wrappedToken = config?.[1] ?? ZERO_ADDRESS;
  const depositFeeBps = config?.[2] ?? 0;
  const redeemFeeBps = config?.[3] ?? 0;
  const active = config?.[4] ?? false;
  const registered = adapter !== ZERO_ADDRESS;

  const {
    data: details,
    isLoading: loadingDetails,
    refetch: refetchDetails,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: adapter, abi: assetAdapterAbi, functionName: "underlying" },
      { address: adapter, abi: assetAdapterAbi, functionName: "underlyingDecimals" },
      // The four below revert harmlessly on a non-real-estate adapter, which has no such
      // functions — allowFailure turns that into failed entries rather than a broken batch.
      { address: adapter, abi: realEstateAdapterAbi, functionName: "lockupPeriod" },
      { address: adapter, abi: realEstateAdapterAbi, functionName: "maturedAmountNow" },
      { address: adapter, abi: realEstateAdapterAbi, functionName: "lockedAmountNow" },
      { address: adapter, abi: realEstateAdapterAbi, functionName: "nextUnlockAt" },
      { address: adapter, abi: realEstateAdapterAbi, functionName: "lockSchedule" },
    ],
    query: { enabled: registered },
  });

  const underlying = (details?.[0]?.result as Address | undefined) ?? ZERO_ADDRESS;
  const underlyingDecimals = (details?.[1]?.result as number | undefined) ?? 18;
  const canReadTokenData = registered && underlying !== ZERO_ADDRESS;

  const {
    data: tokenData,
    isLoading: loadingTokenData,
    refetch: refetchTokenData,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: underlying, abi: erc20Abi, functionName: "symbol" },
      { address: wrappedToken, abi: erc20Abi, functionName: "symbol" },
      { address: wrappedToken, abi: erc20Abi, functionName: "decimals" },
      { address: wrappedToken, abi: erc20Abi, functionName: "totalSupply" },
      { address: underlying, abi: erc20Abi, functionName: "balanceOf", args: [adapter] },
    ],
    query: { enabled: canReadTokenData },
  });

  const isRealEstate = asset.kind === "real-estate";

  const data: AssetStaticData = {
    adapter,
    wrappedToken,
    depositFeeBps: Number(depositFeeBps),
    redeemFeeBps: Number(redeemFeeBps),
    active,
    registered,
    underlying,
    underlyingDecimals: Number(underlyingDecimals),
    wrappedDecimals: Number((tokenData?.[2]?.result as number | undefined) ?? 18),
    wrappedSymbol: (tokenData?.[1]?.result as string | undefined) ?? asset.label,
    underlyingSymbol: (tokenData?.[0]?.result as string | undefined) ?? "?",
    wrappedSupply: (tokenData?.[3]?.result as bigint | undefined) ?? 0n,
    lockedRaw: (tokenData?.[4]?.result as bigint | undefined) ?? 0n,
    lockupPeriod: isRealEstate ? ((details?.[2]?.result as bigint | undefined) ?? null) : null,
    maturedNow: isRealEstate ? ((details?.[3]?.result as bigint | undefined) ?? null) : null,
    lockedNow: isRealEstate ? ((details?.[4]?.result as bigint | undefined) ?? null) : null,
    nextUnlockAt: isRealEstate ? ((details?.[5]?.result as bigint | undefined) ?? null) : null,
    lockSchedule: isRealEstate
      ? ((details?.[6]?.result as readonly { amount: bigint; unlockAt: bigint }[] | undefined) ?? null)
      : null,
  };

  return {
    data,
    isLoading: loadingConfig || (registered && (loadingDetails || loadingTokenData)),
    refetch: () => {
      void refetchConfig();
      void refetchDetails();
      void refetchTokenData();
    },
  };
}
