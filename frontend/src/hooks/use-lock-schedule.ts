"use client";

import { useAccount, useReadContract } from "wagmi";
import type { Address } from "viem";
import { realEstateAdapterAbi } from "@/lib/abis/realEstateAdapterAbi";
import type { AssetDefinition } from "@/config/assets";
import { useAssetStaticData, ZERO_ADDRESS } from "@/hooks/use-asset-static";

export interface Tranche {
  amount: bigint;
  unlockAt: bigint;
}

/**
 * Les tranches encore bloquées du porteur connecté sur `asset`, chacune avec sa propre échéance —
 * la source de vérité pour dater un dépôt individuellement.
 *
 * `lockSchedule` ne renvoie que ce qui n'a pas encore été balayé vers le montant échu, donc la
 * liste raccourcit d'elle-même à mesure que les échéances tombent. Elle est ordonnée de la plus
 * ancienne à la plus récente, comme les dépôts qui l'ont remplie, ce qui permet à l'appelant
 * d'aligner ses lignes sur les dépôts les plus récents sans identifiant commun.
 *
 * Vide, et non en erreur, pour les actifs sans échéance : l'or et l'argent n'exposent pas cette
 * fonction, et `useReadContract` n'est simplement pas activé pour eux.
 */
export function useLockSchedule(asset: AssetDefinition) {
  const { address: account } = useAccount();
  const { data: staticData } = useAssetStaticData(asset);

  const enabled =
    asset.kind === "real-estate" && staticData.registered && staticData.adapter !== ZERO_ADDRESS && Boolean(account);

  const { data, refetch } = useReadContract({
    address: staticData.adapter,
    abi: realEstateAdapterAbi,
    functionName: "lockSchedule",
    args: [(account ?? ZERO_ADDRESS) as Address],
    query: { enabled, refetchInterval: 30_000 },
  });

  return { tranches: (data as readonly Tranche[] | undefined) ?? [], refetch };
}
