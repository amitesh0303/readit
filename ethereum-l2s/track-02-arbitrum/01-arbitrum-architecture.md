# Arbitrum Architecture: How the Optimistic Rollup Works

**Track:** Arbitrum Development
**Lesson:** 1 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're evaluating Arbitrum for your next project. You know it's "an optimistic rollup" and "cheaper than Ethereum," but you don't understand what that actually means under the hood. How does the sequencer order transactions? What happens during a fraud proof challenge? How does data get posted to L1? Without understanding the architecture, you can't reason about trust assumptions, finality guarantees, or failure modes — and you'll make wrong assumptions that break your protocol.

## Core Concepts

### What "Optimistic Rollup" Means

Arbitrum is an optimistic rollup: it executes transactions off-chain and posts compressed transaction data to Ethereum L1. The "optimistic" part means the system assumes all posted state roots are correct unless someone proves otherwise via a fraud proof within a 7-day challenge window.

```
┌─────────────────────────────────────────────────────────┐
│                  Arbitrum One Architecture               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions                              │
│       ↓                                                 │
│  Sequencer (centralized, Offchain Labs)                 │
│  └── Orders txs, produces L2 blocks (~250ms)            │
│  └── Provides "soft confirmations" instantly            │
│       ↓                                                 │
│  Batch Poster                                           │
│  └── Compresses tx batches                              │
│  └── Posts calldata/blobs to Ethereum L1                │
│       ↓                                                 │
│  Validators                                             │
│  └── Execute txs, compute state roots                   │
│  └── Post assertions (state commitments) to L1          │
│  └── Challenge incorrect assertions (fraud proofs)      │
│       ↓                                                 │
│  Ethereum L1 (Settlement + Data Availability)           │
│  └── Stores compressed tx data                          │
│  └── Resolves disputes via fraud proof protocol         │
│  └── Finalizes state after 7-day challenge window       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### The Nitro Stack

Arbitrum Nitro is the current execution environment. It replaced the original Arbitrum Classic in August 2022. Key properties:

- **Geth at the core**: Nitro runs a fork of go-ethereum (geth) for transaction execution, making it EVM-equivalent (not just EVM-compatible)
- **WASM fraud proofs**: The execution is compiled to WebAssembly for deterministic replay during fraud proof challenges
- **Separate execution from proving**: Normal operation runs native code for speed; WASM is only used during disputes

```typescript
// Arbitrum Nitro node architecture (conceptual)
// Source: https://github.com/OffchainLabs/nitro

import { ethers } from "ethers"; // ethers@6.9.0

// Connect to Arbitrum One — same interface as connecting to Ethereum
const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");

// Verify we're on Arbitrum One (chainId 42161)
const network = await provider.getNetwork();
console.log(`Connected to chain: ${network.chainId}`); // 42161

// Arbitrum blocks are produced every ~250ms by the sequencer
const block = await provider.getBlock("latest");
console.log(`Block number: ${block?.number}`);
console.log(`Timestamp: ${new Date((block?.timestamp ?? 0) * 1000).toISOString()}`);
```

### Sequencer and Finality Levels

Arbitrum has multiple levels of finality:

| Finality Level | Time | Trust Assumption |
|---|---|---|
| Soft confirmation | ~250ms | Trust the sequencer won't reorder |
| L1 batch posted | ~3-10 min | Data is on Ethereum, can be reconstructed |
| L1 finalized | ~7 days | Challenge window passed, state is final |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArbSys} from "@arbitrum/nitro-contracts@2.1.0/src/precompiles/ArbSys.sol";

/// @title FinalityAware
/// @notice Demonstrates how to reason about finality on Arbitrum
contract FinalityAware {
    ArbSys constant ARBSYS = ArbSys(address(100));

    /// @notice Get the L1 block number that Arbitrum has confirmed up to
    /// @dev This tells you which L1 block the sequencer has seen
    function getConfirmedL1Block() external view returns (uint256) {
        return ARBSYS.arbBlockNumber();
    }

    /// @notice Check if enough L1 blocks have passed for "soft finality"
    /// @param targetL1Block The L1 block number you're waiting for
    function isL1BlockConfirmed(uint256 targetL1Block) external view returns (bool) {
        return ARBSYS.arbBlockNumber() >= targetL1Block;
    }
}
```

### Fraud Proof Protocol (BOLD)

Arbitrum uses the BOLD (Bounded Liquidity Delay) protocol for dispute resolution:

1. A validator posts a state assertion to L1
2. Any other validator can challenge it within 7 days
3. The challenge is resolved via interactive bisection — the dispute is narrowed down to a single WASM instruction
4. The L1 contract executes that single instruction to determine the correct state
5. The losing party's stake is slashed

This means Arbitrum's security relies on at least one honest validator being online to challenge incorrect assertions.

### Data Availability: Calldata vs Blobs

After EIP-4844 (March 2024), Arbitrum posts transaction data as blobs instead of calldata:

| Method | Cost per byte | Availability |
|---|---|---|
| Calldata (pre-4844) | ~16 gas/byte × L1 gas price | Permanent on-chain |
| Blobs (post-4844) | ~1 gas/byte equivalent | ~18 days, then pruned |

Blobs reduced Arbitrum's L1 data costs by approximately 10x, which directly translates to lower user fees.

## Common Pitfalls

1. **Treating soft confirmations as final** — The sequencer provides instant "soft" confirmations, but these can theoretically be reordered until the batch is posted to L1. For high-value operations (bridges, large trades), wait for L1 batch inclusion (~3-10 minutes).

2. **Assuming the sequencer is decentralized** — Arbitrum's sequencer is currently a single entity run by Offchain Labs. It can censor transactions temporarily (users can force-include via L1 after ~24 hours). Don't build protocols that assume censorship resistance at the sequencer level.

3. **Ignoring the 7-day withdrawal delay** — Withdrawals from Arbitrum to Ethereum take 7 days due to the challenge window. If your protocol needs faster L2→L1 movement, you need a third-party bridge (like Across or Hop) that provides liquidity upfront.

4. **Confusing Arbitrum One and Arbitrum Nova** — Arbitrum One posts data to Ethereum (full security). Arbitrum Nova uses a Data Availability Committee (cheaper but weaker security guarantees). Deploy to One for DeFi; Nova is for gaming/social.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Understand gas, opcodes, and block semantics that differ on Arbitrum
- [Arbitrum Docs: Architecture Overview](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro) — Official deep dive into Nitro internals
- [Offchain Labs Nitro GitHub](https://github.com/OffchainLabs/nitro) — Source code for the Arbitrum Nitro node
