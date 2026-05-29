# Subgraph Anatomy: Manifest, Schema, and Mappings

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Reading on-chain history through RPC is painful at scale. "Show me every Transfer event for this token in the last year" is a million-event query that no public RPC will let you do efficiently. You'd spend hours iterating `getLogs` calls and stitching pages together.

The Graph solves this by maintaining a **subgraph** — a continuously-updated database, defined by you, populated by event handlers you write, queried via GraphQL. You define what to index and how to shape the data; The Graph runs an indexer that follows the chain and keeps your database fresh. Every major DeFi protocol (Uniswap, Aave, Compound, Lido) has a public subgraph that powers their UI's history pages.

This first lesson is the three pieces that make up every subgraph: the manifest (what to watch), the schema (what to store), and the mappings (how to transform events into stored entities).


---

## Core Concepts

### The three files

A subgraph repo has three things:

1. **`subgraph.yaml`** — the manifest. Lists which contracts to watch, which events to react to, and which mapping function handles each.
2. **`schema.graphql`** — the entity schema. Defines the data shape your indexer produces and that clients query.
3. **`src/mapping.ts`** — the mappings. AssemblyScript (a TypeScript-flavored language compiled to WASM) functions that transform events into entity writes.

The Graph's tooling (`graph-cli`) takes these three, generates types from your ABIs, compiles the mappings to WASM, and uploads everything to the indexer.

### The manifest

Looking at a real example:

```yaml
specVersion: 1.2.0
schema:
  file: ./schema.graphql

dataSources:
  - kind: ethereum
    name: USDC
    network: mainnet
    source:
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
      abi: ERC20
      startBlock: 6082465
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Transfer
        - Account
      abis:
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
      file: ./src/mapping.ts
```

What this says: "Index the USDC contract starting at the block it was deployed; whenever it emits a `Transfer(from, to, value)` event, run my `handleTransfer` function. The handler can read/write `Transfer` and `Account` entities, defined in the schema."

`startBlock` is the optimization that matters most. Set it too low and the indexer scans years of empty history before reaching your contract's deployment. Set it correctly and indexing starts right at the contract's first block.

### The schema

GraphQL schema with subgraph-specific directives:

```graphql
type Account @entity {
  id: ID!                # the account address (lowercase hex)
  balance: BigInt!
  transferCount: Int!
  transfersOut: [Transfer!]! @derivedFrom(field: "from")
  transfersIn: [Transfer!]! @derivedFrom(field: "to")
}

type Transfer @entity(immutable: true) {
  id: ID!                # txHash + logIndex
  from: Account!
  to: Account!
  value: BigInt!
  blockNumber: BigInt!
  timestamp: BigInt!
  transactionHash: Bytes!
}
```

Every entity needs a primary key field called `id`. The convention: for tokens or accounts, use the lowercase hex address. For per-event entities, use `txHash-logIndex`. For derived stats keyed by time, use `address-timestamp` or similar composite keys.

`@entity(immutable: true)` is a performance hint: this entity is never updated after creation. The indexer can skip change-tracking, which makes append-heavy entities (like Transfer events) much faster.

`@derivedFrom` defines reverse relations without storing them. Querying `account.transfersIn` resolves to "all Transfer entities where `to == this account`."

### Mappings

The mappings are AssemblyScript functions that the indexer calls when matching events fire. AssemblyScript looks like TypeScript but compiles to WASM and has stricter typing — there's no `null` (you use `null`-checked types), no exceptions in normal flow, and arithmetic is on `BigInt` for any 256-bit values:

```typescript
import { Transfer as TransferEvent } from "../generated/USDC/ERC20";
import { Account, Transfer } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

export function handleTransfer(event: TransferEvent): void {
  // Look up or create the from/to Account entities
  let fromAcc = loadOrCreateAccount(event.params.from.toHex());
  let toAcc = loadOrCreateAccount(event.params.to.toHex());

  fromAcc.balance = fromAcc.balance.minus(event.params.value);
  toAcc.balance = toAcc.balance.plus(event.params.value);
  fromAcc.transferCount = fromAcc.transferCount + 1;
  toAcc.transferCount = toAcc.transferCount + 1;

  fromAcc.save();
  toAcc.save();

  // Record the transfer event itself (immutable entity)
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let transfer = new Transfer(id);
  transfer.from = fromAcc.id;
  transfer.to = toAcc.id;
  transfer.value = event.params.value;
  transfer.blockNumber = event.block.number;
  transfer.timestamp = event.block.timestamp;
  transfer.transactionHash = event.transaction.hash;
  transfer.save();
}

function loadOrCreateAccount(id: string): Account {
  let acc = Account.load(id);
  if (acc == null) {
    acc = new Account(id);
    acc.balance = BigInt.zero();
    acc.transferCount = 0;
  }
  return acc;
}
```

Three things going on:
1. The handler signature: a single typed event argument. Type generated from the manifest's ABI by `graph-cli`.
2. Entity lifecycle: `load()` to read, `new` for new ones, `save()` to persist.
3. Aggregation logic: balances and counts maintained explicitly. The indexer doesn't auto-derive them.

### How queries work

Once deployed, the subgraph exposes a GraphQL endpoint:

```graphql
query {
  account(id: "0xalice...") {
    balance
    transferCount
    transfersOut(first: 10, orderBy: blockNumber, orderDirection: desc) {
      to { id }
      value
      timestamp
    }
  }
}
```

You get back JSON. The query planner uses the entity schema and the indexes The Graph builds for you. Filter, sort, paginate, traverse relations — all standard GraphQL.

What you can NOT do at query time: arbitrary aggregations (SUM, AVG, GROUP BY across non-keyed dimensions). If you want "total volume by day," you have to write that aggregation into your mapping (creating a `DailyVolume` entity per day, updating it as transfers happen). The lesson: precompute everything you'll want to query.

### The development loop

A typical workflow:

```bash
graph init --product subgraph-studio my-subgraph
cd my-subgraph
# Edit subgraph.yaml, schema.graphql, src/mapping.ts
graph codegen          # generates types from ABIs and schema
graph build            # compiles AssemblyScript → WASM
graph deploy --studio my-subgraph
```

For local development, run a full Graph Node + IPFS + Postgres stack via Docker Compose. Iteration is faster than redeploying to the network on every change.

---

## Code Walkthrough

A complete minimal subgraph for Uniswap V2 pair creation events:

`subgraph.yaml`:
```yaml
specVersion: 1.2.0
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: Factory
    network: mainnet
    source:
      address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
      abi: Factory
      startBlock: 10000835
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities: [Pair]
      abis:
        - name: Factory
          file: ./abis/Factory.json
      eventHandlers:
        - event: PairCreated(indexed address,indexed address,address,uint256)
          handler: handlePairCreated
      file: ./src/mapping.ts
```

`schema.graphql`:
```graphql
type Pair @entity(immutable: true) {
  id: ID!              # pair contract address (lowercase)
  token0: Bytes!
  token1: Bytes!
  pairIndex: BigInt!
  createdAtBlock: BigInt!
  createdAtTimestamp: BigInt!
}
```

`src/mapping.ts`:
```typescript
import { PairCreated as PairCreatedEvent } from "../generated/Factory/Factory";
import { Pair } from "../generated/schema";

export function handlePairCreated(event: PairCreatedEvent): void {
  let pair = new Pair(event.params.pair.toHex());
  pair.token0 = event.params.token0;
  pair.token1 = event.params.token1;
  pair.pairIndex = event.params.param3;
  pair.createdAtBlock = event.block.number;
  pair.createdAtTimestamp = event.block.timestamp;
  pair.save();
}
```

That's the entire subgraph. After deployment, you can query:

```graphql
{ pairs(first: 5, orderBy: createdAtBlock, orderDirection: desc) {
    id
    token0
    token1
    createdAtTimestamp
} }
```

And you get the most recently-created pairs in milliseconds, even though Uniswap V2 has hundreds of thousands.

---

## Common Mistakes and Gotchas

**1. Forgetting to set `startBlock`**
Default `startBlock` is 0. Indexing from block 0 to current on Ethereum is days of compute time. Always set this to your contract's deployment block.

**2. Using uppercase addresses as entity IDs**
The Graph treats `0xABC...` and `0xabc...` as different entities. Always `.toHex()` (which lowercases) or `.toHexString().toLowerCase()` for consistency. Mismatched casing produces "duplicate" entities for the same on-chain account.

**3. Storing arrays of unbounded size**
A `transfersOut: [Transfer!]!` field directly on Account that's literally an array would balloon. Always use `@derivedFrom` for one-to-many relations — it's cheap and computed at query time.

**4. AssemblyScript surprises**
No optional chaining, no implicit conversions between `i32` and `BigInt`, no `Date`. Math on big numbers requires `BigInt` operations. Reading `event.params.value.toBigDecimal().div(BigDecimal.fromString("1e18"))` is the kind of thing you write a hundred times.

**5. Deploying without testing locally**
The Graph's hosted indexer is rate-limited and slow to redeploy. A local Graph Node lets you iterate in seconds. Set up Docker Compose with `graph-node`, IPFS, Postgres, and a Hardhat node — your iteration speed will multiply.

**6. Confusing event name with handler name**
The handler is *your* function name (`handleTransfer`). The event signature must exactly match the ABI (parameter types and `indexed` modifier). Mismatches result in "no handler matched this event."

**7. Not handling reorgs in mappings**
The Graph's indexer handles reorgs by rolling back state, but custom logic that has side effects (e.g. sending email, calling out to APIs) won't be rolled back. Subgraph mappings should be pure: read events in, write entities out, no IO.

**8. Skipping `apiVersion` upgrades**
Older `apiVersion` values lack features (no immutable entities, no aggregations, no full-text search). Use the latest stable.

---

## How This Connects to Production

Almost every consumer-facing dApp UI has a subgraph behind it. Uniswap's analytics, Aave's user dashboards, OpenSea's transaction history, Lido's APR — all powered by GraphQL queries to indexers. The dApp would be unusable if it had to compute these from raw RPC at request time.

The model has scaled because it's *separable*: the dApp team owns the schema and mappings; The Graph (the network or hosted service) owns the indexer infrastructure; the GraphQL endpoint is the contract between them. Many teams treat the subgraph as a "Backend-as-a-Service" — they don't run servers themselves, they just deploy a subgraph and query it from the frontend.

The next several lessons go deeper into the practical issues: writing complex mappings, performance, dynamic data sources, and when to stop using The Graph entirely and roll your own indexer.

---

## What to Learn Next

- **Writing Mappings in AssemblyScript: Event Handlers and Entities** — go deeper into the actual handler code patterns.
- **Modeling Time-Series and Cumulative Data in Subgraphs** — how to build daily/hourly aggregates and trending stats.
- **Indexing Factory Patterns: Dynamic Data Sources** — when one contract spawns others (Uniswap factory, ERC-721 cloned templates).
