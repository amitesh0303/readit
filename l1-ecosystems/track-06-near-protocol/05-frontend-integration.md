# Frontend Integration with near-api-js and Wallet Selector

**Track:** NEAR Protocol Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've deployed a contract to NEAR testnet. Now you need a frontend that connects wallets, reads contract state, and sends transactions. NEAR's frontend stack has two main pieces: `near-api-js` (the low-level SDK) and `@near-wallet-selector` (the wallet connection UI). Unlike Ethereum's ethers.js + MetaMask pattern, NEAR supports multiple wallet types (browser wallets, injected wallets, hardware wallets) through a unified selector interface. This lesson builds a working dApp frontend from scratch.

---

## Core Concepts

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ NEAR Frontend Stack                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Your React/Next.js App                                 │
│       │                                                 │
│       ├── @near-wallet-selector/core@8.9.0              │
│       │     └── Manages wallet connections              │
│       │                                                 │
│       ├── @near-wallet-selector/modal-ui@8.9.0          │
│       │     └── Pre-built wallet selection modal        │
│       │                                                 │
│       ├── @near-wallet-selector/my-near-wallet@8.9.0    │
│       │     └── MyNearWallet adapter                    │
│       │                                                 │
│       ├── @near-wallet-selector/meteor-wallet@8.9.0     │
│       │     └── Meteor Wallet adapter                   │
│       │                                                 │
│       └── near-api-js@4.0.0                             │
│             └── RPC calls, transaction building         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Installing Dependencies

```shell
# Core dependencies
npm install near-api-js@4.0.0
npm install @near-wallet-selector/core@8.9.0
npm install @near-wallet-selector/modal-ui@8.9.0

# Wallet adapters (install the ones you want to support)
npm install @near-wallet-selector/my-near-wallet@8.9.0
npm install @near-wallet-selector/meteor-wallet@8.9.0
npm install @near-wallet-selector/here-wallet@8.9.0
```

```
Expected output:
added 47 packages in 8s
```

### Setting Up Wallet Selector

Create a wallet connection module that initializes the selector and manages state:

```typescript
// src/near/wallet.ts
import { setupWalletSelector, WalletSelector, AccountState } from "@near-wallet-selector/core";
import { setupModal, WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";

// Import the modal CSS
import "@near-wallet-selector/modal-ui/styles.css";

const CONTRACT_ID = "guestbook.testnet";
const NETWORK_ID = "testnet"; // "mainnet" for production

let selector: WalletSelector;
let modal: WalletSelectorModal;

export async function initNear(): Promise<WalletSelector> {
  selector = await setupWalletSelector({
    network: NETWORK_ID,
    modules: [
      setupMyNearWallet(),
      setupMeteorWallet(),
    ],
  });

  modal = setupModal(selector, {
    contractId: CONTRACT_ID,
    description: "Please connect your wallet to use the GuestBook dApp",
  });

  return selector;
}

export function showWalletModal(): void {
  modal.show();
}

export function getAccountId(): string | null {
  const state = selector.store.getState();
  const accounts: AccountState[] = state.accounts;
  if (accounts.length === 0) return null;
  return accounts[0].accountId;
}

export async function signOut(): Promise<void> {
  const wallet = await selector.wallet();
  await wallet.signOut();
}

export function getSelector(): WalletSelector {
  return selector;
}
```

### Reading Contract State (View Calls)

View calls are free — they don't require a wallet connection or gas:

```typescript
// src/near/contract.ts
import { providers } from "near-api-js";

const CONTRACT_ID = "guestbook.testnet";
const RPC_URL = "https://rpc.testnet.near.org";

const provider = new providers.JsonRpcProvider({ url: RPC_URL });

/**
 * Call a view method on the contract (free, no wallet needed)
 */
export async function viewMethod<T>(
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const result = await provider.query({
    request_type: "call_function",
    account_id: CONTRACT_ID,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });

  // Parse the result (returned as byte array)
  const resultBytes = (result as any).result;
  const resultString = String.fromCharCode(...resultBytes);
  return JSON.parse(resultString) as T;
}

// Usage examples:
export async function getMessage(accountId: string): Promise<string | null> {
  return viewMethod<string | null>("get_message", { account_id: accountId });
}

export async function getTotalMessages(): Promise<number> {
  return viewMethod<number>("get_total_messages");
}
```

### Sending Transactions (Change Calls)

Change calls modify state and require a connected wallet:

```typescript
// src/near/contract.ts (continued)
import { WalletSelector } from "@near-wallet-selector/core";
import { utils } from "near-api-js";

const GAS = "30000000000000"; // 30 TGas
const NO_DEPOSIT = "0";
const ONE_YOCTO = "1";

/**
 * Call a change method on the contract (requires wallet, costs gas)
 */
export async function callMethod(
  selector: WalletSelector,
  methodName: string,
  args: Record<string, unknown>,
  deposit: string = NO_DEPOSIT
): Promise<any> {
  const wallet = await selector.wallet();
  const accounts = await wallet.getAccounts();

  if (accounts.length === 0) {
    throw new Error("No wallet connected");
  }

  const outcome = await wallet.signAndSendTransaction({
    signerId: accounts[0].accountId,
    receiverId: CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName,
          args,
          gas: GAS,
          deposit,
        },
      },
    ],
  });

  return outcome;
}

// Usage examples:
export async function addMessage(
  selector: WalletSelector,
  message: string
): Promise<any> {
  return callMethod(selector, "add_message", { message });
}

export async function addMessageWithTip(
  selector: WalletSelector,
  message: string,
  tipNear: string
): Promise<any> {
  // Convert NEAR to yoctoNEAR
  const deposit = utils.format.parseNearAmount(tipNear);
  if (!deposit) throw new Error("Invalid NEAR amount");
  return callMethod(selector, "add_message_with_tip", { message }, deposit);
}

export async function transferToken(
  selector: WalletSelector,
  receiverId: string,
  amount: string
): Promise<any> {
  return callMethod(
    selector,
    "ft_transfer",
    { receiver_id: receiverId, amount, memo: null },
    ONE_YOCTO // NEP-141 requires 1 yoctoNEAR
  );
}
```

### React Component Example

A complete React component using the wallet selector:

```typescript
// src/components/GuestBook.tsx
import React, { useEffect, useState, useCallback } from "react";
import { WalletSelector } from "@near-wallet-selector/core";
import { initNear, showWalletModal, getAccountId, signOut, getSelector } from "../near/wallet";
import { getMessage, getTotalMessages, addMessage } from "../near/contract";

export function GuestBook() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [existingMessage, setExistingMessage] = useState<string | null>(null);
  const [totalMessages, setTotalMessages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const selector = await initNear();

        // Subscribe to account changes
        selector.store.observable.subscribe((state) => {
          const accounts = state.accounts;
          if (accounts.length > 0) {
            setAccountId(accounts[0].accountId);
          } else {
            setAccountId(null);
          }
        });

        // Check if already signed in
        const currentAccount = getAccountId();
        if (currentAccount) {
          setAccountId(currentAccount);
        }

        // Load total messages (view call, no wallet needed)
        const total = await getTotalMessages();
        setTotalMessages(total);
      } catch (err) {
        setError(`Failed to initialize: ${(err as Error).message}`);
      }
    }
    init();
  }, []);

  // Load user's existing message when account changes
  useEffect(() => {
    async function loadMessage() {
      if (!accountId) return;
      try {
        const msg = await getMessage(accountId);
        setExistingMessage(msg);
      } catch (err) {
        console.error("Failed to load message:", err);
      }
    }
    loadMessage();
  }, [accountId]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const selector = getSelector();
      await addMessage(selector, message);
      setExistingMessage(message);
      setMessage("");
      setTotalMessages((prev) => prev + 1);
    } catch (err) {
      const errorMessage = (err as Error).message;
      if (errorMessage.includes("User rejected")) {
        setError("Transaction cancelled by user");
      } else {
        setError(`Transaction failed: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  return (
    <div className="guestbook">
      <h1>NEAR GuestBook</h1>
      <p>Total messages: {totalMessages}</p>

      {!accountId ? (
        <button onClick={showWalletModal}>Connect Wallet</button>
      ) : (
        <div>
          <p>Connected as: {accountId}</p>
          <button onClick={signOut}>Sign Out</button>

          {existingMessage && (
            <div className="existing-message">
              <h3>Your message:</h3>
              <p>{existingMessage}</p>
            </div>
          )}

          <div className="new-message">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a message..."
              maxLength={500}
              disabled={loading}
            />
            <button onClick={handleSubmit} disabled={loading || !message.trim()}>
              {loading ? "Sending..." : "Submit"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### Handling Transaction Results and Errors

```typescript
// src/near/utils.ts
import { providers } from "near-api-js";

const RPC_URL = "https://rpc.testnet.near.org";
const provider = new providers.JsonRpcProvider({ url: RPC_URL });

/**
 * Get transaction result with full details
 */
export async function getTransactionResult(txHash: string, accountId: string) {
  const result = await provider.txStatus(txHash, accountId);

  // Check if transaction succeeded
  if (
    result.status &&
    typeof result.status === "object" &&
    "SuccessValue" in result.status
  ) {
    // Decode the return value
    const value = result.status.SuccessValue;
    if (value) {
      const decoded = Buffer.from(value, "base64").toString();
      return { success: true, value: JSON.parse(decoded) };
    }
    return { success: true, value: null };
  }

  // Transaction failed
  if (
    result.status &&
    typeof result.status === "object" &&
    "Failure" in result.status
  ) {
    const failure = result.status.Failure;
    return { success: false, error: JSON.stringify(failure) };
  }

  return { success: false, error: "Unknown transaction status" };
}

/**
 * Parse NEAR contract panic messages from transaction errors
 */
export function parseContractError(error: unknown): string {
  const errorStr = String(error);

  // Common NEAR contract errors
  if (errorStr.includes("Smart contract panicked")) {
    const match = errorStr.match(/Smart contract panicked: (.+?)(?:,|$)/);
    return match ? match[1] : "Contract execution failed";
  }

  if (errorStr.includes("NotEnoughBalance")) {
    return "Insufficient NEAR balance for this transaction";
  }

  if (errorStr.includes("NotEnoughAllowance")) {
    return "Function call key doesn't have enough allowance";
  }

  if (errorStr.includes("GasExceeded")) {
    return "Transaction ran out of gas. Try increasing the gas limit.";
  }

  return "Transaction failed. Check the explorer for details.";
}
```

### Querying Account Balance

```typescript
// src/near/account.ts
import { providers, utils } from "near-api-js";

const RPC_URL = "https://rpc.testnet.near.org";
const provider = new providers.JsonRpcProvider({ url: RPC_URL });

/**
 * Get NEAR balance for an account
 */
export async function getAccountBalance(accountId: string): Promise<{
  total: string;
  available: string;
  staked: string;
  storageUsed: string;
}> {
  const account = await provider.query({
    request_type: "view_account",
    account_id: accountId,
    finality: "final",
  });

  const result = account as any;
  const totalBalance = BigInt(result.amount);
  const storageUsed = BigInt(result.storage_usage) * BigInt("10000000000000000000"); // storage cost per byte
  const stakedBalance = BigInt(result.locked);
  const availableBalance = totalBalance - stakedBalance - storageUsed;

  return {
    total: utils.format.formatNearAmount(totalBalance.toString()),
    available: utils.format.formatNearAmount(
      availableBalance > 0n ? availableBalance.toString() : "0"
    ),
    staked: utils.format.formatNearAmount(stakedBalance.toString()),
    storageUsed: result.storage_usage.toString() + " bytes",
  };
}
```

---

## Common Pitfalls

1. **Not handling wallet redirect flows** — MyNearWallet uses a redirect-based flow (user leaves your app, signs in the wallet, then returns). After redirect, you must check the URL for transaction results. The wallet-selector handles this internally, but if you're building custom flows, you need to parse the callback URL parameters.

2. **Calling change methods without a connected wallet** — View methods work without a wallet, but change methods require one. Always check `getAccountId() !== null` before calling `callMethod`. If the wallet isn't connected, show the wallet modal instead of throwing an error.

3. **Forgetting to convert NEAR amounts** — The RPC returns amounts in yoctoNEAR (10^24). Use `utils.format.formatNearAmount()` to display human-readable values and `utils.format.parseNearAmount()` to convert user input to yoctoNEAR. Displaying raw yoctoNEAR values confuses users.

4. **Not subscribing to account state changes** — The wallet selector's `store.observable` emits events when the user connects, disconnects, or switches accounts. If you only check the account on page load, your UI won't update when the user signs out from the wallet extension.

5. **Hardcoding gas values too low** — 30 TGas is safe for simple calls, but cross-contract calls or complex operations need more. If a transaction fails with `GasExceeded`, increase the gas. The maximum is 300 TGas per transaction. Monitor actual gas usage on the explorer and set values 20-30% above observed usage.

---

## What to Learn Next

- [NEAR Documentation — Frontend Integration](https://docs.near.org/build/web3-apps/integrate-contracts) — Official frontend guide
- [wallet-selector GitHub](https://github.com/near/wallet-selector) — Source code and additional wallet adapters
- [near-api-js documentation](https://docs.near.org/tools/near-api-js/quick-reference) — Full API reference
- [NEAR Examples — Frontend](https://github.com/near-examples/hello-near-examples) — Official frontend example apps
