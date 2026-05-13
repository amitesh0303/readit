# Polkadot Relay Chain Architecture: Shared Security for a Multi-Chain World

**Track:** Polkadot & Substrate Development
**Lesson:** 1 of 6
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You've heard Polkadot described as a "layer-0" or "multi-chain network," but you don't understand how it actually works. What is the relay chain? How do parachains connect to it? What makes this different from a bridge between independent chains? Without understanding the relay chain architecture, you can't reason about the security model, finality guarantees, or why building a parachain is fundamentally different from deploying a smart contract.

## Core Concepts

### The Relay Chain as Shared Security Hub

Polkadot's relay chain is the central chain that provides shared security, consensus, and cross-chain interoperability to all connected parachains. Unlike Ethereum L2s where each rollup posts proofs to L1, Polkadot validators directly validate parachain blocks — meaning parachains inherit the full economic security of the relay chain without running their own validator sets.

```
┌─────────────────────────────────────────────────────────────┐
│                  Polkadot Architecture                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Relay Chain (DOT staked, ~300 validators)                  │
│  └── Provides consensus (BABE + GRANDPA)                    │
│  └── Validates parachain blocks                             │
│  └── Routes XCM messages between parachains                 │
│       │           │           │           │                 │
│  ┌────┴───┐  ┌────┴───┐  ┌────┴───┐  ┌────┴───┐           │
│  │Para A  │  │Para B  │  │Para C  │  │Para D  │           │
│  │(Acala) │  │(Astar) │  │(Hydra) │  │(KILT)  │           │
│  │DeFi    │  │dApps   │  │DEX     │  │Identity│           │
│  └────────┘  └────────┘  └────────┘  └────────┘           │
│       │                                                     │
│  Collators: produce parachain blocks                        │
│  Validators: validate + finalize on relay chain             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Consensus: BABE + GRANDPA

Polkadot uses a hybrid consensus mechanism:

- **BABE (Blind Assignment for Blockchain Extension)**: Block production — validators take turns producing relay chain blocks in 6-second slots
- **GRANDPA (GHOST-based Recursive ANcestor Deriving Prefix Agreement)**: Finality gadget — finalizes batches of blocks, can finalize hundreds of blocks in a single round

This separation means block production continues even if finality stalls temporarily.

```rust
// Polkadot relay chain runtime configuration (simplified)
// Source: https://github.com/polkadot-fellows/runtimes
// polkadot-sdk@1.7.0

use frame_support::parameter_types;
use sp_consensus_babe::AuthorityId as BabeId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;

parameter_types! {
    /// BABE epoch duration — 2400 slots × 6 seconds = 4 hours per epoch
    pub const EpochDuration: u64 = 2400;
    /// Expected block time — 6 seconds
    pub const ExpectedBlockTime: u64 = 6000; // milliseconds
    /// Maximum number of authorities (validators)
    pub const MaxAuthorities: u32 = 300;
}

/// Configure BABE block production
impl pallet_babe::Config for Runtime {
    type EpochDuration = EpochDuration;
    type ExpectedBlockTime = ExpectedBlockTime;
    type MaxAuthorities = MaxAuthorities;
    // Validators are selected via NPoS (Nominated Proof of Stake)
    type KeyOwner = pallet_session::historical::NoteHistoricalRoot<Self, Staking>;
    // ... additional config
}
```

### Validators, Collators, and Nominators

| Role | Responsibility | Requirement |
|------|---------------|-------------|
| Validator | Validate parachain blocks, participate in relay chain consensus | Stake DOT, run high-availability node |
| Collator | Produce parachain blocks, submit to validators | Run parachain full node, no staking required |
| Nominator | Delegate DOT to validators | Stake DOT (minimum ~250 DOT) |

Validators are randomly assigned to parachain groups each session. A validator assigned to Parachain A checks that A's block is valid, then includes a proof in the relay chain block. This is called **Approval Voting** — additional randomly-selected validators double-check the work.

### Parachain Slot Model (Legacy)

Before Polkadot 2.0, parachains acquired slots through auctions:

1. Teams bid DOT in a candle auction
2. Winners lock DOT for 96 weeks (lease period)
3. Parachain gets guaranteed block inclusion every 6 seconds
4. After lease expires, DOT is returned

This model is being replaced by the coretime model (covered in Lesson 6).

### Notable Parachains

| Parachain | Focus | Key Feature |
|-----------|-------|-------------|
| Acala | DeFi hub | EVM+ compatibility, liquid staking (LDOT) |
| Astar | Multi-VM dApps | EVM + WASM smart contracts |
| HydraDX | DEX | Omnipool — single-sided liquidity provision |
| KILT | Identity | Decentralized identifiers (DIDs) and verifiable credentials |
| Moonbeam | EVM compatibility | Full Ethereum API compatibility on Polkadot |

## Common Pitfalls

1. **Confusing relay chain with a smart contract platform** — The relay chain intentionally has minimal functionality. You don't deploy contracts to it. All application logic lives on parachains. The relay chain only handles consensus, validation, and message routing.

2. **Assuming parachains are independent chains** — Parachains share the relay chain's validator set. They don't need their own economic security. This is fundamentally different from bridges between sovereign chains (like Cosmos IBC), where each chain secures itself.

3. **Ignoring the collator role** — Collators don't validate; they only produce blocks and hand them to validators. A malicious collator can censor transactions but cannot produce invalid state transitions — validators catch that.

4. **Expecting instant finality** — GRANDPA provides deterministic finality, but it takes ~12-60 seconds after block production. For time-sensitive operations, understand the difference between "block produced" and "block finalized."

## What to Learn Next

- [Substrate Pallets and FRAME](./02-substrate-pallets-frame.md) — Learn how to build blockchain logic using Substrate's modular pallet system
- [Polkadot Wiki: Architecture](https://wiki.polkadot.network/docs/learn-architecture) — Official deep dive into relay chain internals
- [Polkadot SDK GitHub](https://github.com/paritytech/polkadot-sdk) — Source code for the relay chain, Substrate, and Cumulus
