# Development Environment Setup

**Track:** Stellar Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You want to start building on Stellar but don't know which tools to install, how to configure them for testnet, or how to get test funds. Stellar has two distinct development paths — Classic operations (SDK-only) and Soroban smart contracts (Rust toolchain) — and you need both. Without a properly configured environment, you'll waste hours debugging connection issues, missing dependencies, and failed deployments.

## Core Concepts

### Tool Landscape

Stellar development requires different tools depending on what you're building:

```
┌─────────────────────────────────────────────────┐
│  Stellar Development Tools                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  Classic Operations:                            │
│  └── @stellar/stellar-sdk (JavaScript/TS)       │
│  └── Horizon API (REST + SSE)                   │
│  └── Stellar Laboratory (web UI)                │
│                                                 │
│  Soroban Smart Contracts:                       │
│  └── Rust + wasm32 target                       │
│  └── soroban-cli (build, deploy, invoke)        │
│  └── stellar-cli (network management)           │
│  └── soroban-sdk (Rust crate)                   │
│                                                 │
│  Wallet:                                        │
│  └── Freighter (browser extension)              │
│  └── Supports Classic + Soroban signing         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Step 1: Install Rust and WASM Target

Soroban contracts compile to WebAssembly. You need Rust with the WASM target:

```shell
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target for Soroban compilation
rustup target add wasm32-unknown-unknown

# Verify installation
rustc --version
# Expected: rustc 1.79.0 or later

cargo --version
# Expected: cargo 1.79.0 or later
```

### Step 2: Install Stellar CLI and Soroban CLI

The Stellar CLI manages network configuration and identity. The Soroban CLI handles contract operations:

```shell
# Install stellar-cli (includes soroban subcommands)
# soroban-cli@21.0.0
cargo install --locked stellar-cli --version 21.0.0

# Verify installation
stellar --version
# Expected: stellar 21.0.0

# The soroban command is now a subcommand of stellar
stellar soroban --help
```

### Step 3: Configure Testnet Network

```shell
# Add testnet network configuration
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Verify network config
stellar network ls
# Expected output:
# testnet
#   RPC URL: https://soroban-testnet.stellar.org
#   Passphrase: Test SDF Network ; September 2015
```

### Step 4: Create and Fund a Testnet Identity

```shell
# Generate a new identity (keypair stored locally)
stellar keys generate alice --network testnet

# Fund the account using Friendbot
stellar keys fund alice --network testnet

# Check the address
stellar keys address alice
# Expected: G... (56-character public key)

# Verify funding via Horizon API
curl "https://horizon-testnet.stellar.org/accounts/$(stellar keys address alice)" | jq '.balances'
# Expected: [{ "asset_type": "native", "balance": "10000.0000000" }]
```

You can also fund accounts directly via the Friendbot URL:

```shell
# Direct Friendbot request (alternative to CLI)
curl "https://friendbot.stellar.org/?addr=GABC...YOUR_PUBLIC_KEY"
```

```
Expected output:
{
  "hash": "abc123...",
  "_links": { "transaction": { "href": "..." } }
}
```

### Step 5: Install JavaScript SDK

For frontend integration and Classic operations, install the Stellar SDK:

```shell
# Create a new project
mkdir stellar-app && cd stellar-app
npm init -y

# Install Stellar SDK
# @stellar/stellar-sdk@11.0.0
npm install @stellar/stellar-sdk@11.0.0
```

Verify the SDK works with a testnet connection:

```javascript
// test-connection.mjs
// @stellar/stellar-sdk@11.0.0
import { Horizon } from '@stellar/stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

async function checkNetwork() {
  try {
    const root = await server.root();
    console.log('Connected to:', root.network_passphrase);
    console.log('Horizon version:', root.horizon_version);
    console.log('Core version:', root.core_version);
  } catch (error) {
    console.error('Connection failed:', error.message);
    process.exit(1);
  }
}

checkNetwork();
```

```shell
node test-connection.mjs
```

```
Expected output:
Connected to: Test SDF Network ; September 2015
Horizon version: 2.28.0
Core version: v20.0.0
```

### Step 6: Install Freighter Wallet

Freighter is the standard browser wallet for Stellar (Classic + Soroban):

1. Install from [freighter.app](https://www.freighter.app/) or Chrome Web Store
2. Create or import a wallet
3. Switch to **Testnet** in Settings → Network
4. Fund your Freighter address using Friendbot:

```shell
# Fund your Freighter wallet address
curl "https://friendbot.stellar.org/?addr=YOUR_FREIGHTER_PUBLIC_KEY"
```

### Step 7: Create a Soroban Project

```shell
# Initialize a new Soroban contract project
stellar contract init my-first-contract

# Project structure:
# my-first-contract/
# ├── Cargo.toml
# ├── src/
# │   └── lib.rs        ← Contract code
# └── test/
#     └── test.rs       ← Contract tests

cd my-first-contract
```

Verify the project builds:

```shell
# Build the contract to WASM
stellar contract build

# Expected output:
# Compiling my-first-contract v0.1.0
# Finished release [optimized] target(s)
# Output: target/wasm32-unknown-unknown/release/my_first_contract.wasm
```

### Step 8: Run Contract Tests

```shell
# Run the built-in test suite
cargo test
```

```
Expected output:
running 1 test
test test::test_hello ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

### Complete Environment Checklist

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | ≥1.79.0 | Soroban contract language |
| wasm32-unknown-unknown | (target) | WASM compilation target |
| stellar-cli | 21.0.0 | Network management, contract ops |
| @stellar/stellar-sdk | 11.0.0 | JavaScript SDK for Classic + Soroban |
| Freighter | Latest | Browser wallet for signing |
| Node.js | ≥18.0.0 | Running JS/TS scripts |

## Common Pitfalls

1. **Missing WASM target** — Running `stellar contract build` without `wasm32-unknown-unknown` installed gives a cryptic compilation error. Always run `rustup target add wasm32-unknown-unknown` before building contracts.

2. **Using outdated soroban-cli** — Soroban is evolving rapidly. Contracts built with CLI v20 may not deploy with v21 due to protocol changes. Pin your CLI version (`cargo install --locked stellar-cli --version 21.0.0`) and match it to your `soroban-sdk` crate version.

3. **Forgetting to fund accounts** — Unlike Ethereum where you can deploy to any address, Stellar accounts must exist on-chain before they can sign transactions. Always fund via Friendbot (`https://friendbot.stellar.org/?addr={ADDRESS}`) before attempting any operations.

4. **Confusing stellar-cli and soroban-cli** — As of 2024, `soroban-cli` is merged into `stellar-cli`. The `soroban` command is now `stellar soroban`. Old tutorials referencing standalone `soroban` binary are outdated.

## What to Learn Next

- [Soroban Smart Contracts](./03-soroban-contracts.md) — Write and deploy your first Rust-based smart contract on Stellar testnet
- [Stellar Laboratory](https://laboratory.stellar.org/) — Web-based tool for building and submitting transactions without code
