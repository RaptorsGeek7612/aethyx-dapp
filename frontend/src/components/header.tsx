"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/lib/motion";

const NAV_LINKS = [
  { href: "/", label: "Portfolio" },
  { href: "/reserve", label: "Reserve" },
  { href: "/cdp", label: "Credit" },
];

export function Header() {
  const pathname = usePathname();
  // La barre ne se distingue du fond qu'une fois la page défilée : en haut, elle se fond dans le
  // dégradé, ce qui laisse toute sa place au titre.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300",
        scrolled
          ? "border-b border-hairline bg-background/80 shadow-[0_1px_24px_-12px_oklch(0_0_0/0.9)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <motion.div
              whileHover={{ rotate: -6, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-inset/60 shadow-[0_0_18px_-4px_oklch(0.795_0.16_82/0.75)] ring-1 ring-primary/25"
            >
              {/* No letterform: an asymmetric low-poly crystal, each facet a distinct shade of the
                  same gradient rather than one smooth fill — the cut-gem-as-data-shard read this
                  brand wants is in that faceting, not in spelling out a name. */}
              <svg viewBox="0 0 32 32" className="h-6 w-6 drop-shadow-[0_0_6px_oklch(0.795_0.16_82/0.6)]" aria-hidden>
                <polygon points="16,2 27,11 15,15" fill="#fde68a" />
                <polygon points="27,11 24,26 15,15" fill="#f59e0b" />
                <polygon points="24,26 12,30 15,15" fill="#b45309" />
                <polygon points="12,30 4,20 15,15" fill="#9a3412" />
                <polygon points="4,20 6,9 15,15" fill="#d97706" />
                <polygon points="6,9 16,2 15,15" fill="#fbbf24" />
                <polygon
                  points="16,2 27,11 24,26 12,30 4,20 6,9"
                  fill="none"
                  stroke="oklch(0.99 0.01 90)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">AETHYX</span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="live-dot relative inline-flex h-1.5 w-1.5 rounded-full bg-status-good text-status-good" />
                Gateway
              </span>
            </div>
          </div>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname === link.href ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Une seule pastille partagée, déplacée par `layoutId` : elle glisse d'un onglet à
                    l'autre au lieu de disparaître ici pour réapparaître là. */}
                {pathname === link.href && (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                    className="absolute inset-0 -z-10 rounded-md bg-primary/10 ring-1 ring-inset ring-primary/20"
                  />
                )}
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>
    </header>
  );
}
