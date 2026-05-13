# Building a Solana Indexer from Scratch with Node.js and PostgreSQL

**Track:** Expert  
**Read time:** 14 min

---

## The Problem

Your Solana protocol has been live for a month. Users want to see their transaction history, position history, and analytics. You can't query this from the chain efficiently — Solana doesn't have a queryable state history. You need an indexer: a service that reads on-chain data and stores it in a database you can query.

The Graph Protocol supports Solana but has limitations. Building your own indexer gives you full control over the data model, query performance, and update latency. This blog builds a production-grade indexer from scratch.

---

## Core Concepts

### What an Indexer Does

```
Solana Validator
    ↓ (Geyser stream or RPC polling)
Indexer Service (Node.js)
    ↓ (parse, transform, store)
PostgreSQL Database
    ↓ (SQL queries)
Your API / Frontend
```

An indexer:
1. Receives raw on-chain data (transactions, account updates)
2. Parses and decodes it (using your program's IDL)
3. Stores it in a structured database
4. Handles reorgs (slot rollbacks)
5. Exposes it via an API

### Indexing Strategies

**Transaction-based indexing**: parse every transaction that involves your program. Good for event-driven data (swaps, deposits, withdrawals).

**Account-based indexing**: subscribe to account updates and store the current state. Good for position data, balances, configuration.

**Hybrid**: most production indexers use both — account updates for current state, transactions for history.

### Handling Reorgs

Solana can reorg (reorganize) slots. A transaction that appeared confirmed can be rolled back if the validator switches to a different fork. Your indexer must handle this:

```
Slot 1000: confirmed → write to DB
Slot 1001: confirmed → write to DB
Slot 1000: REORGED → must rollback DB changes from slot 1000
Slot 1000 (new): confirmed → write new version to DB
```

The solution: track slot status (processed → confirmed → finalized) and only make permanent writes at finalized status. Or use a staging table for confirmed data and promote to final at finalized.

---

## Code Walkthrough

Complete indexer implementation:

```typescript
// src/indexer/index.ts
import { Pool } from "pg";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import IDL from "../idl/my_protocol.json";

// ── Database Setup ─────────────────────────────────────────────────────────

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

async function initDatabase() {
  await db.query(`
    -- Tracks processed slots for reorg detection
    CREATE TABLE IF NOT EXISTS slots (
      slot BIGINT PRIMARY KEY,
      status VARCHAR(20) NOT NULL,  -- 'processed' | 'confirmed' | 'finalized'
      parent_slot BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Swap events from your protocol
    CREATE TABLE IF NOT EXISTS swaps (
      id SERIAL PRIMARY KEY,
      signature VARCHAR(88) NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time TIMESTAMPTZ,
      trader VARCHAR(44) NOT NULL,
      token_in VARCHAR(44) NOT NULL,
      token_out VARCHAR(44) NOT NULL,
      amount_in NUMERIC NOT NULL,
      amount_out NUMERIC NOT NULL,
      fee NUMERIC NOT NULL,
      finalized BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Current position state (account-based)
    CREATE TABLE IF NOT EXISTS positions (
      pubkey VARCHAR(44) PRIMARY KEY,
      owner VARCHAR(44) NOT NULL,
      collateral_amount NUMERIC NOT NULL,
      debt_amount NUMERIC NOT NULL,
      health_factor NUMERIC,
      last_update_slot BIGINT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Position history (for charts/analytics)
    CREATE TABLE IF NOT EXISTS position_history (
      id SERIAL PRIMARY KEY,
      pubkey VARCHAR(44) NOT NULL,
      slot BIGINT NOT NULL,
      collateral_amount NUMERIC NOT NULL,
      debt_amount NUMERIC NOT NULL,
      health_factor NUMERIC,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_swaps_trader ON swaps(trader);
    CREATE INDEX IF NOT EXISTS idx_swaps_slot ON swaps(slot);
    CREATE INDEX IF NOT EXISTS idx_positions_owner ON positions(owner);
    CREATE INDEX IF NOT EXISTS idx_position_history_pubkey ON position_history(pubkey);
    CREATE INDEX IF NOT EXISTS idx_position_history_slot ON position_history(slot);
  `);

  console.log("Database initialized");
}

// ── Transaction Parser ─────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(IDL.metadata.address);
const programInterface = new anchor.BorshInstructionCoder(IDL as anchor.Idl);
const eventParser = new anchor.EventParser(PROGRAM_ID, new anchor.BorshCoder(IDL as anchor.Idl));

interface ParsedSwap {
  signature: string;
  slot: number;
  blockTime: Date | null;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
}

function parseSwapTransaction(update: any): ParsedSwap | null {
  try {
    const sig = Buffer.from(update.transaction.signature).toString("base64");
    const meta = update.transaction.meta;

    if (meta.err) return null; // skip failed transactions

    const logs: string[] = meta.logMessages ?? [];

    // Use Anchor's event parser to extract typed events from logs
    const events: any[] = [];
    eventParser.parseLogs(logs, (event) => events.push(event));

    const swapEvent = events.find((e) => e.name === "Swap");
    if (!swapEvent) return null;

    return {
      signature: sig,
      slot: update.slot,
      blockTime: update.transaction.blockTime
        ? new Date(update.transaction.blockTime * 1000)
        : null,
      trader: new PublicKey(swapEvent.data.trader).toBase58(),
      tokenIn: new PublicKey(swapEvent.data.tokenIn).toBase58(),
      tokenOut: new PublicKey(swapEvent.data.tokenOut).toBase58(),
      amountIn: BigInt(swapEvent.data.amountIn.toString()),
      amountOut: BigInt(swapEvent.data.amountOut.toString()),
      fee: BigInt(swapEvent.data.fee.toString()),
    };
  } catch (err) {
    console.error("Failed to parse transaction:", err);
    return null;
  }
}

// ── Account Decoder ────────────────────────────────────────────────────────

interface Position {
  pubkey: string;
  owner: string;
  collateralAmount: bigint;
  debtAmount: bigint;
  lastUpdateSlot: bigint;
}

const accountCoder = new anchor.BorshAccountsCoder(IDL as anchor.Idl);

function decodePosition(pubkey: string, data: Buffer): Position | null {
  try {
    const decoded = accountCoder.decode("UserPosition", data);
    return {
      pubkey,
      owner: decoded.owner.toBase58(),
      collateralAmount: BigInt(decoded.collateralAmount.toString()),
      debtAmount: BigInt(decoded.debtAmount.toString()),
      lastUpdateSlot: BigInt(decoded.lastUpdateSlot.toString()),
    };
  } catch {
    return null;
  }
}

// ── Database Writers ───────────────────────────────────────────────────────

async function writeSwap(swap: ParsedSwap, client: any) {
  await client.query(
    `INSERT INTO swaps (
      signature, slot, block_time, trader, token_in, token_out,
      amount_in, amount_out, fee
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (signature) DO NOTHING`,
    [
      swap.signature,
      swap.slot,
      swap.blockTime,
      swap.trader,
      swap.tokenIn,
      swap.tokenOut,
      swap.amountIn.toString(),
      swap.amountOut.toString(),
      swap.fee.toString(),
    ]
  );
}

async function writePosition(position: Position, slot: number, client: any) {
  const healthFactor =
    position.debtAmount > 0n
      ? (Number(position.collateralAmount) * 0.825) / Number(position.debtAmount)
      : null;

  // Upsert current state
  await client.query(
    `INSERT INTO positions (pubkey, owner, collateral_amount, debt_amount, health_factor, last_update_slot, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (pubkey) DO UPDATE SET
       collateral_amount = EXCLUDED.collateral_amount,
       debt_amount = EXCLUDED.debt_amount,
       health_factor = EXCLUDED.health_factor,
       last_update_slot = EXCLUDED.last_update_slot,
       updated_at = NOW()
     WHERE positions.last_update_slot < EXCLUDED.last_update_slot`,
    [
      position.pubkey,
      position.owner,
      position.collateralAmount.toString(),
      position.debtAmount.toString(),
      healthFactor,
      position.lastUpdateSlot.toString(),
    ]
  );

  // Append to history (for time-series queries)
  await client.query(
    `INSERT INTO position_history (pubkey, slot, collateral_amount, debt_amount, health_factor)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [
      position.pubkey,
      slot,
      position.collateralAmount.toString(),
      position.debtAmount.toString(),
      healthFactor,
    ]
  );
}

// ── Reorg Handler ──────────────────────────────────────────────────────────

async function handleSlotUpdate(update: any) {
  const { slot, status, parent } = update.slot;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Track slot status
    await client.query(
      `INSERT INTO slots (slot, status, parent_slot)
       VALUES ($1, $2, $3)
       ON CONFLICT (slot) DO UPDATE SET status = EXCLUDED.status`,
      [slot, status, parent]
    );

    if (status === "finalized") {
      // Mark all data from this slot as finalized (permanent)
      await client.query(
        "UPDATE swaps SET finalized = TRUE WHERE slot = $1",
        [slot]
      );

      // Clean up old unfinalized data (reorged slots)
      // Any slot older than finalized that isn't finalized was reorged
      await client.query(
        `DELETE FROM swaps
         WHERE slot < $1 AND finalized = FALSE`,
        [slot]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Main Indexer Loop ──────────────────────────────────────────────────────

// Update queue to avoid blocking the stream
const updateQueue: any[] = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || updateQueue.length === 0) return;
  isProcessing = true;

  const batch = updateQueue.splice(0, 100); // process 100 at a time
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    for (const update of batch) {
      if (update.type === "transaction") {
        const swap = parseSwapTransaction(update.data);
        if (swap) await writeSwap(swap, client);
      } else if (update.type === "account") {
        const pubkey = new PublicKey(update.data.account.pubkey).toBase58();
        const data = Buffer.from(update.data.account.data);
        const position = decodePosition(pubkey, data);
        if (position) await writePosition(position, update.data.slot, client);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Batch processing error:", err);
  } finally {
    client.release();
    isProcessing = false;
    // Continue processing if more items arrived
    if (updateQueue.length > 0) setImmediate(processQueue);
  }
}

async function startIndexer() {
  await initDatabase();

  const geyserClient = new Client(
    process.env.GRPC_ENDPOINT!,
    process.env.GRPC_TOKEN!,
    {}
  );

  const stream = await geyserClient.subscribe();

  stream.write({
    accounts: {
      positions: {
        account: [],
        owner: [PROGRAM_ID.toBase58()],
        filters: [{ memcmp: { offset: "0", data: "base64_discriminator", encoding: "base64" } }],
      },
    },
    transactions: {
      programTxs: {
        vote: false,
        failed: false,
        accountInclude: [PROGRAM_ID.toBase58()],
        accountExclude: [],
        accountRequired: [],
      },
    },
    slots: { slots: { filterByCommitment: true } },
    commitment: CommitmentLevel.CONFIRMED,
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
  });

  stream.on("data", (update: any) => {
    // Push to queue — don't block the stream
    if (update.transaction) {
      updateQueue.push({ type: "transaction", data: update });
    } else if (update.account) {
      updateQueue.push({ type: "account", data: update });
    } else if (update.slot) {
      handleSlotUpdate(update).catch(console.error);
    }

    setImmediate(processQueue);
  });

  stream.on("error", (err: Error) => {
    console.error("Stream error:", err);
    setTimeout(startIndexer, 5000);
  });

  console.log("Indexer started");
}

startIndexer().catch(console.error);
```

---

## Common Mistakes and Gotchas

**1. Writing to the database synchronously in the stream handler**  
The stream delivers data faster than you can write to PostgreSQL. If you write synchronously, you'll fall behind and eventually run out of memory. Always use a queue and process asynchronously.

**2. Not handling duplicate events**  
Geyser can deliver the same event twice (on reconnect, during reorgs). Always use `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE` in your INSERT statements. Use the transaction signature as a unique key for transaction data.

**3. Storing raw bigints as JavaScript numbers**  
JavaScript numbers lose precision above 2^53. Solana amounts are u64 (up to 2^64). Always store amounts as strings or use PostgreSQL's `NUMERIC` type. Never use JavaScript `Number()` for token amounts.

**4. Not tracking slot finality**  
Data at "confirmed" slots can be reorged. Only data at "finalized" slots is permanent. If you write confirmed data to your database without tracking finality, you'll have incorrect data after reorgs. Always track slot status and handle rollbacks.

**5. Ignoring the startup snapshot**  
When you first connect, Geyser sends all matching accounts as a snapshot. This can be millions of accounts. If you process each one as a "new update" and write to the database, you'll overwhelm PostgreSQL. Use bulk inserts (`COPY` or multi-row `INSERT`) for the initial snapshot.

---

## How This Connects to Production

Helius's enhanced transaction API is built on top of a Geyser-based indexer similar to what's described here. Birdeye (Solana analytics) indexes all DEX transactions across every Solana protocol. Solscan's transaction history is powered by a custom indexer. Drift Protocol's analytics dashboard queries an internal indexer for position history and PnL calculations. The pattern — Geyser → queue → PostgreSQL → API — is the standard architecture for Solana data infrastructure.

---

## What to Learn Next

- **Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data** — the data source for your indexer.
- **The Graph Protocol vs Custom Indexers: When to Use Each** — understand when to build vs buy.
- **Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale** — deploy your indexer to production.
