"use client";

import { useCallback, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { BaseError } from "viem";
import type { Address, Hex } from "viem";
import { toast } from "sonner";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { investOrGatewayAbi } from "@/lib/abis/investOrGatewayAbi";
import { GATEWAY_ADDRESS, VAULT_MANAGER_ADDRESS } from "@/config/contracts";

export type WrapStep = "idle" | "approving" | "submitting" | "confirming";

function humanizeError(error: unknown): string {
  if (error instanceof BaseError) {
    return error.shortMessage ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "Transaction failed";
}

export function useWrapActions() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<WrapStep>("idle");

  const ensureAllowance = useCallback(
    async (token: Address, spender: Address, amount: bigint, currentAllowance: bigint) => {
      if (currentAllowance >= amount) return;
      setStep("approving");
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      });
      await waitForTransactionReceipt(config, { hash });
    },
    [config, writeContractAsync],
  );

  const deposit = useCallback(
    async (params: {
      assetId: Hex;
      amount: bigint;
      underlying: Address;
      adapter: Address;
      currentAllowance: bigint;
      onSuccess?: () => void;
    }) => {
      try {
        await ensureAllowance(params.underlying, params.adapter, params.amount, params.currentAllowance);
        setStep("submitting");
        const hash = await writeContractAsync({
          address: GATEWAY_ADDRESS as Address,
          abi: investOrGatewayAbi,
          functionName: "deposit",
          args: [params.assetId, params.amount],
        });
        setStep("confirming");
        await waitForTransactionReceipt(config, { hash });
        toast.success("Deposit confirmed");
        params.onSuccess?.();
      } catch (error) {
        toast.error(humanizeError(error));
        throw error;
      } finally {
        setStep("idle");
      }
    },
    [config, ensureAllowance, writeContractAsync],
  );

  const redeem = useCallback(
    async (params: {
      assetId: Hex;
      amount: bigint;
      wrappedToken: Address;
      currentAllowance: bigint;
      onSuccess?: () => void;
    }) => {
      try {
        await ensureAllowance(
          params.wrappedToken,
          VAULT_MANAGER_ADDRESS as Address,
          params.amount,
          params.currentAllowance,
        );
        setStep("submitting");
        const hash = await writeContractAsync({
          address: GATEWAY_ADDRESS as Address,
          abi: investOrGatewayAbi,
          functionName: "redeem",
          args: [params.assetId, params.amount],
        });
        setStep("confirming");
        await waitForTransactionReceipt(config, { hash });
        toast.success("Redemption confirmed");
        params.onSuccess?.();
      } catch (error) {
        toast.error(humanizeError(error));
        throw error;
      } finally {
        setStep("idle");
      }
    },
    [config, ensureAllowance, writeContractAsync],
  );

  return { deposit, redeem, step };
}
