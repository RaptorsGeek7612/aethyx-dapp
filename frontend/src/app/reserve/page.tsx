import { Info } from "lucide-react";
import { Header } from "@/components/header";
import { ConfigBanner } from "@/components/config-banner";
import { ReserveGrid } from "@/components/reserve-grid";

export default function ReservePage() {
  return (
    <div className="bg-mesh flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-12">
        <section className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Transparency</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Proof of Reserve</h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            Every wrapped token is backed 1:1 by collateral locked in its AssetAdapter. Coverage below is read directly
            from the two on-chain numbers that make that true — it can&apos;t drift, lag, or be misreported.
          </p>

          <div className="mt-5 flex max-w-2xl items-start gap-2.5 rounded-xl border border-white/5 bg-black/20 p-3.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              <strong className="text-foreground">Coverage</strong> is cryptographically verifiable on-chain: it
              compares the wrapped token&apos;s total supply against the underlying balance actually held by its
              adapter. <strong className="text-foreground">Audit</strong> is a separate, off-chain claim — that the
              physical or legal asset behind the token is what its custodian says it is. The blockchain can prove the
              first; only a trusted third party can attest to the second.
            </p>
          </div>
        </section>

        <ConfigBanner />

        <ReserveGrid />
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-muted-foreground">
        Invest&apos;Or Gateway — every wrapped token is backed 1:1 by collateral locked on-chain.
      </footer>
    </div>
  );
}
