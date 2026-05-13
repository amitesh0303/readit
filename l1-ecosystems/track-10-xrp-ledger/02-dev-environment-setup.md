# Development Environment Setup

**Track:** XRP Ledger Development
**Level:** Beginner
**Read time:** 8 min

---

## The Problem

You want to start building on XRP Ledger but you're not sure which SDK to use, how to get testnet XRP, or how to structure a project. Unlike EVM chains where you pick between Hardhat and Foundry, XRPL development centers around the xrpl.js SDK for JavaScript/TypeScript or xrpl-py for Python. You need a funded testnet wallet, a WebSocket connection to a node, and an understanding of how transactions flow through the system.

## Core Concepts

### Installing xrpl.js

The official JavaScript/TypeScript SDK for XRP Ledger:

```shell
mkdir xrpl-project && cd xrpl-project
npm init -y
npm install xrpl@3.0.0
```

```
Expected output:
added 15 packages in 2s
```

For TypeScript projects:

```shell
npm install typescript@5.3.3 ts-node@10.9.2 @types/node@20.11.5 --save-dev
npx tsc --init
```

### Project Structure

```
xrpl-project/
├── src/
│   ├── connect.js        # Connection utilities
│   ├── wallet.js         # Wallet management
│   └── transactions.js   # Transaction builders
├── package.json
└── .env                  # Store wallet seeds (never commit)
```

### Connecting to XRPL Testnet

XRPL uses WebSocket connections to communicate with nodes:

```javascript
// src/connect.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

// Available XRPL networks
const NETWORKS = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
  devnet: "wss://s.devnet.rippletest.net:51233",
};

async function connectToTestnet() {
  const client = new xrpl.Client(NETWORKS.testnet);

  client.on("error", (error) => {
    console.error("Connection error:", error);
  });

  client.on("connected", () => {
    console.log("Connected to XRPL Testnet");
  });

  client.on("disconnected", (code) => {
    console.log("Disconnected with code:", code);
  });

  await client.connect();

  // Verify connection by checking server info
  const serverInfo = await client.request({ command: "server_info" });
  console.log(
    "Server version:",
    serverInfo.result.info.build_version
  );
  console.log(
    "Validated ledger:",
    serverInfo.result.info.validated_ledger.seq
  );

  return client;
}

module.exports = { connectToTestnet, NETWORKS };
```

### Funding a Wallet from the Testnet Faucet

XRPL Testnet provides a faucet that creates and funds wallets automatically:

Faucet URL: https://xrpl.org/xrp-testnet-faucet.html

```javascript
// src/wallet.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function createAndFundWallet() {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  // The fund_wallet method hits the testnet faucet automatically
  const { wallet, balance } = await client.fundWallet();

  console.log("=== New Testnet Wallet ===");
  console.log("Address:", wallet.address);
  console.log("Public Key:", wallet.publicKey);
  console.log("Private Key:", wallet.privateKey);
  console.log("Seed:", wallet.seed);
  console.log("Balance:", balance, "XRP");

  // Verify the account exists on-ledger
  const accountInfo = await client.request({
    command: "account_info",
    account: wallet.address,
    ledger_index: "validated",
  });

  console.log(
    "\nOn-ledger balance:",
    xrpl.dropsToXrp(accountInfo.result.account_data.Balance),
    "XRP"
  );
  console.log(
    "Sequence number:",
    accountInfo.result.account_data.Sequence
  );

  await client.disconnect();
  return wallet;
}

// Restore an existing wallet from seed
function restoreWallet(seed) {
  const wallet = xrpl.Wallet.fromSeed(seed);
  console.log("Restored wallet:", wallet.address);
  return wallet;
}

module.exports = { createAndFundWallet, restoreWallet };
```

```shell
node src/wallet.js
```

```
Expected output:
=== New Testnet Wallet ===
Address: rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
Public Key: ED1A2B3C...
Private Key: ED4D5E6F...
Seed: sEdV19BLfeQhh3qYbM...
Balance: 1000 XRP

On-ledger balance: 1000 XRP
Sequence number: 1
```

### Sending Your First Transaction

A basic XRP payment to verify everything works:

```javascript
// src/transactions.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function sendPayment(senderSeed, destinationAddress, amountXRP) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const wallet = xrpl.Wallet.fromSeed(senderSeed);

  const payment = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: destinationAddress,
    Amount: xrpl.xrpToDrops(amountXRP),
  };

  // autofill adds Fee, Sequence, and LastLedgerSequence
  const prepared = await client.autofill(payment);
  console.log("Transaction fee:", xrpl.dropsToXrp(prepared.Fee), "XRP");

  const signed = wallet.sign(prepared);
  console.log("Transaction hash:", signed.hash);

  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult === "tesSUCCESS") {
    console.log("Payment successful!");
    console.log(
      "Delivered:",
      xrpl.dropsToXrp(result.result.meta.delivered_amount),
      "XRP"
    );
  } else {
    console.error("Payment failed:", result.result.meta.TransactionResult);
  }

  await client.disconnect();
  return result;
}

module.exports = { sendPayment };
```

### Understanding Transaction Flow

Every XRPL transaction follows this lifecycle:

```javascript
// xrpl.js@3.0.0 — Transaction lifecycle demonstration
const xrpl = require("xrpl");

async function demonstrateTransactionLifecycle(wallet) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  // 1. Build the transaction
  const tx = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", // testnet address
    Amount: xrpl.xrpToDrops("10"),
  };

  // 2. Autofill network-specific fields
  const prepared = await client.autofill(tx);
  // LastLedgerSequence: transaction expires if not validated by this ledger
  console.log("Expires at ledger:", prepared.LastLedgerSequence);

  // 3. Sign with wallet's private key
  const signed = wallet.sign(prepared);

  // 4. Submit to the network
  const submitResult = await client.submit(signed.tx_blob);
  console.log("Preliminary result:", submitResult.result.engine_result);
  // "tesSUCCESS" means accepted into the queue, NOT yet validated

  // 5. Wait for validation (3-5 seconds)
  const validated = await client.request({
    command: "tx",
    transaction: signed.hash,
    min_ledger: prepared.LastLedgerSequence - 5,
    max_ledger: prepared.LastLedgerSequence,
  });
  console.log("Final result:", validated.result.meta.TransactionResult);

  await client.disconnect();
}
```

## Common Pitfalls

1. **Not handling WebSocket disconnections** — XRPL uses persistent WebSocket connections. Network interruptions will drop your connection silently. Always add reconnection logic and error handlers to your client.

2. **Ignoring LastLedgerSequence** — Every transaction has an expiration ledger. If the network is congested and your transaction isn't validated by that ledger, it's permanently dead. The `autofill` method sets this automatically, but if you build transactions manually, you must set it.

3. **Storing seeds in code** — The wallet seed (`sEd...`) gives full control of the account. Never hardcode it. Use environment variables or a secrets manager. A leaked testnet seed is harmless, but the habit carries to mainnet.

4. **Confusing submit results with validation** — `client.submit()` returns a preliminary result. `tesSUCCESS` at submit time means "accepted into the queue," not "confirmed on-ledger." Always use `submitAndWait()` or poll for validation.

## What to Learn Next

- [Hooks and Custom Transactions](./03-hooks-custom-transactions.md) — Write C-based smart contracts (Hooks) and explore XRPL's native transaction types
- [XRPL Testnet Faucet](https://xrpl.org/xrp-testnet-faucet.html) — Get testnet XRP for development
- [xrpl.js GitHub Repository](https://github.com/XRPLF/xrpl.js) — Source code and additional examples
