# Writing Mappings in AssemblyScript: Event Handlers and Entities

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

The subgraph manifest tells The Graph *what* to watch. The mappings tell it *what to do* when those events fire. Mappings are written in AssemblyScript — a TypeScript-flavored language that compiles to WebAssembly. It looks like TypeScript, but the type system is stricter, the standard library is smaller, and the gotchas are different. This lesson is the practical guide to writing mappings that work.

---

## Core Concepts

### What a mapping function looks like

For every event listed in your `subgraph.yaml`, you write a handler:

```typescript
import { Transfer as TransferEvent } from "../generated/Token/Token";
import { User, Token, Transfer } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

export function handleTransfer(event: TransferEvent): void {
  // 1) Load or create the entities involved
  let from = User.load(event.params.from.toHex());
  if (from == null) {
    from = new User(event.params.from.toHex());
    from.balance = BigInt.zero();
  }

  let to = User.load(event.params.to.toHex());
  if (to == null) {
    to = new User(event.params.to.toHex());
    to.balance = BigInt.zero();
  }

  // 2) Update state
  from.balance = from.balance.minus(event.params.value);
  to.balance = to.balance.plus(event.params.value);

  // 3) Save
  from.save();
  to.save();

  // 4) Record the transfer itself as an entity
  let transferId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let transfer = new Transfer(transferId);
  transfer.from = from.id;
  transfer.to = to.id;
  transfer.value = event.params.value;
  transfer.timestamp = event.block.timestamp;
  transfer.blockNumber = event.block.number;
  transfer.save();
}
```

The pattern: load existing state, update it, save it. Plus often: record a row in a "history" entity for the event itself.


### AssemblyScript ≠ TypeScript

The traps that bite TypeScript developers:

- **No `null` coercion.** `User.load(id)` returns `User | null`. You *must* check for null explicitly. `if (user)` is *not* enough — use `if (user == null)` or `if (user !== null)`.
- **No untyped objects.** Every variable has a strict type. No `any`. No dynamic property access. No JSON-style ad-hoc objects.
- **No closures over mutable state.** AS is much stricter about this than TS.
- **BigInt is a class, not a primitive.** `a + b` doesn't work for BigInts. Use `a.plus(b)`. Comparisons use `.gt()`, `.lt()`, `.equals()`.
- **Strings are limited.** No template literals (use `+`). No `String.format`. Reach for `BigInt.toString()` and concatenate.
- **No `async`/`await`.** Mappings are synchronous. Need to fetch external data? You can call contract `view` functions via the generated bindings — but that's it.

These rules feel painful at first. They're what makes mappings deterministic and replayable, which is what makes subgraphs reliable.

### IDs: the most important design decision

Every entity has a unique `id: ID!` (string). How you derive that ID determines what your data looks like.

- **Address as ID** for "one entity per account": `event.params.from.toHex()`.
- **Compound ID for relationships**: a `Position` entity might be `userAddress + "-" + poolAddress`.
- **txHash + logIndex for event records**: `event.transaction.hash.toHex() + "-" + event.logIndex.toString()`. This is the canonical "unique per emitted log" ID.

Bad ID schemes cause bugs you discover only at scale: collisions overwriting older records, missed records because two events produced the same ID, or unreasonable query patterns because the ID doesn't match what clients want to filter by.


### Reading contract state from a mapping

Sometimes the event doesn't tell you everything. You need to call a `view` function on a contract:

```typescript
import { Token } from "../generated/Token/Token";

let contract = Token.bind(event.address);
let symbol = contract.symbol();
let decimals = contract.decimals();
```

The generated bindings expose every `view`/`pure` function on the contract. Calls happen against the state at the *current event's block*. They're cached within a block, so calling `contract.symbol()` 100 times in one handler is OK.

Caveats:

- Calls *can* revert. Use `try_symbol()` (also generated) to get a `CallResult` that doesn't crash your mapping.
- Contract calls slow down indexing. If you're doing one per event on a high-volume contract, your subgraph indexes 5x slower. Cache aggressively — fetch `symbol()` once on first encounter, store it on the entity, never call again.

### Generated types

`graph codegen` reads your `subgraph.yaml` (for events) and `schema.graphql` (for entities) and produces:

- `generated/<DataSource>/<DataSource>.ts` — typed wrappers around contract calls and event arg parsing.
- `generated/schema.ts` — `User.load(id)`, `new User(id)`, getters/setters for every field, all type-safe.

Always run `graph codegen` after changing the manifest or schema. Your editor will show errors before you build.

---

## Code Walkthrough

A more involved handler — a swap event that updates pool, position, and a daily aggregate.

```typescript
import { Swap as SwapEvent } from "../generated/Pool/Pool";
import { Pool, User, Swap, DayData } from "../generated/schema";
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";

export function handleSwap(event: SwapEvent): void {
  // Pool entity (created elsewhere via factory pattern)
  let pool = Pool.load(event.address.toHex());
  if (pool == null) return; // unknown pool — skip

  // User
  let user = User.load(event.params.sender.toHex());
  if (user == null) {
    user = new User(event.params.sender.toHex());
    user.swapCount = 0;
    user.totalVolume = BigDecimal.zero();
  }

  // Swap volume in token0 terms (or use price oracle)
  let amount0 = toDecimal(event.params.amount0In.plus(event.params.amount0Out), pool.token0Decimals);

  user.swapCount = user.swapCount + 1;
  user.totalVolume = user.totalVolume.plus(amount0);
  user.save();

  pool.totalVolume = pool.totalVolume.plus(amount0);
  pool.swapCount = pool.swapCount + 1;
  pool.save();

  // Daily aggregate — covered in the time-series lesson
  let dayId = event.block.timestamp.toI32() / 86400;
  let day = DayData.load(dayId.toString());
  if (day == null) {
    day = new DayData(dayId.toString());
    day.date = dayId * 86400;
    day.volume = BigDecimal.zero();
    day.swapCount = 0;
  }
  day.volume = day.volume.plus(amount0);
  day.swapCount = day.swapCount + 1;
  day.save();

  // Record the swap itself
  let swapId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let swap = new Swap(swapId);
  swap.pool = pool.id;
  swap.user = user.id;
  swap.amount = amount0;
  swap.timestamp = event.block.timestamp;
  swap.save();
}

function toDecimal(value: BigInt, decimals: i32): BigDecimal {
  let divisor = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal();
  return value.toBigDecimal().div(divisor);
}
```

Six entities updated by one event. All atomic — if the handler crashes halfway, the indexer rolls back and re-tries.


---

## Common Mistakes and Gotchas

**1. Forgetting `entity.save()`**
Loading and modifying without saving is a no-op. The Graph doesn't auto-save. Your changes vanish.

**2. Saving an entity inside a loop without changing the ID**
You'll just keep overwriting the same row. Make sure each save() target has a unique ID for the data you're trying to record.

**3. BigInt arithmetic with `+`**
Doesn't work — TS allows it via type coercion, AS errors. Use `.plus()`, `.minus()`, `.times()`, `.div()`.

**4. Implicit number conversions**
`event.block.timestamp` is `BigInt`. `event.block.number` is `BigInt`. `event.logIndex` is `BigInt`. Converting to `i32` for arithmetic only works if the value fits — be aware of when you're truncating.

**5. Reading contract state on every event when caching would do**
Token symbols and decimals don't change. Read them once when the entity is first created, not on every event. Saves a lot of indexing time.

**6. `event.params` field names not matching the ABI**
If your ABI says the event arg is `_from` (with underscore) but you reference `event.params.from`, you'll get a typecheck error. The generated types use the exact ABI names.

**7. Producing inconsistent state between handlers**
If handler A creates a `User` and handler B assumes it exists (`User.load(id)!`), the order of events matters. Always defensively load-or-create.

---

## How This Connects to Production

The mappings are 90% of the engineering work in a subgraph. Production subgraphs evolve over months: new events get added, schema fields get refined, performance optimizations get layered on. Treat mapping files like any other production code — review them, test them on archive nodes for a sample of events, monitor indexing latency after deploys.

The other production reality: mappings can't be reverted on a live subgraph in the decentralized network. If your handler has a bug that produces wrong data, you fix the code, redeploy as a new version, and clients have to migrate. Plan for forward-only changes.

---

## What to Learn Next

- **Modeling Time-Series and Cumulative Data in Subgraphs** — the daily/hourly aggregates that power most analytics dashboards.
- **Indexing Factory Patterns: Dynamic Data Sources** — how to track contracts that are deployed by other contracts (e.g. every Uniswap V2 pool).
- **Subgraph Performance: Query Cost, Pagination, and Indexing Speed** — when your subgraph slows down, what to do about it.
