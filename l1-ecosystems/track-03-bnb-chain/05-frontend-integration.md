# Frontend Integration: Connect MetaMask to BSC

**Track:** BNB Chain Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've deployed a BEP-20 token to BSC testnet, but users can't interact with it yet. You need to build a frontend that connects MetaMask to BSC, reads token balances, and sends transactions — all while handling network switching, transaction failures, and the UX quirks of Web3 wallets. Most tutorials show a happy path that breaks the moment a user is on the wrong network or rejects a transaction.

## Core Concepts

### Project Setup

We'll use ethers.js to interact with BSC from a browser. Create a minimal frontend:

```shell
mkdir bnb-frontend && cd bnb-frontend
npm init -y
npm install ethers@6.9.0 vite@5.0.0
```

```
Expected output:
added 12 packages, and audited 13 packages in 2s
```

### Connecting MetaMask to BSC

Create `src/main.js` — the core wallet connection logic:

```typescript
// src/main.js
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

// BSC Testnet configuration
const BSC_TESTNET = {
  chainId: "0x61", // 97 in hex
  chainName: "BSC Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

// Your deployed BEP-20 token address
const TOKEN_ADDRESS = "0xYOUR_DEPLOYED_TOKEN_ADDRESS";

// Minimal BEP-20 ABI (only the functions we need)
const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

let provider;
let signer;
let tokenContract;

/**
 * Connect to MetaMask and switch to BSC Testnet.
 * Handles the case where BSC isn't added to MetaMask yet.
 */
async function connectWallet() {
  if (!window.ethereum) {
    throw new Error(
      "MetaMask not detected. Install it from https://metamask.io"
    );
  }

  try {
    // Request account access
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    // Switch to BSC Testnet
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_TESTNET.chainId }],
      });
    } catch (switchError) {
      // Chain not added to MetaMask — add it
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BSC_TESTNET],
        });
      } else {
        throw switchError;
      }
    }

    provider = new BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    tokenContract = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

    return accounts[0];
  } catch (error) {
    if (error.code === 4001) {
      throw new Error("User rejected the connection request");
    }
    throw error;
  }
}
```

### Reading Token Data

```typescript
// src/main.js (continued)

/**
 * Fetch token metadata and user balance.
 * All read operations are free (no gas required).
 */
async function getTokenInfo(userAddress) {
  if (!tokenContract) throw new Error("Wallet not connected");

  try {
    const [name, symbol, decimals, balance] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.balanceOf(userAddress),
    ]);

    return {
      name,
      symbol,
      decimals: Number(decimals),
      balance: formatEther(balance), // Assumes 18 decimals
      rawBalance: balance,
    };
  } catch (error) {
    throw new Error(`Failed to read token data: ${error.message}`);
  }
}

/**
 * Get the user's native BNB balance.
 */
async function getBNBBalance(address) {
  if (!provider) throw new Error("Wallet not connected");
  const balance = await provider.getBalance(address);
  return formatEther(balance);
}
```

### Sending Transactions (Write Operations)

```typescript
// src/main.js (continued)

/**
 * Transfer BEP-20 tokens to another address.
 * Returns the transaction receipt after confirmation.
 */
async function transferTokens(toAddress, amount) {
  if (!tokenContract) throw new Error("Wallet not connected");

  try {
    const amountWei = parseEther(amount.toString());

    // Estimate gas to catch errors before sending
    const gasEstimate = await tokenContract.transfer.estimateGas(
      toAddress,
      amountWei
    );
    console.log("Estimated gas:", gasEstimate.toString());

    // Send the transaction
    const tx = await tokenContract.transfer(toAddress, amountWei);
    console.log("Transaction submitted:", tx.hash);
    console.log(
      "View on BscScan:",
      `https://testnet.bscscan.com/tx/${tx.hash}`
    );

    // Wait for 1 confirmation (~3 seconds on BSC)
    const receipt = await tx.wait(1);

    if (receipt.status === 0) {
      throw new Error("Transaction reverted on-chain");
    }

    return {
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    // Handle specific error cases
    if (error.code === "ACTION_REJECTED") {
      throw new Error("User rejected the transaction");
    }
    if (error.code === "INSUFFICIENT_FUNDS") {
      throw new Error("Not enough BNB to pay for gas");
    }
    if (error.reason) {
      throw new Error(`Contract error: ${error.reason}`);
    }
    throw error;
  }
}

/**
 * Approve a spender (e.g., DEX router) to spend tokens on your behalf.
 * Required before interacting with PancakeSwap or other DeFi protocols.
 */
async function approveSpender(spenderAddress, amount) {
  if (!tokenContract) throw new Error("Wallet not connected");

  const amountWei = parseEther(amount.toString());
  const tx = await tokenContract.approve(spenderAddress, amountWei);
  const receipt = await tx.wait(1);

  return {
    hash: tx.hash,
    spender: spenderAddress,
    amount: amount,
  };
}
```

### Listening to Events

```typescript
// src/main.js (continued)

/**
 * Listen for Transfer events involving the connected user.
 * Useful for updating UI in real-time when tokens are received.
 */
function listenForTransfers(userAddress, callback) {
  if (!tokenContract) throw new Error("Wallet not connected");

  // Filter: transfers TO the user
  const filterTo = tokenContract.filters.Transfer(null, userAddress);

  tokenContract.on(filterTo, (from, to, value, event) => {
    callback({
      type: "received",
      from,
      to,
      amount: formatEther(value),
      txHash: event.log.transactionHash,
    });
  });

  // Filter: transfers FROM the user
  const filterFrom = tokenContract.filters.Transfer(userAddress, null);

  tokenContract.on(filterFrom, (from, to, value, event) => {
    callback({
      type: "sent",
      from,
      to,
      amount: formatEther(value),
      txHash: event.log.transactionHash,
    });
  });

  // Return cleanup function
  return () => {
    tokenContract.removeAllListeners(filterTo);
    tokenContract.removeAllListeners(filterFrom);
  };
}
```

### Handling Network Changes

```typescript
// src/main.js (continued)

/**
 * Handle MetaMask events: account changes and network switches.
 * Critical for UX — users switch networks and accounts frequently.
 */
function setupEventListeners(onAccountChange, onChainChange) {
  if (!window.ethereum) return;

  window.ethereum.on("accountsChanged", (accounts) => {
    if (accounts.length === 0) {
      // User disconnected
      onAccountChange(null);
    } else {
      onAccountChange(accounts[0]);
    }
  });

  window.ethereum.on("chainChanged", (chainId) => {
    const isCorrectChain = chainId === BSC_TESTNET.chainId;
    onChainChange(chainId, isCorrectChain);

    if (!isCorrectChain) {
      console.warn("Switched away from BSC Testnet. Please switch back.");
    }
  });
}

// Export for use in UI
export {
  connectWallet,
  getTokenInfo,
  getBNBBalance,
  transferTokens,
  approveSpender,
  listenForTransfers,
  setupEventListeners,
};
```

### Minimal HTML Interface

Create `index.html`:

```typescript
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BSC Token Interface</title>
</head>
<body>
  <h1>BSC Token Interface</h1>
  <button id="connectBtn">Connect MetaMask</button>
  <div id="info" style="display:none">
    <p>Address: <span id="address"></span></p>
    <p>BNB Balance: <span id="bnbBalance"></span></p>
    <p>Token Balance: <span id="tokenBalance"></span> <span id="tokenSymbol"></span></p>
    <hr />
    <input id="toAddress" placeholder="Recipient address" />
    <input id="amount" placeholder="Amount" type="number" />
    <button id="sendBtn">Send Tokens</button>
    <p id="status"></p>
  </div>
  <script type="module" src="/src/main.js"></script>
  <script type="module">
    import { connectWallet, getTokenInfo, getBNBBalance, transferTokens, setupEventListeners } from "/src/main.js";

    document.getElementById("connectBtn").addEventListener("click", async () => {
      try {
        const account = await connectWallet();
        document.getElementById("address").textContent = account;
        document.getElementById("info").style.display = "block";

        const bnb = await getBNBBalance(account);
        document.getElementById("bnbBalance").textContent = bnb + " tBNB";

        const token = await getTokenInfo(account);
        document.getElementById("tokenBalance").textContent = token.balance;
        document.getElementById("tokenSymbol").textContent = token.symbol;

        setupEventListeners(
          (newAccount) => { if (newAccount) location.reload(); },
          (chainId, isCorrect) => { if (!isCorrect) alert("Please switch to BSC Testnet"); }
        );
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById("sendBtn").addEventListener("click", async () => {
      const to = document.getElementById("toAddress").value;
      const amount = document.getElementById("amount").value;
      const status = document.getElementById("status");

      try {
        status.textContent = "Sending...";
        const result = await transferTokens(to, amount);
        status.textContent = `Sent! TX: ${result.hash}`;
      } catch (err) {
        status.textContent = `Error: ${err.message}`;
      }
    });
  </script>
</body>
</html>
```

### Run the Frontend

```shell
npx vite@5.0.0
```

```
Expected output:
  VITE v5.0.0  ready in 200 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Open `http://localhost:5173` in a browser with MetaMask installed. Click "Connect MetaMask" and approve the connection.

## Common Pitfalls

1. **Not handling `chainChanged` events** — When a user switches networks in MetaMask, your provider becomes stale. All subsequent calls will fail or return data from the wrong chain. Always listen for `chainChanged` and either prompt the user to switch back or reload the page.

2. **Calling write functions without gas estimation first** — If a transaction will revert (insufficient balance, wrong parameters), `estimateGas` catches it before the user signs. Without estimation, users sign a transaction that fails on-chain and still pay gas.

3. **Assuming MetaMask is always available** — Mobile browsers, privacy-focused browsers, and some users don't have MetaMask. Always check `window.ethereum` exists before calling any wallet methods. Show a clear "Install MetaMask" message with a link.

4. **Using `eth_accounts` instead of `eth_requestAccounts`** — `eth_accounts` returns an empty array if the user hasn't explicitly connected. Always use `eth_requestAccounts` which triggers the MetaMask popup. Falling back to `eth_accounts` silently fails.

5. **Forgetting to handle transaction rejection** — Users reject transactions frequently (wrong amount, changed their mind). Error code `4001` / `ACTION_REJECTED` is not a bug — handle it gracefully with a "Transaction cancelled" message, not a generic error.

## What to Learn Next

- [BNB Chain Official Docs](https://docs.bnbchain.org/) — Complete reference for BSC and opBNB development
- [ethers.js v6 Documentation](https://docs.ethers.org/v6/) — Full API reference for the ethers library
- [PancakeSwap Developer Docs](https://github.com/pancakeswap/pancake-frontend) — Integration patterns for BSC's largest DEX
- [Web3Modal](https://github.com/WalletConnect/web3modal) — Multi-wallet connection library supporting MetaMask, WalletConnect, and more
