# Hooks and Custom Transactions

**Track:** XRP Ledger Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You need programmable logic on XRP Ledger — maybe you want to enforce spending limits, auto-forward payments, or add custom validation before transactions execute. But XRPL doesn't have Solidity or a general-purpose VM. Instead, it offers Hooks: lightweight WebAssembly programs written in C that attach to accounts and fire before or after transactions. You also have a rich set of native transaction types that handle common financial operations without any custom code. Understanding when to use Hooks vs native transactions is the key architectural decision.

## Core Concepts

### XRPL Native Transaction Types

Before reaching for Hooks, understand what XRPL handles natively:

```javascript
// xrpl.js@3.0.0 — Native transaction types (no Hooks needed)
const xrpl = require("xrpl");

// 1. Escrow: Time-locked or condition-locked payments
const escrowCreate = {
  TransactionType: "EscrowCreate",
  Account: "rSenderAddress...",
  Destination: "rReceiverAddress...",
  Amount: xrpl.xrpToDrops("1000"),
  FinishAfter: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
  CancelAfter: Math.floor(Date.now() / 1000) + 604800, // 7 days (safety)
};

// 2. Payment Channel: Off-ledger micropayments
const channelCreate = {
  TransactionType: "PaymentChannelCreate",
  Account: "rSenderAddress...",
  Destination: "rReceiverAddress...",
  Amount: xrpl.xrpToDrops("500"),
  SettleDelay: 3600, // 1-hour dispute window
  PublicKey: "ED1234...", // Sender's public key for claim verification
};

// 3. DEX Offer: Place a trade on the built-in exchange
const offerCreate = {
  TransactionType: "OfferCreate",
  Account: "rTraderAddress...",
  TakerGets: xrpl.xrpToDrops("100"), // Selling 100 XRP
  TakerPays: {
    currency: "USD",
    issuer: "rGatewayAddress...",
    value: "50", // For 50 USD
  },
};

// 4. Check: Deferred pull-payment (like a paper check)
const checkCreate = {
  TransactionType: "CheckCreate",
  Account: "rPayerAddress...",
  Destination: "rPayeeAddress...",
  SendMax: xrpl.xrpToDrops("200"),
  Expiration: Math.floor(Date.now() / 1000) + 2592000, // 30 days
};
```

### Introduction to Hooks

Hooks are small C programs compiled to WebAssembly that execute on XRPL validators. They attach to accounts and intercept transactions:

```
┌─────────────────────────────────────────────────┐
│              Hook Execution Flow                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  Transaction submitted                          │
│       │                                         │
│       ▼                                         │
│  Before Hook (on sender account)                │
│  └── Can: reject, modify, emit new txns         │
│       │                                         │
│       ▼                                         │
│  Transaction executes on ledger                 │
│       │                                         │
│       ▼                                         │
│  After Hook (on destination account)            │
│  └── Can: emit new txns, update state           │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Writing a Basic Hook in C

Hooks use a C API with helper functions. Here's a Hook that rejects payments below a minimum amount:

```c
// minimum_payment_hook.c — Rejects incoming payments below 10 XRP
// Compile with: hook-cleaner && guard-checker && wasm2wat
#include "hookapi.h"

int64_t hook(uint32_t reserved) {
    // Only trigger on Payment transactions
    int64_t tt = otxn_type();
    if (tt != 0) {  // 0 = Payment
        accept(SBUF("Not a payment, passing through."), 0);
        return 0;
    }

    // Get the payment amount in drops
    int64_t amount_drops = otxn_amount();

    // Minimum threshold: 10 XRP = 10,000,000 drops
    int64_t minimum = 10000000;

    if (amount_drops < minimum) {
        // Reject the transaction
        rollback(SBUF("Payment below minimum 10 XRP."), 1);
        return 1;
    }

    // Accept the transaction
    accept(SBUF("Payment meets minimum threshold."), 0);
    return 0;
}
```

### Hook Development Setup

Install the Hooks development tools:

```shell
# Install the XRPL Hooks Builder (Docker-based)
docker pull xrplf/hook-builder:latest

# Compile a Hook from C to WASM
docker run --rm -v $(pwd):/src xrplf/hook-builder:latest \
  bash -c "cd /src && gcc -O2 -target wasm32 \
    -nostdlib -nostdinc \
    -I/opt/hooks-api \
    -o minimum_payment_hook.wasm \
    minimum_payment_hook.c"
```

```
Expected output:
Compilation successful: minimum_payment_hook.wasm (1.2 KB)
```

### Deploying a Hook to an Account

```javascript
// deploy-hook.js — xrpl.js@3.0.0
const xrpl = require("xrpl");
const fs = require("fs");

async function deployHook(wallet, hookWasmPath) {
  const client = new xrpl.Client("wss://hooks-testnet-v3.xrpl-labs.com");
  await client.connect();

  // Read the compiled WASM binary
  const hookBinary = fs.readFileSync(hookWasmPath);
  const hookHex = hookBinary.toString("hex").toUpperCase();

  const setHookTx = {
    TransactionType: "SetHook",
    Account: wallet.address,
    Hooks: [
      {
        Hook: {
          CreateCode: hookHex,
          HookOn:
            "0000000000000000000000000000000000000000000000000000000000000000", // Trigger on all transaction types
          HookNamespace: xrpl.convertStringToHex("minimum_payment").padEnd(
            64,
            "0"
          ),
          HookApiVersion: 0,
          Flags: 1, // hsfOverride — replace existing hook
        },
      },
    ],
  };

  const prepared = await client.autofill(setHookTx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult === "tesSUCCESS") {
    console.log("Hook deployed successfully!");
    console.log("Hook hash:", result.result.meta.HookHash);
  } else {
    console.error("Hook deployment failed:", result.result.meta.TransactionResult);
  }

  await client.disconnect();
  return result;
}

module.exports = { deployHook };
```

### Hook State Management

Hooks can persist data across executions using state:

```c
// counter_hook.c — Counts incoming payments using Hook state
#include "hookapi.h"

int64_t hook(uint32_t reserved) {
    // Only count Payment transactions
    int64_t tt = otxn_type();
    if (tt != 0) {
        accept(SBUF("Not a payment."), 0);
        return 0;
    }

    // State key for our counter
    uint8_t state_key[32];
    CLEARBUF(state_key);
    state_key[0] = 'C'; // "Counter" key

    // Read current count from state
    int64_t count = 0;
    uint8_t count_buf[8];
    int64_t state_result = state(SBUF(count_buf), SBUF(state_key));

    if (state_result == 8) {
        // State exists, read the value
        count = INT64_FROM_BUF(count_buf);
    }

    // Increment counter
    count++;
    INT64_TO_BUF(count_buf, count);

    // Write updated count back to state
    state_set(SBUF(count_buf), SBUF(state_key));

    // Log the count (visible in transaction metadata)
    trace_num(SBUF("Payment count:"), count);

    accept(SBUF("Payment counted."), 0);
    return 0;
}
```

### Emitting Transactions from Hooks

Hooks can emit new transactions — enabling auto-forwarding, fee splitting, and more:

```c
// auto_forward_hook.c — Forwards 10% of incoming payments to another account
#include "hookapi.h"

int64_t hook(uint32_t reserved) {
    int64_t tt = otxn_type();
    if (tt != 0) {
        accept(SBUF("Not a payment."), 0);
        return 0;
    }

    // Get payment amount
    int64_t amount_drops = otxn_amount();

    // Calculate 10% forward amount
    int64_t forward_amount = amount_drops / 10;

    if (forward_amount < 1000000) { // Less than 1 XRP, skip
        accept(SBUF("Amount too small to forward."), 0);
        return 0;
    }

    // Forward destination (hardcoded for this example)
    uint8_t dest_acc[20];
    // In production, read this from Hook parameters
    int64_t param_result = hook_param(SBUF(dest_acc), SBUF("dest"));

    if (param_result < 0) {
        accept(SBUF("No forward destination configured."), 0);
        return 0;
    }

    // Emit a new payment transaction
    etxn_reserve(1); // Reserve space for 1 emitted transaction

    uint8_t emithash[32];
    int64_t emit_result = emit(SBUF(emithash), /* emit buffer built here */);

    accept(SBUF("Payment forwarded."), 0);
    return 0;
}
```

## Common Pitfalls

1. **Using Hooks for things XRPL handles natively** — Escrow, DEX offers, payment channels, and checks are all built into the protocol. Writing a Hook to replicate these wastes execution budget and adds complexity. Check native transaction types first.

2. **Exceeding Hook execution limits** — Hooks have strict resource limits: max 65,536 instructions per execution. Complex loops or large data processing will hit the limit and cause the Hook to abort. Keep logic minimal and focused.

3. **Forgetting Hook state costs reserves** — Each state entry a Hook creates costs 2 XRP in owner reserve on the account. A Hook that creates unbounded state entries will eventually lock all the account's XRP in reserves.

4. **Not testing on Hooks testnet** — Hooks are not yet on XRPL mainnet. They run on a separate Hooks-enabled testnet (`hooks-testnet-v3.xrpl-labs.com`). Code that works on regular testnet won't have Hook support.

5. **Ignoring the HookOn bitmask** — The `HookOn` field controls which transaction types trigger the Hook. Setting it to all-zeros triggers on everything, which may cause unexpected behavior. Be specific about which transaction types your Hook should intercept.

## What to Learn Next

- [Token Issuance](./04-token-issuance.md) — Create trust lines, issue custom currencies, and mint NFTs on XRPL
- [XRPL Hooks Documentation](https://xrpl-hooks.readme.io/) — Official Hooks API reference
- [Hooks Builder Playground](https://hooks-builder.xrpl.org/) — Browser-based Hook development environment
