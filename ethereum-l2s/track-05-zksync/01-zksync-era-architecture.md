# zkSync Era Architecture: How a ZK-Rollup Works

**Track:** zkSync Era Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've heard zkSync Era is a "zk-rollup" and that it's faster and cheaper than Ethereum mainnet. But what does that actually mean under the hood? How does a validity proof differ from a fraud proof? Why does zkSync use a custom compiler instead of running the EVM directly? Understanding the architecture helps you reason about gas costs, finality times, and the subtle differences you'll hit when deploying contracts.

## Core Concepts

### ZK-Rollup vs Optimistic Rollup

Rollups execute transactions off Ethereum and post results back. The difference is how they prove correctness:

```
Optimistic Rollup (Arbitrum, Optimism):
  1. Execute transactions off-chain
  2. Post state root to Ethereum
  3. Assume valid for 7 days
  4. Anyone can submit fraud proof during window
  → Withdrawal delay: 7 days

ZK-Rollup (zkSync Era):
  1. Execute transactions off-chain
  2. Generate cryptographic validity proof (SNARK)
  3. Post proof + compressed state diff to Ethereum
  4. Ethereum verifies proof on-chain (~200K gas)
  → Withdrawal delay: ~24 hours (proof generation time)
```

zkSync Era uses **zkSNARKs** (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge). The proof mathematically guarantees that all transactions in a batch were executed correctly — no trust assumptions, no challenge windows.

### zkSync Era's Architecture Stack

```
┌─────────────────────────────────────────────┐
│  Users / dApps                              │
├─────────────────────────────────────────────┤
│  zkSync Era JSON-RPC API                    │
│  (Ethereum-compatible + extensions)         │
├─────────────────────────────────────────────┤
│  Sequencer (operator)                       │
│  - Orders transactions                      │
│  - Executes in zkEVM                        │
│  - Produces batches                         │
├─────────────────────────────────────────────┤
│  Prover                                     │
│  - Generates SNARK proofs for batches       │
│  - GPU-accelerated (Boojum proof system)    │
├─────────────────────────────────────────────┤
│  Ethereum L1 (Data Availability + Proofs)   │
│  - Verifier contract checks proofs          │
│  - State diffs stored as calldata/blobs     │
└─────────────────────────────────────────────┘
```

### The zkEVM: Not Quite the EVM

zkSync Era does **not** run the standard EVM. It uses a custom virtual machine called **EraVM** (formerly zkEVM) that is designed to be provable with ZK circuits. Solidity and Vyper code is compiled through a two-step process:

```
Solidity source code
    │
    ▼
solc (standard Solidity compiler) → Yul intermediate representation
    │
    ▼
zksolc (zkSync's compiler) → EraVM bytecode
```

This means:
- Most Solidity code works unchanged
- Some EVM opcodes behave differently or are unsupported
- Contract bytecode is different from Ethereum (not directly portable)
- Gas costs differ from Ethereum for the same operations

### Batches, Blocks, and Finality

zkSync Era processes transactions in three stages:

```typescript
// Transaction lifecycle on zkSync Era
interface TransactionLifecycle {
  // Stage 1: Processed by sequencer (~1-2 seconds)
  // Transaction is included in an L2 block
  // Soft confirmation — sequencer could theoretically reorder
  processed: {
    l2BlockNumber: number;
    timestamp: number;
  };

  // Stage 2: Committed to Ethereum (~1-5 minutes)
  // Batch data posted to L1, but proof not yet verified
  committed: {
    l1BatchNumber: number;
    l1TxHash: string;
  };

  // Stage 3: Proven on Ethereum (~1-24 hours)
  // SNARK proof verified by L1 contract
  // Transaction is cryptographically final
  proven: {
    proofTxHash: string;
    finalizedAt: number;
  };
}
```

### The Boojum Proof System

zkSync Era uses **Boojum**, a custom SNARK proof system built on the PLONK protocol:

- **Recursive proofs**: Multiple batch proofs are aggregated into a single proof before posting to L1, reducing verification cost
- **GPU-accelerated**: Proof generation runs on GPUs, making it faster and cheaper than CPU-based provers
- **Transparent setup**: No trusted setup ceremony required (unlike original Groth16-based systems)

```
Batch 1 proof ─┐
Batch 2 proof ─┼─→ Aggregated proof ─→ Single L1 verification (~200K gas)
Batch 3 proof ─┘
```

### Account Abstraction (Native)

Unlike Ethereum where account abstraction requires ERC-4337, zkSync Era has **native account abstraction**. Every account (including EOAs) goes through the same validation flow:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@matterlabs/zk-contracts/l2/system-contracts/interfaces/IAccount.sol";

// On zkSync Era, all accounts implement IAccount
// This enables custom validation logic without ERC-4337 bundlers
interface IAccount {
    function validateTransaction(
        bytes32 _txHash,
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable returns (bytes4 magic);

    function executeTransaction(
        bytes32 _txHash,
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable;

    function payForTransaction(
        bytes32 _txHash,
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable;
}
```

This means:
- Smart contract wallets are first-class citizens
- Paymasters can sponsor gas for users
- Custom signature schemes (multisig, social recovery) work natively

## Common Pitfalls

1. **Assuming EVM bytecode compatibility** — zkSync Era compiles Solidity to EraVM bytecode, not EVM bytecode. You cannot deploy pre-compiled EVM bytecode directly. Always compile from source using `zksolc`. Tools like `CREATE2` produce different addresses than on Ethereum for the same init code.

2. **Expecting instant finality** — While transactions are processed in 1-2 seconds (soft confirmation), true cryptographic finality requires the SNARK proof to be verified on L1, which takes 1-24 hours. Design your cross-chain logic accordingly.

3. **Ignoring the two-step compilation** — `zksolc` requires a specific version of `solc` as input. Version mismatches between `solc` and `zksolc` cause cryptic compilation errors. Always pin both compiler versions in your config.

4. **Using unsupported opcodes** — `SELFDESTRUCT`, `EXTCODECOPY` (for arbitrary addresses), and some precompiles behave differently or are unavailable. Check the [zkSync Era differences documentation](https://docs.zksync.io/build/developer-reference/ethereum-differences) before deploying existing contracts.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Detailed breakdown of what works differently on zkSync Era
- [zkSync Official Documentation](https://docs.zksync.io/) — Complete reference for the zkSync Era protocol
- [Boojum Proof System](https://github.com/matter-labs/era-boojum) — Source code for zkSync's SNARK prover
