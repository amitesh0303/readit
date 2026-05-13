# Stellar Overview and Architecture

**Track:** Stellar Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You need a blockchain optimized for payments and asset tokenization — fast finality, negligible fees, and built-in support for issuing custom tokens without writing smart contracts. Ethereum gives you programmability but costs dollars per transaction. You've heard Stellar settles in 5 seconds for fractions of a cent, but you don't understand how its consensus differs from PoS chains, what the Soroban VM adds, or how the account model works. Without this foundation, you'll misuse Stellar's unique primitives and build patterns that belong on EVM chains.

## Core Concepts

### Stellar Network Architecture

Stellar is a purpose-built payment and asset network with a smart contract layer (Soroban) added in 2023:

```
┌─────────────────────────────────────────────────┐
│              Stellar Network                     │
├─────────────────────────────────────────────────┤
│                                                 │
│  Stellar Classic Layer                          │
│  └── Built-in operations (payments, offers)     │
│  └── Asset issuance via trust lines             │
│  └── Decentralized exchange (SDEX)              │
│  └── Path payments (atomic multi-hop swaps)     │
│                                                 │
│  Soroban Smart Contracts (2023+)                │
│  └── WASM-based VM for custom logic             │
│  └── Rust-based contract development            │
│  └── Separate fee market from Classic           │
│                                                 │
│  Horizon API                                    │
│  └── RESTful interface to the network           │
│  └── Streaming endpoints (SSE)                  │
│  └── Transaction submission and queries         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Stellar Consensus Protocol (SCP)

Stellar uses the Federated Byzantine Agreement (FBA) model — not Proof of Work, not Proof of Stake:

```
┌─────────────────────────────────────────────────┐
│  Stellar Consensus Protocol (SCP)               │
├─────────────────────────────────────────────────┤
│                                                 │
│  Key Properties:                                │
│  • No mining, no staking rewards                │
│  • Nodes choose which other nodes to trust      │
│  • Quorum slices form overlapping trust sets    │
│  • Consensus in 3-5 seconds                     │
│  • No probabilistic finality — absolute         │
│                                                 │
│  Quorum Slice Example:                          │
│  Node A trusts: {B, C, D} (needs 2/3 agree)    │
│  Node B trusts: {A, C, E} (needs 2/3 agree)    │
│  Overlapping trust → network-wide agreement     │
│                                                 │
└─────────────────────────────────────────────────┘
```

Unlike PoS chains where validators are selected by stake weight, SCP lets each node define its own trust set (quorum slice). The network reaches consensus when enough quorum slices overlap. This means:

- **No leader election** — all nodes participate equally
- **Safety over liveness** — the network halts rather than forks
- **5-second finality** — once confirmed, transactions never revert
- **No inflation rewards** — validators run nodes for network access, not block rewards

### Account Model

Stellar accounts are fundamentally different from Ethereum addresses:

```javascript
// @stellar/stellar-sdk@11.0.0
import { Keypair } from '@stellar/stellar-sdk';

// Generate a new keypair
const pair = Keypair.random();

console.log('Public Key:', pair.publicKey());
// G... (56 chars, starts with G)

console.log('Secret Key:', pair.secret());
// S... (56 chars, starts with S)

// Accounts must be funded to exist on-chain
// Minimum balance: 1 XLM (base reserve) + 0.5 XLM per subentry
// Subentries: trust lines, offers, signers, data entries
```

Key differences from Ethereum:

| Property | Stellar | Ethereum |
|----------|---------|----------|
| Address format | G... (Ed25519 public key) | 0x... (secp256k1) |
| Account creation | Explicit (requires funding) | Implicit (any address valid) |
| Minimum balance | 1 XLM + 0.5 per subentry | None (but gas needed) |
| Native operations | 20+ built-in (payment, offer, etc.) | Only transfer |
| Smart contracts | Soroban (WASM/Rust) | EVM (Solidity) |
| Transaction fees | ~0.00001 XLM ($0.000001) | Variable (gas × gas price) |

### Soroban VM — Smart Contracts on Stellar

Soroban is Stellar's smart contract platform, launched in 2023. It runs WebAssembly (WASM) contracts written in Rust:

```rust
// A minimal Soroban contract
// soroban-sdk = "21.0.0"
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, to: Symbol) -> Symbol {
        let greeting = symbol_short!("Hello");
        env.events().publish((symbol_short!("hello"),), &to);
        greeting
    }
}
```

Soroban design choices:

- **Separate fee market** — Soroban fees don't compete with Classic operations
- **State archival** — unused contract state expires (can be restored)
- **Resource metering** — CPU, memory, ledger I/O all have explicit limits
- **No global state** — contracts declare which ledger entries they access upfront

### Horizon API

Horizon is the HTTP API server that connects to the Stellar network:

```javascript
// @stellar/stellar-sdk@11.0.0
import { Horizon } from '@stellar/stellar-sdk';

// Connect to testnet
const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Query account info
const account = await server.loadAccount('GABC...XYZ');
console.log('Balances:', account.balances);
// [{ asset_type: 'native', balance: '100.0000000' }, ...]

// Stream payments in real-time (Server-Sent Events)
server.payments()
  .forAccount('GABC...XYZ')
  .cursor('now')
  .stream({
    onmessage: (payment) => {
      console.log('Payment received:', payment.amount, payment.asset_type);
    }
  });
```

### Network Details

| Property | Mainnet | Testnet |
|----------|---------|---------|
| Network Passphrase | Public Global Stellar Network ; September 2015 | Test SDF Network ; September 2015 |
| Horizon URL | https://horizon.stellar.org | https://horizon-testnet.stellar.org |
| Friendbot (faucet) | N/A | https://friendbot.stellar.org/?addr={ADDRESS} |
| Soroban RPC | https://soroban-rpc.mainnet.stellar.gateway.fm | https://soroban-testnet.stellar.org |
| Block time | ~5 seconds | ~5 seconds |
| Base fee | 100 stroops (0.00001 XLM) | 100 stroops |

## Common Pitfalls

1. **Treating Stellar like an EVM chain** — Stellar Classic has 20+ built-in operations (payments, offers, path payments) that don't require smart contracts. Deploying a Soroban contract for simple token transfers wastes resources. Use Classic operations for payments and asset management; use Soroban only for custom logic.

2. **Forgetting account minimum balances** — Unlike Ethereum where any address can receive funds, Stellar accounts must maintain a minimum balance (1 XLM base + 0.5 XLM per subentry). Creating trust lines and offers increases this requirement. Running out of reserve locks the account.

3. **Ignoring state archival in Soroban** — Soroban contract state expires if not accessed within the TTL window. Your contract data can disappear from the ledger. You must either extend TTL proactively or handle state restoration in your application logic.

4. **Confusing network passphrases** — Transactions signed for testnet won't work on mainnet and vice versa. The network passphrase is part of the transaction hash. Always verify you're using the correct passphrase for your target network.

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install Stellar CLI, Soroban CLI, and configure Freighter wallet for testnet
- [Stellar Developer Docs](https://developers.stellar.org/) — Complete reference for Classic operations and Soroban contracts
