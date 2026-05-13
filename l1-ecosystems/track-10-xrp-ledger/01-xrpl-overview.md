# XRP Ledger Overview and Architecture

**Track:** XRP Ledger Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to build payment applications with near-instant settlement and built-in exchange capabilities, but you're not sure how XRP Ledger differs from EVM chains. XRPL doesn't use smart contracts in the traditional sense — it has a built-in decentralized exchange, native payment channels, and a unique consensus model. Without understanding these architectural choices, you'll try to force Ethereum patterns onto a ledger designed for a fundamentally different purpose.

## Core Concepts

### XRPL Architecture

XRP Ledger is a purpose-built payment and exchange layer that's been running since 2012. Unlike general-purpose smart contract platforms, XRPL bakes financial primitives directly into the protocol:

```
┌─────────────────────────────────────────────────┐
│              XRP Ledger Architecture             │
├─────────────────────────────────────────────────┤
│                                                 │
│  Consensus Layer (Federated Byzantine Agreement)│
│  └── Unique Node List (UNL) validators          │
│  └── 3-5 second ledger close time               │
│  └── No mining, no staking                      │
│                                                 │
│  Protocol-Level Features (Built-in)             │
│  └── Decentralized Exchange (DEX)               │
│  └── Payment Channels                           │
│  └── Escrow                                     │
│  └── Trust Lines & Issued Currencies            │
│  └── NFTs (XLS-20)                              │
│  └── Hooks (Smart Contract Layer)               │
│                                                 │
│  Account Model                                  │
│  └── Base reserve: 10 XRP                       │
│  └── Owner reserve: 2 XRP per object            │
│  └── Sequence numbers for replay protection     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Federated Consensus (Not PoW, Not PoS)

XRPL uses the XRP Ledger Consensus Protocol — a federated Byzantine agreement system:

```javascript
// xrpl.js@3.0.0 — Connecting to XRPL and checking ledger state
const xrpl = require("xrpl");

async function checkLedgerState() {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  // Get the latest validated ledger
  const ledgerResponse = await client.request({
    command: "ledger",
    ledger_index: "validated",
    transactions: false,
  });

  console.log("Ledger Index:", ledgerResponse.result.ledger.ledger_index);
  console.log("Close Time:", ledgerResponse.result.ledger.close_time_human);
  console.log("Transaction Count:", ledgerResponse.result.ledger.txn_count);

  await client.disconnect();
}

checkLedgerState().catch(console.error);
```

Key differences from PoW/PoS:

| Property | XRPL Consensus | Ethereum PoS | Bitcoin PoW |
|----------|---------------|--------------|-------------|
| Finality | 3-5 seconds (absolute) | ~13 min (probabilistic) | ~60 min (probabilistic) |
| Energy | Negligible | Low | Extremely high |
| Validators | ~150 UNL nodes | ~900,000 | ~15,000 miners |
| Fork risk | None (by design) | Possible | Possible |
| Cost to transact | ~0.00001 XRP ($0.00001) | $1-50 | $1-30 |

Each validator maintains a Unique Node List (UNL) — a set of trusted validators. Consensus is reached when 80%+ of a validator's UNL agrees on a transaction set. This means no forks, deterministic finality, and no wasted energy.

### Built-in Decentralized Exchange (DEX)

XRPL has a native order-book DEX at the protocol level. No smart contracts needed:

```javascript
// xrpl.js@3.0.0 — Querying the built-in DEX order book
const xrpl = require("xrpl");

async function getOrderBook() {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  // Get USD/XRP order book (USD issued by a gateway)
  const orderBook = await client.request({
    command: "book_offers",
    taker_gets: { currency: "XRP" },
    taker_pays: {
      currency: "USD",
      issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B", // Bitstamp
    },
    limit: 5,
  });

  console.log("Top 5 offers (selling XRP for USD):");
  orderBook.result.offers.forEach((offer, i) => {
    const xrpAmount = xrpl.dropsToXrp(offer.TakerGets);
    console.log(`  ${i + 1}. ${xrpAmount} XRP @ ${offer.quality}`);
  });

  await client.disconnect();
}

getOrderBook().catch(console.error);
```

### Payment Channels

Payment channels enable off-ledger micropayments with on-ledger settlement:

```javascript
// xrpl.js@3.0.0 — Creating a payment channel
const xrpl = require("xrpl");

async function createPaymentChannel(wallet, destination) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const channelCreate = {
    TransactionType: "PaymentChannelCreate",
    Account: wallet.address,
    Amount: xrpl.xrpToDrops("100"), // Fund channel with 100 XRP
    Destination: destination,
    SettleDelay: 86400, // 24-hour dispute window
    PublicKey: wallet.publicKey,
  };

  const prepared = await client.autofill(channelCreate);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  console.log("Channel created:", result.result.meta.TransactionResult);
  await client.disconnect();
  return result;
}
```

### Account Reserves

XRPL requires accounts to hold minimum XRP balances:

- **Base reserve**: 10 XRP to activate an account
- **Owner reserve**: 2 XRP per ledger object (trust lines, offers, escrows)

This prevents ledger spam but means creating accounts has a real cost. An account with 3 trust lines and 2 open DEX offers needs: 10 + (5 × 2) = 20 XRP minimum.

## Common Pitfalls

1. **Treating XRPL like an EVM chain** — XRPL doesn't have general-purpose smart contracts (Hooks are limited). The DEX, escrow, and payment channels are protocol-level features, not deployed contracts. You configure them via transaction types, not Solidity.

2. **Forgetting account reserves** — Every trust line and DEX offer locks 2 XRP. If you create many objects, your account's available balance drops. Users can't spend reserved XRP until they remove the objects.

3. **Ignoring the destination tag** — Exchanges use a single XRP address for all customers, distinguished by a numeric destination tag. Sending XRP without the required tag means lost funds with no recovery path.

4. **Assuming XRP amounts are in XRP** — The protocol uses "drops" (1 XRP = 1,000,000 drops). Passing `100` when you mean 100 XRP actually sends 0.0001 XRP. Always use `xrpl.xrpToDrops()` and `xrpl.dropsToXrp()`.

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install xrpl.js, connect to testnet, and fund a wallet from the faucet
- [XRPL Documentation](https://xrpl.org/docs.html) — Official protocol reference and tutorials
- [XRPL Explorer](https://livenet.xrpl.org/) — Browse live ledger state and transactions
