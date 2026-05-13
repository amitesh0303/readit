# Scroll Architecture: A Type 1 zkEVM Rollup

**Track:** Scroll Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've heard Scroll is a "zkEVM" like zkSync Era and Polygon zkEVM, but each takes a fundamentally different approach to ZK proving. Scroll aims for bytecode-level EVM equivalence — meaning your existing Ethereum contracts deploy without recompilation. But how does that work? How do you generate ZK proofs for an instruction set that wasn't designed for provability? Understanding Scroll's architecture helps you reason about its tradeoffs: higher compatibility vs. longer proof times, and why that matters for your deployment decisions.

## Core Concepts

### ZK-Rollup Fundamentals

Scroll is a **zk-rollup** that posts validity proofs to Ethereum L1. Unlike optimistic rollups (Arbitrum, Optimism) that assume transactions are valid and rely on fraud proofs during a 7-day challenge window, Scroll generates cryptographic proofs that mathematically guarantee correctness:

```
Optimistic Rollup (Arbitrum, Optimism, Base):
  1. Execute transactions off-chain
  2. Post state root to Ethereum
  3. Assume valid for 7 days (challenge window)
  4. Anyone can submit fraud proof
  → Withdrawal delay: 7 days

ZK-Rollup (Scroll):
  1. Execute transactions off-chain
  2. Generate validity proof (zk-SNARK)
  3. Post proof + state diff to Ethereum
  4. L1 verifier contract checks proof on-chain
  → Withdrawal delay: ~4-8 hours (proof generation + finalization)
```

### Scroll's Architecture Stack

```
┌─────────────────────────────────────────────┐
│  Users / dApps                              │
├─────────────────────────────────────────────┤
│  Scroll JSON-RPC (fully Ethereum-compatible)│
│  (same API as geth — no extensions needed)  │
├─────────────────────────────────────────────┤
│  Sequencer (l2geth — modified go-ethereum)  │
│  - Orders transactions                      │
│  - Executes in standard EVM                 │
│  - Produces L2 blocks                       │
├─────────────────────────────────────────────┤
│  Coordinator                                │
│  - Splits blocks into proving chunks        │
│  - Assigns chunks to provers                │
│  - Aggregates chunk proofs into batch proof │
├─────────────────────────────────────────────┤
│  Prover Network (zkEVM circuits)            │
│  - Generates zk-SNARK proofs per chunk      │
│  - GPU-accelerated proof generation         │
│  - Halo2-based proving system               │
├─────────────────────────────────────────────┤
│  Rollup Contract on Ethereum L1             │
│  - Verifies aggregated batch proofs         │
│  - Stores state commitments                 │
│  - Handles L1↔L2 message passing            │
└─────────────────────────────────────────────┘
```

### Type 1 zkEVM: Bytecode-Level Equivalence

The key differentiator for Scroll is its approach to EVM compatibility. The zkEVM classification system:

```
Type 1: Bytecode-equivalent — proves actual EVM execution
         (Scroll targets this — same bytecode, same results)

Type 2: EVM-equivalent with minor gas differences
         (Polygon zkEVM — nearly identical, small gas tweaks)

Type 3: EVM-compatible — compiles Solidity but different VM
         (zkSync Era — requires recompilation with zksolc)

Type 4: High-level language compatible — different execution
         (StarkNet — Cairo language, completely different VM)
```

Scroll's approach means:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// This contract deploys to Scroll with ZERO modifications.
// Same compiler (solc), same bytecode, same CREATE2 addresses.
contract ScrollCompatibility {
    // ✅ Standard EVM opcodes work identically
    function getBlockInfo() external view returns (
        uint256 blockNum,
        uint256 timestamp,
        address coinbase
    ) {
        return (block.number, block.timestamp, block.coinbase);
    }

    // ✅ CREATE2 produces the same address as on Ethereum
    function deployChild(bytes32 salt) external returns (address) {
        bytes memory bytecode = type(SimpleChild).creationCode;
        address addr;
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        require(addr != address(0), "Deploy failed");
        return addr;
    }

    // ✅ All precompiles supported (ecrecover, sha256, etc.)
    function verifySignature(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address) {
        return ecrecover(hash, v, r, s);
    }
}

contract SimpleChild {
    address public immutable deployer;
    constructor() { deployer = msg.sender; }
}
```

### How Scroll Proves EVM Execution

Scroll uses a multi-layer proof system built on the [Halo2](https://github.com/privacy-scaling-explorations/halo2) proving framework:

```
Transaction Execution
    │
    ▼
EVM Execution Trace (every opcode step recorded)
    │
    ▼
zkEVM Circuits (one circuit per EVM component):
  ├── State Circuit — storage reads/writes
  ├── EVM Circuit — opcode execution logic
  ├── Bytecode Circuit — code loading
  ├── Transaction Circuit — tx validation
  ├── Copy Circuit — memory/calldata copies
  ├── Keccak Circuit — hash computations
  ├── Exponentiation Circuit — modexp
  └── Pi Circuit — public inputs
    │
    ▼
Chunk Proof (aggregates multiple blocks)
    │
    ▼
Batch Proof (aggregates multiple chunks)
    │
    ▼
Single proof verified on Ethereum L1 (~300K gas)
```

### Transaction Lifecycle on Scroll

```typescript
// Transaction states on Scroll
interface ScrollTransactionLifecycle {
  // Stage 1: Confirmed on L2 (~3 seconds)
  // Sequencer includes tx in an L2 block
  // Soft confirmation — trusted sequencer ordering
  confirmed: {
    l2BlockNumber: number;
    l2Timestamp: number;
  };

  // Stage 2: Committed to L1 (~5-20 minutes)
  // Transaction data posted to Ethereum as calldata/blobs
  // Data is available but not yet proven
  committed: {
    l1BatchIndex: number;
    l1CommitTxHash: string;
  };

  // Stage 3: Finalized on L1 (~4-8 hours)
  // Validity proof verified by L1 contract
  // Transaction is cryptographically final
  finalized: {
    l1FinalizeTxHash: string;
    batchProofVerified: boolean;
  };
}
```

### Scroll vs Other ZK-Rollups

| Feature | Scroll | zkSync Era | Polygon zkEVM |
|---------|--------|------------|---------------|
| zkEVM Type | Type 1 (bytecode) | Type 3 (compatible) | Type 2 (equivalent) |
| Compiler | Standard `solc` | Custom `zksolc` | Standard `solc` |
| Bytecode | Same as Ethereum | Different (EraVM) | Same as Ethereum |
| CREATE2 addresses | Identical to L1 | Different from L1 | Identical to L1 |
| Proof system | Halo2 (KZG) | Boojum (PLONK) | PIL/Starks + SNARK |
| Proof time | ~4-8 hours | ~1-24 hours | ~30 min - 2 hours |
| Account abstraction | ERC-4337 (same as L1) | Native (built-in) | ERC-4337 (same as L1) |

## Common Pitfalls

1. **Assuming all zk-rollups require recompilation** — Unlike zkSync Era, Scroll uses standard `solc` output. You do NOT need a custom compiler. If you're coming from zkSync, don't look for a `scrollsolc` — it doesn't exist. Just deploy your existing bytecode.

2. **Expecting instant finality** — While L2 confirmation is fast (~3 seconds), cryptographic finality requires the validity proof to be generated and verified on L1, which takes 4-8 hours. For cross-chain messaging or withdrawals, you must wait for finalization.

3. **Confusing Scroll with Scroll's testnet history** — Scroll went through multiple testnet iterations (Pre-Alpha, Alpha, Sepolia). The current production network is Scroll Mainnet (chain ID 534352) and the testnet is Scroll Sepolia (chain ID 534351). Older tutorials referencing "Scroll Alpha" are outdated.

4. **Overlooking the sequencer trust assumption** — Scroll currently uses a centralized sequencer. While the validity proof guarantees execution correctness, the sequencer controls transaction ordering and inclusion. This is a liveness assumption, not a safety one — the sequencer cannot steal funds, but it can censor transactions temporarily.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — What actually changes when deploying to Scroll
- [Scroll Official Documentation](https://docs.scroll.io/) — Complete developer reference
- [Scroll Architecture Overview](https://github.com/scroll-tech/scroll) — Source code for Scroll's rollup components
- [Privacy Scaling Explorations — Halo2](https://github.com/privacy-scaling-explorations/halo2) — The proving system underlying Scroll's zkEVM
