"use client";

import { useAccount, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { realEstateAdapterAbi } from "@/lib/abis/realEstateAdapterAbi";
import { GATEWAY_ADDRESS, VAULT_MANAGER_ADDRESS } from "@/config/contracts";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData, ZERO_ADDRESS, type AssetStaticData } from "@/hooks/use-asset-static";

export interface AssetOnChainData extends AssetStaticData {
  underlyingBalance: bigint;
  wrappedBalance: bigint;
  underlyingAllowanceForAdapter: bigint;
  wrappedAllowanceForVault: bigint;
  lockedUntil: bigint | null;
}

/** Adds the connected wallet's balances/allowances/lock state on top of useAssetStaticData. */
export function useAssetData(asset: AssetDefinition) {
  const { address: account } = useAccount();
  const { data: staticData, isLoading: loadingStatic, refetch: refetchStatic } = useAssetStaticData(asset);

  const canReadUserData = staticData.registered && staticData.underlying !== ZERO_ADDRESS && Boolean(account);

  const {
    data: userData,
    isLoading: loadingUserData,
    refetch: refetchUserData,
  } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: staticData.underlying,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account ?? ZERO_ADDRESS],
      },
      {
        address: staticData.wrappedToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account ?? ZERO_ADDRESS],
      },
      {
        address: staticData.underlying,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account ?? ZERO_ADDRESS, staticData.adapter],
      },
      {
        address: staticData.wrappedToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account ?? ZERO_ADDRESS, VAULT_MANAGER_ADDRESS as Address],
      },
      {
        // Reverts harmlessly for non-real-estate adapters (they don't have this function) —
        // allowFailure means that just shows up as a failed entry, not a broken batch.
        address: staticData.adapter,
        abi: realEstateAdapterAbi,
        functionName: "lockedUntil",
        args: [account ?? ZERO_ADDRESS],
      },
    ],
    query: { enabled: canReadUserData },
  });

  const data: AssetOnChainData = {
    ...staticData,
    underlyingBalance: (userData?.[0]?.result as bigint | undefined) ?? 0n,
    wrappedBalance: (userData?.[1]?.result as bigint | undefined) ?? 0n,
    underlyingAllowanceForAdapter: (userData?.[2]?.result as bigint | undefined) ?? 0n,
    wrappedAllowanceForVault: (userData?.[3]?.result as bigint | undefined) ?? 0n,
    lockedUntil: asset.kind === "real-estate" ? ((userData?.[4]?.result as bigint | undefined) ?? null) : null,
  };

  return {
    data,
    isLoading: loadingStatic || (canReadUserData && loadingUserData),
    refetch: () => {
      void refetchStatic();
      void refetchUserData();
    },
    gatewayAddress: GATEWAY_ADDRESS as Address,
  };
}
