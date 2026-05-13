# Runtime Configuration: Composing Pallets into a Blockchain

**Track:** Polkadot & Substrate Development
**Lesson:** 3 of 6
**Level:** Intermediate → Advanced
**Read time:** 11 min

---

## The Problem

You've written a pallet, but how does it become part of a running blockchain? Substrate's runtime is where all pallets are composed together, configured, and compiled into a single WebAssembly blob that defines your chain's entire state transition function. Understanding runtime configuration is essential because misconfiguring it means your chain won't compile, won't produce blocks, or will have broken economics. Every parameter — block time, existential deposit, maximum block weight — directly affects your chain's behavior.

## Core Concepts

### What is the Runtime?

The runtime is the state transition function of your blockchain. It's compiled to both native code (for speed) and WebAssembly (for deterministic execution and forkless upgrades). The runtime:

1. Defines which pallets exist on your chain
2. Configures each pallet's parameters
3. Wires pallets together (e.g., Balances pallet provides currency for Staking pallet)
4. Sets block limits, fees, and economic parameters

### The `construct_runtime!` Macro

This macro assembles all pallets into the runtime:

```rust
// runtime/src/lib.rs
// polkadot-sdk@1.7.0

use frame_support::construct_runtime;

construct_runtime!(
    pub struct Runtime {
        // System pallets (required for any chain)
        System: frame_system = 0,
        Timestamp: pallet_timestamp = 1,
        
        // Consensus
        Aura: pallet_aura = 2,           // Block production (PoA for dev)
        Grandpa: pallet_grandpa = 3,     // Finality
        
        // Economics
        Balances: pallet_balances = 10,
        TransactionPayment: pallet_transaction_payment = 11,
        
        // Governance
        Sudo: pallet_sudo = 20,          // Dev-only superuser
        
        // Custom pallets
        KvStore: pallet_kv_store = 50,
        MyDex: pallet_dex = 51,
    }
);
```

The `= N` assigns a stable pallet index. Like call indices, these must never change after launch — they're used in transaction encoding and storage key derivation.

### Configuring `frame_system`

Every Substrate chain needs `frame_system` configured. This defines fundamental types:

```rust
// runtime/src/lib.rs
// polkadot-sdk@1.7.0

use frame_support::parameter_types;
use frame_system::limits::{BlockLength, BlockWeights};
use sp_runtime::traits::{BlakeTwo256, IdentityLookup};

parameter_types! {
    pub const BlockHashCount: u32 = 2400;
    /// Maximum block weight: 2 seconds of compute, 5 MB proof size
    pub BlockWeightsConfig: BlockWeights = BlockWeights::builder()
        .base_block(Weight::from_parts(5_000_000, 0))
        .for_class(DispatchClass::Normal, |weights| {
            weights.max_total = Some(
                Weight::from_parts(NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT.ref_time(), 0)
            );
        })
        .for_class(DispatchClass::Operational, |weights| {
            weights.max_total = Some(MAXIMUM_BLOCK_WEIGHT);
        })
        .build_or_panic();
    pub BlockLengthConfig: BlockLength = BlockLength::max(5 * 1024 * 1024); // 5 MB
    pub const SS58Prefix: u8 = 42; // Generic Substrate prefix
}

impl frame_system::Config for Runtime {
    /// The identifier used to distinguish between accounts
    type AccountId = sp_runtime::AccountId32;
    /// The hashing algorithm used (Blake2-256)
    type Hashing = BlakeTwo256;
    /// The block number type
    type BlockNumber = u32;
    /// Maximum number of block number to block hash mappings to keep
    type BlockHashCount = BlockHashCount;
    /// The weight configuration for blocks
    type BlockWeights = BlockWeightsConfig;
    /// The maximum length of a block (in bytes)
    type BlockLength = BlockLengthConfig;
    /// The SS58 address prefix
    type SS58Prefix = SS58Prefix;
    /// The overarching event type
    type RuntimeEvent = RuntimeEvent;
    /// The overarching call type
    type RuntimeCall = RuntimeCall;
    /// Account lookup mechanism
    type Lookup = IdentityLookup<Self::AccountId>;
    /// Version of the runtime
    type Version = Version;
    // ... additional required types
}
```

### Configuring the Balances Pallet

The Balances pallet manages native token balances. Key parameters:

```rust
// runtime/src/lib.rs
// polkadot-sdk@1.7.0

parameter_types! {
    /// Minimum balance to keep an account alive.
    /// Accounts below this are reaped (deleted) to prevent state bloat.
    pub const ExistentialDeposit: u128 = 1_000_000_000; // 0.001 TOKEN (12 decimals)
    
    /// Maximum number of locks on a single account
    pub const MaxLocks: u32 = 50;
    
    /// Maximum number of named reserves on a single account
    pub const MaxReserves: u32 = 50;
}

impl pallet_balances::Config for Runtime {
    /// The balance type (u128 supports up to ~3.4 × 10^38)
    type Balance = u128;
    
    /// Event type
    type RuntimeEvent = RuntimeEvent;
    
    /// Handler for unbalanced reductions (e.g., slashing goes to treasury)
    type DustRemoval = ();  // Dust is burned
    
    /// Minimum balance for account existence
    type ExistentialDeposit = ExistentialDeposit;
    
    /// Account storage provider
    type AccountStore = System;
    
    /// Weight information for dispatchables
    type WeightInfo = pallet_balances::weights::SubstrateWeight<Runtime>;
    
    type MaxLocks = MaxLocks;
    type MaxReserves = MaxReserves;
    type ReserveIdentifier = [u8; 8];
    
    /// Who can force-set balances (nobody in production, Sudo in dev)
    type ForcedOrigin = frame_system::EnsureRoot<Self::AccountId>;
}
```

### Wiring Your Custom Pallet

Connect your custom pallet to the runtime by implementing its Config trait:

```rust
// runtime/src/lib.rs — configuring the KvStore pallet from Lesson 2
// polkadot-sdk@1.7.0

parameter_types! {
    pub const MaxValueLength: u32 = 1024; // 1 KB max per stored value
}

impl pallet_kv_store::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type MaxValueLength = MaxValueLength;
}
```

### Chain Specification (chain_spec.rs)

The chain spec defines genesis state — initial balances, authorities, and pallet configurations:

```rust
// node/src/chain_spec.rs
// polkadot-sdk@1.7.0

use sc_service::ChainType;
use sp_core::sr25519;

pub fn development_config() -> Result<ChainSpec, String> {
    Ok(ChainSpec::builder(
        WASM_BINARY.ok_or("WASM binary not available")?,
        None,
    )
    .with_name("Development")
    .with_id("dev")
    .with_chain_type(ChainType::Development)
    .with_genesis_config_patch(serde_json::json!({
        "balances": {
            "balances": [
                // Alice gets 1,000,000 tokens for testing
                [get_account_id_from_seed::<sr25519::Public>("Alice"), 1_000_000_000_000_000_000u128],
                // Bob gets 1,000,000 tokens
                [get_account_id_from_seed::<sr25519::Public>("Bob"), 1_000_000_000_000_000_000u128],
            ]
        },
        "aura": {
            "authorities": [
                get_from_seed::<AuraId>("Alice"),
            ]
        },
        "grandpa": {
            "authorities": [
                [get_from_seed::<GrandpaId>("Alice"), 1],
            ]
        },
        "sudo": {
            "key": Some(get_account_id_from_seed::<sr25519::Public>("Alice"))
        }
    }))
    .build())
}
```

## Deployment

```shell
# Build the runtime (compiles to WASM + native)
cargo build --release
```

```
Expected output:
   Compiling my-chain-runtime v0.1.0
   Compiling my-chain-node v0.1.0
    Finished release [optimized] target(s) in 4m 32s
```

```shell
# Run a development node with temporary state
./target/release/my-chain-node --dev --tmp
```

```
Expected output:
2025-01-15 10:00:00 Substrate Node
2025-01-15 10:00:00 ✌️  version 0.1.0-dev
2025-01-15 10:00:00 🏷  Node name: my-chain-dev-node
2025-01-15 10:00:00 💾  Chain specification: Development
2025-01-15 10:00:01 🏁 Imported #0 (0x1234…abcd)
2025-01-15 10:00:06 🙌 Starting consensus session on top of parent 0x1234…abcd
2025-01-15 10:00:06 ✨ Imported #1 (0x5678…efgh)
```

```shell
# Interact via Polkadot.js Apps (browser UI)
# Navigate to: https://polkadot.js.org/apps/?rpc=ws://127.0.0.1:9944
# Or use subxt CLI for programmatic interaction:
cargo install subxt-cli@0.34.0
subxt metadata --url ws://127.0.0.1:9944 > metadata.scale
```

## Common Pitfalls

1. **Changing pallet indices after launch** — The number in `construct_runtime!` (e.g., `Balances: pallet_balances = 10`) is baked into storage keys. Changing it after genesis means all existing storage becomes inaccessible. Always assign explicit indices and never reorder.

2. **Setting ExistentialDeposit too low** — A low existential deposit means millions of dust accounts can bloat your state. Polkadot uses 1 DOT (~$7), Kusama uses 0.000033 KSM. Choose based on your token economics.

3. **Forgetting to add your pallet to `construct_runtime!`** — Your pallet compiles fine in isolation, but if you don't add it to the runtime macro, it doesn't exist on-chain. The compiler won't warn you about this omission.

4. **Ignoring weight limits** — `BlockWeights` defines how much computation fits in a block. If your pallet's extrinsics exceed the per-block limit, transactions will be rejected. Always benchmark and set realistic weights.

## What to Learn Next

- [Building a Parachain](./04-building-a-parachain.md) — Take your runtime and connect it to the Polkadot relay chain as a parachain
- [Substrate Docs: Runtime Configuration](https://docs.substrate.io/build/runtime-storage/) — Official guide to storage and runtime setup
- [Polkadot SDK Templates](https://github.com/paritytech/polkadot-sdk/tree/master/templates) — Starter templates for parachain and solochain development
