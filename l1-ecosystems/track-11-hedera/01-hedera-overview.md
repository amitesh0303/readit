# Hedera Overview and Hashgraph Consensus

**Track:** Hedera Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to build applications that need fast finality, predictable fees, and enterprise-grade throughput, but traditional blockchains force you to choose between decentralization and performance. You've heard Hedera uses "Hashgraph" instead of a blockchain, achieves 10,000+ TPS with 3-5 second finality, and has a governing council of global enterprises — but you don't understand how it differs from a blockchain, what aBFT means for your application, or which of Hedera's multiple services (HCS, HTS, HSC) you should use for your use case.

## Core Concepts

### Hashgraph vs Blockchain

Hedera doesn't use a blockchain. It uses a Directed Acyclic Graph (DAG) structure called a Hashgraph, which achieves consensus through a protocol called "gossip about gossip" combined with virtual voting:

```
Traditional Blockchain:          Hashgraph:
                                 
Block 1 → Block 2 → Block 3     Events form a DAG (no linear chain)
                                 
┌───┐   ┌───┐   ┌───┐           A₁──┐    B₁──┐
│Tx1│──▶│Tx4│──▶│Tx7│              │       │
│Tx2│   │Tx5│   │Tx8│           A₂──┼──B₂──┘
│Tx3│   │Tx6│   │Tx9│              │    │
└───┘   └───┘   └───┘           A₃──┘  B₃──C₁
                                 
One block at a time              All nodes gossip simultaneously
Sequential                       Parallel, asynchronous
```

### Asynchronous Byzantine Fault Tolerance (aBFT)

Hedera's consensus is aBFT — the strongest form of Byzantine fault tolerance:

- **Tolerates** up to 1/3 of nodes being malicious or offline
- **No leader** — no single node can stall the network
- **Asynchronous** — reaches consensus regardless of network timing assumptions
- **Finality in 3-5 seconds** — once consensus is reached, transactions cannot be reversed

This means your application gets mathematical certainty of transaction ordering, not probabilistic finality like Ethereum's PoS.

### Hedera Network Services

Hedera provides purpose-built services rather than forcing everything through smart contracts:

```
┌─────────────────────────────────────────────────────┐
│                  Hedera Network                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  HCS (Hedera Consensus Service)                     │
│  └── Ordered, timestamped messages                  │
│  └── Use case: audit logs, supply chain, pub/sub    │
│                                                     │
│  HTS (Hedera Token Service)                         │
│  └── Create tokens WITHOUT smart contracts          │
│  └── Fungible + NFTs, native compliance features    │
│                                                     │
│  HSC (Hedera Smart Contract Service)                │
│  └── EVM-compatible Solidity contracts              │
│  └── Runs on HyperLedger Besu EVM                  │
│                                                     │
│  HFS (Hedera File Service)                          │
│  └── Immutable file storage on-network              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Account Model

Hedera uses an account-based model (like Ethereum), but with key differences:

```javascript
// Hedera account structure
// Account ID format: 0.0.XXXXX (shard.realm.number)
// Example: 0.0.12345

// Accounts can have:
// - Ed25519 keys (default)
// - ECDSA secp256k1 keys (Ethereum-compatible)
// - Multi-sig threshold keys
// - Key rotation without changing account ID
```

| Property | Hedera | Ethereum |
|----------|--------|----------|
| Account ID | 0.0.12345 (shard.realm.num) | 0x... (20-byte address) |
| Key type | Ed25519 or ECDSA | ECDSA secp256k1 only |
| Account creation | Explicit (costs HBAR) | Implicit (first tx) |
| Key rotation | Supported natively | Not possible |
| Memo field | Built-in per account | Not native |

### Network Details

| Property | Mainnet | Testnet | Previewnet |
|----------|---------|---------|------------|
| Network | mainnet | testnet | previewnet |
| Mirror Node | https://mainnet.mirrornode.hedera.com | https://testnet.mirrornode.hedera.com | https://previewnet.mirrornode.hedera.com |
| Explorer | https://hashscan.io/mainnet | https://hashscan.io/testnet | https://hashscan.io/previewnet |
| Native Token | HBAR | Test HBAR | Preview HBAR |
| Portal | — | https://portal.hedera.com/ | https://portal.hedera.com/ |

### Fee Structure

Hedera fees are fixed in USD (paid in HBAR at market rate):

- **Crypto transfer:** $0.0001
- **Token transfer (HTS):** $0.001
- **Smart contract call:** $0.05-0.10 (depends on gas)
- **Consensus message (HCS):** $0.0001
- **Token creation (HTS):** $1.00

Fees are predictable — they don't spike during network congestion like Ethereum gas auctions.

## Common Pitfalls

1. **Treating Hedera like a typical blockchain** — Hedera is a DAG-based DLT with purpose-built services. Using smart contracts for everything (tokens, messages) when native services (HTS, HCS) are cheaper and faster is a common mistake. Check if a native service handles your use case before writing a contract.

2. **Forgetting account creation costs** — Unlike Ethereum where any address can receive funds, Hedera accounts must be explicitly created (costs ~$0.05). Your onboarding flow needs to handle account creation for new users.

3. **Ignoring the mirror node for queries** — The consensus nodes handle transactions; mirror nodes handle queries. Reading state from consensus nodes is expensive. Always use the mirror node REST API for reads (balances, transaction history, token info).

4. **Assuming EVM equivalence** — While Hedera runs Solidity via Besu EVM, there are differences: no `SELFDESTRUCT`, different gas costs, 15M gas limit per contract call, and HTS precompile contracts for token operations. Test thoroughly on testnet.

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install the Hedera SDK, configure testnet access, and set up HashPack wallet
- [Hedera Documentation](https://docs.hedera.com/) — Complete reference for all Hedera services
