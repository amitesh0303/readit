# Starknet Architecture: How a Validity Rollup Works

**Track:** Starknet Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've heard Starknet is a "validity rollup" (sometimes called a zk-rollup) that uses STARK proofs instead of SNARK proofs. But what does that actually mean for you as a developer? Why does Starknet use its own language (Cairo) instead of Solidity? How does the sequencer-prover pipeline work, and what are the real finality guarantees? Understanding the architecture helps you reason about gas costs, contract design patterns, and the fundamental differences from EVM-based L2s.

## Core Concepts

### Validity Rollup Classification

Starknet is a **validity rollup** — it executes transactions off-chain and posts cryptographic proofs to Ethereum L1 that mathematically guarantee correctness:

```
Optimistic Rollup (Arbitrum, Optimism):
  1. Execute transactions off-chain
  2. Post state root to Ethereum
  3. Assume valid for 7 days (challenge window)
  4. Anyone can submit fraud proof
  → Withdrawal delay: 7 days

Validity Rollup (Starknet):
  1. Execute transactions off-chain via Sequencer
  2. Generate STARK proof of execution correctness
  3. Post proof + state diff to Ethereum
  4. L1 Verifier contract checks proof (~5M gas)
  → Withdrawal delay: ~12 hours (proof generation + L1 finality)
```

Starknet uses **STARKs** (Scalable Transparent Arguments of Knowledge) rather than SNARKs. Key differences:

| Property | STARKs (Starknet) | SNARKs (zkSync) |
|----------|-------------------|-----------------|
| Trusted setup | None required | Some variants need it |
| Proof size | Larger (~100KB) | Smaller (~1KB) |
| Verification cost | Higher on L1 | Lower on L1 |
| Quantum resistance | Yes | No |
| Prover speed | Fast for large computations | Varies |

### Starknet Architecture Stack

```
┌─────────────────────────────────────────────┐
│  Users / dApps (starknet.js, starkli)       │
├─────────────────────────────────────────────┤
│  Starknet JSON-RPC API                      │
│  (Custom RPC — not Ethereum-compatible)     │
├─────────────────────────────────────────────┤
│  Sequencer (Madara / centralized operator)  │
│  - Orders transactions                      │
│  - Executes in StarknetOS (Cairo VM)        │
│  - Produces blocks                          │
├─────────────────────────────────────────────┤
│  Prover (SHARP — Shared Prover)             │
│  - Generates STARK proofs for blocks        │
│  - Aggregates multiple blocks into one proof│
│  - Recursive proof composition              │
├─────────────────────────────────────────────┤
│  Ethereum L1                                │
│  - Verifier contract validates STARK proofs │
│  - State diffs stored as calldata/blobs     │
│  - Starknet Core contract manages state     │
└─────────────────────────────────────────────┘
```

### The Cairo VM: Not the EVM

Unlike EVM-compatible L2s, Starknet runs the **Cairo VM** — a virtual machine specifically designed to generate provable execution traces. This is why Starknet uses Cairo instead of Solidity:

```
Cairo source code (.cairo)
    │
    ▼
Scarb (Cairo package manager + compiler)
    │
    ▼
Sierra (Safe Intermediate Representation)
    │
    ▼
CASM (Cairo Assembly — runs on Cairo VM)
    │
    ▼
Execution trace → STARK proof
```

The two-step compilation (Cairo → Sierra → CASM) exists for safety:
- **Sierra** guarantees every program terminates (no infinite loops)
- This means the sequencer can always charge gas, even for failing transactions
- The network cannot be DoS'd with unprovable computations

### Account Abstraction (Native)

Starknet has **native account abstraction** — there are no EOAs (Externally Owned Accounts). Every account is a smart contract:

```cairo
// Every Starknet account implements this interface
#[starknet::interface]
trait IAccount<TState> {
    fn __validate__(ref self: TState, calls: Array<Call>) -> felt252;
    fn __execute__(ref self: TState, calls: Array<Call>) -> Array<Span<felt252>>;
    fn is_valid_signature(self: @TState, hash: felt252, signature: Array<felt252>) -> felt252;
}
```

This means:
- Custom signature schemes (multisig, WebAuthn, social recovery) are native
- Paymasters and fee delegation work without extra infrastructure
- Account deployment is a first-class operation

### Blocks, Transactions, and Finality

Transaction lifecycle on Starknet:

```typescript
// Transaction states on Starknet
interface StarknetTransactionLifecycle {
  // Stage 1: RECEIVED (~2-5 seconds)
  // Sequencer has received the transaction
  received: {
    transactionHash: string;
  };

  // Stage 2: ACCEPTED_ON_L2 (~2-30 seconds)
  // Included in an L2 block, executed successfully
  // Soft finality — sequencer could theoretically reorg
  acceptedOnL2: {
    blockNumber: number;
    blockHash: string;
    executionStatus: "SUCCEEDED" | "REVERTED";
  };

  // Stage 3: ACCEPTED_ON_L1 (~3-12 hours)
  // STARK proof verified on Ethereum
  // Hard finality — cryptographically irreversible
  acceptedOnL1: {
    l1TransactionHash: string;
    stateRoot: string;
  };
}
```

### SHARP: The Shared Prover

Starknet uses **SHARP** (Shared Prover) — a proving service that aggregates proofs from multiple StarkEx applications and Starknet itself:

```
Starknet Block 1 ─┐
Starknet Block 2 ─┤
Starknet Block 3 ─┼─→ SHARP ─→ Single recursive STARK proof ─→ L1 verification
StarkEx App A    ─┤
StarkEx App B    ─┘
```

Benefits:
- Amortized proving costs across multiple applications
- Recursive proof composition reduces L1 verification cost
- Single L1 transaction verifies thousands of L2 transactions

## Common Pitfalls

1. **Assuming EVM compatibility** — Starknet is NOT EVM-compatible. You cannot deploy Solidity contracts. You must learn Cairo and use Starknet-specific tooling (Scarb, starkli, starknet.js). There is no "compatibility mode."

2. **Expecting Ethereum RPC methods** — Starknet has its own JSON-RPC specification. Methods like `eth_getBalance` don't exist. Use `starknet_getBalance` or the equivalent starknet.js calls. Wallet integration uses different standards (SN_WALLET).

3. **Ignoring the declare-deploy pattern** — On Starknet, you first "declare" a contract class (upload the code), then "deploy" instances of that class. This is fundamentally different from Ethereum where deployment and code upload happen in one transaction.

4. **Underestimating Cairo's learning curve** — Cairo is a Rust-inspired language with ownership semantics, no garbage collection, and felt252 as the native type (not uint256). Budget time to learn the language before attempting contract development.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Detailed breakdown of what works differently on Starknet
- [Starknet Documentation](https://docs.starknet.io/) — Official developer reference
- [Starknet Architecture Overview](https://github.com/starkware-libs/cairo) — Cairo language repository and specs
- [STARK Math Explained](https://starkware.co/stark/) — Deep dive into the cryptography behind STARKs
