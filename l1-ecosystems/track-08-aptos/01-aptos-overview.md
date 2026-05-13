# Aptos: Block-STM Parallel Execution and Architecture

**Track:** Aptos Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You've heard Aptos is a "high-throughput L1" built by former Meta engineers, but you don't understand what makes it different from Solana or Ethereum. Block-STM, Move VM, the resource model, and parallel execution are thrown around without explaining how they affect the contracts you write. This lesson breaks down Aptos's architecture so you understand the execution model before writing your first Move module.

---

## Core Concepts

### Block-STM: Optimistic Parallel Execution

Aptos uses Block-STM (Software Transactional Memory) to execute transactions in parallel without requiring developers to declare state access upfront. Unlike Solana where you must specify all accounts a transaction touches, Aptos optimistically executes transactions in parallel and re-executes any that conflict.

```
Traditional sequential execution (Ethereum):
tx1 → tx2 → tx3 → tx4 → tx5  (one at a time)

Aptos Block-STM:
tx1 ─┐
tx2 ─┼→ Execute in parallel → Detect conflicts → Re-execute conflicts
tx3 ─┤
tx4 ─┤
tx5 ─┘

Result: 4-16x throughput improvement on real workloads
```

Key properties of Block-STM:
- Transactions are pre-ordered by the leader (deterministic output)
- Execution is optimistic — assumes no conflicts
- Conflicts are detected via a multi-version data structure
- Only conflicting transactions are re-executed (not the entire block)
- Developers don't need to annotate state access (unlike Solana)

### The Move Virtual Machine

Aptos runs the Move VM, originally designed at Meta for the Diem project. Move is a bytecode language with first-class support for resources — values that cannot be copied or implicitly discarded.

```move
module 0x1::coin {
    /// A coin resource. Cannot be copied or dropped — only moved.
    struct Coin<phantom CoinType> has store {
        value: u64,
    }

    /// Transfer moves the coin from one account to another.
    /// After transfer, the sender no longer has the coin.
    public fun transfer<CoinType>(
        from: &signer,
        to: address,
        amount: u64
    ) {
        // Coin is moved, not copied — double-spend is impossible at the type level
    }
}
```

The Move VM enforces resource safety at the bytecode level:
- **No copying**: Resources cannot be duplicated (prevents double-spend)
- **No implicit drop**: Resources must be explicitly destroyed or stored (prevents accidental loss)
- **Type safety**: Generic types prevent mixing different coin types
- **Formal verification**: Move Prover can mathematically verify contract properties

### Resource Model vs Account Model

| Feature | Ethereum (Account Model) | Aptos (Resource Model) |
|---------|--------------------------|------------------------|
| Token storage | Mapping in contract | Resource in user account |
| Ownership | Contract tracks balances | User owns their resources |
| Access control | Contract enforces | Type system enforces |
| Composability | approve + transferFrom | Direct resource movement |
| Double-spend prevention | Runtime checks | Compile-time guarantees |

In Aptos, tokens live in the user's account as resources, not in a central contract's storage mapping. This means:

```move
// Ethereum model (Solidity): tokens stored in contract
// mapping(address => uint256) balances;
// balances[alice] = 100;  // Contract owns this data

// Aptos model (Move): tokens stored in user's account
// Alice's account contains: Coin<APT> { value: 100 }
// The resource physically lives under Alice's address
```

### Accounts and Authentication

Aptos accounts use a 32-byte address derived from the authentication key:

```
Account creation flow:
1. Generate Ed25519 keypair (or other supported scheme)
2. auth_key = SHA3-256(public_key | scheme_byte)
3. address = auth_key (first 32 bytes)
4. Fund the address to create the account on-chain
```

Aptos supports multiple authentication schemes:
- Ed25519 (single key)
- Multi-Ed25519 (multisig)
- Secp256k1 (Ethereum-compatible)
- Keyless (OAuth-based, no private key needed)

### Consensus: AptosBFT (DiemBFT v4)

Aptos uses a pipelined BFT consensus protocol:
- Block proposal, execution, and certification happen in parallel across different blocks
- Sub-second finality (~0.9s in practice)
- Tolerates up to 1/3 Byzantine validators
- No forks — once committed, transactions are final

```
Pipeline stages (overlapping):
Block N:   [Propose] [Execute] [Certify] [Commit]
Block N+1:          [Propose] [Execute] [Certify] [Commit]
Block N+2:                   [Propose] [Execute] [Certify] [Commit]
```

---

## Common Pitfalls

1. **Assuming Aptos works like Ethereum's account model** — In Aptos, assets are resources stored in user accounts, not entries in a contract's mapping. You can't "read anyone's balance" from a central contract — you query the resource stored at their address. This changes how you design indexing and frontend queries.

2. **Confusing Aptos Move with Sui Move** — While both use Move, Aptos uses a resource/module model where resources live at addresses, while Sui uses an object model with unique IDs. Code written for one does not compile on the other. Aptos Move uses `move_to`, `borrow_global`, and `move_from`; Sui Move uses object ownership and transfer.

3. **Ignoring gas estimation for parallel execution** — Block-STM's parallel execution means gas costs can vary based on contention. A transaction that conflicts with many others in the same block may cost more in practice due to re-execution. Always test with realistic concurrent workloads, not just isolated transactions.

4. **Not understanding resource abilities** — Move resources have four abilities: `copy`, `drop`, `store`, `key`. A struct with only `store` cannot be placed at top-level in an account (needs `key`). A struct without `drop` must be explicitly destroyed. Misunderstanding abilities leads to compile errors that seem cryptic.

5. **Expecting instant indexing after transaction commit** — While Aptos has sub-second finality, fullnode indexers may lag behind. If your frontend reads state immediately after submitting a transaction, you may get stale data. Use the transaction hash to wait for confirmation before querying updated state.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install Aptos CLI, set up Petra wallet, and configure testnet access
- [Aptos Developer Documentation](https://aptos.dev/en/build/get-started) — Official getting started guide
- [Aptos GitHub Repository](https://github.com/aptos-labs/aptos-core) — Core protocol source code

