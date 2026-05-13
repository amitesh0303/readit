# Frontend Integration: Core Wallet, MetaMask, and Reading C-Chain Data

**Track:** Avalanche Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

You've deployed a smart contract to Avalanche C-Chain, but users can't interact with it without a frontend. Avalanche has its own native wallet (Core) alongside MetaMask support, and you need to handle both. The challenge is connecting wallets, detecting the correct network (Fuji vs Mainnet), switching chains programmatically, and reading/writing contract data — all while providing a smooth UX that accounts for Avalanche's fast finality.

---

## Core Concepts

### Wallet Detection and Connection

Avalanche users primarily use two wallets:
- **Core Wallet** — Avalanche-native, supports C/X/P chains, injects `window.avalanche`
- **MetaMask** — EVM standard, C-Chain only, injects `window.ethereum`

```typescript
// src/wallet.ts
// ethers@6.9.0

import { BrowserProvider, JsonRpcSigner, Contract } from "ethers";

// Avalanche C-Chain network configurations
const AVALANCHE_MAINNET = {
  chainId: "0xA86A", // 43114
  chainName: "Avalanche C-Chain",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
  blockExplorerUrls: ["https://snowtrace.io/"],
};

const AVALANCHE_FUJI = {
  chainId: "0xA869", // 43113
  chainName: "Avalanche Fuji Testnet",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
  blockExplorerUrls: ["https://testnet.snowtrace.io/"],
};

interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string | null;
  chainId: number | null;
  walletType: "core" | "metamask" | null;
}

const state: WalletState = {
  provider: null,
  signer: null,
  address: null,
  chainId: null,
  walletType: null,
};

/**
 * Detect available wallet providers.
 * Core wallet injects window.avalanche; MetaMask injects window.ethereum.
 */
function detectWallet(): "core" | "metamask" | null {
  if (typeof window === "undefined") return null;

  // Core wallet takes priority if both are installed
  if ((window as any).avalanche) return "core";
  if ((window as any).ethereum) return "metamask";
  return null;
}

/**
 * Connect to the user's wallet and request account access.
 */
async function connectWallet(): Promise<WalletState> {
  const walletType = detectWallet();

  if (!walletType) {
    throw new Error(
      "No wallet detected. Install Core (https://core.app/) or MetaMask."
    );
  }

  const injectedProvider =
    walletType === "core"
      ? (window as any).avalanche
      : (window as any).ethereum;

  // Request account access
  const accounts: string[] = await injectedProvider.request({
    method: "eth_requestAccounts",
  });

  if (accounts.length === 0) {
    throw new Error("No accounts found. Please unlock your wallet.");
  }

  // Create ethers provider from the injected provider
  const provider = new BrowserProvider(injectedProvider);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();

  state.provider = provider;
  state.signer = signer;
  state.address = accounts[0];
  state.chainId = Number(network.chainId);
  state.walletType = walletType;

  console.log(`Connected via ${walletType}:`, state.address);
  console.log("Chain ID:", state.chainId);

  return state;
}

/**
 * Switch to Avalanche Fuji testnet.
 * Adds the network if it's not already configured in the wallet.
 */
async function switchToFuji(): Promise<void> {
  const injectedProvider =
    state.walletType === "core"
      ? (window as any).avalanche
      : (window as any).ethereum;

  try {
    // Try switching to Fuji
    await injectedProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AVALANCHE_FUJI.chainId }],
    });
  } catch (switchError: any) {
    // Error code 4902 = chain not added yet
    if (switchError.code === 4902) {
      await injectedProvider.request({
        method: "wallet_addEthereumChain",
        params: [AVALANCHE_FUJI],
      });
    } else {
      throw switchError;
    }
  }

  // Update state after switch
  const provider = new BrowserProvider(injectedProvider);
  const network = await provider.getNetwork();
  state.provider = provider;
  state.signer = await provider.getSigner();
  state.chainId = Number(network.chainId);
}

export { connectWallet, switchToFuji, detectWallet, state, AVALANCHE_FUJI, AVALANCHE_MAINNET };
```

### Reading Contract Data

```typescript
// src/contract.ts
// ethers@6.9.0

import { Contract, formatEther, JsonRpcProvider } from "ethers";
import { state } from "./wallet";

// ABI for the AvalancheVault contract (from lesson 03)
const VAULT_ABI = [
  "function owner() view returns (address)",
  "function balances(address) view returns (uint256)",
  "function totalDeposits() view returns (uint256)",
  "function paused() view returns (bool)",
  "function getContractBalance() view returns (uint256)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "event Deposited(address indexed user, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 remaining)",
];

// Replace with your deployed contract address
const VAULT_ADDRESS = "0xYourDeployedVaultAddress";

/**
 * Create a read-only contract instance (no signer needed).
 * Uses a public RPC endpoint — works without wallet connection.
 */
function getReadOnlyVault(): Contract {
  const provider = new JsonRpcProvider(
    "https://api.avax-test.network/ext/bc/C/rpc"
  );
  return new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
}

/**
 * Create a read-write contract instance (requires connected signer).
 */
function getSignedVault(): Contract {
  if (!state.signer) {
    throw new Error("Wallet not connected. Call connectWallet() first.");
  }
  return new Contract(VAULT_ADDRESS, VAULT_ABI, state.signer);
}

/**
 * Fetch vault statistics — works without wallet connection.
 */
async function getVaultStats(): Promise<{
  totalDeposits: string;
  contractBalance: string;
  isPaused: boolean;
  owner: string;
}> {
  const vault = getReadOnlyVault();

  const [totalDeposits, contractBalance, isPaused, owner] = await Promise.all([
    vault.totalDeposits(),
    vault.getContractBalance(),
    vault.paused(),
    vault.owner(),
  ]);

  return {
    totalDeposits: formatEther(totalDeposits),
    contractBalance: formatEther(contractBalance),
    isPaused,
    owner,
  };
}

/**
 * Get the connected user's vault balance.
 */
async function getUserBalance(): Promise<string> {
  if (!state.address) throw new Error("Wallet not connected");

  const vault = getReadOnlyVault();
  const balance = await vault.balances(state.address);
  return formatEther(balance);
}

export { getVaultStats, getUserBalance, getReadOnlyVault, getSignedVault, VAULT_ABI, VAULT_ADDRESS };
```

### Writing Transactions

```typescript
// src/transactions.ts
// ethers@6.9.0

import { parseEther, ContractTransactionResponse, ContractTransactionReceipt } from "ethers";
import { getSignedVault } from "./contract";

interface TransactionResult {
  hash: string;
  gasUsed: bigint;
  blockNumber: number;
  status: "success" | "reverted";
}

/**
 * Deposit AVAX into the vault.
 * @param amountInAvax Amount to deposit as a string (e.g., "0.1")
 */
async function depositToVault(amountInAvax: string): Promise<TransactionResult> {
  const vault = getSignedVault();
  const amount = parseEther(amountInAvax);

  // Send the transaction
  const tx: ContractTransactionResponse = await vault.deposit({
    value: amount,
  });

  console.log("Transaction sent:", tx.hash);
  console.log("Waiting for confirmation (~2 seconds on Avalanche)...");

  // Wait for 1 confirmation — sufficient on Avalanche due to deterministic finality
  const receipt: ContractTransactionReceipt | null = await tx.wait(1);

  if (!receipt) throw new Error("Transaction receipt not found");

  return {
    hash: receipt.hash,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "success" : "reverted",
  };
}

/**
 * Withdraw AVAX from the vault.
 * @param amountInAvax Amount to withdraw as a string (e.g., "0.05")
 */
async function withdrawFromVault(amountInAvax: string): Promise<TransactionResult> {
  const vault = getSignedVault();
  const amount = parseEther(amountInAvax);

  const tx: ContractTransactionResponse = await vault.withdraw(amount);
  console.log("Withdrawal tx sent:", tx.hash);

  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("Transaction receipt not found");

  return {
    hash: receipt.hash,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "success" : "reverted",
  };
}

export { depositToVault, withdrawFromVault, TransactionResult };
```

### Listening to Events in Real-Time

Avalanche's fast block times (~2 seconds) make event listening very responsive:

```typescript
// src/events.ts
// ethers@6.9.0

import { formatEther } from "ethers";
import { getReadOnlyVault } from "./contract";

interface DepositEvent {
  user: string;
  amount: string;
  newBalance: string;
  blockNumber: number;
  transactionHash: string;
}

/**
 * Listen for new deposits in real-time.
 * On Avalanche, events arrive every ~2 seconds (each new block).
 */
function listenForDeposits(
  callback: (event: DepositEvent) => void
): () => void {
  const vault = getReadOnlyVault();

  const filter = vault.filters.Deposited();

  const handler = (user: string, amount: bigint, newBalance: bigint, event: any) => {
    callback({
      user,
      amount: formatEther(amount),
      newBalance: formatEther(newBalance),
      blockNumber: event.log.blockNumber,
      transactionHash: event.log.transactionHash,
    });
  };

  vault.on(filter, handler);

  // Return cleanup function
  return () => {
    vault.off(filter, handler);
  };
}

/**
 * Fetch historical deposit events.
 * @param fromBlock Starting block number (or "earliest")
 * @param toBlock Ending block number (or "latest")
 */
async function getDepositHistory(
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<DepositEvent[]> {
  const vault = getReadOnlyVault();
  const filter = vault.filters.Deposited();

  const events = await vault.queryFilter(filter, fromBlock, toBlock);

  return events.map((event: any) => ({
    user: event.args[0],
    amount: formatEther(event.args[1]),
    newBalance: formatEther(event.args[2]),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
  }));
}

export { listenForDeposits, getDepositHistory, DepositEvent };
```

### Complete UI Integration Example

```html
<!-- index.html — minimal dApp frontend -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Avalanche Vault dApp</title>
  <script type="module" src="./src/app.ts"></script>
</head>
<body>
  <h1>Avalanche Vault</h1>
  <div id="wallet-section">
    <button id="connect-btn">Connect Wallet</button>
    <p id="wallet-info"></p>
  </div>
  <div id="vault-section" style="display:none">
    <h2>Vault Stats</h2>
    <p>Total Deposits: <span id="total-deposits">—</span> AVAX</p>
    <p>Your Balance: <span id="user-balance">—</span> AVAX</p>
    <h2>Actions</h2>
    <input id="amount-input" type="text" placeholder="Amount in AVAX" />
    <button id="deposit-btn">Deposit</button>
    <button id="withdraw-btn">Withdraw</button>
    <p id="tx-status"></p>
  </div>
</body>
</html>
```

```typescript
// src/app.ts — main application logic
// ethers@6.9.0

import { connectWallet, switchToFuji, state } from "./wallet";
import { getVaultStats, getUserBalance } from "./contract";
import { depositToVault, withdrawFromVault } from "./transactions";
import { listenForDeposits } from "./events";

const EXPECTED_CHAIN_ID = 43113; // Fuji

async function init() {
  const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
  const walletInfo = document.getElementById("wallet-info") as HTMLParagraphElement;
  const vaultSection = document.getElementById("vault-section") as HTMLDivElement;
  const totalDepositsEl = document.getElementById("total-deposits") as HTMLSpanElement;
  const userBalanceEl = document.getElementById("user-balance") as HTMLSpanElement;
  const depositBtn = document.getElementById("deposit-btn") as HTMLButtonElement;
  const withdrawBtn = document.getElementById("withdraw-btn") as HTMLButtonElement;
  const amountInput = document.getElementById("amount-input") as HTMLInputElement;
  const txStatus = document.getElementById("tx-status") as HTMLParagraphElement;

  connectBtn.addEventListener("click", async () => {
    try {
      await connectWallet();

      // Ensure we're on Fuji
      if (state.chainId !== EXPECTED_CHAIN_ID) {
        txStatus.textContent = "Switching to Fuji testnet...";
        await switchToFuji();
      }

      walletInfo.textContent = `Connected: ${state.address} (${state.walletType})`;
      vaultSection.style.display = "block";

      // Load vault data
      await refreshData();

      // Listen for new deposits (updates every ~2 seconds)
      listenForDeposits((event) => {
        console.log("New deposit:", event);
        refreshData();
      });
    } catch (error: any) {
      walletInfo.textContent = `Error: ${error.message}`;
    }
  });

  depositBtn.addEventListener("click", async () => {
    const amount = amountInput.value;
    if (!amount || isNaN(Number(amount))) {
      txStatus.textContent = "Enter a valid amount";
      return;
    }

    try {
      txStatus.textContent = "Sending deposit transaction...";
      const result = await depositToVault(amount);
      txStatus.textContent = `✅ Deposited! Tx: ${result.hash.slice(0, 10)}... (${result.gasUsed} gas)`;
      await refreshData();
    } catch (error: any) {
      txStatus.textContent = `❌ Error: ${error.reason || error.message}`;
    }
  });

  withdrawBtn.addEventListener("click", async () => {
    const amount = amountInput.value;
    if (!amount || isNaN(Number(amount))) {
      txStatus.textContent = "Enter a valid amount";
      return;
    }

    try {
      txStatus.textContent = "Sending withdrawal transaction...";
      const result = await withdrawFromVault(amount);
      txStatus.textContent = `✅ Withdrawn! Tx: ${result.hash.slice(0, 10)}... (${result.gasUsed} gas)`;
      await refreshData();
    } catch (error: any) {
      txStatus.textContent = `❌ Error: ${error.reason || error.message}`;
    }
  });

  async function refreshData() {
    try {
      const stats = await getVaultStats();
      totalDepositsEl.textContent = stats.totalDeposits;

      const userBalance = await getUserBalance();
      userBalanceEl.textContent = userBalance;
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", init);
```

### Error Handling for Wallet Interactions

```typescript
// src/errors.ts
// Common wallet/transaction errors and how to handle them

interface WalletError {
  code: number;
  message: string;
}

/**
 * Parse and handle common wallet errors.
 * Avalanche-specific: fast finality means fewer timeout errors,
 * but network switching errors are common.
 */
function handleWalletError(error: any): string {
  const code = error?.code || error?.error?.code;

  switch (code) {
    case 4001:
      return "Transaction rejected by user";
    case 4902:
      return "Network not configured in wallet. Adding Avalanche Fuji...";
    case -32603:
      // Internal JSON-RPC error — often means insufficient funds
      if (error.message?.includes("insufficient funds")) {
        return "Insufficient AVAX for gas. Get testnet AVAX: https://faucet.avax.network/";
      }
      return "RPC error. Check your network connection.";
    case -32002:
      return "Request already pending. Check your wallet for a pending approval.";
    default:
      // Check for revert reasons from the contract
      if (error.reason) {
        return `Contract error: ${error.reason}`;
      }
      return `Unknown error: ${error.message || "Transaction failed"}`;
  }
}

export { handleWalletError };
```

---

## Common Pitfalls

1. **Not handling the Core wallet vs MetaMask provider difference** — Core wallet injects `window.avalanche` while MetaMask uses `window.ethereum`. If you only check for `window.ethereum`, Core wallet users won't be able to connect. Always check for both providers and prefer Core when both are present (since Core also exposes `window.ethereum` as a fallback).

2. **Waiting for too many confirmations** — On Ethereum, `await tx.wait(12)` is common for safety. On Avalanche, `await tx.wait(1)` provides the same finality guarantee. Waiting for more blocks just adds unnecessary latency (2 seconds per extra confirmation) without any security benefit.

3. **Not handling chain switching gracefully** — Users may be connected to Ethereum mainnet or another network when they visit your dApp. Always check `chainId` after connection and call `wallet_switchEthereumChain` if needed. Show a clear message like "Please switch to Avalanche Fuji" rather than silently failing.

4. **Ignoring the `accountsChanged` and `chainChanged` events** — Wallets emit these events when users switch accounts or networks. If you don't listen for them, your UI will show stale data. Always register listeners:
   ```typescript
   window.ethereum.on("accountsChanged", (accounts) => { /* refresh */ });
   window.ethereum.on("chainChanged", (chainId) => { /* refresh */ });
   ```

5. **Using `eth_getBalance` without formatting** — The raw balance is in wei (18 decimals). Displaying `2000000000000000000` instead of `2.0 AVAX` is a common UI bug. Always use `ethers.formatEther()` for display and `ethers.parseEther()` for input conversion.

6. **Not providing the faucet link in error messages** — When users get "insufficient funds" errors on testnet, they need to know where to get AVAX. Always include the faucet URL (https://faucet.avax.network/) in your error handling for testnet deployments.

---

## What to Learn Next

- [Avalanche Subnet development](https://docs.avax.network/subnets) — Create your own blockchain with custom rules and gas tokens
- [Teleporter cross-chain messaging](https://github.com/ava-labs/teleporter) — Send messages and tokens between Subnets
- [Trader Joe SDK](https://docs.traderjoexyz.com/) — Integrate DEX swaps into your Avalanche dApp
- [Core Developer documentation](https://docs.core.app/) — Advanced Core wallet integration patterns
