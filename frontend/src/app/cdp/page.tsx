import { Header } from "@/components/header";
import { CdpConsole } from "@/components/cdp/cdp-console";

export default function CdpPage() {
  return (
    <div className="hud-grid flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-12">
        <section className="mb-8">
          <p className="hud-tag w-fit">CDP · Alpha</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Borrow against your reserves</h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            Lock wrapped AETHYX collateral and mint ioEUR against it, up to each market&apos;s minimum ratio. Positions
            below the liquidation threshold — whether from a price move or accrued stability fee — can be closed out by
            anyone at any time.
          </p>
        </section>

        <CdpConsole />
      </main>

      <footer className="border-t border-hairline py-6 text-center text-xs text-muted-foreground">
        AETHYX CDP — debt is over-collateralized and liquidatable; it is not a savings product.
      </footer>
    </div>
  );
}
