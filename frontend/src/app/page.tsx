import { Header } from "@/components/header";
import { ConfigBanner } from "@/components/config-banner";
import { PortfolioSummary } from "@/components/dashboard/portfolio-summary";

export default function Home() {
  return (
    <div className="bg-mesh flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
        <section className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Invest&apos;Or Gateway</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Dashboard</h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">
            Deposit a compliant ERC-3643 asset, receive its 1:1-backed ERC-20 equivalent, and track its live value —
            always redeemable back into the underlying asset.
          </p>
        </section>

        <ConfigBanner />

        <PortfolioSummary />
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-muted-foreground">
        Invest&apos;Or Gateway — every wrapped token is backed 1:1 by collateral locked on-chain.
      </footer>
    </div>
  );
}
