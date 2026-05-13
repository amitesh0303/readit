# Frontend Integration with TON Connect

**Track:** TON Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've built and deployed a FunC contract to testnet but now need to connect it to a web frontend. TON's wallet connection protocol (TON Connect 2.0) is different from Ethereum's MetaMask/WalletConnect flow. You need to understand how to connect wallets, construct transaction messages in the browser, and read contract state via the TON API. This lesson builds a complete dApp frontend that interacts with your deployed contract.

---

## Core Concepts

### TON Connect 2.0 Overview

TON Connect is the standard protocol for connecting dApps to TON wallets (Tonkeeper, MyTonWallet, OpenMask):

```
TON Connect flow:
1. dApp generates a connection request (manifest URL + return URL)
2. User scans QR code or clicks deep link in wallet
3. Wallet approves connection → returns user's address
4. dApp can now request transaction signatures from the wallet
5. Wallet shows transaction details → user confirms → wallet broadcasts
```

### Project Setup

```shell
# Create a React + Vite project
npm create vite@5.0.0 my-ton-dapp -- --template react-ts
cd my-ton-dapp

# Install TON Connect and SDK dependencies
npm install @tonconnect/ui-react@2.0.6 @ton/ton@14.0.0 @ton/core@0.57.0 @ton/crypto@3.3.0
```

```json
// package.json (relevant dependencies)
{
  "dependencies": {
    "@ton/core": "0.57.0",
    "@ton/crypto": "3.3.0",
    "@ton/ton": "14.0.0",
    "@tonconnect/ui-react": "2.0.6",
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "devDependencies": {
    "@types/react": "18.2.0",
    "typescript": "5.3.0",
    "vite": "5.0.0"
  }
}
```

### TON Connect Manifest

Every dApp needs a manifest file hosted at a public URL:

```json
// public/tonconnect-manifest.json
{
  "url": "https://my-ton-dapp.example.com",
  "name": "My TON Counter dApp",
  "iconUrl": "https://my-ton-dapp.example.com/icon.png"
}
```

### Setting Up the Provider

```typescript
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react@2.0.6";
import App from "./App";

const manifestUrl = "https://my-ton-dapp.example.com/tonconnect-manifest.json";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);
```

### Wallet Connection Component

```typescript
// src/components/WalletConnect.tsx
import { TonConnectButton, useTonAddress, useTonWallet } from "@tonconnect/ui-react@2.0.6";

export function WalletConnect() {
  const wallet = useTonWallet();
  const address = useTonAddress();

  return (
    <div>
      {/* Built-in connect/disconnect button */}
      <TonConnectButton />

      {wallet && (
        <div>
          <p>Connected wallet: {wallet.name}</p>
          <p>Address: {address}</p>
          <p>
            Network: {wallet.account.chain === "-239" ? "Mainnet" : "Testnet"}
          </p>
        </div>
      )}
    </div>
  );
}
```

### Reading Contract State

Use the TON Center API to call get methods:

```typescript
// src/hooks/useCounterContract.ts
import { useState, useEffect, useCallback } from "react";
import { Address } from "@ton/core@0.57.0";
import { TonClient } from "@ton/ton@14.0.0";
import { useTonAddress } from "@tonconnect/ui-react@2.0.6";

const COUNTER_ADDRESS = "EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR";

// Initialize TON client for testnet
const client = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
  apiKey: import.meta.env.VITE_TONCENTER_API_KEY,
});

export function useCounterContract() {
  const [counter, setCounter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const address = useTonAddress();

  const fetchCounter = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const contractAddress = Address.parse(COUNTER_ADDRESS);

      // Call the get_counter method
      const result = await client.runMethod(contractAddress, "get_counter");
      const value = result.stack.readNumber();

      setCounter(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read counter";
      setError(message);
      console.error("Error reading counter:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounter();
    // Poll every 10 seconds for updates
    const interval = setInterval(fetchCounter, 10000);
    return () => clearInterval(interval);
  }, [fetchCounter]);

  return { counter, loading, error, refetch: fetchCounter };
}
```

### Sending Transactions

```typescript
// src/hooks/useSendTransaction.ts
import { useTonConnectUI } from "@tonconnect/ui-react@2.0.6";
import { beginCell, toNano, Address } from "@ton/core@0.57.0";
import { useCallback, useState } from "react";

const COUNTER_ADDRESS = "EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR";

export function useSendIncrement() {
  const [tonConnectUI] = useTonConnectUI();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendIncrement = useCallback(
    async (amount: number) => {
      try {
        setSending(true);
        setError(null);

        // Build the message body
        const body = beginCell()
          .storeUint(0x01, 32) // op::increment
          .storeUint(0, 64) // query_id
          .storeUint(amount, 32) // amount to increment
          .endCell();

        // Send transaction via TON Connect
        const result = await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300, // 5 min timeout
          messages: [
            {
              address: COUNTER_ADDRESS,
              amount: toNano("0.05").toString(), // Gas for the transaction
              payload: body.toBoc().toString("base64"),
            },
          ],
        });

        console.log("Transaction sent:", result.boc);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        console.error("Send error:", err);
        throw err;
      } finally {
        setSending(false);
      }
    },
    [tonConnectUI]
  );

  return { sendIncrement, sending, error };
}

export function useSendReset() {
  const [tonConnectUI] = useTonConnectUI();
  const [sending, setSending] = useState(false);

  const sendReset = useCallback(async () => {
    try {
      setSending(true);

      const body = beginCell()
        .storeUint(0x03, 32) // op::reset
        .storeUint(0, 64) // query_id
        .endCell();

      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: COUNTER_ADDRESS,
            amount: toNano("0.05").toString(),
            payload: body.toBoc().toString("base64"),
          },
        ],
      });

      return result;
    } catch (err) {
      console.error("Reset failed:", err);
      throw err;
    } finally {
      setSending(false);
    }
  }, [tonConnectUI]);

  return { sendReset, sending };
}
```

### Complete dApp Component

```typescript
// src/App.tsx
import { TonConnectButton, useTonAddress } from "@tonconnect/ui-react@2.0.6";
import { useCounterContract } from "./hooks/useCounterContract";
import { useSendIncrement, useSendReset } from "./hooks/useSendTransaction";
import { useState } from "react";

function App() {
  const address = useTonAddress();
  const { counter, loading, error, refetch } = useCounterContract();
  const { sendIncrement, sending: incrementing } = useSendIncrement();
  const { sendReset, sending: resetting } = useSendReset();
  const [amount, setAmount] = useState(1);

  const handleIncrement = async () => {
    try {
      await sendIncrement(amount);
      // Wait for transaction to process, then refresh
      setTimeout(refetch, 6000);
    } catch (err) {
      // Error already handled in hook
    }
  };

  const handleReset = async () => {
    try {
      await sendReset();
      setTimeout(refetch, 6000);
    } catch (err) {
      // Error already handled in hook
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>TON Counter dApp</h1>

      <div style={{ marginBottom: "2rem" }}>
        <TonConnectButton />
      </div>

      <div style={{ marginBottom: "2rem" }}>
        <h2>Counter Value</h2>
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: "red" }}>Error: {error}</p>}
        {counter !== null && <p style={{ fontSize: "3rem" }}>{counter}</p>}
      </div>

      {address && (
        <div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="amount-input">Increment by: </label>
            <input
              id="amount-input"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{ width: "80px", marginRight: "1rem" }}
              aria-label="Increment amount"
            />
            <button
              onClick={handleIncrement}
              disabled={incrementing}
              aria-busy={incrementing}
            >
              {incrementing ? "Sending..." : "Increment"}
            </button>
          </div>

          <button
            onClick={handleReset}
            disabled={resetting}
            aria-busy={resetting}
          >
            {resetting ? "Sending..." : "Reset (Owner Only)"}
          </button>
        </div>
      )}

      {!address && <p>Connect your wallet to interact with the counter.</p>}
    </div>
  );
}

export default App;
```

### Handling Transaction Confirmation

TON transactions take ~5 seconds to confirm. Implement proper UX:

```typescript
// src/hooks/useTransactionStatus.ts
import { useState, useCallback } from "react";
import { Address, Cell } from "@ton/core@0.57.0";
import { TonClient } from "@ton/ton@14.0.0";

const client = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
  apiKey: import.meta.env.VITE_TONCENTER_API_KEY,
});

type TxStatus = "idle" | "pending" | "confirmed" | "failed";

export function useTransactionStatus() {
  const [status, setStatus] = useState<TxStatus>("idle");

  const waitForTransaction = useCallback(
    async (
      address: string,
      bocBase64: string,
      timeoutMs: number = 30000
    ): Promise<boolean> => {
      setStatus("pending");

      const contractAddr = Address.parse(address);
      const startTime = Date.now();

      // Get the transaction hash from the BOC
      const cell = Cell.fromBase64(bocBase64);
      const hash = cell.hash().toString("hex");

      while (Date.now() - startTime < timeoutMs) {
        try {
          const transactions = await client.getTransactions(contractAddr, {
            limit: 5,
          });

          const found = transactions.find(
            (tx) => tx.inMessage?.body?.hash().toString("hex") === hash
          );

          if (found) {
            setStatus("confirmed");
            return true;
          }
        } catch (err) {
          console.warn("Polling error:", err);
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      setStatus("failed");
      return false;
    },
    []
  );

  return { status, waitForTransaction, setStatus };
}
```

### Environment Configuration

```shell
# .env (for local development)
VITE_TONCENTER_API_KEY=your-testnet-api-key-here
VITE_NETWORK=testnet
VITE_COUNTER_ADDRESS=EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR
```

```shell
# Run the development server
npm run dev
```

```
Expected output:
  VITE v5.0.0  ready in 312 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Last verified: 2025-01-15. For current TON Connect SDK, see https://docs.ton.org/develop/dapps/ton-connect/overview

---

## Common Pitfalls

1. **Not hosting the manifest at a public HTTPS URL** — TON Connect requires the manifest to be accessible via HTTPS. During local development, you can use a tunneling service (ngrok, localtunnel) or host the manifest on a CDN. Wallets will refuse to connect if the manifest URL is unreachable or uses HTTP.

2. **Forgetting `validUntil` in transaction requests** — The `validUntil` field is required and specifies when the transaction request expires (Unix timestamp in seconds). If you set it too short, the user won't have time to confirm in their wallet. If you omit it, some wallets will reject the request. Use `Math.floor(Date.now() / 1000) + 300` for a 5-minute window.

3. **Not converting amounts to nanoTON strings** — The `amount` field in TON Connect messages must be a string representing nanoTON. Using a number or forgetting to convert from TON will either fail silently or send the wrong amount. Always use `toNano('0.05').toString()`.

4. **Polling too aggressively after sending** — TON testnet blocks take ~5 seconds. If you poll for state changes immediately after sending a transaction, you'll get stale data and confuse users. Wait at least 5-6 seconds before the first poll, then poll every 3 seconds with a timeout.

5. **Not handling wallet disconnection** — Users can disconnect their wallet at any time. If your UI doesn't react to disconnection events, buttons will appear clickable but transactions will fail. Always check `useTonAddress()` before showing interaction UI and handle the `null` case gracefully.

---

## What to Learn Next

- [TON Connect Documentation](https://docs.ton.org/develop/dapps/ton-connect/overview) — Full protocol specification and advanced features
- [TON Connect React SDK](https://github.com/ton-connect/sdk/tree/main/packages/ui-react) — Complete API reference
- [Tact Language](https://docs.tact-lang.org/) — Higher-level alternative to FunC with Solidity-like syntax
