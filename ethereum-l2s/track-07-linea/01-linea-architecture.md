# Linea Architecture: A Type 2 zkEVM Rollup

**Track:** Linea Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've seen multiple zk-rollups — zkSync Era, Polygon zkEVM, Scroll — each with different tradeoffs between EVM compatibility and proving efficiency. Linea claims to be a "type 2 zkEVM" backed by Consensys, the team behind MetaMask and Infura. But what does that mean in practice? How does Linea's architecture differ from other zk-rollups, and why does its Consensys lineage matter for your development workflow? Understanding the architecture helps you predict gas behavior, finality times, and tooling compatibility.

## Core Concepts

### What Is Linea?

Linea is a **zk-rollup** (zero-knowledge rollup) that executes transactions off Ethereum mainnet and posts validity proofs back to L1. It is developed by Consensys, the company behind MetaMask, Infura, and Truffle (now Hardhat-adjacent). This lineage means deep integration with the tools most Ethereum developers already use.

Key properties:
- **Type 2 zkEVM**: High EVM equivalence — most Solidity contracts deploy without modification
- **Lattice-based cryptography**: Uses a custom proving system based on lattice assumptions
- **Consensys ecosystem**: Native MetaMask, Infura, and Verax attestation integration
- **Ethereum-aligned**: Designed to be a direct extension of Ethereum, not a separate ecosystem

### ZK-Rollup Fundamentals

```
How Linea processes transactions:

1. User submits transaction → Linea sequencer
2. Sequencer orders and executes transactions in batches
3. Prover generates a zk-SNARK proof for the batch
4. Proof + compressed state data posted to Ethereum L1
5. L1 verifier contract validates the proof
6. State is finalized — withdrawals can proceed

Timeline:
  Soft confirmation: ~2-3 seconds (sequencer inclusion)
  L1 commitment:    ~5-20 minutes (batch posted)
  Finality:         ~1-3 hours (proof verified on L1)
```

### Linea's Architecture Stack

```
┌─────────────────────────────────────────────────┐
│  Users / dApps (MetaMask, any EVM wallet)       │
├─────────────────────────────────────────────────┤
│  Linea JSON-RPC (Infura / public endpoints)     │
│  (Ethereum-compatible, standard eth_ namespace) │
├─────────────────────────────────────────────────┤
│  Sequencer (Consensys-operated)                 │
│  - Orders transactions into blocks              │
│  - Executes in zkEVM (type 2)                   │
│  - Produces conflated batches for proving        │
├─────────────────────────────────────────────────┤
│  Coordinator                                    │
│  - Manages batch lifecycle                      │
│  - Triggers proof generation                    │
│  - Submits proofs to L1                         │
├─────────────────────────────────────────────────┤
│  Prover (Lattice-based inner proof + Vortex)    │
│  - Inner proof: lattice-based SNARK             │
│  - Outer proof: Vortex (SNARK wrapper for L1)   │
│  - Recursive composition for efficiency         │
├─────────────────────────────────────────────────┤
│  Ethereum L1                                    │
│  - Rollup contract stores state roots           │
│  - Verifier contract checks proofs              │
│  - Message service for L1↔L2 bridging           │
└─────────────────────────────────────────────────┘
```

### Type 2 zkEVM: What It Means

The zkEVM type classification (from Vitalik's framework) describes how closely a zk-rollup matches Ethereum:

```
Type 1: Fully Ethereum-equivalent (same state, same rules)
  → Hardest to prove, slowest proofs
  → Example: Scroll (aspirational)

Type 2: EVM-equivalent (same bytecode, minor state differences)
  → Linea sits here
  → Most contracts work unchanged
  → Gas schedule may differ slightly

Type 2.5: EVM-equivalent except gas costs
  → Some operations cost more/less than mainnet

Type 3: Almost EVM-equivalent (some opcodes differ)
  → Example: Scroll (current)

Type 4: High-level language equivalent (compiles differently)
  → Example: zkSync Era (uses zksolc → EraVM bytecode)
```

Linea's type 2 status means:
- Standard `solc` compiler output works directly (no custom compiler)
- Same bytecode as Ethereum mainnet
- `CREATE2` produces the same addresses as on mainnet
- Most opcodes behave identically
- Minor differences in gas costs for some operations

### The Proving System: Lattice + Vortex

Linea uses a two-layer proof system:

```typescript
// Conceptual model of Linea's proving pipeline
interface LineaProvingPipeline {
  // Step 1: Inner proof (lattice-based)
  // Uses lattice cryptography for efficient arithmetic circuit proving
  // Generates a compact proof for each batch of transactions
  innerProof: {
    system: "Lattice-based SNARK";
    advantage: "Fast prover, post-quantum potential";
    batchSize: "variable (hundreds to thousands of txs)";
  };

  // Step 2: Outer proof (Vortex)
  // Wraps the lattice proof into a format verifiable on Ethereum
  // Uses a SNARK-friendly curve for cheap L1 verification
  outerProof: {
    system: "Vortex (Groth16-compatible wrapper)";
    advantage: "Cheap L1 verification (~200-300K gas)";
    recursion: "Multiple inner proofs aggregated";
  };

  // Step 3: L1 submission
  l1Verification: {
    contract: "LineaRollup.sol on Ethereum mainnet";
    gasPerProof: "~200,000-300,000 gas";
    frequency: "Every few minutes to hours";
  };
}
```

### Conflation: Linea's Batch Optimization

Linea introduces "conflation" — combining multiple L2 blocks into a single provable batch:

```
L2 Block 100 ─┐
L2 Block 101 ─┤
L2 Block 102 ─┼─→ Conflated Batch → Single Proof → L1
L2 Block 103 ─┤
L2 Block 104 ─┘

Benefits:
- Amortizes proving cost across many blocks
- Reduces L1 gas per transaction
- Allows flexible batch sizes based on demand
```

### Transaction Lifecycle

```typescript
// Transaction states on Linea
interface LineaTransactionLifecycle {
  // Stage 1: Included by sequencer (~2-3 seconds)
  // Transaction appears in an L2 block
  // Soft confirmation — trusted sequencer guarantee
  included: {
    l2BlockNumber: number;
    l2BlockTimestamp: number;
    status: "ACCEPTED_ON_L2";
  };

  // Stage 2: Batch submitted to L1 (~5-20 minutes)
  // Conflated batch data posted to Ethereum
  // Data is available but not yet proven
  submitted: {
    batchNumber: number;
    l1SubmissionTx: string;
    status: "SENT_TO_L1";
  };

  // Stage 3: Proof verified on L1 (~1-3 hours)
  // ZK proof accepted by L1 verifier contract
  // Transaction is cryptographically final
  finalized: {
    proofTx: string;
    l1FinalizedBlock: number;
    status: "FINALIZED";
  };
}
```

### Consensys Ecosystem Integration

Linea's development by Consensys provides native integration with widely-used tools:

```
┌─────────────────────────────────────────┐
│  Consensys Tool Stack                   │
├─────────────────────────────────────────┤
│  MetaMask    → Native Linea support     │
│  Infura      → Linea RPC endpoints      │
│  Verax       → On-chain attestations    │
│  Besu        → Execution client basis   │
│  Linea SDK   → Bridge + messaging API   │
└─────────────────────────────────────────┘
```

This means:
- MetaMask users can add Linea with one click (built-in network)
- Infura provides reliable RPC without rate-limit concerns for small projects
- Existing Hardhat/Foundry workflows work without modification
- No custom compiler or toolchain required

## Common Pitfalls

1. **Assuming instant finality** — While Linea confirms transactions in 2-3 seconds (sequencer inclusion), true cryptographic finality requires the zk-proof to be verified on L1, which takes 1-3 hours. Cross-chain applications must account for this delay when designing withdrawal flows or message passing.

2. **Confusing Linea with zkSync Era's architecture** — Unlike zkSync Era (type 4, custom VM), Linea is type 2 and uses standard EVM bytecode. You do NOT need a custom compiler. Standard `solc` output deploys directly. This is a significant developer experience advantage.

3. **Expecting identical gas costs to mainnet** — While Linea is EVM-equivalent, gas costs differ because of the proving overhead. Storage-heavy operations may cost relatively more due to the state diff compression and proving costs. Always test gas consumption on Linea's testnet before mainnet deployment.

4. **Overlooking the centralized sequencer** — Linea currently operates a single sequencer run by Consensys. While the zk-proof guarantees correctness, the sequencer can censor transactions or go offline. This is a liveness concern, not a safety concern — your funds remain safe on L1 regardless.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Detailed breakdown of EVM differences on Linea
- [Linea Official Documentation](https://docs.linea.build/) — Complete developer reference
- [Vitalik's zkEVM Types](https://vitalik.eth.limo/general/2022/08/04/zkevm.html) — Understanding the type 1-4 classification
- [Linea GitHub](https://github.com/Consensys/linea-monorepo) — Source code for Linea's components
