# Subgraph Performance: Query Cost, Pagination, and Indexing Speed

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Your subgraph works in dev. Then you index a busy contract for a few months and queries start timing out. Indexing falls behind the chain. The dashboard that loads in 200ms locally takes 12 seconds against the production endpoint. This is the part of subgraph development tutorials gloss over and that real teams spend weeks fixing.

Performance has two axes: **indexing speed** (how fast the indexer keeps up with the chain) and **query speed** (how fast clients get answers). They're related but tuned differently. This lesson covers what makes each slow, what to measure, and the techniques that consistently help.


---

## Core Concepts

### What "indexing speed" actually measures

Indexing speed = blocks processed per second. A subgraph that processes 100 blocks/sec on Ethereum mainnet (12s/block) keeps up with the chain in real time. Less than that and the indexer falls progressively behind — users see stale data.

What slows indexing:

1. **Number of events to process per block.** Busy contracts → busy mappings.
2. **Cost of each handler.** Slow handlers compound across millions of events.
3. **Contract calls inside handlers.** Each `try_<method>` call does an `eth_call` against an archive node — easily 50-200ms.
4. **Number of dynamic data sources.** Each one adds to the indexer's bookkeeping per block.
5. **Disk I/O.** Postgres writes — each `entity.save()` hits storage.

The indexing dashboard (Subgraph Studio's deploy page) shows blocks/sec live. If it's < 50 on a chain with 12s blocks, you're not keeping up.

### Indexing speed wins

**Minimize contract calls in handlers.** Cache token metadata, cache anything else from view functions. The 5x speedup from avoiding `try_name()` on every Transfer is the single biggest gain in most subgraphs.

**Use immutable entities** (`@entity(immutable: true)`) wherever you can. The indexer skips change-tracking, which dramatically speeds up entity creation. Per-event entities (Swaps, Transfers, Mints) should always be immutable.

**Batch entity reads/writes.** If you load Pair, then load Token0, then load Token1, that's three separate Postgres queries. The graph-node's WASM runtime caches loaded entities for the duration of the handler — so loading the same entity twice is free, but loading three different ones is three queries.

**Don't store data you'll never query.** Every field is storage and bandwidth on writes. If you're not sure you need it, don't add it. You can always add fields later (forward-compatible) — but you can't remove them gracefully.

**Use grafted subgraphs** for fast iteration. If you've already indexed up to block 18M and you only want to add a new entity from block 18M onward, "graft" your new subgraph onto the old one. Avoids re-indexing the entire history.

### Query performance

The subgraph's GraphQL endpoint runs on top of Postgres. Every query becomes one or more SQL queries, with The Graph's planner deciding the joins. Some queries are O(1) lookups; some are sequential scans of millions of rows.

Fast query patterns:

- **Lookup by primary key**: `account(id: "0xalice...")` — direct index hit, milliseconds.
- **Filter by indexed field**: `transfers(where: { from: "0xalice..." })` — fast IF the field is indexed (more on this).
- **Sort by an indexed field with `first`**: `swaps(orderBy: timestamp orderDirection: desc, first: 50)` — index scan.

Slow query patterns:

- **Substring match on a string field**: `swaps(where: { id_contains: "abc" })` — table scan.
- **Sort by a non-indexed field**: doesn't have an index for it, must sort everything.
- **Skip large offsets**: `swaps(skip: 1000000, first: 100)` — Postgres has to scan past a million rows.

Cursor-based pagination instead of offset:

```graphql
{ swaps(where: { id_gt: $lastId } first: 100, orderBy: id) { id ... } }
```

Each page passes the last-seen ID as the bound for the next page. Constant time per page regardless of position.

### Indexes via `@indexed`

The Graph automatically indexes the primary key. For other fields you filter on, mark them indexed in the schema:

```graphql
type Transfer @entity(immutable: true) {
  id: ID!
  from: Account! @indexed
  to: Account! @indexed
  value: BigInt!
  timestamp: BigInt! @indexed
}
```

Querying `where: { from: "0x..." }` becomes an index hit. Without the `@indexed` annotation, it'd be a sequential scan.

Note: `@indexed` is supported in newer specVersions. In older versions the planner did its best without explicit hints. Always declare them now — it's free perf.

### Aggregations: don't query for them, store them

The biggest single perf rule: **GraphQL queries don't aggregate**. There's no SUM, no GROUP BY, no AVG at query time. If you want "total volume per day per pair," you precomputed it during indexing (covered in the time-series lesson). The query then is just "give me the precomputed entity."

Anywhere you find yourself wanting an aggregation at query time, that's a sign you need a new entity in your schema.

### Storage: the silent cost

Subgraph storage costs scale with entity count × entity size. A few practical numbers (rough, late 2025):

- An immutable Swap entity with 6-8 fields → ~300-500 bytes per row.
- A million swaps → ~400 MB of storage.
- The decentralized network charges per GB-day; the hosted service has its own quotas.

A Uniswap V3 subgraph storing every swap, every position-change, every fee-collection from launch is in the tens of GB. That's an operational cost to plan for.

Tradeoffs you'll make:
- Drop immutable entities you don't need (do you really need every Transfer for a token, or just Account balances?).
- Use `Bytes` instead of `String` where the data is hex (saves space).
- Consider truncating high-frequency entities — keep last 90 days of granular swaps, daily aggregates forever.

### Measuring before optimizing

Subgraph Studio (and the decentralized network) expose:

- **Indexing speed** (blocks/sec).
- **Sync progress** (current block vs head).
- **Query metrics** (P50/P99 latency, query count).
- **Errors** (handler failures with stack traces).

A common production setup: alert on "subgraph more than 100 blocks behind chain head" or "P99 query latency > 5s". Without alerts you'll only find out when users notice.

---

## Code Walkthrough

A "before and after" of a slow subgraph handler.

**Before** (slow):

```typescript
export function handleSwap(event: SwapEvent): void {
  let pair = Pair.load(event.address.toHex())!;
  let pairContract = Pair.bind(event.address);

  // 4 contract calls per swap
  pair.reserve0 = pairContract.try_getReserves().value.value0.toBigDecimal();
  pair.reserve1 = pairContract.try_getReserves().value.value1.toBigDecimal();
  pair.token0Symbol = ERC20.bind(event.params.token0).try_symbol().value;
  pair.token1Symbol = ERC20.bind(event.params.token1).try_symbol().value;
  pair.save();

  // Mutable Swap with extra fields
  let swap = new Swap(event.transaction.hash.toHex());
  swap.timestamp = event.block.timestamp;
  swap.allParticipants = pair.allParticipants; // unbounded array
  swap.allParticipants.push(event.params.to);
  swap.save();
}
```

Problems: 4 contract calls per swap, mutable Swap entity, unbounded array growth. On a busy pair with 100 swaps/block, this caps indexing speed at maybe 5 blocks/sec.

**After** (fast):

```typescript
// Pair created handler — runs ONCE per pair, caches metadata
export function handlePairCreated(event: PairCreatedEvent): void {
  let pair = new Pair(event.params.pair.toHex());
  pair.token0 = event.params.token0;
  pair.token1 = event.params.token1;
  pair.token0Symbol = symbolOf(event.params.token0);
  pair.token1Symbol = symbolOf(event.params.token1);
  pair.reserve0 = BigDecimal.fromString("0");
  pair.reserve1 = BigDecimal.fromString("0");
  pair.save();

  PairTemplate.create(event.params.pair);
}

function symbolOf(addr: Bytes): string {
  let result = ERC20.bind(changetype<Address>(addr)).try_symbol();
  return result.reverted ? "???" : result.value;
}

// Swap handler — no contract calls, immutable entity
export function handleSwap(event: SwapEvent): void {
  let pair = Pair.load(event.address.toHex());
  if (pair == null) return;

  // Reserves arrive in event params or via Sync; no extra call needed
  // (Uniswap V2 emits Sync alongside Swap)

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let swap = new Swap(id);  // immutable in the schema
  swap.pair = pair.id;
  swap.to = event.params.to;
  swap.amount0 = event.params.amount0In.plus(event.params.amount0Out).toBigDecimal();
  swap.amount1 = event.params.amount1In.plus(event.params.amount1Out).toBigDecimal();
  swap.timestamp = event.block.timestamp;
  swap.save();
}
```

Schema change to support this:

```graphql
type Swap @entity(immutable: true) {
  id: ID!
  pair: Pair! @indexed
  to: Bytes! @indexed
  amount0: BigDecimal!
  amount1: BigDecimal!
  timestamp: BigInt! @indexed
}
```

Now: zero contract calls in the hot path, immutable entities, indexed fields for the queries we expect. Indexing speed jumps an order of magnitude. Queries that filter by pair or by `to` are index-hit fast.

---

## Common Mistakes and Gotchas

**1. `try_<method>` calls in every handler**
The single biggest indexing slowdown. Cache contract metadata on creation; never re-fetch.

**2. Mutable entities used as if they were immutable**
If a Swap entity will never change after the swap event, mark it immutable. Indexing speed difference is real.

**3. Skipping `@indexed` on fields you filter by**
Filtered queries on un-indexed fields scan the table. Add `@indexed` proactively to any field used in `where:` clauses.

**4. Loading and re-saving entities you didn't change**
`pair.save()` after just reading does no harm but isn't free. Only save after meaningful mutations.

**5. Storing entities only to query them once and never again**
Storage cost compounds. If a per-event log entity is only ever queried for "show me last 100," consider keeping just the last 100 in a fixed-size set or a parent entity, not millions of standalone entities.

**6. Premature graft**
Grafting (carrying state from an old subgraph) can save reindex time, but if the old subgraph had bugs in the handler, the bugs persist. Only graft when you trust the historical state.

**7. Querying with `skip: 10000` for pagination**
Always use cursor-based pagination (filter by `id_gt: $lastId`). Skip-based gets exponentially slower.

**8. No monitoring for indexing lag**
Subgraphs silently fall behind during chain congestion or when contract activity spikes. Without monitoring, your dashboard quietly serves data from "yesterday." Set up sync-lag alerts.

---

## How This Connects to Production

Performance gaps cost real money on the decentralized network — slow queries are charged by execution time, slow syncing means re-indexing more often. They cost real users on hosted services — a dashboard that takes 5 seconds to load is a dashboard people stop using.

Most teams hit a "we've outgrown our subgraph" moment when traffic ramps up. The patterns in this lesson are how you avoid hitting that wall — design for performance from the start. When you do hit it, the next lesson is the deeper question: do you optimize the subgraph, or move to a custom indexer?

---

## What to Learn Next

- **Hosted Service vs Decentralized Network** — operational decisions about where to run your subgraph.
- **Migrating from a Subgraph to a Custom Indexer** — when subgraphs hit their limits.
- **Web3 Backend Engineering** (separate track) — the broader infrastructure question of where indexed data lives in your stack.
