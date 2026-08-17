import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { Attestation } from "@/config/assets";

const GOOD = "#0ca30c";
const CRITICAL = "#d03b3b";

export function AuditBadge({ attestation }: { attestation?: Attestation }) {
  if (!attestation) {
    return (
      <div className="rounded-xl border border-white/5 bg-black/20 p-4">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Audit</span>
        <p className="mt-1 text-sm text-muted-foreground">No attestation on file</p>
      </div>
    );
  }

  const Icon = attestation.verified ? ShieldCheck : ShieldAlert;
  const color = attestation.verified ? GOOD : CRITICAL;

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Audit</span>
      <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tracking-tight" style={{ color }}>
        <Icon className="h-5 w-5" aria-hidden />
        {attestation.verified ? "Verified" : "Flagged"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Attested off-chain by {attestation.auditor}, as of {attestation.asOf}
        {attestation.reportUrl && (
          <>
            {" — "}
            <a href={attestation.reportUrl} target="_blank" rel="noreferrer" className="underline hover:text-primary">
              report
            </a>
          </>
        )}
      </p>
    </div>
  );
}
