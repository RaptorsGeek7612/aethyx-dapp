"use client";

import { TriangleAlert } from "lucide-react";
import { isContractsConfigured } from "@/config/contracts";

export function ConfigBanner() {
  if (isContractsConfigured) return null;

  return (
    <div className="mb-8 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Contract addresses aren&apos;t configured yet. Deploy the protocol (
        <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs">hardhat ignition deploy</code>) and set{" "}
        <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs">NEXT_PUBLIC_GATEWAY_ADDRESS</code> /{" "}
        <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs">
          NEXT_PUBLIC_VAULT_MANAGER_ADDRESS
        </code>{" "}
        in <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-xs">frontend/.env.local</code>.
      </p>
    </div>
  );
}
