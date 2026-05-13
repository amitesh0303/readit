# Modular vs Monolithic Blockchains: The Architecture Shift

**Track:** Modular Blockchain & Data Availability Layers
**Lesson:** 1 of 5
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You've heard "modular blockchains" thrown around in every rollup announcement and DA layer pitch, but you don't actually understand what it means architecturally. Ethereum does execution, consensus, settlement, and data availability all in one place — that's monolithic. Modular chains split these responsibilities across specialized layers. Without understanding this separation, you can't evaluate which DA layer to use for your rollup, why Celestia exists, or what EigenDA actually provides. You'll make architecture decisions based on marketing instead of engineering tradeoffs.

## Core Concepts

### The Four Blockchain Functions

Every blockchain performs four core functions. Monolithic chains handle all four; modular chains specialize:

```
┌─────────────────────────────────────────────────────────────┐
│              Blockchain Core Functions                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Execution        — Process transactions, update state    │
│  2. Settlement       — Verify proofs, resolve disputes       │
│  3. Consensus        — Order transactions, agree on blocks   │
│  4. Data Availability — Store tx data so anyone can verify   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  MONOLITHIC (Ethereum pre-rollups, Solana, BNB Chain):       │
│  ┌──────────────────────────────────────────────────┐       │
│  │  Single chain does ALL four functions             │       │
│  │  Execution + Settlement + Consensus + DA          │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  MODULAR (Rollup + DA layer + Settlement layer):             │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐        │
│  │ Execution  │  │ Settlement │  │ Data Avail.    │        │
│  │ (Rollup)   │  │ (Ethereum) │  │ (Celestia/     │        │
│  │            │  │            │  │  EigenDA/Avail)│        │
│  └────────────┘  └────────────┘  └────────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why Modular? The Scalability Argument

Monolithic chains face a fundamental tradeoff: increasing throughput requires either bigger blocks (centralization pressure) or weaker security guarantees. Modular architecture breaks this by letting each layer optimize independently.

```typescript
// Conceptual comparison: cost of posting data
// ethers@6.9.0

import { ethers } from "ethers";

// Monolithic approach: post all data to Ethereum calldata
// Cost: ~16 gas per byte of calldata (non-zero)
const ethereumCalldataCostPerByte = 16; // gas units
const averageL1GasPrice = 30; // gwei
const blobSize = 128 * 1024; // 128 KB typical rollup batch

const monolithicCostGas = blobSize * ethereumCalldataCostPerByte;
const monolithicCostETH = (monolithicCostGas * averageL1GasPrice) / 1e9;
console.log(`Monolithic (Ethereum calldata): ${monolithicCostETH.toFixed(4)} ETH`);
// ~0.0629 ETH per 128KB batch

// Modular approach: post data to Celestia DA layer
// Cost: ~0.01 TIA per 128KB blob (varies with congestion)
const celestiaCostPerBlob = 0.01; // TIA (approximate, testnet pricing)
console.log(`Modular (Celestia DA): ~${celestiaCostPerBlob} TIA per 128KB blob`);

// EIP-4844 blobs (Ethereum's own modular step):
// Cost: ~1 gas equivalent per byte (target: 3 blobs per block)
const blobCostPerByte = 1; // gas equivalent
const blobCostGas = blobSize * blobCostPerByte;
const blobCostETH = (blobCostGas * averageL1GasPrice) / 1e9;
console.log(`EIP-4844 blobs: ${blobCostETH.toFixed(6)} ETH per 128KB blob`);
// ~0.000004 ETH — 10-100x cheaper than calldata
```

### Data Availability Sampling (DAS)

The key innovation enabling modular DA layers is Data Availability Sampling. Instead of requiring every node to download all data, light nodes sample random chunks and use erasure coding to verify the full data is available:

```typescript
// Conceptual: how DAS works with erasure coding
// This demonstrates the principle, not production code

interface DABlock {
  originalData: Uint8Array;      // The actual transaction data
  erasureCoded: Uint8Array;      // 2x extended with Reed-Solomon coding
  commitments: Uint8Array[];     // KZG polynomial commitments per chunk
}

// A light node only needs to sample a few chunks to verify DA
// With 2x erasure coding, if >50% of chunks are available,
// the full data can be reconstructed
function verifyDataAvailability(
  block: DABlock,
  sampleCount: number = 15  // ~15 samples gives 99.99% confidence
): boolean {
  let successfulSamples = 0;

  for (let i = 0; i < sampleCount; i++) {
    const randomChunkIndex = Math.floor(
      Math.random() * block.erasureCoded.length
    );
    // Request chunk from network, verify against KZG commitment
    const chunkAvailable = requestAndVerifyChunk(
      randomChunkIndex,
      block.commitments
    );
    if (chunkAvailable) successfulSamples++;
  }

  // If all samples succeed, data is available with high probability
  return successfulSamples === sampleCount;
}

function requestAndVerifyChunk(
  index: number,
  commitments: Uint8Array[]
): boolean {
  // In production: network request + KZG proof verification
  // Returns true if chunk matches its polynomial commitment
  return true; // simplified
}
```

### The Modular Stack in Practice

Here's how a real modular rollup stack looks:

| Layer | Monolithic (Ethereum L1) | Modular (Rollup + Celestia) | Modular (Rollup + EigenDA) |
|---|---|---|---|
| Execution | Ethereum EVM | Rollup (OP Stack, Arbitrum, etc.) | Rollup (OP Stack, Arbitrum, etc.) |
| Settlement | Ethereum | Ethereum (proofs/disputes) | Ethereum (proofs/disputes) |
| Consensus | Ethereum PoS | Celestia Tendermint | Ethereum PoS (via restaking) |
| Data Availability | Ethereum calldata/blobs | Celestia DAS | EigenDA (restaked security) |

### When to Use Which Architecture

```typescript
// Decision framework for choosing DA layer
// This is a reference guide, not executable code

interface DALayerChoice {
  layer: "ethereum-blobs" | "celestia" | "eigenda" | "avail";
  bestFor: string[];
  tradeoffs: string[];
  costPerMB: string;
  securityModel: string;
}

const daLayers: DALayerChoice[] = [
  {
    layer: "ethereum-blobs",
    bestFor: [
      "Maximum security inheritance",
      "DeFi rollups with high TVL",
      "When Ethereum alignment matters most"
    ],
    tradeoffs: [
      "Limited to ~375 KB per block (3 blobs × 125 KB)",
      "Blob data pruned after ~18 days",
      "Shared blob space with all rollups"
    ],
    costPerMB: "~0.001-0.01 ETH (varies with demand)",
    securityModel: "Full Ethereum validator set"
  },
  {
    layer: "celestia",
    bestFor: [
      "High-throughput rollups",
      "Sovereign rollups (no Ethereum settlement)",
      "Cost-sensitive applications"
    ],
    tradeoffs: [
      "Separate validator set from Ethereum",
      "Newer network, less battle-tested",
      "TIA token required for fees"
    ],
    costPerMB: "~0.01-0.05 TIA",
    securityModel: "Celestia's own PoS validator set"
  },
  {
    layer: "eigenda",
    bestFor: [
      "Ethereum-aligned rollups wanting cheaper DA",
      "Projects that value restaked ETH security",
      "EigenLayer ecosystem integration"
    ],
    tradeoffs: [
      "Depends on EigenLayer operator set",
      "Newer, less proven in production",
      "Operator slashing conditions still evolving"
    ],
    costPerMB: "~0.001 ETH (subsidized early phase)",
    securityModel: "Restaked ETH via EigenLayer operators"
  },
  {
    layer: "avail",
    bestFor: [
      "Cross-ecosystem DA (not Ethereum-only)",
      "Validity proofs with KZG commitments",
      "Light client verification"
    ],
    tradeoffs: [
      "Separate validator set",
      "Newer network, mainnet launched 2024",
      "AVAIL token required"
    ],
    costPerMB: "~0.01-0.03 AVAIL",
    securityModel: "Avail's nominated PoS validator set"
  }
];
```

## Common Pitfalls

1. **Confusing data availability with data storage** — DA layers guarantee that data was published and is available for a window of time (hours to weeks). They are NOT permanent storage. If you need data after the DA window, you need an archival solution (IPFS, Arweave, or your own indexer).

2. **Assuming modular always means cheaper** — Modular DA is cheaper per byte, but adds complexity: you need a DA bridge contract, a relayer to post commitments, and monitoring for DA layer liveness. For low-throughput rollups, Ethereum blobs might be simpler and sufficient.

3. **Ignoring the trust model differences** — Celestia has its own validator set (separate trust assumption from Ethereum). EigenDA inherits Ethereum security via restaking but depends on operator behavior. Avail has its own PoS. These are fundamentally different security profiles — don't treat them as interchangeable.

4. **Thinking EIP-4844 solves everything** — Ethereum blobs (EIP-4844) are a step toward modular DA within Ethereum itself, but they're limited to ~375 KB per block. High-throughput rollups (gaming, social) will still need external DA layers for the foreseeable future.

## What to Learn Next

- [Celestia DA Integration](./02-celestia-da-integration.md) — Post and retrieve data blobs on Celestia's network
- [Celestia Documentation](https://docs.celestia.org/) — Official Celestia developer docs
- [EIP-4844 Specification](https://eips.ethereum.org/EIPS/eip-4844) — Ethereum's proto-danksharding blob spec
- [Celestia GitHub](https://github.com/celestiaorg/celestia-node) — Source code for Celestia light/full nodes
