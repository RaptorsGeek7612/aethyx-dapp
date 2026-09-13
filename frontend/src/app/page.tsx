"use client";

import { motion } from "framer-motion";
import { Header } from "@/components/header";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { ConfigBanner } from "@/components/config-banner";
import { PortfolioSummary } from "@/components/dashboard/portfolio-summary";
import { TransactionHistory } from "@/components/dashboard/transaction-history";

export default function Home() {
  return (
    <div className="bg-mesh flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
        <motion.section variants={staggerContainer(0.07)} initial="hidden" animate="visible" className="mb-8">
          <motion.p variants={fadeUp} className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
            AETHYX Gateway
          </motion.p>
          <motion.h1
            variants={fadeUp}
            className="mt-3 bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl"
          >
            Portfolio Overview
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-4 max-w-xl text-sm text-muted-foreground">
            Deposit a compliant ERC-3643 asset, receive its 1:1-backed ERC-20 equivalent, and track its live value,
            always redeemable back into the underlying asset.
          </motion.p>
        </motion.section>

        <ConfigBanner />

        <PortfolioSummary />

        <div className="mt-5">
          <TransactionHistory />
        </div>
      </main>

      <footer className="border-t border-hairline py-6 text-center text-xs text-muted-foreground">
        AETHYX Gateway. Every wrapped token is backed 1:1 by collateral locked on-chain.
      </footer>
    </div>
  );
}
