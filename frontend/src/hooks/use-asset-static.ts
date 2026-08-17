"use client";

import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { vaultManagerAbi } from "@/lib/abis/vaultManagerAbi";
import { assetAdapterAbi } from "@/lib/abis/assetAdapterAbi";
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
}

/**
 * Everything about an asset that doesn't depend on a connected wallet: registry config,
 * decimals/symbols, and the two numbers a proof-of-reserve view needs (locked collateral vs
 * wrapped supply). Shared by the deposit/redeem dialog and the reserve page — wagmi/react-query
 * dedupes identical calls, so using this in both places costs no extra RPC round trips.
 */
export function useAssetStaticData(asset: AssetDefinition) {
  const { data: config, isLoading: loadingConfig, refetch: refetchConfig } = useReadContract({
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

  const { data: details, isLoading: loadingDetails, refetch: refetchDetails } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: adapter, abi: assetAdapterAbi, functionName: "underlying" },
      { address: adapter, abi: assetAdapterAbi, functionName: "underlyingDecimals" },
    ],
    query: { enabled: registered },
  });

  const underlying = (details?.[0]?.result as Address | undefined) ?? ZERO_ADDRESS;
  const underlyingDecimals = (details?.[1]?.result as number | undefined) ?? 18;
  const canReadTokenData = registered && underlying !== ZERO_ADDRESS;

  const { data: tokenData, isLoading: loadingTokenData, refetch: refetchTokenData } = useReadContracts({
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
