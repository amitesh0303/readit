# Modeling Time-Series and Cumulative Data in Subgraphs

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

Every analytics dashboard you've used on a DeFi UI — TVL over time, daily volume, hourly swaps, weekly active users — is a time-series. You can't compute these from raw event logs at query time without scanning everything; that defeats the purpose of having an indexer. You have to **bucket** the data into time windows during indexing, so queries are fast.

The Graph doesn't have a native "give me daily aggregates" feature (well, recent versions support timeseries, but they're optional and most production subgraphs predate them). You build them yourself: a per-day entity, updated on every relevant event. Get the bucket key right and queries are O(N_days). Get it wrong and you're stuck reprocessing historical data.



### Cumulative vs incremental

Two ways to store totals:

- **Incremental**: each `DayData` row stores the volume for that day only. Lifetime total = sum of all rows.
- **Cumulative**: each row stores running total to that day. Lifetime total = last row's value.

For most use cases, *incremental* is correct. Charts of "daily volume" are exactly the incremental values. If you need cumulative, derive it client-side from the incremental series.

The exception: cumulative metrics that are expensive to compute on the fly (e.g. "total holders ever," requires distinct-count). Store these as cumulative on the entity itself: `pool.lifetimeVolume = pool.lifetimeVolume.plus(amount)`.

### The `date` field gotcha

Always store the start-of-bucket timestamp as a separate field, not just the ID:

```graphql
type DayData @entity {
  id: ID!     # "19872" — the day index
  date: Int!  # 1716595200 — the unix timestamp for start of that day
  ...
}
```

The ID is great for joins. The `date` field is what clients filter on. Without `date`, you have to parse the ID — and GraphQL filtering on string-converted-int IDs doesn't sort numerically.

### Reorgs and aggregates

If a transaction in your bucket is reorged out of the chain, The Graph rolls back your aggregates correctly — your handler is essentially re-run on the canonical chain, and previously-saved entities are reverted. The mechanism is internal; you don't need to handle reorgs explicitly. But it does mean your aggregates can briefly show wrong numbers during a reorg, which is normal.

---

## Code Walkthrough

A complete time-series handler from a swap event, producing global daily, per-pool daily, and per-user weekly aggregates.

```typescript
export function handleSwap(event: SwapEvent): void {
  let pool = Pool.load(event.address.toHex())!;
  let user = loadOrCreateUser(event.params.sender.toHex());
  let amount = toDecimal(event.params.amount0, pool.token0Decimals);

  // Existing entity updates
  pool.totalVolume = pool.totalVolume.plus(amount);
  pool.save();
  user.totalVolume = user.totalVolume.plus(amount);
  user.save();

  // Time-series aggregates
  let ts = event.block.timestamp.toI32();
  let dayIndex = ts / 86400;
  let weekIndex = ts / 604800;

  // Global daily
  let day = DayData.load(dayIndex.toString());
  if (day == null) {
    day = new DayData(dayIndex.toString());
    day.date = dayIndex * 86400;
    day.volume = BigDecimal.zero();
    day.swapCount = 0;
    day.activeUsers = 0;
  }
  day.volume = day.volume.plus(amount);
  day.swapCount = day.swapCount + 1;
  day.save();

  // Per-pool daily
  let pdId = pool.id + "-" + dayIndex.toString();
  let pd = PoolDayData.load(pdId);
  if (pd == null) {
    pd = new PoolDayData(pdId);
    pd.pool = pool.id;
    pd.date = dayIndex * 86400;
    pd.volume = BigDecimal.zero();
    pd.swapCount = 0;
  }
  pd.volume = pd.volume.plus(amount);
  pd.swapCount = pd.swapCount + 1;
  pd.save();

  // Per-user weekly
  let uwId = user.id + "-" + weekIndex.toString();
  let uw = UserWeekData.load(uwId);
  if (uw == null) {
    uw = new UserWeekData(uwId);
    uw.user = user.id;
    uw.weekStart = weekIndex * 604800;
    uw.volume = BigDecimal.zero();
    uw.swapCount = 0;
  }
  uw.volume = uw.volume.plus(amount);
  uw.swapCount = uw.swapCount + 1;
  uw.save();
}
```

Per swap: 4 entity writes for aggregates. At 100 swaps/sec on a busy chain, that's 400 writes/sec — well within indexer capacity, while making client queries effectively free.


---

## Common Mistakes and Gotchas

**1. Off-by-one on bucket boundaries**
A swap at exactly 00:00 UTC belongs to the new day. Make sure your division uses the start-of-day correctly — `ts / 86400` floors to the bucket index, not rounds.

**2. Computing aggregates client-side then writing them back**
Don't fetch a count from the entity, increment in JS, and store. Use `entity.field = entity.field.plus(...)` directly — atomic and reorg-safe.

**3. Hourly aggregates on a high-volume contract**
On a chain producing 100k events/day on your contracts, hourly buckets at 24/day = 2.4M extra entity writes per day. Your indexer slows down. Consider whether daily granularity is enough.

**4. Aggregating `activeUsers` naively**
A daily "active users" count is a distinct-count, which subgraphs don't support natively. The workaround: maintain a `UserDayActivity` entity (id = `userId-dayIndex`), upsert it on every event involving the user, then count rows for that day. It's expensive but correct.

**5. Forgetting to set `date` on first creation**
If `date` is missing on the create path, you'll have rows with `date = 0` filtering breaks. Always set every numeric field to a valid initial value.

**6. Using local time / non-UTC**
All blockchain timestamps are UTC. Your buckets must be UTC. If your dashboard "shows in local time," that's a display concern — store and aggregate in UTC.

---

## How This Connects to Production

Every dashboard you've seen for a DeFi protocol — DefiLlama, Uniswap's analytics page, Aave's stats — is querying time-bucketed entities like these. The schema patterns above are what those subgraphs (mostly open-source on GitHub) actually use. The tradeoffs are about granularity (daily vs hourly vs minute) and cost (more buckets = more entities = slower indexing and more storage).

Sensible defaults: daily buckets for everything that's user-facing, plus a few high-value metrics (TVL, active users) at hourly granularity. Avoid minute-level unless you're building a real-time trading UI — at that point, push directly off WebSocket subscriptions, not subgraphs.

---

## What to Learn Next

- **Indexing Factory Patterns: Dynamic Data Sources** — when your contract spawns child contracts and you need to index them dynamically.
- **Subgraph Performance: Query Cost, Pagination, and Indexing Speed** — what to do when these aggregates start slowing your indexer down.
- **Hosted Service vs Decentralized Network** — where to actually deploy.

---

## Core Concepts

### Bucketing time

The standard pattern: convert the event's timestamp to a UTC day (or hour) integer, use it as part of the entity ID.

```typescript
let timestamp = event.block.timestamp;            // BigInt, seconds since epoch
let dayId = timestamp.toI32() / 86400;            // integer day count
let dayStartTimestamp = dayId * 86400;            // start of that UTC day
```

Then your entity ID is `<scope>-<dayId>`:
- `pair-<pairAddress>-<dayId>` for per-pair daily stats
- `protocol-<dayId>` for global daily stats
- `user-<userAddress>-<dayId>` for per-user daily stats

The handler:
1. Compute the dayId from `event.block.timestamp`.
2. Load (or create) the day entity.
3. Update its cumulative fields.
4. Save.

```graphql
type PairDayData @entity {
  id: ID!                # pairAddress + "-" + dayId
  pair: Pair!
  date: Int!             # UTC midnight timestamp
  volumeToken0: BigDecimal!
  volumeToken1: BigDecimal!
  swapCount: Int!
  uniqueTraders: [Bytes!]! # if you need it; consider tradeoffs
}
```

The query: "give me Uniswap pair X's daily volume for the last 30 days":
```graphql
{
  pairDayDatas(
    where: { pair: "0x..." }
    orderBy: date orderDirection: desc
    first: 30
  ) {
    date
    volumeToken0
    volumeToken1
    swapCount
  }
}
```

Returns in O(30) reads. Fast.

### Cumulative vs differential

When designing time-series, decide: do you want the entity to hold the **cumulative** value as of that day's end, or the **differential** value (just the delta during that day)?

- **Differential** is simpler to update: `dayData.volumeToken0 = dayData.volumeToken0.plus(swap.amount0)`.
- **Cumulative** lets you compute "how much volume happened between day X and day Y" as `dayData_Y - dayData_X` without summing days, but updates are subtler.

Most subgraphs store differential per-day stats and let the client sum to get cumulative. Some store both: `dailyVolume` (differential) and `cumulativeVolume` (running total carried forward).

### Hourly buckets

Same pattern, finer granularity:

```typescript
let hourId = timestamp.toI32() / 3600;
let hourStart = hourId * 3600;
```

Storage trade-off: 24× more entities than daily. For a busy contract that's a lot of storage, but query cost is identical (you query a known small range). Most production subgraphs ship both: hourly for the last 7 days (high-resolution), daily forever.

If you don't need both forever, a heuristic: keep hourly for the last N days (the indexer doesn't auto-prune, but your query layer can ignore old hourly data), keep daily forever.

### Multi-dimensional bucketing

Often you want "daily volume per pair, per token." That's two dimensions: `(pair, token, day)`. The entity ID becomes `<pair>-<token>-<dayId>`.

```graphql
type PairTokenDayData @entity {
  id: ID!  # "<pair>-<token>-<dayId>"
  pair: Pair!
  token: Token!
  date: Int!
  volume: BigDecimal!
}
```

Querying for "all tokens' daily volumes on this pair":

```graphql
{
  pairTokenDayDatas(
    where: { pair: "0xpair...", date_gte: 1735689600 }
    orderBy: date
  ) { date token { symbol } volume }
}
```

The cost: more entity rows, more storage. The benefit: queries that would otherwise be impossible.

### Snapshots vs running stats

Two forms of "current state":

- **Snapshot entity**: at the end of every day, write a snapshot of current state (e.g. `Account.balance` as of midnight). Query "what was X's balance on day Y?" → load `AccountDay-X-Y`. Storage-heavy but easy to query historically.
- **Running stats on the parent entity**: keep `Account.balance` always current. Query "what's X's balance now?" → load `Account-X`. Light on storage but no historical lookup.

You usually need both: running stats on the parent (current view), snapshots for time-series (historical view). The snapshot pattern is the way to answer "what was the price/balance/state at time T."

The catch with snapshots: you have to write them somewhere. Subgraph mappings only run when an event fires. If no events for an account on day Y, no snapshot was created. Workarounds:

- Write a snapshot lazily: on the first event of day Y for that account, snapshot the *previous* day's final state.
- Use `_meta`-block mappings or block handlers (run on every block) — expensive but accurate.
- Accept that snapshots are only created on event-touched days and the client interpolates.

### "First-event-of-day" pattern

Many cumulative computations need to detect the first event of a new day. Pattern:

```typescript
function getOrCreateDayData(pair: Pair, timestamp: BigInt): PairDayData {
  let dayId = timestamp.toI32() / 86400;
  let id = pair.id + "-" + dayId.toString();
  let dayData = PairDayData.load(id);

  if (dayData == null) {
    dayData = new PairDayData(id);
    dayData.pair = pair.id;
    dayData.date = dayId * 86400;
    dayData.volumeToken0 = BigDecimal.fromString("0");
    dayData.volumeToken1 = BigDecimal.fromString("0");
    dayData.swapCount = 0;
    // First-event-of-day: optionally snapshot pair's current state here
    dayData.openLiquidity = pair.reserveToken0;
  }
  return dayData;
}
```

The first time we see this `(pair, dayId)` pair, we create the entity AND snapshot the pair's pre-event state ("liquidity at the open"). Subsequent events on the same day just update the cumulative.

---

## Code Walkthrough

A complete daily-and-hourly volume tracker for a DEX swap:

```typescript
import { Swap as SwapEvent } from "../generated/Pair/Pair";
import { Pair, PairDayData, PairHourData, ProtocolDayData } from "../generated/schema";
import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";

export function handleSwap(event: SwapEvent): void {
  let pairAddr = event.address.toHex();
  let pair = Pair.load(pairAddr);
  if (pair == null) return;

  let amount0 = event.params.amount0In.toBigDecimal()
    .plus(event.params.amount0Out.toBigDecimal());
  let amount1 = event.params.amount1In.toBigDecimal()
    .plus(event.params.amount1Out.toBigDecimal());

  // Always update cumulatives on the parent
  pair.swapCount = pair.swapCount + 1;
  pair.totalVolumeToken0 = pair.totalVolumeToken0.plus(amount0);
  pair.totalVolumeToken1 = pair.totalVolumeToken1.plus(amount1);
  pair.save();

  // Daily aggregate
  let dayId = event.block.timestamp.toI32() / 86400;
  let dayKey = pair.id + "-" + dayId.toString();
  let day = PairDayData.load(dayKey);
  if (day == null) {
    day = new PairDayData(dayKey);
    day.pair = pair.id;
    day.date = dayId * 86400;
    day.volumeToken0 = BigDecimal.fromString("0");
    day.volumeToken1 = BigDecimal.fromString("0");
    day.swapCount = 0;
  }
  day.volumeToken0 = day.volumeToken0.plus(amount0);
  day.volumeToken1 = day.volumeToken1.plus(amount1);
  day.swapCount = day.swapCount + 1;
  day.save();

  // Hourly aggregate (last 7 days = 168 buckets per pair)
  let hourId = event.block.timestamp.toI32() / 3600;
  let hourKey = pair.id + "-" + hourId.toString();
  let hour = PairHourData.load(hourKey);
  if (hour == null) {
    hour = new PairHourData(hourKey);
    hour.pair = pair.id;
    hour.hourStart = hourId * 3600;
    hour.volumeToken0 = BigDecimal.fromString("0");
    hour.volumeToken1 = BigDecimal.fromString("0");
    hour.swapCount = 0;
  }
  hour.volumeToken0 = hour.volumeToken0.plus(amount0);
  hour.volumeToken1 = hour.volumeToken1.plus(amount1);
  hour.swapCount = hour.swapCount + 1;
  hour.save();

  // Protocol-level aggregate
  let protoKey = "protocol-" + dayId.toString();
  let proto = ProtocolDayData.load(protoKey);
  if (proto == null) {
    proto = new ProtocolDayData(protoKey);
    proto.date = dayId * 86400;
    proto.totalSwaps = 0;
  }
  proto.totalSwaps = proto.totalSwaps + 1;
  proto.save();
}
```

This single handler keeps four levels of state in sync: parent pair (running totals), daily per-pair, hourly per-pair, protocol-wide daily. Storage is bounded — a 1000-pair protocol over 4 years yields ~1.5M entity rows for daily + ~1.5M for the last year of hourly. Postgres handles that easily.

---

## Common Mistakes and Gotchas

**1. Using `block.timestamp` directly as ID**
Every event has a different timestamp. You'd create a new entity per event, not per day. Always bucket: `timestamp / 86400`.

**2. Treating local time as the bucket**
Subgraph mappings should always use UTC. If you bucket by "user's local day," your indexer can't know what that is — it's a query-layer concern. Index in UTC; convert at display time.

**3. Computing rolling averages in the mapping**
"30-day rolling average volume" requires looking at 30 prior days at every event — too expensive. Compute daily totals in the mapping; let the client compute the rolling average from the daily data.

**4. Storing arrays of values per day**
A `dailyTraders: [Bytes!]` field that grows unboundedly during a busy day is a performance disaster. Either store a per-(day, trader) entity for unique counts, or use a HyperLogLog approximation (not directly supported, but you can hash and bucket).

**5. Forgetting the parent entity's running totals**
If the only place you maintain cumulative volume is in `PairDayData`, queries for "lifetime volume" require summing all days. Maintain a `Pair.totalVolume` running total too — cheap.

**6. Off-by-one on day boundaries**
A swap at `timestamp = 86400` is the start of day 1, not the end of day 0. `timestamp.toI32() / 86400` gives the right answer, but your test data needs to span a midnight boundary or you won't catch this.

**7. Missing default initializations**
Creating a new `PairDayData` and forgetting to set `volumeToken0 = ZERO_BD` means the first `.plus()` is on a null. AssemblyScript will refuse to compile, but if you copy-paste partial init code it's easy to miss.

**8. Hourly buckets forever**
24 hourly buckets × 365 days × N pairs adds up. Decide a retention policy (e.g. 30 days of hourly, 5 years of daily) and document it. Indexers don't auto-prune, but you can stop creating hourly entities once they're more than X days old by adding a check.

---

## How This Connects to Production

Every DeFi analytics platform — DefiLlama, Token Terminal, Dune dashboards backed by subgraphs — relies on time-bucketed entities. The Uniswap V2/V3 subgraphs ship `dayData` and `hourData` for both pairs and the global protocol. Aave's subgraph has `reserveDayData` for per-asset stats. Same pattern, different domain.

Once you have time-bucket entities, building dashboards is straightforward — query the bucket, plot it. The hard work is in the mappings, getting the aggregations right, handling edge cases (zero-volume days, contract migrations, decimal precision). That work pays off many times over in dashboard quality.

---

## What to Learn Next

- **Indexing Factory Patterns: Dynamic Data Sources** — when one contract spawns others (Uniswap factory) and you need to track them all.
- **Subgraph Performance: Query Cost, Pagination, and Indexing Speed** — making your subgraph fast at both index time and query time.
- **Hosted Service vs Decentralized Network** — where to actually run your subgraph in 2026.
