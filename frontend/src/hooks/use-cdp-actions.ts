"use client";

import { useCallback, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError } from "viem";
import type { Address, Hex } from "viem";
import { toast } from "sonner";
import { erc20Abi } from "@/lib/abis/erc20Abi";
import { cdpManagerAbi, cdpManagerLegacyAbi } from "@/lib/abis/cdpManagerAbi";
import { CDP_MANAGER_ADDRESS, STABLE_TOKEN_ADDRESS, type CdpManagerRef } from "@/config/contracts";

export type CdpStep = "idle" | "approving" | "submitting" | "confirming";

const CURRENT_MANAGER: CdpManagerRef = { address: CDP_MANAGER_ADDRESS as Address, label: "Current", legacy: false };

function humanizeError(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage ?? error.message;
  if (error instanceof Error) return error.message;
  return "Transaction failed";
}

/** Deposit/mint/repay/withdraw/liquidate against CDPManager — same approve-then-call shape as
 *  useWrapActions, against a different pair of spenders (the wrapped token for collateral, the
 *  stablecoin for debt). Defaults to the current CDPManager; pass a legacy ref (see
 *  CDP_MANAGERS in config/contracts.ts) to act on a position still open on a superseded
 *  instance — liquidate() there takes two arguments, not three, see cdpManagerLegacyAbi. */
export function useCdpActions(manager: CdpManagerRef = CURRENT_MANAGER) {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<CdpStep>("idle");
  const abi = manager.legacy ? cdpManagerLegacyAbi : cdpManagerAbi;

  const ensureAllowance = useCallback(
    async (token: Address, amount: bigint, currentAllowance: bigint) => {
      if (currentAllowance >= amount) return;
      setStep("approving");
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [manager.address, amount],
      });
      await waitForTransactionReceipt(config, { hash });
    },
    [config, manager.address, writeContractAsync],
  );

  const run = useCallback(
    async (label: string, action: () => Promise<Hex>, onSuccess?: () => void) => {
      try {
        setStep("submitting");
        const hash = await action();
        setStep("confirming");
        await waitForTransactionReceipt(config, { hash });
        toast.success(`${label} confirmed`);
        // Same reasoning as useWrapActions: without this, a just-confirmed CDP action doesn't
        // show up in the ledger until the next 30s poll.
        queryClient.invalidateQueries({ queryKey: ["cdpActivity"] });
        onSuccess?.();
      } catch (error) {
        toast.error(humanizeError(error));
        throw error;
      } finally {
        setStep("idle");
      }
    },
    [config, queryClient],
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
            address: manager.address,
            abi,
            functionName: "depositCollateral",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [abi, ensureAllowance, manager.address, run, writeContractAsync],
  );

  const withdrawCollateral = useCallback(
    async (params: { collateralId: Hex; amount: bigint; onSuccess?: () => void }) => {
      await run(
        "Withdrawal",
        () =>
          writeContractAsync({
            address: manager.address,
            abi,
            functionName: "withdrawCollateral",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [abi, manager.address, run, writeContractAsync],
  );

  const mintDebt = useCallback(
    async (params: { collateralId: Hex; amount: bigint; onSuccess?: () => void }) => {
      await run(
        "Mint",
        () =>
          writeContractAsync({
            address: manager.address,
            abi,
            functionName: "mintDebt",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [abi, manager.address, run, writeContractAsync],
  );

  const repayDebt = useCallback(
    async (params: { collateralId: Hex; amount: bigint; currentAllowance: bigint; onSuccess?: () => void }) => {
      await ensureAllowance(STABLE_TOKEN_ADDRESS as Address, params.amount, params.currentAllowance);
      await run(
        "Repayment",
        () =>
          writeContractAsync({
            address: manager.address,
            abi,
            functionName: "repayDebt",
            args: [params.collateralId, params.amount],
          }),
        params.onSuccess,
      );
    },
    [abi, ensureAllowance, manager.address, run, writeContractAsync],
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
          manager.legacy
            ? writeContractAsync({
                address: manager.address,
                abi: cdpManagerLegacyAbi,
                functionName: "liquidate",
                args: [params.user, params.collateralId],
              })
            : writeContractAsync({
                address: manager.address,
                abi: cdpManagerAbi,
                functionName: "liquidate",
                args: [params.user, params.collateralId, params.debtToRepay],
              }),
        params.onSuccess,
      );
    },
    [ensureAllowance, manager.address, manager.legacy, run, writeContractAsync],
  );

  return { depositCollateral, withdrawCollateral, mintDebt, repayDebt, liquidate, step };
}
