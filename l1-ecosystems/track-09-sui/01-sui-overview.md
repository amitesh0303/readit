# Sui Overview and Architecture

**Track:** Sui Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You've heard Sui can process 100,000+ transactions per second with sub-second finality, but you don't understand how. Traditional blockchains process transactions sequentially — every validator re-executes every transaction in order. Sui breaks this model with an object-centric architecture that enables parallel execution. Without understanding how objects, ownership, and consensus interact, you'll write contracts that accidentally serialize execution and lose Sui's performance advantages.

## Core Concepts

### Object-Centric Model

Unlike Ethereum's account-based model where all state lives in a global mapping, Sui treats everything as an **object** with a unique ID. Each object has exactly one owner, and transactions that touch different objects can execute in parallel without coordination.

```
┌─────────────────────────────────────────────────────┐
│              Sui Object Model                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Ethereum (Account Model):                          │
│  ┌──────────────────────────────┐                   │
│  │ Global State Trie            │                   │
│  │  address → { balance, nonce, │                   │
│  │             storage_root }   │                   │
│  └──────────────────────────────┘                   │
│  All txs read/write same trie → sequential          │
│                                                     │
│  Sui (Object Model):                                │
│  ┌────────┐ ┌────────┐ ┌────────┐                  │
│  │ Obj A  │ │ Obj B  │ │ Obj C  │                  │
│  │owner:0x│ │owner:0x│ │shared  │                  │
│  │ Alice  │ │  Bob   │ │        │                  │
│  └────────┘ └────────┘ └────────┘                  │
│  Tx on A ∥ Tx on B → parallel execution            │
│  Tx on C → consensus required                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Object Types and Ownership

Sui defines three ownership categories that determine how transactions are processed:

```move
module examples::ownership {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::transfer;

    /// Owned object — only the owner can use it in transactions.
    /// Transactions on owned objects skip consensus (fast path).
    struct OwnedNFT has key, store {
        id: UID,
        name: vector<u8>,
    }

    /// Shared object — anyone can read/write.
    /// Transactions on shared objects go through consensus (slower).
    struct SharedCounter has key {
        id: UID,
        value: u64,
    }

    /// Immutable object — frozen forever, anyone can read.
    /// No transactions can modify it. Zero coordination cost.
    struct ImmutableConfig has key {
        id: UID,
        max_supply: u64,
    }

    public fun create_owned(ctx: &mut TxContext) {
        let nft = OwnedNFT {
            id: object::new(ctx),
            name: b"My NFT",
        };
        // Transfer to sender — becomes an owned object
        transfer::transfer(nft, tx_context::sender(ctx));
    }

    public fun create_shared(ctx: &mut TxContext) {
        let counter = SharedCounter {
            id: object::new(ctx),
            value: 0,
        };
        // Share with everyone — requires consensus for mutations
        transfer::share_object(counter);
    }

    public fun create_immutable(ctx: &mut TxContext) {
        let config = ImmutableConfig {
            id: object::new(ctx),
            max_supply: 10000,
        };
        // Freeze forever — no one can modify
        transfer::freeze_object(config);
    }
}
```

### Consensus: Narwhal and Bullshark

Sui uses a two-component consensus system:

- **Narwhal** — A DAG-based mempool that structures transaction dissemination. Validators share transaction batches in rounds, forming a directed acyclic graph. This ensures data availability before ordering.
- **Bullshark** — A consensus protocol that orders the Narwhal DAG. It determines the final sequence of shared-object transactions.

The key insight: **owned-object transactions bypass consensus entirely**. When you transfer an NFT you own, Sui only needs a Byzantine-consistent broadcast (3 rounds of communication) — no total ordering required. This is the "fast path" that achieves sub-second finality.

| Transaction Type | Path | Finality | Throughput |
|-----------------|------|----------|------------|
| Owned objects only | Fast path (no consensus) | ~400ms | 100,000+ TPS |
| Shared objects | Consensus (Narwhal/Bullshark) | ~2-3s | 10,000+ TPS |

### Parallel Execution

Sui's execution engine processes non-conflicting transactions simultaneously:

1. Transactions declare which objects they read/write upfront
2. The scheduler identifies independent transaction sets
3. Independent sets execute on separate CPU cores in parallel
4. Only transactions touching the same shared object serialize

This is fundamentally different from Ethereum where every transaction executes sequentially in a single thread, even if they touch completely unrelated state.

### Network Architecture

| Property | Sui Mainnet | Sui Testnet | Sui Devnet |
|----------|-------------|-------------|------------|
| Chain ID | sui:mainnet | sui:testnet | sui:devnet |
| RPC URL | https://fullnode.mainnet.sui.io:443 | https://fullnode.testnet.sui.io:443 | https://fullnode.devnet.sui.io:443 |
| Explorer | https://suiscan.xyz | https://suiscan.xyz/testnet | https://suiscan.xyz/devnet |
| Faucet | — | https://docs.sui.io/guides/developer/getting-started/get-coins | https://docs.sui.io/guides/developer/getting-started/get-coins |
| Native Token | SUI | SUI (test) | SUI (test) |

### SUI Tokenomics

- **Total supply**: 10 billion SUI
- **Gas fees**: Paid in SUI, with a reference gas price set by validators each epoch
- **Storage rebates**: When you delete an object, you get back the storage deposit — incentivizing state cleanup
- **Staking**: Delegated proof-of-stake with ~100+ validators

## Common Pitfalls

1. **Making everything a shared object** — Shared objects require consensus and serialize execution. If your object only needs one owner at a time, use owned objects with `transfer::transfer`. Reserve `share_object` for truly shared state like AMM pools or global registries.

2. **Ignoring the object model when designing contracts** — Porting Ethereum patterns directly (global mappings, single contract state) defeats Sui's parallelism. Design around independent objects that different users own separately.

3. **Confusing Sui Move with Aptos Move** — While both derive from the original Diem Move, Sui Move has a distinct object system, different standard library (`sui::` modules), and no global storage operators. Code from one doesn't compile on the other.

4. **Expecting EVM-style contract addresses** — On Sui, you interact with object IDs, not contract addresses. A "contract" is a published package (also an immutable object), and instances are separate objects created by that package's functions.

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install Sui CLI, configure wallet, and connect to testnet
- [Sui Official Documentation](https://docs.sui.io/) — Complete reference for Sui development
- [Sui GitHub Repository](https://github.com/MystenLabs/sui) — Source code and examples
