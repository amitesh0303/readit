# WalletConnect v2: Multi-Chain Wallet Support for dApps

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

MetaMask is great for desktop users. But a significant portion of your users are on mobile — they use Trust Wallet, Rainbow, Coinbase Wallet, or MetaMask Mobile. These wallets can't inject `window.ethereum` into a desktop browser. WalletConnect bridges this gap: it lets mobile wallets connect to desktop dApps via QR code or deep link.

WalletConnect v2 (the current version) also adds multi-chain support — one connection can span multiple chains simultaneously. This blog covers the full integration.

---

## Core Concepts

### How WalletConnect Works

```
Desktop dApp                    Mobile Wallet
    │                               │
    │  1. Generate QR code          │
    │  (contains connection URI)    │
    │                               │
    │  2. User scans QR code ──────►│
    │                               │
    │  3. Wallet connects via ──────►│
    │     WalletConnect relay       │
    │                               │
    │◄──── 4. Connection established │
    │                               │
    │  5. dApp requests tx ────────►│
    │                               │
    │◄──── 6. User approves in wallet│
    │                               │
    │  7. Signed tx returned ───────►│
```

WalletConnect uses a relay server to pass messages between the dApp and wallet. The relay server can't read the messages (end-to-end encrypted).

### v1 vs v2

WalletConnect v1 is deprecated. v2 differences:
- **Multi-chain**: one session can include multiple chains
- **Better reliability**: improved relay infrastructure
- **Project ID required**: you must register at cloud.walletconnect.com
- **Different SDK**: `@walletconnect/web3wallet` (wallet side), `@walletconnect/modal` (dApp side)

### Integration Options

**Option 1: wagmi + WalletConnect connector** (recommended for React)
```typescript
import { walletConnect } from "wagmi/connectors";
// Handles everything automatically
```

**Option 2: Web3Modal** (WalletConnect's official UI component)
```typescript
import { createWeb3Modal } from "@web3modal/wagmi/react";
// Pre-built modal with wallet selection UI
```

**Option 3: Raw WalletConnect SDK** (for custom implementations)
```typescript
import { EthereumProvider } from "@walletconnect/ethereum-provider";
// Full control, more code
```

---

## Code Walkthrough

**Complete Web3Modal + wagmi setup:**

```typescript
// src/config/web3modal.ts
import { createWeb3Modal } from "@web3modal/wagmi/react";
import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { mainnet, arbitrum, polygon, optimism, base } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

const metadata = {
  name: "My DApp",
  description: "A Web3 application",
  url: "https://mydapp.com",
  icons: ["https://mydapp.com/icon.png"],
};

const chains = [mainnet, arbitrum, polygon, optimism, base] as const;

export const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId,
  metadata,
  // Enable additional features
  enableWalletConnect: true,
  enableInjected: true,
  enableEIP6963: true,  // EIP-6963: multi-wallet detection
  enableCoinbase: true,
});

// Initialize Web3Modal
createWeb3Modal({
  wagmiConfig,
  projectId,
  chains,
  // Customize the modal
  themeMode: "dark",
  themeVariables: {
    "--w3m-color-mix": "#00BB7F",
    "--w3m-color-mix-strength": 40,
  },
  // Featured wallets (shown prominently)
  featuredWalletIds: [
    "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
    "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  ],
});
```

```tsx
// src/app/layout.tsx
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/config/web3modal";

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
```

```tsx
// src/components/ConnectButton.tsx
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { useAccount, useDisconnect, useBalance } from "wagmi";
import { formatEther } from "viem";

export function ConnectButton() {
  const { open } = useWeb3Modal();
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  if (!isConnected) {
    return (
      <button
        onClick={() => open()}
        className="connect-button"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="wallet-info">
      <span className="chain-badge">{chain?.name}</span>
      <span className="balance">
        {balance ? `${parseFloat(formatEther(balance.value)).toFixed(4)} ${balance.symbol}` : "..."}
      </span>
      <button onClick={() => open({ view: "Account" })}>
        {address?.slice(0, 6)}...{address?.slice(-4)}
      </button>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}
```

**Raw WalletConnect for non-React environments:**

```typescript
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { ethers } from "ethers";

async function connectWithWalletConnect() {
  const provider = await EthereumProvider.init({
    projectId: process.env.WALLETCONNECT_PROJECT_ID!,
    chains: [1],           // Ethereum mainnet
    optionalChains: [137, 42161], // Polygon, Arbitrum (optional)
    showQrModal: true,     // Show QR code modal automatically
    metadata: {
      name: "My DApp",
      description: "A Web3 application",
      url: "https://mydapp.com",
      icons: ["https://mydapp.com/icon.png"],
    },
  });

  // Connect — shows QR code modal
  await provider.connect();

  // Wrap with ethers.js
  const ethersProvider = new ethers.BrowserProvider(provider);
  const signer = await ethersProvider.getSigner();
  const address = await signer.getAddress();

  console.log("Connected via WalletConnect:", address);

  // Listen for events
  provider.on("accountsChanged", (accounts: string[]) => {
    console.log("Accounts changed:", accounts);
  });

  provider.on("chainChanged", (chainId: number) => {
    console.log("Chain changed:", chainId);
  });

  provider.on("disconnect", () => {
    console.log("Disconnected");
  });

  return { provider, ethersProvider, signer, address };
}

// Switch chain via WalletConnect
async function switchChain(provider: EthereumProvider, chainId: number) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (error: any) {
    if (error.code === 4902) {
      // Chain not added — add it
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: `0x${chainId.toString(16)}`,
          chainName: "Arbitrum One",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://arb1.arbitrum.io/rpc"],
          blockExplorerUrls: ["https://arbiscan.io"],
        }],
      });
    }
  }
}
```

---

## Common Mistakes and Gotchas

**1. Not registering a project ID**  
WalletConnect v2 requires a project ID from cloud.walletconnect.com. Without it, connections will fail. The free tier is sufficient for most projects.

**2. Not handling session restoration**  
WalletConnect sessions persist across page reloads. On page load, check if there's an existing session and restore it instead of requiring the user to reconnect. wagmi handles this automatically; raw WalletConnect requires manual session management.

**3. Not handling the QR code modal on mobile**  
On mobile, the QR code modal doesn't make sense (you can't scan your own screen). Use deep links instead. Web3Modal handles this automatically — it shows a QR code on desktop and deep links on mobile.

**4. Assuming all wallets support all methods**  
Not all WalletConnect wallets support `wallet_switchEthereumChain` or `wallet_addEthereumChain`. Always handle errors gracefully and provide fallback instructions ("Please switch to Arbitrum in your wallet manually").

**5. Not cleaning up event listeners**  
WalletConnect event listeners persist. If you add listeners in a React component without cleaning them up, you'll have memory leaks and duplicate event handlers. Always remove listeners in cleanup functions.

---

## How This Connects to Production

Uniswap's interface uses Web3Modal for wallet connection, supporting 300+ wallets via WalletConnect. Aave's interface uses WalletConnect for mobile wallet support. OpenSea supports WalletConnect for mobile users. The WalletConnect ecosystem has grown to support virtually every major wallet — if you integrate WalletConnect, you support them all. The Web3Modal component is the fastest way to get a production-quality wallet connection UI without building it from scratch.

---

## What to Learn Next

- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full range of wallet scenarios.
- **Phantom Wallet Integration on Solana** — extend your multi-chain support to Solana.
- **EIP-2771 Meta-Transactions: Gasless UX for Your dApp** — improve UX by removing gas friction.
