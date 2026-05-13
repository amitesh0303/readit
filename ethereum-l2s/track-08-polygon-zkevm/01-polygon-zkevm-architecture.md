# Polygon zkEVM Architecture: How the Type 2 zkEVM Works

**Track:** Polygon zkEVM Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've heard Polygon zkEVM described as "EVM-equivalent" and "a Type 2 zkEVM," but you don't understand what that means architecturally. How does it differ from zkSync Era or Starknet? What does "Type 2" actually guarantee about compatibility? How does the proving system work, and what are the trust assumptions? Without understanding the architecture, you can't reason about finality, security guarantees, or when your existing Ethereum contracts will work without modification versus when they won't.

## Core Concepts

### What "Type 2 zkEVM" Means

Polygon zkEVM aims for EVM equivalence at the bytecode level. The classification system (proposed by Vitalik Buterin) ranks zkEVMs by compatibility:

```
Type 1: Fully Ethereum-equivalent (consensus + EVM) — theoretically perfect
Type 2: EVM-equivalent (bytecode level, minor gas diffs) — Polygon zkEVM
Type 2.5: EVM-equivalent except gas costs — practical Type 2
Type 3: EVM-compatible (most opcodes, some differ) — zkSync Era
Type 4: High-level language compatible (different VM) — StarkNet
```

Polygon zkEVM targets Type 2: your compiled Solidity bytecode deploys and runs without recompilation. The same `solc` output that works on Ethereum mainnet works on Polygon zkEVM. This is a significant difference from zkSync Era (which requires `zksolc`) or Starknet (which requires Cairo).

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              Polygon zkEVM Architecture                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions                              │
│       ↓                                                 │
│  Trusted Sequencer                                      │
│  └── Orders txs, produces L2 batches                    │
│  └── Posts tx data to Ethereum L1 (SequenceBatches)     │
│  └── Provides "trusted" state instantly                 │
│       ↓                                                 │
│  Aggregator (Prover)                                    │
│  └── Generates ZK proofs for batches                    │
│  └── Submits proofs to L1 (verifyBatchesTrustedAgg)     │
│  └── Multiple batches proven in single proof            │
│       ↓                                                 │
│  Ethereum L1 (Settlement + DA)                          │
│  └── PolygonZkEVM.sol — verifies proofs                 │
│  └── PolygonZkEVMBridge.sol — handles deposits/claims   │
│  └── Stores tx data as calldata                         │
│  └── State finalized once proof verified (~30 min)      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Components

**Trusted Sequencer**: Currently operated by Polygon Labs. It orders transactions, creates L2 batches, and posts transaction data to Ethereum. Unlike optimistic rollups, there's no 7-day challenge window — finality comes from ZK proof verification.

**Aggregator (Prover)**: Generates zero-knowledge proofs that attest to the correctness of state transitions. The prover uses a custom zkASM (zero-knowledge Assembly) that mirrors EVM opcodes. Multiple batches can be aggregated into a single proof for cost efficiency.

**PolygonZkEVM.sol (L1 Contract)**: The smart contract on Ethereum that verifies ZK proofs and manages the rollup state. It stores the state root and validates that sequenced batches match proven state transitions.

```typescript
// Connect to Polygon zkEVM — identical to connecting to any EVM chain
import { ethers } from "ethers"; // ethers@6.9.0

// Polygon zkEVM Mainnet
const provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");

// Verify chain ID (1101 for mainnet, 2442 for Cardona testnet)
const network = await provider.getNetwork();
console.log(`Connected to chain: ${network.chainId}`); // 1101

// Blocks are produced by the sequencer
const block = await provider.getBlock("latest");
console.log(`Block number: ${block?.number}`);
console.log(`Timestamp: ${new Date((block?.timestamp ?? 0) * 1000).toISOString()}`);

// Check the batch number (L2-specific)
const batchNumber = await provider.send("zkevm_batchNumber", []);
console.log(`Current batch: ${parseInt(batchNumber, 16)}`);
```

### Finality Levels

Polygon zkEVM has three distinct finality stages:

| Finality Level | Time | Trust Assumption |
|---|---|---|
| Trusted state | ~2-3 seconds | Trust the sequencer won't reorder |
| Virtual state | ~5-10 min | Tx data posted to L1, can be reconstructed |
| Consolidated state | ~30 min | ZK proof verified on L1, mathematically final |

The key advantage over optimistic rollups: consolidated finality takes ~30 minutes instead of 7 days. Once the ZK proof is verified on Ethereum, the state is cryptographically guaranteed correct.

```typescript
// Check batch verification status
import { ethers } from "ethers"; // ethers@6.9.0

const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
const l2Provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");

// PolygonZkEVM contract on Ethereum mainnet
const ZKEVM_CONTRACT = "0x5132A183E9F3CB7C848b0AAC5Ae0c4f0491B7aB2";
const ZKEVM_ABI = [
  "function lastVerifiedBatch() view returns (uint64)",
  "function lastBatchSequenced() view returns (uint64)",
  "function batchNumToStateRoot(uint64) view returns (bytes32)",
];

const zkevmContract = new ethers.Contract(ZKEVM_CONTRACT, ZKEVM_ABI, l1Provider);

const lastSequenced = await zkevmContract.lastBatchSequenced();
const lastVerified = await zkevmContract.lastVerifiedBatch();

console.log(`Last sequenced batch: ${lastSequenced}`);
console.log(`Last verified batch: ${lastVerified}`);
console.log(`Batches pending proof: ${lastSequenced - lastVerified}`);

// A batch is "consolidated" (final) once verified
const stateRoot = await zkevmContract.batchNumToStateRoot(lastVerified);
console.log(`Verified state root: ${stateRoot}`);
```

### The Proving System: zkASM and PIL

Polygon zkEVM uses a custom proving stack:

1. **zkASM (Zero-Knowledge Assembly)**: A micro-code layer that implements each EVM opcode as a sequence of zkASM instructions. This allows the prover to generate proofs for arbitrary EVM execution.

2. **PIL (Polynomial Identity Language)**: Defines the constraints that the prover must satisfy. Each zkASM instruction maps to polynomial constraints that can be verified efficiently.

3. **STARK → SNARK pipeline**: The prover first generates a STARK proof (fast to create, large), then wraps it in a SNARK proof (slower to create, small and cheap to verify on-chain).

```
EVM Bytecode → zkASM execution trace → PIL constraints → STARK proof → SNARK proof → L1 verification
```

This architecture means any valid EVM bytecode can be proven, but proving time scales with execution complexity. Simple transfers prove quickly; complex DeFi operations take longer.

### Forced Batches: Censorship Resistance

If the trusted sequencer censors transactions, users can force-include them via L1:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ForcedBatchExample
/// @notice Demonstrates the censorship resistance mechanism
/// @dev Users can call forceBatch on the L1 contract to bypass the sequencer
interface IPolygonZkEVM {
    /// @notice Force a batch of transactions to be included
    /// @param transactions RLP-encoded transactions to force-include
    function forceBatch(bytes calldata transactions, uint256 maticAmount) external;
}

/// @notice If the sequencer is censoring your transactions:
/// 1. Encode your L2 transaction as RLP bytes
/// 2. Call forceBatch on the L1 PolygonZkEVM contract
/// 3. The sequencer MUST include it within the forced batch timeout
/// 4. If not included, anyone can sequence it via sequenceForceBatches
contract CensorshipResistance {
    IPolygonZkEVM constant ZKEVM = IPolygonZkEVM(0x5132A183E9F3CB7C848b0AAC5Ae0c4f0491B7aB2);

    /// @notice Force-include a transaction if being censored
    /// @param rlpEncodedTx The RLP-encoded transaction to force
    function forceInclude(bytes calldata rlpEncodedTx) external {
        // Requires MATIC approval to the contract (anti-spam)
        ZKEVM.forceBatch(rlpEncodedTx, 0);
    }
}
```

## Common Pitfalls

1. **Assuming instant finality** — The trusted sequencer provides fast "trusted state" (~2-3s), but this relies on trusting the sequencer. For high-value operations (bridge withdrawals, large trades), wait for consolidated state (~30 min) when the ZK proof is verified on L1.

2. **Confusing Polygon zkEVM with Polygon PoS** — Polygon zkEVM (chain ID 1101) is a completely separate network from Polygon PoS (chain ID 137). They have different security models, different bridges, and different RPC endpoints. Polygon PoS is a sidechain with its own validator set; Polygon zkEVM inherits Ethereum's security via ZK proofs.

3. **Expecting identical gas costs to Ethereum** — While bytecode is compatible, gas costs differ because the prover must generate proofs for each operation. Some opcodes (like KECCAK256) are more expensive on Polygon zkEVM because they're harder to prove in ZK circuits. Always test gas consumption on testnet.

4. **Not understanding the sequencer trust model** — The current sequencer is centralized (Polygon Labs). It can temporarily censor or reorder transactions. The forced batch mechanism provides censorship resistance, but with a delay. Don't build time-sensitive protocols that assume the sequencer is neutral.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Understand gas, opcodes, and precompile differences on Polygon zkEVM
- [Polygon zkEVM Documentation](https://docs.polygon.technology/zkEVM/) — Official developer reference
- [Polygon zkEVM GitHub](https://github.com/0xPolygonHermez/zkevm-node) — Source code for the zkEVM node
- [Vitalik's zkEVM Types](https://vitalik.eth.limo/general/2022/08/04/zkevm.html) — The classification system explained
