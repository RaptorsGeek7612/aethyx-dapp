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
  { appName: "Invest'Or Gateway", projectId },
);

// Falls back to wagmi/viem's bundled public Sepolia endpoint (thirdweb's) when unset, which
// tolerates a 1000-block eth_getLogs range — comfortably enough for lib/log-range.ts's chunked
// queries. Set NEXT_PUBLIC_SEPOLIA_RPC_URL only to a provider that's *at least* as generous:
// several "free tier" API keys (Alchemy's included) cap eth_getLogs at a 10-block range, which
// is unusable for this app's price/transaction history and would silently break both — verify
// the actual getLogs range limit before pointing this at anything.
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined;

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
      chains: [hardhat, sepolia],
      transports: {
        [hardhat.id]: http(),
        [sepolia.id]: http(sepoliaRpcUrl),
      },
      ssr: true,
    })
  : createConfig({
      connectors,
      chains: [sepolia],
      transports: {
        [sepolia.id]: http(sepoliaRpcUrl),
      },
      ssr: true,
    });
