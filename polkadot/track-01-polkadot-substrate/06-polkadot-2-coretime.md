# Polkadot 2.0 and Coretime: The New Economic Model

**Track:** Polkadot & Substrate Development
**Lesson:** 6 of 6
**Level:** Advanced
**Read time:** 11 min

---

## The Problem

Polkadot's original parachain slot auction model required teams to lock millions of dollars in DOT for 96 weeks just to get a slot. This created a massive barrier to entry — only well-funded projects could become parachains. Polkadot 2.0 replaces this with "Agile Coretime," a flexible system where blockspace is purchased on-demand or in bulk, similar to buying cloud compute. If you're building on Polkadot, you need to understand this new model because it fundamentally changes how your chain accesses relay chain security and how you plan your economics.

## Core Concepts

### From Slot Auctions to Coretime

The old model vs the new model:

| Aspect | Slot Auctions (Legacy) | Agile Coretime (Polkadot 2.0) |
|--------|----------------------|-------------------------------|
| Access method | Win a candle auction | Purchase coretime on Coretime Chain |
| Cost | Lock DOT for 96 weeks | Pay DOT per block or in bulk |
| Minimum commitment | 2 years | 1 block (on-demand) or 28 days (bulk) |
| Flexibility | Fixed — always producing blocks | Elastic — scale up/down as needed |
| Barrier to entry | Very high ($1M+ in DOT) | Low (pay-as-you-go) |
| Secondary market | None | Coretime can be traded, split, shared |

### What is a "Core"?

A core is a unit of relay chain validation capacity. Each core can validate one parachain block per relay chain block (every 6 seconds). Polkadot currently has ~50 cores, expandable as the validator set grows.

```
┌─────────────────────────────────────────────────────────┐
│              Coretime Allocation                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Core 0: ████████████████████████████  Parachain A      │
│          (Bulk coretime - 28 day region)                │
│                                                         │
│  Core 1: ████████░░░░████████░░░░████  Parachain B      │
│          (Bulk - shared with C, 50/50 split)            │
│                                                         │
│  Core 2: █░█░░░█░░░░░░░█░░░█░░░░░░░█  On-demand        │
│          (Multiple parathreads, pay per block)          │
│                                                         │
│  Core 3: ████████████████████████████  Parachain D      │
│          (Bulk coretime - full region)                  │
│                                                         │
│  ████ = Block produced    ░░░░ = Idle/other chain       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Coretime Types

**Bulk Coretime**: Purchase a "region" of coretime (28 days) via the Coretime Chain's broker pallet. You get guaranteed block production for the entire period.

**On-Demand Coretime**: Pay per block. Your chain submits a block when it needs to, paying the current spot price. Ideal for low-traffic chains or burst workloads.

**Elastic Scaling**: A single parachain can use multiple cores simultaneously to increase throughput. Instead of 1 block per 6 seconds, a parachain with 3 cores produces 3 blocks per 6 seconds.

### The Coretime Chain (Broker Pallet)

Coretime is managed by a system parachain called the Coretime Chain. It runs the `pallet_broker` which handles sales, renewals, and the secondary market:

```rust
// Interacting with the Coretime Chain's broker pallet
// polkadot-sdk@1.7.0 (pallet-broker)

use pallet_broker::{
    ConfigRecord, CoreAssignment, CoreIndex, RegionId, Timeslice,
};

/// Key broker pallet calls:

/// 1. Purchase bulk coretime at the current price
/// Called during a sale period (sales happen every 28 days)
#[pallet::call_index(4)]
pub fn purchase(
    origin: OriginFor<T>,
    price_limit: BalanceOf<T>,  // Max price you're willing to pay
) -> DispatchResult;

/// 2. Renew existing bulk coretime (priority over new purchases)
#[pallet::call_index(5)]
pub fn renew(
    origin: OriginFor<T>,
    core: CoreIndex,  // The core you're renewing
) -> DispatchResult;

/// 3. Transfer a coretime region to another account
#[pallet::call_index(6)]
pub fn transfer(
    origin: OriginFor<T>,
    region_id: RegionId,
    new_owner: T::AccountId,
) -> DispatchResult;

/// 4. Split a region in time (e.g., use first 14 days, sell last 14)
#[pallet::call_index(8)]
pub fn partition(
    origin: OriginFor<T>,
    region_id: RegionId,
    pivot: Timeslice,  // Split point
) -> DispatchResult;

/// 5. Split a region by core fraction (share a core 50/50)
#[pallet::call_index(9)]
pub fn interlace(
    origin: OriginFor<T>,
    region_id: RegionId,
    pivot: CoreMask,  // Which timeslots go to each half
) -> DispatchResult;
```

### Purchasing On-Demand Coretime

For chains that don't need continuous block production:

```rust
// On-demand coretime: pay per block via the relay chain
// polkadot-sdk@1.7.0

use cumulus_primitives_core::relay_chain::OnDemandOrder;

/// Your collator submits an on-demand order when it has a block to produce
/// The relay chain's on-demand pallet processes these orders by price priority

// In your parachain's collator logic:
async fn submit_on_demand_block(
    relay_client: &RelayChainClient,
    para_id: ParaId,
    max_fee: Balance,
) -> Result<(), Error> {
    // Submit an on-demand order to the relay chain
    // The relay chain will include your block in the next available slot
    // if your fee bid is competitive
    let order = OnDemandOrder {
        para_id,
        max_amount: max_fee,
    };

    relay_client
        .submit_on_demand_order(order)
        .await
        .map_err(|e| Error::OnDemandSubmissionFailed(e))?;

    Ok(())
}

// Pricing: on-demand uses a dynamic pricing model
// - Base price set by governance
// - Price increases with demand (more orders = higher price)
// - Price decreases when cores are idle
// Current Polkadot on-demand price: ~0.05-0.5 DOT per block
```

### Elastic Scaling: Multiple Cores

A parachain can use multiple cores to increase throughput:

```rust
// runtime/src/lib.rs — enabling elastic scaling
// polkadot-sdk@1.7.0

parameter_types! {
    /// Maximum number of cores this parachain can use simultaneously
    pub const MaxCoresPerParachain: u32 = 3;
    /// Unincluded segment capacity — how many blocks can be produced
    /// ahead of relay chain inclusion
    pub const UnincludedSegmentCapacity: u32 = 3;
}

impl cumulus_pallet_parachain_system::Config for Runtime {
    // ... other config ...
    /// Enable elastic scaling — produce multiple blocks per relay chain block
    type ConsensusHook = cumulus_pallet_aura_ext::FixedVelocityConsensusHook<
        Runtime,
        RELAY_CHAIN_SLOT_DURATION_MILLIS,
        BLOCK_PROCESSING_VELOCITY,  // e.g., 3 for 3x throughput
        UNINCLUDED_SEGMENT_CAPACITY,
    >;
}

// With 3 cores and elastic scaling enabled:
// - Your parachain produces 3 blocks per 6-second relay chain slot
// - Effective block time: 2 seconds
// - 3x the throughput of a single-core parachain
```

### Migration from Slot Leases

Existing parachains with active slot leases are automatically migrated:

1. Lease continues until expiry (no disruption)
2. At expiry, the parachain transitions to bulk coretime
3. Existing parachains get renewal priority (can renew before new sales open)
4. DOT previously locked is returned when the lease expires

### Cost Comparison

| Scenario | Old Model (Auction) | New Model (Coretime) |
|----------|--------------------|--------------------|
| Full parachain, 2 years | Lock ~1M DOT ($7M) | ~1,000 DOT/month bulk ($7K/mo) |
| Low-traffic chain | Same cost as full | ~0.1 DOT/block on-demand |
| Burst workload | Overpay for idle time | Scale up temporarily |
| Startup/experiment | Prohibitive | Start on-demand, upgrade to bulk |

## Deployment

```shell
# Check current coretime sales on Polkadot
# Using subxt to query the Coretime Chain
# subxt-cli@0.34.0
subxt metadata --url wss://polkadot-coretime-rpc.polkadot.io > coretime-metadata.scale
```

```shell
# Query current sale status via Polkadot.js Apps
# Navigate to: https://polkadot.js.org/apps/?rpc=wss://polkadot-coretime-rpc.polkadot.io
# Developer → Chain State → broker → saleInfo()
```

```
Expected output (example):
{
  saleStart: 1,234,567,
  regionBegin: 500,
  regionEnd: 700,
  idealCoresSold: 40,
  coresOffered: 50,
  firstCore: 0,
  selloutPrice: null,
  leadinLength: 100
}
```

```shell
# Purchase bulk coretime (requires DOT on Coretime Chain)
# Using polkadot-js CLI:
# @polkadot/api-cli@0.58.0
polkadot-js-api --ws wss://polkadot-coretime-rpc.polkadot.io \
    tx.broker.purchase 500000000000  # price_limit: 50 DOT
```

## Common Pitfalls

1. **Assuming you still need an auction** — Slot auctions are deprecated. New parachains acquire coretime through the broker pallet on the Coretime Chain. Don't waste time preparing for an auction that won't happen.

2. **Not budgeting for coretime renewal** — Bulk coretime expires every 28 days. If you don't renew (or your treasury runs out of DOT), your chain stops producing blocks. Build renewal automation into your chain's governance or treasury.

3. **Over-provisioning cores** — Elastic scaling is powerful but expensive. If your chain only processes 10 transactions per block, you don't need 3 cores. Start with on-demand or single-core bulk, and scale up based on actual demand.

4. **Ignoring the secondary market** — Coretime regions are tradeable NFTs. If you purchased bulk coretime but don't need it for a period, you can sell or split the remaining time. Conversely, you can buy coretime from others if the primary sale is sold out.

## What to Learn Next

- [Polkadot Wiki: Agile Coretime](https://wiki.polkadot.network/docs/learn-agile-coretime) — Official documentation on the coretime model
- [RFC-1: Agile Coretime](https://github.com/polkadot-fellows/RFCs/blob/main/text/0001-agile-coretime.md) — The original RFC proposing the coretime model
- [Broker Pallet Source](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame/broker) — Implementation of the coretime marketplace
- [Relay Chain Architecture](./01-relay-chain-architecture.md) — Review how the relay chain provides shared security to parachains
