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

// Falls back to wagmi/viem's bundled public Sepolia endpoint when unset, same as before — but
// that endpoint rate-limits aggressively under the getLogs-heavy price/transaction history
// queries this app makes every 30s. Set NEXT_PUBLIC_SEPOLIA_RPC_URL to a real provider (Alchemy,
// Infura, etc.) to avoid throttling in anything beyond light local testing.
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined;

export const wagmiConfig = createConfig({
  connectors,
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http(),
    [sepolia.id]: http(sepoliaRpcUrl),
  },
  ssr: true,
});
