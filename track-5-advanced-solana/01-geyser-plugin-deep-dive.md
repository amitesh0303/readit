# Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data

**Track:** Expert  
**Read time:** 13 min

---

## The Problem

You're building a liquidation bot for a Solana lending protocol. You need to know the moment any user's health factor drops below 1.0. Polling every account every second is too slow (you'll miss liquidations) and too expensive (thousands of RPC calls per minute). You need real-time streaming of account changes.

Or you're building an indexer. You need to capture every transaction that touches your program, in order, with no gaps. WebSocket subscriptions miss events during reconnects. You need something more reliable.

Geyser is Solana's answer to both problems. It's a plugin interface that lets you stream raw validator data — account updates, transactions, blocks — directly from a validator node. This blog explains how it works and how to build on top of it.

---

## Core Concepts

### What Geyser Is

Geyser is a plugin interface built into the Solana validator. When enabled, it calls your plugin's functions every time:
- An account is updated
- A transaction is processed
- A block is completed
- A slot changes status (processed → confirmed → finalized)

```
Solana Validator
    ├── Consensus (PoH, voting)
    ├── Transaction processing
    └── Geyser Plugin Interface
            ↓ (every account update, tx, block)
        Your Plugin (Rust shared library)
            ↓
        Your downstream system (Kafka, PostgreSQL, Redis, gRPC)
```

Geyser runs inside the validator process — it's not an RPC call. This means zero latency between the validator processing a transaction and your plugin receiving it.

### Geyser vs WebSocket Subscriptions

| | Geyser | WebSocket (`accountSubscribe`) |
|--|--------|-------------------------------|
| Latency | ~0ms (in-process) | ~50-200ms (RPC round trip) |
| Reliability | No missed events | Can miss events on reconnect |
| Data completeness | All accounts, all txs | Only subscribed accounts |
| Infrastructure | Requires validator access | Any RPC endpoint |
| Cost | Run your own validator | Pay RPC provider |

Geyser is for protocols that need guaranteed, low-latency data. WebSocket subscriptions are fine for frontends and simple bots.

### Yellowstone gRPC: Geyser Over the Network

Running your own validator is expensive (~$10,000+/month for a high-performance setup). Yellowstone gRPC (by Triton One) exposes Geyser data over a gRPC interface, letting you subscribe to validator data without running your own node.

Helius, Triton, and other providers offer Yellowstone gRPC endpoints. This is the practical way most teams access Geyser data.

```
Solana Validator
    └── Geyser Plugin (Yellowstone)
            ↓ gRPC stream
        Your Application (Node.js, Rust, Python)
```

### What Data You Get

**Account updates:**
```
AccountUpdate {
    pubkey: Pubkey,
    lamports: u64,
    owner: Pubkey,
    executable: bool,
    rent_epoch: u64,
    data: Vec<u8>,      // raw account data
    write_version: u64, // monotonically increasing version
    slot: u64,
    is_startup: bool,   // true for initial snapshot
}
```

**Transaction updates:**
```
TransactionUpdate {
    signature: Signature,
    is_vote: bool,
    transaction: Transaction,
    transaction_status_meta: TransactionStatusMeta,
    slot: u64,
    index: u64,
}
```

---

## Code Walkthrough

Subscribing to Geyser data via Yellowstone gRPC in Node.js:

```typescript
import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

const GRPC_ENDPOINT = "https://your-yellowstone-endpoint.com:10000";
const GRPC_TOKEN = "your-api-token";

// Your program ID and account discriminators
const PROGRAM_ID = new PublicKey("YourProgramId111111111111111111111111111111");

// Anchor discriminator for UserPosition account (first 8 bytes of sha256("account:UserPosition"))
const USER_POSITION_DISCRIMINATOR = Buffer.from([/* 8 bytes */]);

async function streamAccountUpdates() {
  const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {});
  const stream = await client.subscribe();

  // Build subscription request
  const request: SubscribeRequest = {
    accounts: {
      // Subscribe to all accounts owned by your program
      myProgram: {
        account: [],           // empty = all accounts
        owner: [PROGRAM_ID.toBase58()],
        filters: [
          {
            // Only UserPosition accounts (filter by discriminator)
            memcmp: {
              offset: "0",
              data: USER_POSITION_DISCRIMINATOR.toString("base64"),
              encoding: "base64",
            },
          },
        ],
      },
    },
    transactions: {
      // Subscribe to all transactions involving your program
      myProgramTxs: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: [PROGRAM_ID.toBase58()],
        accountExclude: [],
        accountRequired: [],
      },
    },
    slots: {
      // Subscribe to slot status changes
      slots: { filterByCommitment: true },
    },
    commitment: CommitmentLevel.CONFIRMED,
    // Required empty objects for unused subscription types
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    ping: undefined,
  };

  // Send subscription request
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log("Subscribed to Geyser stream");

  // Process incoming updates
  stream.on("data", async (update: SubscribeUpdate) => {
    if (update.account) {
      await handleAccountUpdate(update.account);
    }
    if (update.transaction) {
      await handleTransaction(update.transaction);
    }
    if (update.slot) {
      handleSlotUpdate(update.slot);
    }
  });

  stream.on("error", (err: Error) => {
    console.error("Stream error:", err);
    // Implement reconnection logic
    setTimeout(() => streamAccountUpdates(), 5000);
  });

  stream.on("end", () => {
    console.log("Stream ended, reconnecting...");
    setTimeout(() => streamAccountUpdates(), 1000);
  });
}

// ── Account Update Handler ─────────────────────────────────────────────────

interface UserPosition {
  owner: PublicKey;
  collateralAmount: bigint;
  debtAmount: bigint;
  lastUpdateSlot: bigint;
}

function decodeUserPosition(data: Buffer): UserPosition | null {
  try {
    // Skip 8-byte discriminator
    const offset = 8;
    const owner = new PublicKey(data.slice(offset, offset + 32));
    const collateralAmount = data.readBigUInt64LE(offset + 32);
    const debtAmount = data.readBigUInt64LE(offset + 40);
    const lastUpdateSlot = data.readBigUInt64LE(offset + 48);
    return { owner, collateralAmount, debtAmount, lastUpdateSlot };
  } catch {
    return null;
  }
}

async function handleAccountUpdate(update: any) {
  const pubkey = new PublicKey(update.account.pubkey);
  const data = Buffer.from(update.account.data);

  // Decode the account data
  const position = decodeUserPosition(data);
  if (!position) return;

  // Calculate health factor
  const healthFactor = calculateHealthFactor(
    position.collateralAmount,
    position.debtAmount
  );

  console.log(`Position ${pubkey.toBase58().slice(0, 8)}... HF: ${healthFactor.toFixed(3)}`);

  // Check if liquidatable
  if (healthFactor < 1.0) {
    console.log(`🚨 LIQUIDATABLE: ${pubkey.toBase58()}, HF: ${healthFactor}`);
    await triggerLiquidation(pubkey, position);
  }
}

function calculateHealthFactor(collateral: bigint, debt: bigint): number {
  if (debt === 0n) return Infinity;
  const LIQUIDATION_THRESHOLD = 0.825; // 82.5%
  return (Number(collateral) * LIQUIDATION_THRESHOLD) / Number(debt);
}

// ── Transaction Handler ────────────────────────────────────────────────────

async function handleTransaction(update: any) {
  const sig = Buffer.from(update.transaction.signature).toString("base64");
  const meta = update.transaction.meta;

  if (meta.err) {
    // Transaction failed — log but don't process
    return;
  }

  // Parse log messages to identify which instruction was called
  const logs: string[] = meta.logMessages ?? [];
  const instructionLog = logs.find((log) => log.includes("Instruction:"));

  if (instructionLog?.includes("Liquidate")) {
    console.log(`Liquidation executed: ${sig}`);
    // Update your database, notify monitoring, etc.
  }
}

function handleSlotUpdate(update: any) {
  if (update.status === "finalized") {
    // Slot is finalized — data at this slot is permanent
    // Safe to write to database as confirmed
  }
}

// ── Liquidation Bot ────────────────────────────────────────────────────────

async function triggerLiquidation(positionPubkey: PublicKey, position: UserPosition) {
  // Build and send liquidation transaction
  // This is where your liquidation logic goes
  console.log(`Triggering liquidation for ${positionPubkey.toBase58()}`);
}

streamAccountUpdates().catch(console.error);
```

**Handling the initial snapshot:**

```typescript
// When you first connect, Geyser sends a snapshot of all matching accounts
// (is_startup = true). After that, you receive incremental updates.
// You need to handle both cases:

let isInitialSnapshotComplete = false;
const positionCache = new Map<string, UserPosition>();

async function handleAccountUpdate(update: any) {
  const pubkey = new PublicKey(update.account.pubkey).toBase58();
  const data = Buffer.from(update.account.data);
  const position = decodeUserPosition(data);

  if (!position) return;

  if (update.account.isStartup) {
    // Initial snapshot — populate cache
    positionCache.set(pubkey, position);
    return;
  }

  if (!isInitialSnapshotComplete) {
    // Still receiving snapshot — buffer updates
    positionCache.set(pubkey, position);
    return;
  }

  // Incremental update — process immediately
  positionCache.set(pubkey, position);
  await checkLiquidation(pubkey, position);
}

// Called when snapshot is complete (Geyser sends a special ping)
function onSnapshotComplete() {
  isInitialSnapshotComplete = true;
  console.log(`Snapshot complete. Monitoring ${positionCache.size} positions.`);

  // Check all positions from snapshot
  for (const [pubkey, position] of positionCache) {
    checkLiquidation(pubkey, position);
  }
}
```

---

## Common Mistakes and Gotchas

**1. Not handling reconnections**  
gRPC streams disconnect. Network issues, server restarts, rate limits — all cause disconnections. Always implement exponential backoff reconnection. When you reconnect, you'll get a fresh snapshot — make sure your state handling accounts for this.

**2. Processing updates out of order**  
Geyser delivers updates in slot order, but network jitter can cause out-of-order delivery. Use `write_version` (for accounts) and `slot` + `index` (for transactions) to detect and handle out-of-order updates.

**3. Not filtering by discriminator**  
If you subscribe to all accounts owned by your program without a discriminator filter, you'll receive updates for every account type — including temporary accounts, closed accounts, and accounts from old program versions. Always filter by discriminator.

**4. Blocking the stream handler**  
Your `data` event handler must return quickly. If you do slow database writes or RPC calls inside it, you'll fall behind the stream and miss updates. Use a queue (Redis, Kafka, in-memory) to buffer updates and process them asynchronously.

**5. Ignoring `is_startup` flag**  
The initial snapshot can contain millions of accounts. If you try to process each one as a "new update" (e.g., trigger liquidation checks for all of them simultaneously), you'll overwhelm your system. Handle startup accounts differently from incremental updates.

---

## How This Connects to Production

Helius uses Geyser internally to power their enhanced transaction APIs and webhooks. Drift Protocol's liquidation bots use Geyser to monitor all user positions in real-time — they can detect and liquidate positions within milliseconds of them becoming undercollateralized. Tensor (NFT marketplace) uses Geyser to index all NFT transfers and listings in real-time. Triton One's Yellowstone gRPC is the standard way to access Geyser data without running your own validator. For any protocol where latency matters — liquidations, arbitrage, real-time analytics — Geyser is the right tool.

---

## What to Learn Next

- **Building a Solana Indexer from Scratch with Node.js and PostgreSQL** — use Geyser data to build a queryable database.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build the full liquidation bot on top of Geyser.
- **Pyth Network Oracle Integration: Real-Time Price Feeds on Solana** — combine Geyser account monitoring with real-time price feeds.
