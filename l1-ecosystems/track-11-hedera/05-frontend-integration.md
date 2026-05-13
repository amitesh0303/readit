# Frontend Integration with HashConnect

**Track:** Hedera Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've built smart contracts and created tokens on Hedera, but now you need to connect a web frontend to the network. On Ethereum you'd use MetaMask + ethers.js, but Hedera has its own wallet ecosystem. HashPack is the primary wallet, HashConnect is the connection library, and the Hedera SDK works in the browser — but the patterns are different from what you're used to with wagmi or web3-react. You need to understand how to connect wallets, sign transactions client-side, and query the mirror node for display data.

## Core Concepts

### Hedera Frontend Stack

```
┌─────────────────────────────────────────────┐
│              Your dApp Frontend              │
├─────────────────────────────────────────────┤
│                                             │
│  HashConnect SDK                            │
│  └── Wallet connection (HashPack, Blade)    │
│  └── Transaction signing                    │
│                                             │
│  @hashgraph/sdk (browser bundle)            │
│  └── Build transactions                     │
│  └── Query consensus nodes                  │
│                                             │
│  Mirror Node REST API                       │
│  └── Read balances, history, token info     │
│  └── Free queries (no HBAR cost)            │
│                                             │
└─────────────────────────────────────────────┘
```

### Step 1: Project Setup

```shell
# Create a React project (or use any framework)
npm create vite@latest hedera-dapp -- --template react
cd hedera-dapp

# Install Hedera dependencies
npm install @hashgraph/sdk@2.40.0 hashconnect@3.0.10

# Start development server
npm run dev
```

### Step 2: HashConnect Initialization

HashConnect manages the pairing between your dApp and HashPack wallet:

```javascript
// src/hashconnect.js — HashConnect setup for wallet pairing
import { HashConnect } from "hashconnect";

const appMetadata = {
    name: "My Hedera dApp",
    description: "A demo application on Hedera",
    icons: ["https://your-app.com/icon.png"],
    url: "https://your-app.com",
};

let hashconnect;
let pairingData;

export async function initHashConnect() {
    hashconnect = new HashConnect(
        // LedgerId.TESTNET for testnet, LedgerId.MAINNET for production
        "testnet",
        // Project ID from WalletConnect (optional but recommended)
        process.env.VITE_WALLETCONNECT_PROJECT_ID || "",
        appMetadata,
        // Debug mode
        true
    );

    // Set up event listeners
    hashconnect.pairingEvent.on((newPairing) => {
        pairingData = newPairing;
        console.log("Paired with wallet:", newPairing.accountIds);
    });

    hashconnect.disconnectionEvent.on(() => {
        pairingData = null;
        console.log("Wallet disconnected");
    });

    // Initialize — this triggers the pairing modal
    await hashconnect.init();

    return hashconnect;
}

export async function connectWallet() {
    if (!hashconnect) {
        throw new Error("HashConnect not initialized. Call initHashConnect() first.");
    }
    // Opens HashPack pairing modal
    await hashconnect.openPairingModal();
}

export function getConnectedAccountId() {
    if (!pairingData || pairingData.accountIds.length === 0) {
        return null;
    }
    return pairingData.accountIds[0];
}

export function getHashConnect() {
    return hashconnect;
}
```

### Step 3: React Wallet Connection Component

```javascript
// src/components/WalletConnect.jsx — Wallet connection UI
import { useState, useEffect } from "react";
import { initHashConnect, connectWallet, getConnectedAccountId } from "../hashconnect";

export function WalletConnect() {
    const [accountId, setAccountId] = useState(null);
    const [balance, setBalance] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        initHashConnect()
            .then(() => {
                const existing = getConnectedAccountId();
                if (existing) {
                    setAccountId(existing);
                    fetchBalance(existing);
                }
            })
            .catch((err) => setError(err.message));
    }, []);

    async function fetchBalance(accId) {
        try {
            const response = await fetch(
                `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accId}`
            );
            if (!response.ok) throw new Error("Failed to fetch balance");
            const data = await response.json();
            setBalance((data.balance.balance / 1e8).toFixed(4));
        } catch (err) {
            console.error("Balance fetch failed:", err);
        }
    }

    async function handleConnect() {
        setIsConnecting(true);
        setError(null);
        try {
            await connectWallet();
            const connectedId = getConnectedAccountId();
            if (connectedId) {
                setAccountId(connectedId);
                await fetchBalance(connectedId);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsConnecting(false);
        }
    }

    if (error) {
        return <div className="wallet-error">Error: {error}</div>;
    }

    if (accountId) {
        return (
            <div className="wallet-connected">
                <span>Connected: {accountId}</span>
                {balance && <span> | {balance} HBAR</span>}
            </div>
        );
    }

    return (
        <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="connect-button"
        >
            {isConnecting ? "Connecting..." : "Connect HashPack"}
        </button>
    );
}
```

### Step 4: Signing Transactions from the Frontend

```javascript
// src/services/transactions.js — Build and sign transactions via HashConnect
import { TransferTransaction, Hbar, AccountId } from "@hashgraph/sdk";
import { getHashConnect, getConnectedAccountId } from "../hashconnect";

/**
 * Transfer HBAR from connected wallet to a recipient
 * @param {string} recipientId - Hedera account ID (e.g., "0.0.12345")
 * @param {number} amount - Amount in HBAR
 * @returns {object} Transaction receipt
 */
export async function transferHbar(recipientId, amount) {
    const hashconnect = getHashConnect();
    const senderId = getConnectedAccountId();

    if (!senderId) {
        throw new Error("No wallet connected");
    }

    if (!recipientId || amount <= 0) {
        throw new Error("Invalid recipient or amount");
    }

    // Build the transaction
    const transaction = new TransferTransaction()
        .addHbarTransfer(senderId, new Hbar(-amount))
        .addHbarTransfer(recipientId, new Hbar(amount))
        .setTransactionMemo("Transfer from dApp");

    // Send to wallet for signing
    const response = await hashconnect.sendTransaction(
        AccountId.fromString(senderId),
        transaction
    );

    if (response.success) {
        console.log("Transaction successful:", response.receipt);
        return response.receipt;
    } else {
        throw new Error(`Transaction failed: ${response.error}`);
    }
}

/**
 * Transfer HTS tokens from connected wallet
 * @param {string} tokenId - Token ID (e.g., "0.0.4823456")
 * @param {string} recipientId - Recipient account ID
 * @param {number} amount - Amount in smallest unit (with decimals applied)
 */
export async function transferToken(tokenId, recipientId, amount) {
    const hashconnect = getHashConnect();
    const senderId = getConnectedAccountId();

    if (!senderId) {
        throw new Error("No wallet connected");
    }

    const transaction = new TransferTransaction()
        .addTokenTransfer(tokenId, senderId, -amount)
        .addTokenTransfer(tokenId, recipientId, amount);

    const response = await hashconnect.sendTransaction(
        AccountId.fromString(senderId),
        transaction
    );

    if (response.success) {
        return response.receipt;
    } else {
        throw new Error(`Token transfer failed: ${response.error}`);
    }
}
```

### Step 5: Mirror Node Queries for Display Data

```javascript
// src/services/mirror.js — Query mirror node for UI data
const MIRROR_BASE = "https://testnet.mirrornode.hedera.com";

/**
 * Get token balances for an account
 * @param {string} accountId - Hedera account ID
 * @returns {Array} Token balances with metadata
 */
export async function getTokenBalances(accountId) {
    const response = await fetch(
        `${MIRROR_BASE}/api/v1/accounts/${accountId}/tokens`
    );

    if (!response.ok) {
        throw new Error(`Mirror node error: ${response.status}`);
    }

    const data = await response.json();

    return data.tokens.map((token) => ({
        tokenId: token.token_id,
        balance: token.balance,
        decimals: token.decimals,
        freezeStatus: token.freeze_status,
        kycStatus: token.kyc_status,
    }));
}

/**
 * Get recent transactions for an account
 * @param {string} accountId - Hedera account ID
 * @param {number} limit - Max results (default 10)
 * @returns {Array} Recent transactions
 */
export async function getRecentTransactions(accountId, limit = 10) {
    const response = await fetch(
        `${MIRROR_BASE}/api/v1/transactions?account.id=${accountId}&limit=${limit}&order=desc`
    );

    if (!response.ok) {
        throw new Error(`Mirror node error: ${response.status}`);
    }

    const data = await response.json();

    return data.transactions.map((tx) => ({
        id: tx.transaction_id,
        type: tx.name,
        timestamp: tx.consensus_timestamp,
        status: tx.result,
        transfers: tx.transfers,
    }));
}

/**
 * Get token info (name, symbol, supply)
 * @param {string} tokenId - Token ID
 * @returns {object} Token metadata
 */
export async function getTokenInfo(tokenId) {
    const response = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);

    if (!response.ok) {
        throw new Error(`Token not found: ${tokenId}`);
    }

    const data = await response.json();

    return {
        tokenId: data.token_id,
        name: data.name,
        symbol: data.symbol,
        decimals: parseInt(data.decimals),
        totalSupply: data.total_supply,
        maxSupply: data.max_supply,
        type: data.type,
        treasuryAccountId: data.treasury_account_id,
    };
}
```

### Step 6: Complete dApp Component

```javascript
// src/components/TokenDashboard.jsx — Full token interaction UI
import { useState, useEffect } from "react";
import { getConnectedAccountId } from "../hashconnect";
import { transferToken } from "../services/transactions";
import { getTokenBalances, getTokenInfo } from "../services/mirror";

export function TokenDashboard() {
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sendForm, setSendForm] = useState({ tokenId: "", recipient: "", amount: "" });
    const [txStatus, setTxStatus] = useState(null);

    useEffect(() => {
        loadTokens();
    }, []);

    async function loadTokens() {
        const accountId = getConnectedAccountId();
        if (!accountId) return;

        try {
            const balances = await getTokenBalances(accountId);

            // Enrich with token metadata
            const enriched = await Promise.all(
                balances.map(async (token) => {
                    const info = await getTokenInfo(token.tokenId);
                    return { ...token, ...info };
                })
            );

            setTokens(enriched);
        } catch (err) {
            console.error("Failed to load tokens:", err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSend(e) {
        e.preventDefault();
        setTxStatus("signing");

        try {
            const token = tokens.find((t) => t.tokenId === sendForm.tokenId);
            const rawAmount = Math.floor(
                parseFloat(sendForm.amount) * 10 ** (token?.decimals || 0)
            );

            await transferToken(sendForm.tokenId, sendForm.recipient, rawAmount);
            setTxStatus("success");
            await loadTokens(); // Refresh balances
        } catch (err) {
            setTxStatus(`error: ${err.message}`);
        }
    }

    if (loading) return <div>Loading tokens...</div>;

    return (
        <div className="token-dashboard">
            <h2>Your Tokens</h2>
            <ul>
                {tokens.map((token) => (
                    <li key={token.tokenId}>
                        {token.name} ({token.symbol}):
                        {(token.balance / 10 ** token.decimals).toFixed(token.decimals)}
                    </li>
                ))}
            </ul>

            <h3>Send Tokens</h3>
            <form onSubmit={handleSend}>
                <select
                    value={sendForm.tokenId}
                    onChange={(e) => setSendForm({ ...sendForm, tokenId: e.target.value })}
                    required
                >
                    <option value="">Select token</option>
                    {tokens.map((t) => (
                        <option key={t.tokenId} value={t.tokenId}>
                            {t.symbol}
                        </option>
                    ))}
                </select>
                <input
                    type="text"
                    placeholder="Recipient (0.0.XXXXX)"
                    value={sendForm.recipient}
                    onChange={(e) => setSendForm({ ...sendForm, recipient: e.target.value })}
                    required
                />
                <input
                    type="number"
                    placeholder="Amount"
                    step="any"
                    min="0"
                    value={sendForm.amount}
                    onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                    required
                />
                <button type="submit">Send</button>
            </form>

            {txStatus && <p className="tx-status">{txStatus}</p>}
        </div>
    );
}
```

## Common Pitfalls

1. **Not handling wallet disconnection** — Users can disconnect from HashPack at any time. Always check `getConnectedAccountId()` before building transactions, and listen for the `disconnectionEvent` to update your UI state.

2. **Querying consensus nodes from the frontend** — Every consensus node query costs HBAR. Use the mirror node REST API for all read operations (balances, transaction history, token info). Only use the SDK's consensus queries when you need cryptographic proof of current state.

3. **Ignoring token association in UX** — Before a user can receive any HTS token, they must associate with it. Build an "Associate Token" button into your UI, or use `TokenAssociateTransaction` as part of your onboarding flow. Without this, transfers will fail silently from the user's perspective.

4. **Hardcoding testnet URLs in production** — Use environment variables to switch between testnet and mainnet mirror nodes. The mirror node base URL, network name for HashConnect, and explorer links all change between environments.

5. **Not validating account ID format** — Hedera account IDs follow the pattern `0.0.XXXXX`. Validate user input before building transactions to avoid confusing SDK errors. A simple regex check: `/^0\.0\.\d+$/`.

## What to Learn Next

- [Hedera Portal](https://portal.hedera.com/) — Manage testnet accounts and get test HBAR
- [HashConnect Documentation](https://github.com/nickytonline/hashconnect) — Full API reference for wallet pairing
- [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api) — Complete endpoint reference for queries
