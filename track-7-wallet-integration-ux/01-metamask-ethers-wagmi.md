# MetaMask Integration with ethers.js and wagmi: A Complete Guide

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You've built a smart contract. Now you need a frontend where users can connect MetaMask, read their balances, and send transactions. You've seen tutorials using `window.ethereum` directly, others using ethers.js, and now everyone's talking about wagmi and viem. Which approach should you use, and how do they fit together?

This blog covers the full stack: raw `window.ethereum` (so you understand what's happening), ethers.js (the classic approach), and wagmi v2 (the modern React approach). By the end, you'll know when to use each and how to build a production-grade wallet integration.

---

## Core Concepts

### The Provider Hierarchy

```
window.ethereum (injected by MetaMask)
    ↓
ethers.BrowserProvider (wraps window.ethereum)
    ↓
ethers.Signer (represents the connected account)
    ↓
Contract calls, transaction signing
```

wagmi sits on top of this stack, adding React hooks, caching, and multi-wallet support:

```
wagmi (React hooks layer)
    ↓
viem (low-level EVM client, replaces ethers.js in wagmi v2)
    ↓
window.ethereum / WalletConnect / Coinbase Wallet
```

### Raw window.ethereum

Understanding the raw interface helps when things go wrong:

```typescript
// The raw EIP-1193 provider interface
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

// window.ethereum is injected by MetaMask (and other wallets)
declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
```

### ethers.js v6 Approach

ethers.js wraps `window.ethereum` with a clean API:

```typescript
import { ethers } from "ethers";

async function connectWithEthers() {
  if (!window.ethereum) throw new Error("MetaMask not installed");

  // BrowserProvider wraps window.ethereum
  const provider = new ethers.BrowserProvider(window.ethereum);

  // Request account access (triggers MetaMask popup)
  await provider.send("eth_requestAccounts", []);

  // Get the signer (represents the connected account)
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const balance = await provider.getBalance(address);

  console.log("Connected:", address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  return { provider, signer, address };
}
```

---

## Code Walkthrough

**Complete ethers.js integration:**

```typescript
// src/wallet/ethers-integration.ts
import { ethers } from "ethers";

export class WalletManager {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;

  async connect(): Promise<string> {
    if (!window.ethereum) {
      throw new Error("No wallet detected. Please install MetaMask.");
    }

    this.provider = new ethers.BrowserProvider(window.ethereum);

    // Request accounts — triggers MetaMask popup
    const accounts = await this.provider.send("eth_requestAccounts", []);
    if (accounts.length === 0) throw new Error("No accounts returned");

    this.signer = await this.provider.getSigner();
    const address = await this.signer.getAddress();

    // Listen for account changes
    window.ethereum.on("accountsChanged", (accounts: string[]) => {
      if (accounts.length === 0) {
        this.disconnect();
      } else {
        this.handleAccountChange(accounts[0]);
      }
    });

    // Listen for chain changes
    window.ethereum.on("chainChanged", (chainId: string) => {
      // Reload on chain change — simplest approach
      window.location.reload();
    });

    return address;
  }

  async disconnect() {
    this.provider = null;
    this.signer = null;
    // Note: MetaMask doesn't have a "disconnect" method
    // You can only clear your local state
  }

  async getBalance(address: string): Promise<string> {
    if (!this.provider) throw new Error("Not connected");
    const balance = await this.provider.getBalance(address);
    return ethers.formatEther(balance);
  }

  async switchNetwork(chainId: number): Promise<void> {
    if (!window.ethereum) throw new Error("No wallet");

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ethers.toBeHex(chainId) }],
      });
    } catch (error: any) {
      // Error 4902: chain not added to MetaMask
      if (error.code === 4902) {
        await this.addNetwork(chainId);
      } else {
        throw error;
      }
    }
  }

  async addNetwork(chainId: number): Promise<void> {
    const networks: Record<number, object> = {
      137: {
        chainId: "0x89",
        chainName: "Polygon Mainnet",
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
        rpcUrls: ["https://polygon-rpc.com"],
        blockExplorerUrls: ["https://polygonscan.com"],
      },
      42161: {
        chainId: "0xa4b1",
        chainName: "Arbitrum One",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://arb1.arbitrum.io/rpc"],
        blockExplorerUrls: ["https://arbiscan.io"],
      },
    };

    const networkConfig = networks[chainId];
    if (!networkConfig) throw new Error(`Unknown chain: ${chainId}`);

    await window.ethereum!.request({
      method: "wallet_addEthereumChain",
      params: [networkConfig],
    });
  }

  async callContract<T>(
    contractAddress: string,
    abi: ethers.InterfaceAbi,
    functionName: string,
    args: unknown[] = []
  ): Promise<T> {
    if (!this.signer) throw new Error("Not connected");
    const contract = new ethers.Contract(contractAddress, abi, this.signer);
    return contract[functionName](...args) as Promise<T>;
  }

  private handleAccountChange(newAddress: string) {
    console.log("Account changed to:", newAddress);
    // Emit event or update state
  }
}
```

**wagmi v2 integration (React):**

```typescript
// src/wagmi-config.ts
import { createConfig, http } from "wagmi";
import { mainnet, arbitrum, polygon, optimism } from "wagmi/chains";
import { injected, metaMask, walletConnect } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, arbitrum, polygon, optimism],
  connectors: [
    injected(),           // MetaMask and other injected wallets
    metaMask(),           // MetaMask specifically
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
    }),
  ],
  transports: {
    [mainnet.id]: http("https://mainnet.infura.io/v3/YOUR_KEY"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    [polygon.id]: http("https://polygon-rpc.com"),
    [optimism.id]: http("https://mainnet.optimism.io"),
  },
});
```

```tsx
// src/app/layout.tsx — Provider setup
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./wagmi-config";

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

```tsx
// src/components/WalletConnect.tsx — Complete wallet UI
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useChainId,
  useSwitchChain,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { mainnet, arbitrum } from "wagmi/chains";
import { parseEther, formatEther } from "viem";
import { useState } from "react";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
] as const;

export function WalletConnect() {
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  // Read ETH balance
  const { data: balance } = useBalance({ address });

  // Read contract (no wallet needed)
  const { data: tokenBalance } = useReadContract({
    address: "0xTokenAddress",
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address },
  });

  // Write contract
  const { writeContract, data: txHash, isPending: isTxPending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  function handleTransfer() {
    writeContract({
      address: "0xTokenAddress",
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [transferTo as `0x${string}`, parseEther(transferAmount)],
    });
  }

  if (!isConnected) {
    return (
      <div>
        <h2>Connect Wallet</h2>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            disabled={isConnecting}
          >
            {connector.name}
            {isConnecting && " (connecting...)"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <p>Connected: {address?.slice(0, 6)}...{address?.slice(-4)}</p>
      <p>Network: {chainId === mainnet.id ? "Ethereum" : chainId === arbitrum.id ? "Arbitrum" : "Unknown"}</p>
      <p>ETH Balance: {balance ? formatEther(balance.value) : "Loading..."}</p>
      <p>Token Balance: {tokenBalance ? formatEther(tokenBalance) : "Loading..."}</p>

      {chainId !== arbitrum.id && (
        <button onClick={() => switchChain({ chainId: arbitrum.id })}>
          Switch to Arbitrum
        </button>
      )}

      <div>
        <input
          placeholder="Recipient address"
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        />
        <input
          placeholder="Amount"
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
        />
        <button onClick={handleTransfer} disabled={isTxPending || isConfirming}>
          {isTxPending ? "Confirm in wallet..." : isConfirming ? "Confirming..." : "Transfer"}
        </button>
        {isConfirmed && <p>Transaction confirmed!</p>}
      </div>

      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Not handling `window.ethereum` being undefined**  
MetaMask isn't installed on every browser. Always check `if (!window.ethereum)` before using it. Show a "Install MetaMask" message or link to the download page.

**2. Not listening to `accountsChanged` and `chainChanged`**  
Users can switch accounts or networks in MetaMask without your dApp knowing. Always listen to these events and update your UI accordingly. Not doing this leads to stale state and confusing UX.

**3. Using `eth_accounts` instead of `eth_requestAccounts`**  
`eth_accounts` returns connected accounts without prompting. `eth_requestAccounts` prompts the user to connect. Use `eth_accounts` to check if already connected on page load, and `eth_requestAccounts` when the user clicks "Connect."

**4. Not handling transaction rejection**  
When a user clicks "Reject" in MetaMask, the promise rejects with error code 4001. Always catch this and show a user-friendly message instead of crashing.

**5. Hardcoding chain IDs**  
Chain IDs should come from a config, not be hardcoded throughout your code. Use wagmi's chain objects or a central config file. This makes it easy to add new chains or switch between mainnet and testnet.

---

## How This Connects to Production

Uniswap's frontend uses wagmi for all wallet interactions. Aave's interface uses wagmi + WalletConnect. OpenSea uses ethers.js directly for some operations and wagmi for others. The wagmi + viem stack has become the standard for new React dApps because it handles caching, error states, and multi-wallet support out of the box. ethers.js is still widely used in scripts, backend services, and older frontends. Understanding both gives you the flexibility to work in any codebase.

---

## What to Learn Next

- **WalletConnect v2: Multi-Chain Wallet Support for dApps** — extend your integration to mobile wallets.
- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full range of wallet scenarios.
- **EIP-2771 Meta-Transactions: Gasless UX for Your dApp** — remove gas friction for users.
