# Frontend Integration: Wallets and dApp UI on Sei

**Track:** Sei Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

Your contracts are deployed on Sei, but users interact through browser wallets and web interfaces. Sei's dual execution model means you might need to support both EVM wallets (MetaMask) and Cosmos wallets (Compass, Keplr) — or use a unified approach. You need to connect wallets, read balances across both environments, send transactions, and handle Sei's fast block times in your UI. This lesson builds a complete frontend that works with Sei's unique architecture.

---

## Core Concepts

### Wallet Landscape on Sei

| Wallet | Type | Best For |
|--------|------|----------|
| MetaMask | EVM | Users coming from Ethereum ecosystem |
| Compass | Sei-native | Supports both EVM and Cosmos on Sei |
| Keplr | Cosmos | Users in the Cosmos ecosystem |
| Fin | Sei-native | Sei-specific DeFi wallet |
| Rabby | EVM | Multi-chain EVM users |

### EVM Frontend: ethers.js + MetaMask

```typescript
// src/sei-evm-frontend.ts
// Using ethers.js@6.13.0 for EVM interactions on Sei

import { ethers } from "ethers";

const SEI_TESTNET = {
  chainId: "0x530", // 1328
  chainName: "Sei Testnet",
  nativeCurrency: { name: "SEI", symbol: "SEI", decimals: 18 },
  rpcUrls: ["https://evm-rpc-testnet.sei-apis.com"],
  blockExplorerUrls: ["https://testnet.seitrace.com"]
};

const SEI_MAINNET = {
  chainId: "0x531", // 1329
  chainName: "Sei",
  nativeCurrency: { name: "SEI", symbol: "SEI", decimals: 18 },
  rpcUrls: ["https://evm-rpc.sei-apis.com"],
  blockExplorerUrls: ["https://seitrace.com"]
};

export class SeiEVMClient {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.Signer | null = null;
  private address: string = "";

  async connect(): Promise<string> {
    if (typeof window.ethereum === "undefined") {
      throw new Error("No EVM wallet detected. Install MetaMask or Compass.");
    }

    // Request account access
    this.provider = new ethers.BrowserProvider(window.ethereum);

    try {
      // Switch to Sei network
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEI_TESTNET.chainId }]
      });
    } catch (switchError: any) {
      // Chain not added yet — add it
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [SEI_TESTNET]
        });
      } else {
        throw switchError;
      }
    }

    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();

    return this.address;
  }

  async getBalance(): Promise<string> {
    if (!this.provider || !this.address) {
      throw new Error("Not connected");
    }
    const balance = await this.provider.getBalance(this.address);
    return ethers.formatEther(balance);
  }

  async getTokenBalance(tokenAddress: string): Promise<string> {
    if (!this.provider || !this.address) {
      throw new Error("Not connected");
    }

    const erc20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)"
    ];

    const token = new ethers.Contract(tokenAddress, erc20Abi, this.provider);

    try {
      const [balance, decimals, symbol] = await Promise.all([
        token.balanceOf(this.address),
        token.decimals(),
        token.symbol()
      ]);

      return `${ethers.formatUnits(balance, decimals)} ${symbol}`;
    } catch (error) {
      throw new Error(`Failed to read token: ${(error as Error).message}`);
    }
  }

  async transferToken(
    tokenAddress: string,
    to: string,
    amount: string
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Not connected");

    const erc20Abi = [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function decimals() view returns (uint8)"
    ];

    const token = new ethers.Contract(tokenAddress, erc20Abi, this.signer);

    try {
      const decimals = await token.decimals();
      const parsedAmount = ethers.parseUnits(amount, decimals);

      const tx = await token.transfer(to, parsedAmount);
      console.log("Transaction sent:", tx.hash);

      // Sei has ~400ms blocks, so confirmation is fast
      const receipt = await tx.wait(1);

      if (!receipt || receipt.status === 0) {
        throw new Error("Transaction reverted");
      }

      console.log("Confirmed in block:", receipt.blockNumber);
      return receipt;
    } catch (error: any) {
      if (error.code === "ACTION_REJECTED") {
        throw new Error("User rejected transaction");
      }
      throw error;
    }
  }

  onAccountChange(callback: (address: string) => void): void {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts: string[]) => {
        if (accounts.length > 0) {
          this.address = accounts[0];
          callback(accounts[0]);
        }
      });
    }
  }

  onChainChange(callback: (chainId: string) => void): void {
    if (window.ethereum) {
      window.ethereum.on("chainChanged", (chainId: string) => {
        callback(chainId);
      });
    }
  }
}
```

### Cosmos Frontend: @sei-js/core + Compass/Keplr

```typescript
// src/sei-cosmos-frontend.ts
// Using @sei-js/core@0.5.0 for Cosmos interactions on Sei

import {
  getSigningCosmWasmClient,
  getQueryClient,
} from "@sei-js/core";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";

const SEI_TESTNET_RPC = "https://rpc-testnet.sei-apis.com";
const SEI_TESTNET_CHAIN_ID = "atlantic-2";

interface WalletConnection {
  address: string;
  client: SigningCosmWasmClient;
}

export class SeiCosmosClient {
  private client: SigningCosmWasmClient | null = null;
  private address: string = "";

  async connectCompass(): Promise<WalletConnection> {
    // Compass wallet (Sei-native)
    if (typeof window.compass === "undefined") {
      throw new Error("Compass wallet not installed. Get it at https://compasswallet.io");
    }

    // Enable the chain
    await window.compass.enable(SEI_TESTNET_CHAIN_ID);

    // Get the offline signer
    const offlineSigner = await window.compass.getOfflineSigner(SEI_TESTNET_CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    this.address = accounts[0].address;

    // Create signing client
    this.client = await SigningCosmWasmClient.connectWithSigner(
      SEI_TESTNET_RPC,
      offlineSigner,
      { gasPrice: GasPrice.fromString("0.1usei") }
    );

    return { address: this.address, client: this.client };
  }

  async connectKeplr(): Promise<WalletConnection> {
    if (typeof window.keplr === "undefined") {
      throw new Error("Keplr wallet not installed. Get it at https://keplr.app");
    }

    // Suggest Sei chain to Keplr (if not already added)
    await window.keplr.experimentalSuggestChain({
      chainId: SEI_TESTNET_CHAIN_ID,
      chainName: "Sei Testnet",
      rpc: SEI_TESTNET_RPC,
      rest: "https://rest-testnet.sei-apis.com",
      bip44: { coinType: 118 },
      bech32Config: {
        bech32PrefixAccAddr: "sei",
        bech32PrefixAccPub: "seipub",
        bech32PrefixValAddr: "seivaloper",
        bech32PrefixValPub: "seivaloperpub",
        bech32PrefixConsAddr: "seivalcons",
        bech32PrefixConsPub: "seivalconspub"
      },
      currencies: [{ coinDenom: "SEI", coinMinimalDenom: "usei", coinDecimals: 6 }],
      feeCurrencies: [{
        coinDenom: "SEI",
        coinMinimalDenom: "usei",
        coinDecimals: 6,
        gasPriceStep: { low: 0.08, average: 0.1, high: 0.12 }
      }],
      stakeCurrency: { coinDenom: "SEI", coinMinimalDenom: "usei", coinDecimals: 6 }
    });

    await window.keplr.enable(SEI_TESTNET_CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(SEI_TESTNET_CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    this.address = accounts[0].address;

    this.client = await SigningCosmWasmClient.connectWithSigner(
      SEI_TESTNET_RPC,
      offlineSigner,
      { gasPrice: GasPrice.fromString("0.1usei") }
    );

    return { address: this.address, client: this.client };
  }

  async getSeiBalance(): Promise<string> {
    if (!this.client || !this.address) throw new Error("Not connected");

    const balance = await this.client.getBalance(this.address, "usei");
    const seiAmount = Number(balance.amount) / 1e6;
    return `${seiAmount.toFixed(6)} SEI`;
  }

  async queryCW20Balance(contractAddress: string): Promise<string> {
    if (!this.client || !this.address) throw new Error("Not connected");

    try {
      const result = await this.client.queryContractSmart(contractAddress, {
        balance: { address: this.address }
      });
      return result.balance;
    } catch (error) {
      throw new Error(`CW-20 query failed: ${(error as Error).message}`);
    }
  }

  async transferCW20(
    contractAddress: string,
    recipient: string,
    amount: string
  ): Promise<string> {
    if (!this.client || !this.address) throw new Error("Not connected");

    try {
      const result = await this.client.execute(
        this.address,
        contractAddress,
        {
          transfer: {
            recipient: recipient,
            amount: amount
          }
        },
        "auto", // auto gas estimation
        "CW-20 transfer", // memo
        [] // no funds attached
      );

      console.log("Transaction hash:", result.transactionHash);
      console.log("Gas used:", result.gasUsed);
      return result.transactionHash;
    } catch (error: any) {
      if (error.message?.includes("Request rejected")) {
        throw new Error("User rejected transaction");
      }
      throw error;
    }
  }

  async executeCosmWasmContract(
    contractAddress: string,
    msg: Record<string, unknown>,
    funds?: { denom: string; amount: string }[]
  ): Promise<string> {
    if (!this.client || !this.address) throw new Error("Not connected");

    try {
      const result = await this.client.execute(
        this.address,
        contractAddress,
        msg,
        "auto",
        "",
        funds || []
      );
      return result.transactionHash;
    } catch (error) {
      throw new Error(`Execute failed: ${(error as Error).message}`);
    }
  }
}
```

### Unified Frontend: Supporting Both Wallets

```typescript
// src/sei-unified-app.ts
// Unified dApp that supports both EVM and Cosmos wallets

import { SeiEVMClient } from "./sei-evm-frontend";
import { SeiCosmosClient } from "./sei-cosmos-frontend";

type WalletType = "metamask" | "compass" | "keplr";

interface AppState {
  connected: boolean;
  walletType: WalletType | null;
  address: string;
  seiBalance: string;
}

export class SeiDApp {
  private evmClient: SeiEVMClient;
  private cosmosClient: SeiCosmosClient;
  private state: AppState = {
    connected: false,
    walletType: null,
    address: "",
    seiBalance: "0"
  };

  constructor() {
    this.evmClient = new SeiEVMClient();
    this.cosmosClient = new SeiCosmosClient();
  }

  async connect(walletType: WalletType): Promise<AppState> {
    try {
      switch (walletType) {
        case "metamask":
          this.state.address = await this.evmClient.connect();
          this.state.seiBalance = await this.evmClient.getBalance();
          break;
        case "compass":
          const compassConn = await this.cosmosClient.connectCompass();
          this.state.address = compassConn.address;
          this.state.seiBalance = await this.cosmosClient.getSeiBalance();
          break;
        case "keplr":
          const keplrConn = await this.cosmosClient.connectKeplr();
          this.state.address = keplrConn.address;
          this.state.seiBalance = await this.cosmosClient.getSeiBalance();
          break;
      }

      this.state.connected = true;
      this.state.walletType = walletType;
      return { ...this.state };
    } catch (error) {
      this.state.connected = false;
      throw error;
    }
  }

  isEVM(): boolean {
    return this.state.walletType === "metamask";
  }

  isCosmos(): boolean {
    return this.state.walletType === "compass" || this.state.walletType === "keplr";
  }

  getState(): AppState {
    return { ...this.state };
  }
}
```

### React Component Example

```typescript
// src/components/ConnectWallet.tsx
// Using React 18 + ethers.js@6.13.0

import React, { useState, useCallback } from "react";
import { SeiDApp } from "../sei-unified-app";

const app = new SeiDApp();

type WalletType = "metamask" | "compass" | "keplr";

interface WalletState {
  connected: boolean;
  address: string;
  balance: string;
  error: string;
}

export function ConnectWallet(): React.ReactElement {
  const [state, setState] = useState<WalletState>({
    connected: false,
    address: "",
    balance: "",
    error: ""
  });
  const [loading, setLoading] = useState(false);

  const handleConnect = useCallback(async (walletType: WalletType) => {
    setLoading(true);
    setState(prev => ({ ...prev, error: "" }));

    try {
      const result = await app.connect(walletType);
      setState({
        connected: true,
        address: result.address,
        balance: result.seiBalance,
        error: ""
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        connected: false,
        error: (error as Error).message
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  if (state.connected) {
    return (
      <div className="wallet-info">
        <p>Connected: {state.address.slice(0, 10)}...{state.address.slice(-6)}</p>
        <p>Balance: {state.balance} SEI</p>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      <h3>Connect to Sei</h3>
      <div className="wallet-buttons">
        <button
          onClick={() => handleConnect("metamask")}
          disabled={loading}
          aria-label="Connect MetaMask wallet"
        >
          {loading ? "Connecting..." : "MetaMask (EVM)"}
        </button>
        <button
          onClick={() => handleConnect("compass")}
          disabled={loading}
          aria-label="Connect Compass wallet"
        >
          {loading ? "Connecting..." : "Compass (Sei)"}
        </button>
        <button
          onClick={() => handleConnect("keplr")}
          disabled={loading}
          aria-label="Connect Keplr wallet"
        >
          {loading ? "Connecting..." : "Keplr (Cosmos)"}
        </button>
      </div>
      {state.error && (
        <p className="error" role="alert">{state.error}</p>
      )}
    </div>
  );
}
```

### Handling Sei's Fast Block Times

Sei produces blocks every ~400ms, which affects how you handle transaction confirmations in the UI:

```typescript
// src/utils/sei-tx-handler.ts
// Transaction handling optimized for Sei's 400ms blocks

import { ethers } from "ethers";

interface TxStatus {
  state: "pending" | "confirmed" | "failed";
  hash: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: string;
}

export async function waitForSeiTransaction(
  provider: ethers.Provider,
  txHash: string,
  onStatusChange: (status: TxStatus) => void
): Promise<TxStatus> {
  onStatusChange({ state: "pending", hash: txHash });

  // Sei confirms in ~400ms, so poll aggressively
  const maxAttempts = 15; // 15 × 400ms = 6 seconds max
  const pollInterval = 400; // Match block time

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt) {
        const status: TxStatus = {
          state: receipt.status === 1 ? "confirmed" : "failed",
          hash: txHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          error: receipt.status === 0 ? "Transaction reverted" : undefined
        };
        onStatusChange(status);
        return status;
      }
    } catch (error) {
      // Receipt not available yet, continue polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const timeoutStatus: TxStatus = {
    state: "failed",
    hash: txHash,
    error: "Confirmation timeout (6s). Check explorer."
  };
  onStatusChange(timeoutStatus);
  return timeoutStatus;
}

// Usage in a React component:
// const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
// await waitForSeiTransaction(provider, tx.hash, setTxStatus);
```

### Package Setup

```json
{
  "name": "sei-dapp-frontend",
  "version": "1.0.0",
  "dependencies": {
    "ethers": "6.13.0",
    "@sei-js/core": "0.5.0",
    "@cosmjs/cosmwasm-stargate": "0.32.4",
    "@cosmjs/stargate": "0.32.4",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "typescript": "5.5.0",
    "vite": "5.4.0",
    "@types/react": "18.3.0"
  }
}
```

```shell
# Install dependencies
npm install ethers@6.13.0 @sei-js/core@0.5.0 @cosmjs/cosmwasm-stargate@0.32.4 @cosmjs/stargate@0.32.4 react@18.3.1 react-dom@18.3.1

# Install dev dependencies
npm install -D typescript@5.5.0 vite@5.4.0 @types/react@18.3.0

# Start development server
npx vite
```

---

## Common Pitfalls

1. **Not handling both address formats in the UI** — Users connecting via MetaMask have `0x...` addresses, while Compass/Keplr users have `sei1...` addresses. Your UI must display the correct format based on the connected wallet. Use `@sei-js/core`'s address conversion utilities if you need to show both formats to the user.

2. **Polling too slowly for transaction confirmation** — Sei's ~400ms block time means transactions confirm almost instantly. If you poll every 5 seconds (like on Ethereum), your UI feels sluggish. Poll every 400ms on Sei for a responsive experience. Don't use Ethereum-style "waiting for 12 confirmations" — Sei has single-slot finality.

3. **Not detecting wallet type before calling methods** — If a user connects via MetaMask, you can't call CosmWasm contract methods through that connection (and vice versa). Always check `isEVM()` or `isCosmos()` before routing contract calls. Attempting to call a CW-20 method through an EVM provider will throw a confusing error.

4. **Hardcoding gas prices** — Sei's gas prices can change with network upgrades. Use `"auto"` gas estimation for Cosmos transactions and `eth_estimateGas` for EVM transactions. Hardcoded gas values that work today may cause failures after a chain upgrade.

5. **Forgetting to handle Compass wallet's dual mode** — Compass wallet supports both EVM and Cosmos on Sei. If you detect `window.compass`, don't assume it's Cosmos-only. Compass also injects an EVM provider at `window.ethereum`. Check which mode the user prefers or offer both options in your connect dialog.

---

## What to Learn Next

- [Sei Developer Documentation](https://www.docs.sei.io/) — Official guides for advanced topics
- [Sei Discord](https://discord.gg/sei) — Developer community and support
- [SeiTrace Explorer](https://seitrace.com) — Block explorer for mainnet and testnet
- [Sei GitHub](https://github.com/sei-protocol) — Protocol source code and example projects
