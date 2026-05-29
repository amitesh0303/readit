# Migrating from a Subgraph to a Custom Indexer

**Track:** Intermediate
**Read time:** 7 min

---

## The Problem

Subgraphs are the right tool for ~80% of indexing needs. The remaining 20% — high-frequency trading apps needing sub-second freshness, custom analytics requiring cross-protocol joins, products with strong privacy requirements — outgrow subgraphs. AssemblyScript constrains your handler logic; the GraphQL API constrains your query patterns; the indexer's pace constrains your real-time-ness.

When subgraphs hit the wall, you build a custom indexer. This is what that migration actually looks like.

---

## Core Concepts

### Why subgraphs hit a ceiling

Three usual triggers:

1. **Sub-second freshness.** Subgraphs index in batches, with typical latency 10-60 seconds behind the chain. For a perps frontend or an MEV monitor, that's too slow.
2. **Complex queries.** GraphQL is fine for simple retrievals. For "join this protocol's positions with that protocol's prices, then aggregate by user across both chains" — you want SQL.
3. **Custom logic in handlers.** AssemblyScript is intentionally constrained. No async, no external HTTP, no arbitrary code. If your indexing logic needs to call your pricing service or your ML model, subgraphs can't help.

### The architecture of a custom indexer

A typical setup:

```
   ┌──────────────┐
   │ Archive Node │ ◄── you run this, or rent
   └──────┬───────┘
          │ eth_getLogs / eth_subscribe
          ▼
   ┌──────────────┐
   │ Event        │ ◄── your code
   │ Listener     │
   └──────┬───────┘
          │ writes
          ▼
   ┌──────────────┐
   │ Postgres     │ ◄── source of truth
   └──────┬───────┘
          │ reads
          ▼
   ┌──────────────┐
   │ API Service  │ ◄── REST / GraphQL / gRPC
   └──────┬───────┘
          │
          ▼
       Clients
```

The pieces:

- **Archive node** — same as a Graph Node setup. You need historical state.
- **Event listener** — your TypeScript / Go / Python service polling `eth_getLogs` or subscribed via WebSocket. Decodes events. Writes to Postgres.
- **Postgres** — schema you fully control. Use `INSERT ON CONFLICT` for idempotency. Use partitioning for time-series at scale.
- **API service** — your own backend exposing whatever interface fits your clients. REST, GraphQL, gRPC, WebSocket — all are options.


### Reorg handling: the part subgraphs do for you

Graph Node handles reorgs invisibly. Custom indexers must handle them explicitly.

The standard pattern: only treat events as "final" after N confirmations. Until then, store them in a "pending" state. On reorg, delete the pending entries and re-process from the new canonical chain.

```typescript
async function processBlock(block: Block) {
  // Check for reorg: does the parent of this block match what we have?
  const parent = await db.query("SELECT hash FROM blocks WHERE number = $1", [block.number - 1]);
  if (parent.rows[0]?.hash !== block.parentHash) {
    // Reorg! Roll back from the divergence point.
    await rollbackTo(block.number - 1);
  }

  // Process events in this block atomically
  await db.transaction(async (tx) => {
    for (const log of block.logs) {
      await processLog(tx, log);
    }
    await tx.query("INSERT INTO blocks (number, hash) VALUES ($1, $2)", [block.number, block.hash]);
  });
}
```

This is meaningful complexity. Subgraphs spared you from it. Custom indexers don't.

### Frameworks that handle the boilerplate

You don't have to roll everything yourself. Modern alternatives in 2026:

- **Ponder** — TypeScript-native. Handler functions like a subgraph but in real Node, with full SQL access. Reorg-safe by default. Most popular for new builds.
- **Subsquid** — TypeScript or Squid SDK, can pull from Subsquid's hosted archives (faster than RPC).
- **Goldsky Mirror** — managed: define your contract / events, get a Postgres or BigQuery output. No code.
- **Envio** — TypeScript / ReScript, fast.
- **DIY with viem + bullmq** — write event listeners directly. More work but maximum control.

Ponder, Subsquid, and Envio are the closest to "subgraph in TypeScript with full Node access." They handle reorgs, batching, schema migrations. You write the equivalent of a mapping function but in real TypeScript, and your output goes to your own Postgres.


---

## Code Walkthrough

A Ponder handler — equivalent to a subgraph mapping but in real TypeScript:

```typescript
// ponder.config.ts
import { createConfig } from "@ponder/core";
import { http } from "viem";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.RPC_URL!),
    },
  },
  contracts: {
    Pool: {
      network: "mainnet",
      abi: poolAbi,
      address: "0x...",
      startBlock: 19_000_000,
    },
  },
});

// src/index.ts
import { ponder } from "@/generated";

ponder.on("Pool:Swap", async ({ event, context }) => {
  const { db } = context;

  // Update pool — full Postgres semantics, including upsert
  await db.Pool.upsert({
    id: event.log.address,
    create: {
      totalVolume: event.args.amount0,
      swapCount: 1,
    },
    update: ({ current }) => ({
      totalVolume: current.totalVolume + event.args.amount0,
      swapCount: current.swapCount + 1,
    }),
  });

  // Insert the swap
  await db.Swap.create({
    id: `${event.log.transactionHash}-${event.log.logIndex}`,
    data: {
      pool: event.log.address,
      user: event.args.sender,
      amount: event.args.amount0,
      timestamp: Number(event.block.timestamp),
    },
  });

  // You can do anything Node can do — call APIs, fetch prices, run ML
  if (event.args.amount0 > parseEther("100")) {
    await sendSlackAlert(`Big swap: ${event.args.amount0}`);
  }
});
```

Ponder generates TypeScript types from your ABI, handles reorgs, gives you a managed Postgres, and exposes a GraphQL API for free. The main difference from subgraphs: you can do anything Node can do inside a handler — async network calls, third-party SDKs, custom math. The cost: you're operating your own infrastructure.


---

## Common Mistakes and Gotchas

**1. Migrating before you need to**
Custom indexers are operationally expensive. If your subgraph is working, leave it alone. Only migrate when subgraphs are actually limiting you — slow queries, missed real-time, complex joins.

**2. Forgetting to handle reorgs in DIY indexers**
Subgraphs do this for free. Your custom indexer must. Skipping reorg handling produces silently wrong data after every reorg.

**3. Using only RPC for backfilling**
Backfilling 12 months of events via RPC `getLogs` is painful — pagination, rate limits, ordering. Use a service like Subsquid's archives, or go directly to Erigon snapshots, or use a dedicated indexer.

**4. Skipping schema migrations**
Production indexers run for years; the schema will change. Plan for migrations from day one. Tools: Prisma, Drizzle, plain SQL migration files. Don't ALTER TABLE in production without a plan.

**5. Storing too much**
A custom indexer can store way more data than you'd put in a subgraph. Easy to end up with 5TB of historical state because "you never know." Decide retention policies upfront.

**6. Not monitoring lag**
Your indexer can fall behind silently. Build a `lag = chainHead - indexerHead` metric and alert when it climbs over a threshold.

---

## How This Connects to Production

The custom-indexer move is what most production protocols make once they cross meaningful query volume. Hyperliquid, dYdX, and most active perps platforms run their own indexers because subgraphs can't deliver the freshness they need. Most large NFT marketplaces and DEX aggregators do too.

The thing to remember: it's a tradeoff, not a "leveling up." Subgraphs give you a lot for free. Custom indexers give you control for a price. Pick based on what you actually need, not on what feels more sophisticated.

---

## What to Learn Next

You've now finished the subgraph-development track. From here:

- **Web3 Backend Engineering** (separate track) — the broader picture of running indexers, APIs, and tx orchestration.
- **AI Developer Tooling** (separate track) — using MCPs and agents to make indexer development faster.
- **Hosted Service vs Decentralized Network** (previous lesson) — the deployment-side decision.
