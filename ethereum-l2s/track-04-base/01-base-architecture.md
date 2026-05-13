# Base Architecture: Coinbase's OP Stack L2

**Track:** Base Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to deploy a dApp with Ethereum-level security but at a fraction of the cost. Base keeps appearing in TVL rankings and developer activity charts, but you're not sure how it differs from Optimism (they both use the OP Stack), what Coinbase's role is, or whether it's truly decentralized. Without understanding Base's architecture, you'll miss its unique advantages and make wrong assumptions about sequencer trust, withdrawal timing, and EVM compatibility.

## Core Concepts

### What Base Is

Base is an optimistic rollup built on the OP Stack — the same modular framework that powers Optimism mainnet. It's developed by Coinbase but designed to progressively decentralize. Base does not have its own native token; it uses ETH for gas fees.

```
┌─────────────────────────────────────────────────────┐
│                  Base Architecture                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Ethereum L1 (Settlement + Data Availability)       │
│  └── Stores transaction batches as EIP-4844 blobs   │
│  └── Hosts the L1 bridge contracts                  │
│                                                     │
│  Base L2 (Execution)                                │
│  └── OP Stack-based optimistic rollup               │
│  └── 2-second block time                            │
│  └── Sequencer operated by Coinbase                 │
│  └── EVM-equivalent (Type 1 rollup)                 │
│                                                     │
│  Superchain (Future)                                │
│  └── Shared bridge with Optimism                    │
│  └── Cross-L2 messaging via OP Stack interop        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### OP Stack Foundation

Base is a fork of the OP Stack, meaning it shares core infrastructure with Optimism:

- **op-node**: Derives L2 blocks from L1 data
- **op-geth**: Modified go-ethereum that executes L2 transactions
- **op-batcher**: Submits transaction batches to L1
- **op-proposer**: Submits output roots (state commitments) to L1

The key difference from Optimism mainnet: Base runs its own sequencer (operated by Coinbase) and has its own bridge contracts on Ethereum.

```typescript
// ethers.js@6.9.0
import { ethers } from "ethers";

// Base network configuration
const BASE_MAINNET = {
  chainId: 8453,
  name: "Base",
  rpcUrl: "https://mainnet.base.org",
  blockExplorer: "https://basescan.org",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const BASE_SEPOLIA = {
  chainId: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  blockExplorer: "https://sepolia.basescan.org",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

// Connect to Base and verify chain
async function connectToBase(): Promise<ethers.Provider> {
  const provider = new ethers.JsonRpcProvider(BASE_MAINNET.rpcUrl);

  try {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== BASE_MAINNET.chainId) {
      throw new Error(
        `Expected chain ID ${BASE_MAINNET.chainId}, got ${network.chainId}`
      );
    }
    console.log(`Connected to ${BASE_MAINNET.name} (chain ID: ${network.chainId})`);
    return provider;
  } catch (error) {
    throw new Error(`Failed to connect to Base: ${(error as Error).message}`);
  }
}
```

### Optimistic Rollup Mechanics

Base uses the same fraud-proof mechanism as Optimism:

1. The sequencer orders transactions and produces L2 blocks every 2 seconds
2. The batcher compresses transaction data and posts it to Ethereum as EIP-4844 blobs
3. The proposer submits state roots to L1 every ~1 hour
4. A 7-day challenge window allows anyone to submit a fault proof if the state root is invalid
5. After 7 days with no valid challenge, the state is finalized

```
Transaction lifecycle on Base:

User submits tx → Sequencer includes in block (~2s)
                → Soft confirmation (sequencer promise)
                → Batch posted to L1 (~minutes)
                → State root proposed on L1 (~1 hour)
                → Challenge window (7 days)
                → Finalized on L1
```

### Superchain and OP Stack Interop

Base is part of the Optimism Superchain vision — a network of OP Stack chains that share a bridge and can communicate natively. This means:

- Shared security model across all Superchain members
- Future native cross-chain messaging between Base, Optimism, Mode, Zora, and other OP Stack chains
- Shared upgrade path (OP Stack upgrades benefit all chains)

### Network Details

| Property | Base Mainnet | Base Sepolia |
|----------|-------------|--------------|
| Chain ID | 8453 | 84532 |
| RPC URL | https://mainnet.base.org | https://sepolia.base.org |
| Block Explorer | https://basescan.org | https://sepolia.basescan.org |
| Native Token | ETH | ETH |
| Block Time | 2 seconds | 2 seconds |
| Rollup Type | Optimistic (OP Stack) | Optimistic (OP Stack) |
| Sequencer | Coinbase | Coinbase |

> **Last verified:** 2025-01-15. See [Base documentation](https://docs.base.org) for the latest network details.

## Common Pitfalls

1. **Assuming Base has its own token** — Base uses ETH for gas. There is no BASE token. Scam tokens claiming to be "Base token" are fraudulent.

2. **Treating Base and Optimism as identical** — While they share the OP Stack, they have separate sequencers, separate bridge contracts, and separate state. A contract deployed on Optimism is not accessible on Base without redeployment.

3. **Expecting instant L1 finality** — Soft confirmations from the sequencer are fast (~2s) but not final on L1. True L1 finality takes 7 days (challenge window). For high-value operations, wait for L1 finalization.

4. **Ignoring sequencer centralization** — Coinbase operates the sole sequencer. If the sequencer goes down, users can still force-include transactions via L1, but with higher latency. Design your protocol to handle sequencer downtime gracefully.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Understand gas, opcodes, and block semantics that differ on Base
- [Base Documentation](https://docs.base.org) — Official reference for Base development
- [OP Stack Specification](https://github.com/ethereum-optimism/optimism/tree/develop/specs) — Technical details of the underlying rollup framework
