import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";

// WalletConnect requires a projectId even for injected-wallet-only usage in dev. Get a free one
// at https://cloud.walletconnect.com and put it in frontend/.env.local as
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID — MetaMask/injected wallets work without it, but
// WalletConnect-based mobile wallets won't until it's set to a real value.
// `||`, not `??`: an unset var in .env.local resolves to "" (defined, just empty), which `??`
// would happily pass straight through instead of falling back.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

// Built with connectorsForWallets (a curated wallet list) rather than getDefaultConfig: the
// latter's default "Popular" group includes the Base Account wallet, which drags in
// @coinbase/cdp-sdk and @base-org/account — a dependency chain that dynamically imports
// several @x402/* payment packages we don't have installed and don't need, breaking the
// production build. This list covers the common case (MetaMask, WalletConnect-based mobile
// wallets, Rainbow, any other injected wallet) without that baggage.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, walletConnectWallet, rainbowWallet, injectedWallet],
    },
  ],
  { appName: "AETHYX Gateway", projectId },
);

// Not wagmi/viem's own bundled default (thirdweb's public endpoint) — that one advertises a
// generous eth_getLogs range and permissive CORS to a single curl request, but drops the CORS
// header under this app's actual load, confirmed with a real headless-browser run against the
// deployed site. publicnode keeps its CORS header under that load and answers one batched POST of
// 75 contract reads in 163 ms, which is what this transport is for.
//
// What it is NOT good for is history: publicnode prunes to roughly the last 50,000 blocks, and a
// log query reaching further back returns an empty array rather than an error. That is why
// eth_getLogs does not go through this transport at all — see lib/logs-client.ts, and set
// NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL rather than this variable if history is what you are fixing.
// Override with NEXT_PUBLIC_SEPOLIA_RPC_URL only after checking a candidate against actual page
// load, not just a lone request — that's exactly what went wrong here once already.
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// Without this, every useReadContract/getLogs call is its own HTTP POST — a first paint with 7
// assets × several reads each, plus lib/log-range.ts's chunked getLogs calls, fires 70+ requests
// within the same tick and gets rate-limited (429) by a public endpoint, confirmed with a real
// headless-browser run. `batch: true` makes viem collect everything queued within `wait`
// milliseconds into a single JSON-RPC batch POST instead — same data, a fraction of the HTTP
// requests a rate limiter actually counts.
const sepoliaTransport = http(sepoliaRpcUrl, { batch: { wait: 40 } });

// The local Hardhat node only ever exists on a developer's own machine — including it
// unconditionally meant the deployed site tried to reach http://127.0.0.1:8545 for anything that
// touches every configured chain (RainbowKit's chain list, wagmi's cross-chain state sync), which
// no visitor's browser can ever connect to. Every build served to an actual visitor (Vercel sets
// NODE_ENV=production for `next build`; `next dev` doesn't) drops it entirely instead of failing
// to reach it.
const includeLocalChain = process.env.NODE_ENV !== "production";

export const wagmiConfig = includeLocalChain
  ? createConfig({
      connectors,
      // Sepolia first: wagmi reads from chains[0] when no wallet is connected, and this app's
      // Sepolia deployment is what every disconnected view (oracle status, coverage) reads from.
      // Hardhat last so a wallet explicitly switched to it still works, without becoming the
      // default and sending every disconnected read to an 127.0.0.1:8545 that usually isn't running.
      chains: [sepolia, hardhat],
      transports: {
        [hardhat.id]: http(),
        [sepolia.id]: sepoliaTransport,
      },
      ssr: true,
    })
  : createConfig({
      connectors,
      chains: [sepolia],
      transports: {
        [sepolia.id]: sepoliaTransport,
      },
      ssr: true,
    });
