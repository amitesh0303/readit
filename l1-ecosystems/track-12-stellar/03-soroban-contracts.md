# Soroban Smart Contracts

**Track:** Stellar Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

You've set up your Stellar development environment and understand the network architecture. Now you need to write custom on-chain logic that goes beyond Stellar's built-in operations. Soroban lets you deploy Rust-based smart contracts to Stellar, but its programming model differs significantly from Solidity — there's no global state, contracts must declare resource usage upfront, and state can expire. Without understanding these constraints, you'll write contracts that fail to deploy, exceed resource limits, or lose data to archival.

## Core Concepts

### Soroban Contract Structure

Every Soroban contract follows this pattern:

```rust
// soroban-sdk = "21.0.0"
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Env, Address, Symbol, Vec, log};

// Define custom types stored on-chain
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Counter,
    Admin,
    LastCaller,
}

// Declare the contract struct
#[contract]
pub struct CounterContract;

// Implement contract methods
#[contractimpl]
impl CounterContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) {
        // Require that the admin authorized this call
        admin.require_auth();

        // Check not already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        // Store admin in instance storage (lives as long as the contract)
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0u32);

        log!(&env, "Counter initialized by admin: {}", admin);
    }

    /// Increment the counter — anyone can call
    pub fn increment(env: Env, caller: Address) -> u32 {
        caller.require_auth();

        // Read current value
        let mut count: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        count += 1;

        // Write updated value
        env.storage().instance().set(&DataKey::Counter, &count);
        env.storage().instance().set(&DataKey::LastCaller, &caller);

        // Extend TTL to prevent archival (extend by 100,000 ledgers ≈ 6 days)
        env.storage().instance().extend_ttl(50_000, 100_000);

        count
    }

    /// Read the current count (no auth required for reads)
    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    /// Get the last caller address
    pub fn get_last_caller(env: Env) -> Address {
        env.storage().instance().get(&DataKey::LastCaller)
            .expect("no calls yet")
    }
}
```

### Storage Types

Soroban has three storage tiers with different costs and lifetimes:

```rust
// soroban-sdk = "21.0.0"
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Env, Address};

#[contracttype]
pub enum DataKey {
    Config,          // Instance storage — lives with contract
    Balance(Address), // Persistent storage — survives independently
    Session(u64),    // Temporary storage — cheapest, shortest TTL
}

#[contract]
pub struct StorageExample;

#[contractimpl]
impl StorageExample {
    pub fn demo_storage(env: Env, user: Address) {
        // Instance storage: shared contract-wide state
        // TTL tied to the contract instance itself
        // Best for: config, admin address, global counters
        env.storage().instance().set(&DataKey::Config, &true);
        env.storage().instance().extend_ttl(50_000, 100_000);

        // Persistent storage: per-entry TTL, survives independently
        // More expensive but each entry has its own lifetime
        // Best for: user balances, NFT ownership, per-user data
        env.storage().persistent().set(&DataKey::Balance(user.clone()), &1000u64);
        env.storage().persistent().extend_ttl(&DataKey::Balance(user), 50_000, 100_000);

        // Temporary storage: cheapest, shortest TTL, no restore possible
        // Deleted permanently after expiry
        // Best for: session data, caches, one-time flags
        env.storage().temporary().set(&DataKey::Session(1), &true);
        env.storage().temporary().extend_ttl(&DataKey::Session(1), 1_000, 5_000);
    }
}
```

| Storage Type | Cost | TTL | Restorable | Use Case |
|-------------|------|-----|------------|----------|
| Instance | Medium | Contract-wide | Yes | Config, admin, global state |
| Persistent | High | Per-entry | Yes | Balances, ownership |
| Temporary | Low | Per-entry | No | Caches, sessions |

### Writing Tests

Soroban has a built-in test framework that simulates the blockchain environment:

```rust
// soroban-sdk = "21.0.0"
#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{CounterContract, CounterContractClient};

#[test]
fn test_increment() {
    // Create a simulated environment
    let env = Env::default();
    env.mock_all_auths();

    // Deploy the contract
    let contract_id = env.register_contract(None, CounterContract);
    let client = CounterContractClient::new(&env, &contract_id);

    // Initialize
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Increment and verify
    let caller = Address::generate(&env);
    let result = client.increment(&caller);
    assert_eq!(result, 1);

    let result = client.increment(&caller);
    assert_eq!(result, 2);

    // Verify read
    assert_eq!(client.get_count(), 2);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CounterContract);
    let client = CounterContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}
```

### Building and Deploying

```shell
# Build the contract
stellar contract build

# Expected output:
# Compiling counter-contract v0.1.0
# Finished release [optimized] target(s)

# Optimize the WASM (reduces size and cost)
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/counter_contract.wasm

# Expected output:
# Optimized: target/wasm32-unknown-unknown/release/counter_contract.optimized.wasm
# Size: 1.2 KB (down from 4.8 KB)
```

Deploy to testnet:

```shell
# Deploy the contract (returns contract ID)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/counter_contract.optimized.wasm \
  --network testnet \
  --source alice

# Expected output:
# CABC...XYZ (contract address, starts with C)
```

```shell
# Invoke the initialize function
stellar contract invoke \
  --id CABC...XYZ \
  --network testnet \
  --source alice \
  -- \
  initialize \
  --admin $(stellar keys address alice)

# Expected output:
# (transaction hash)
```

```shell
# Invoke increment
stellar contract invoke \
  --id CABC...XYZ \
  --network testnet \
  --source alice \
  -- \
  increment \
  --caller $(stellar keys address alice)

# Expected output:
# 1
```

```shell
# Read the count (simulation only, no fee)
stellar contract invoke \
  --id CABC...XYZ \
  --network testnet \
  --source alice \
  --is-view \
  -- \
  get_count

# Expected output:
# 1
```

### Resource Limits and Fees

Soroban transactions declare resource usage upfront. The CLI simulates this automatically:

```shell
# Simulate a transaction to see resource costs
stellar contract invoke \
  --id CABC...XYZ \
  --network testnet \
  --source alice \
  --sim-only \
  -- \
  increment \
  --caller $(stellar keys address alice)
```

```
Expected output:
Simulation results:
  CPU instructions: 1,234,567
  Memory bytes: 45,678
  Ledger reads: 3
  Ledger writes: 2
  Transaction size: 456 bytes
  Estimated fee: 100 stroops (0.00001 XLM)
```

Resource limits per transaction:
- CPU: 100,000,000 instructions
- Memory: 40 MB
- Ledger entry reads: 40
- Ledger entry writes: 25
- Transaction size: 71,680 bytes

### Cargo.toml Configuration

```toml
[package]
name = "counter-contract"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "21.0.0"

[dev-dependencies]
soroban-sdk = { version = "21.0.0", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true

[profile.release-with-logs]
inherits = "release"
debug-assertions = true
```

## Common Pitfalls

1. **Forgetting to extend TTL** — Soroban state expires. If you don't call `extend_ttl()` on your storage entries, they'll be archived after the default TTL (~30 days on mainnet). Once archived, data is inaccessible until restored (which costs fees). Always extend TTL in write operations.

2. **Not optimizing WASM before deploy** — Unoptimized contracts can be 4-5x larger than necessary. Larger WASM means higher deployment fees and slower execution. Always run `stellar contract optimize` before deploying.

3. **Missing `require_auth()` on state-changing functions** — Unlike Solidity's `msg.sender`, Soroban doesn't implicitly know who's calling. You must explicitly pass the caller address and call `require_auth()` to verify they signed the transaction. Forgetting this means anyone can call your function as any user.

4. **Using temporary storage for important data** — Temporary storage cannot be restored after expiry. If you store user balances or ownership records in temporary storage, that data is permanently lost when the TTL expires. Use persistent storage for anything that must survive.

## What to Learn Next

- [Asset Issuance](./04-asset-issuance.md) — Issue custom tokens using Stellar Classic operations and trust lines
- [Soroban Examples Repository](https://github.com/stellar/soroban-examples) — Official contract examples covering tokens, liquidity pools, and more
