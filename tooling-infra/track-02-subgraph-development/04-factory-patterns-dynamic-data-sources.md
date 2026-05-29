# Indexing Factory Patterns: Dynamic Data Sources

**Track:** Intermediate
**Read time:** 7 min

---

## The Problem

Uniswap V2 has tens of thousands of pools. The factory deploys a new `Pair` contract every time someone creates a market. Your manifest can't list all of them — you don't even know their addresses ahead of time. You need a way to say: "watch the factory's `PairCreated` event, and from then on, also index every pool it deploys."

That's the dynamic data source. Almost every protocol with >1 contract you'd want to index uses this pattern.

---

## Core Concepts

### Static vs dynamic data sources

In `subgraph.yaml`, the `dataSources` section lists contracts known at start: factory addresses, hardcoded protocol contracts. Each has a fixed `address` and a `startBlock`.

Below that, you add a `templates` section. Templates are the *blueprint* for contracts that don't exist yet but will be discovered during indexing.

```yaml
dataSources:
  - kind: ethereum/contract
    name: Factory
    network: mainnet
    source:
      address: "0x5C69bEe...f"
      abi: Factory
      startBlock: 10000835
    mapping:
      ...
      eventHandlers:
        - event: PairCreated(indexed address,indexed address,address,uint256)
          handler: handlePairCreated

templates:
  - kind: ethereum/contract
    name: Pair
    network: mainnet
    source:
      abi: Pair
    mapping:
      ...
      eventHandlers:
        - event: Swap(indexed address,uint256,uint256,uint256,uint256,indexed address)
          handler: handleSwap
        - event: Mint(indexed address,uint256,uint256)
          handler: handleMint
```

The factory data source has a fixed address. The Pair template has no address — it's instantiated at runtime.

### Spawning a template instance

In your factory handler:

```typescript
import { Pair as PairTemplate } from "../generated/templates";

export function handlePairCreated(event: PairCreatedEvent): void {
  // Create the Pair entity
  let pool = new Pool(event.params.pair.toHex());
  pool.token0 = event.params.token0;
  pool.token1 = event.params.token1;
  pool.createdAt = event.block.timestamp;
  pool.save();

  // Tell the indexer to start watching this address with the Pair template
  PairTemplate.create(event.params.pair);
}
```

`PairTemplate.create(address)` is the magic call. From this block forward, the indexer subscribes to events from that address using the template's mapping.


### Cost: indexing speed scales with template count

Every template instance is a separate event filter at the indexer level. 10,000 pools = 10,000 active subscriptions. The indexer batches them, but at scale this is the dominant indexing cost.

Practical impact: a fresh sync of a Uniswap V3 subgraph (which uses dynamic data sources for every pool) can take *days*. Hosted services give you a leg up because they can re-use indexed data across instances; self-hosted indexers do every byte themselves.

### `templates` and `dataSources` share types

The mapping file imports both `generated/Factory/Factory.ts` (for the static factory) and `generated/templates/Pair/Pair.ts` (for template-deployed pairs). Same patterns, same APIs. Don't mix up which `Pair` you're importing.

### When to *not* use templates

If the contracts you'd be tracking via templates are well-known and stable (e.g. five hand-deployed mainnet protocol contracts), just list them directly in `dataSources`. Templates are for the open-ended case.

If the contract emits the data you need as part of the factory's events (some protocols emit all swap data from a central router), you don't need to track each child contract — just handle the router. Less faithful but much faster.

---

## Code Walkthrough

A factory + template pair, end-to-end:

```yaml
specVersion: 0.0.5
schema: { file: ./schema.graphql }
dataSources:
  - kind: ethereum/contract
    name: Factory
    network: mainnet
    source:
      address: "0x5C69bEe..."
      abi: Factory
      startBlock: 10000835
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/factory.ts
      entities: [Pool, Token]
      abis:
        - name: Factory
          file: ./abis/Factory.json
        - name: Pair
          file: ./abis/Pair.json
      eventHandlers:
        - event: PairCreated(indexed address,indexed address,address,uint256)
          handler: handlePairCreated

templates:
  - kind: ethereum/contract
    name: Pair
    network: mainnet
    source: { abi: Pair }
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/pair.ts
      entities: [Pool, Swap, Mint, Burn]
      abis:
        - name: Pair
          file: ./abis/Pair.json
      eventHandlers:
        - event: Swap(indexed address,uint256,uint256,uint256,uint256,indexed address)
          handler: handleSwap
        - event: Mint(indexed address,uint256,uint256)
          handler: handleMint
```

`src/factory.ts`:

```typescript
import { PairCreated } from "../generated/Factory/Factory";
import { Pool } from "../generated/schema";
import { Pair as PairTemplate } from "../generated/templates";

export function handlePairCreated(event: PairCreated): void {
  let pool = new Pool(event.params.pair.toHex());
  pool.token0 = event.params.token0.toHex();
  pool.token1 = event.params.token1.toHex();
  pool.createdAt = event.block.timestamp;
  pool.totalVolume = BigDecimal.zero();
  pool.swapCount = 0;
  pool.save();

  PairTemplate.create(event.params.pair);
}
```

`src/pair.ts`:

```typescript
import { Swap as SwapEvent } from "../generated/templates/Pair/Pair";
import { Pool, Swap } from "../generated/schema";

export function handleSwap(event: SwapEvent): void {
  let pool = Pool.load(event.address.toHex());
  if (pool == null) return; // shouldn't happen — factory created it

  // ... update pool, write Swap entity ...
}
```

When the indexer hits block N where `PairCreated` is emitted, it adds the new pair address to its subscription list and starts processing its events from block N forward.


---

## Common Mistakes and Gotchas

**1. Forgetting to call `Template.create()`**
You created the entity for the new pair but never told the indexer to subscribe. Subsequent events from that pair are ignored.

**2. Calling `Template.create()` with the wrong address**
Use `event.params.pair`, not `event.address` (which is the factory's address). The template is for the *new* contract, not the factory.

**3. Spawning duplicate templates**
Calling `Template.create(addr)` twice for the same address creates two subscriptions. You'll process every event twice. Always guard:

```typescript
let existing = Pool.load(event.params.pair.toHex());
if (existing == null) {
  // first time seen — create entity and template
  ...
  PairTemplate.create(event.params.pair);
}
```

**4. Template `startBlock` confusion**
Templates don't have a `startBlock` — they start from the block where `Template.create()` was called. If the contract emitted events before that block, those are missed. (Solution: backfill via a custom handler if you really need the history.)

**5. Schemas without the `pool` field on swap entities**
Without a `pool` reference on each `Swap`, you can't query "all swaps in this pool" cheaply. Always include the foreign key.

**6. Underestimating sync time**
A subgraph with thousands of dynamic data sources can take 24-72 hours for a cold sync from genesis. Plan deployments accordingly. The hosted service has caching that helps; self-hosted is the slow path.

---

## How This Connects to Production

Every "factory pattern" protocol — Uniswap V2/V3, Curve, Balancer, Sushi, Aave's market factories, every NFT collection that uses a clone factory — uses dynamic data sources in its subgraphs. The pattern is so dominant that "subgraph for an EVM protocol" basically means "factory + template + time-series aggregates."

Production tip: when you ship a new factory deployment (e.g. v3 of your DEX), the subgraph that watched v2 won't auto-watch v3. You either redeploy the subgraph with a new factory data source, or use multiple factory data sources in the same manifest. The latter is cleaner if you're keeping them logically together.

---

## What to Learn Next

- **Subgraph Performance: Query Cost, Pagination, and Indexing Speed** — making your factory-driven subgraph keep up.
- **Hosted Service vs Decentralized Network** — where this all gets deployed in 2026.
- **Migrating from a Subgraph to a Custom Indexer** — when subgraphs are no longer enough.
