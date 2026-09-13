"use client";

import { useAccount, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { GATEWAY_ADDRESS, VAULT_MANAGER_ADDRESS } from "@/config/contracts";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData, ZERO_ADDRESS, type AssetStaticData } from "@/hooks/use-asset-static";

export interface AssetOnChainData extends AssetStaticData {
  underlyingBalance: bigint;
  wrappedBalance: bigint;
  underlyingAllowanceForAdapter: bigint;
  wrappedAllowanceForVault: bigint;
}

/** Adds the connected wallet's balances and allowances on top of useAssetStaticData. The
 *  real-estate lock-up is not here: it meters the market's collateral, not any one holder, so
 *  it lives in useAssetStaticData alongside the other account-independent facts. */
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
    ],
    // Balances here move from actions this hook has no way to know about — CDP collateral
    // deposits/withdrawals move the same wrapped token but go through useCdpActions, not
    // useWrapActions, so its refetch() never reaches this component. Polling is what keeps the
    // portfolio row in sync with those instead of only updating on this asset's own dialog.
    query: { enabled: canReadUserData, refetchInterval: 30_000 },
  });

  const data: AssetOnChainData = {
    ...staticData,
    underlyingBalance: (userData?.[0]?.result as bigint | undefined) ?? 0n,
    wrappedBalance: (userData?.[1]?.result as bigint | undefined) ?? 0n,
    underlyingAllowanceForAdapter: (userData?.[2]?.result as bigint | undefined) ?? 0n,
    wrappedAllowanceForVault: (userData?.[3]?.result as bigint | undefined) ?? 0n,
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
