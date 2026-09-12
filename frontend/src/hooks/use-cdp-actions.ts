"use client";

import { useCallback, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { BaseError } from "viem";
import type { Address, Hex } from "viem";
import { toast } from "sonner";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { cdpManagerAbi } from "@/lib/abis/cdpManagerAbi";
import { CDP_MANAGER_ADDRESS, STABLE_TOKEN_ADDRESS } from "@/config/contracts";

export type CdpStep = "idle" | "approving" | "submitting" | "confirming";

function humanizeError(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage ?? error.message;
  if (error instanceof Error) return error.message;
  return "Transaction failed";
}

/** Deposit/mint/repay/withdraw/liquidate against CDPManager — same approve-then-call shape as
 *  useWrapActions, against a different pair of spenders (the wrapped token for collateral, the
 *  stablecoin for debt). */
export function useCdpActions() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<CdpStep>("idle");

  const ensureAllowance = useCallback(
    async (token: Address, amount: bigint, currentAllowance: bigint) => {
      if (currentAllowance >= amount) return;
      setStep("approving");
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [CDP_MANAGER_ADDRESS as Address, amount],
      });
      await waitForTransactionReceipt(config, { hash });
    },
    [config, writeContractAsync],
  );

  const run = useCallback(
    async (label: string, action: () => Promise<Hex>, onSuccess?: () => void) => {
      try {
        setStep("submitting");
        const hash = await action();
        setStep("confirming");
        await waitForTransactionReceipt(config, { hash });
        toast.success(`${label} confirmed`);
        onSuccess?.();
      } catch (error) {
        toast.error(humanizeError(error));
        throw error;
      } finally {
        setStep("idle");
      }
    },
    [config],
  );

  const depositCollateral = useCallback(
    async (params: {
      collateralId: Hex;
      amount: bigint;
      wrappedToken: Address;
      currentAllowance: bigint;
      onSuccess?: () => void;
    }) => {
      await ensureAllowance(params.wrappedToken, params.amount, params.currentAllowance);
      await run(
        "Deposit",
        () =>
          writeContractAsync({
            address: CDP_MANAGER_ADDRESS as Address,
            abi: cdpManagerAbi,
            functionName: "depositCollateral",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [ensureAllowance, run, writeContractAsync],
  );

  const withdrawCollateral = useCallback(
    async (params: { collateralId: Hex; amount: bigint; onSuccess?: () => void }) => {
      await run(
        "Withdrawal",
        () =>
          writeContractAsync({
            address: CDP_MANAGER_ADDRESS as Address,
            abi: cdpManagerAbi,
            functionName: "withdrawCollateral",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [run, writeContractAsync],
  );

  const mintDebt = useCallback(
    async (params: { collateralId: Hex; amount: bigint; onSuccess?: () => void }) => {
      await run(
        "Mint",
        () =>
          writeContractAsync({
            address: CDP_MANAGER_ADDRESS as Address,
            abi: cdpManagerAbi,
            functionName: "mintDebt",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [run, writeContractAsync],
  );

  const repayDebt = useCallback(
    async (params: { collateralId: Hex; amount: bigint; currentAllowance: bigint; onSuccess?: () => void }) => {
      await ensureAllowance(STABLE_TOKEN_ADDRESS as Address, params.amount, params.currentAllowance);
      await run(
        "Repayment",
        () =>
          writeContractAsync({
            address: CDP_MANAGER_ADDRESS as Address,
            abi: cdpManagerAbi,
            functionName: "repayDebt",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [ensureAllowance, run, writeContractAsync],
  );

  const liquidate = useCallback(
    async (params: {
      collateralId: Hex;
      user: Address;
      currentAllowance: bigint;
      debtToRepay: bigint;
      onSuccess?: () => void;
    }) => {
      await ensureAllowance(STABLE_TOKEN_ADDRESS as Address, params.debtToRepay, params.currentAllowance);
      await run(
        "Liquidation",
        () =>
          writeContractAsync({
            address: CDP_MANAGER_ADDRESS as Address,
            abi: cdpManagerAbi,
            functionName: "liquidate",
            args: [params.user, params.collateralId],
          }),
        params.onSuccess,
      );
    },
    [ensureAllowance, run, writeContractAsync],
  );

  return { depositCollateral, withdrawCollateral, mintDebt, repayDebt, liquidate, step };
}
