# Mantle Architecture: Optimistic Rollup with Modular Data Availability

**Track:** Mantle Network Development
**Lesson:** 1 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're evaluating Mantle Network for your next project. You know it's "an optimistic rollup" like Arbitrum or Optimism, but you've heard it uses a separate data availability layer instead of posting all data to Ethereum. What does that mean for security? How does the sequencer work? What are the trust assumptions compared to a traditional optimistic rollup? Without understanding Mantle's modular architecture, you can't reason about finality, data availability guarantees, or when Mantle is the right choice versus other L2s.

## Core Concepts

### What Makes Mantle Different

Mantle is an optimistic rollup built on a fork of the OP Stack, but with a critical architectural difference: it uses its own Data Availability (DA) layer powered by EigenDA technology instead of posting all transaction data to Ethereum L1. This makes Mantle a **modular optimistic rollup** — it separates execution, settlement, and data availability into distinct layers.

```
┌─────────────────────────────────────────────────────────┐
│                  Mantle Network Architecture             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions                              │
│       ↓                                                 │
│  Sequencer (centralized, Mantle team)                   │
│  └── Orders txs, produces L2 blocks (~2s)               │
│  └── Provides soft confirmations                        │
│       ↓                                                 │
│  Mantle DA (EigenDA-based)                              │
│  └── Transaction data posted to DA layer                │
│  └── Secured by restaked ETH via EigenLayer             │
│  └── Data availability attestations posted to L1        │
│       ↓                                                 │
│  State Commitment (Ethereum L1)                         │
│  └── State roots posted to L1 rollup contract           │
│  └── Fraud proof challenge window (~7 days)             │
│  └── Only state roots + DA attestations on L1           │
│       ↓                                                 │
│  Ethereum L1 (Settlement Layer)                         │
│  └── Resolves disputes                                  │
│  └── Finalizes state after challenge window             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### The Modular DA Approach

Traditional optimistic rollups (Arbitrum, Optimism) post compressed transaction data directly to Ethereum as calldata or blobs. Mantle takes a different approach:

| Component | Traditional Optimistic Rollup | Mantle |
|---|---|---|
| Execution | Off-chain (L2) | Off-chain (L2) |
| Settlement | Ethereum L1 | Ethereum L1 |
| Data Availability | Ethereum L1 (calldata/blobs) | Mantle DA (EigenDA-based) |
| Fraud Proofs | Against L1 data | Against DA-attested data |

This separation means Mantle doesn't pay Ethereum's data posting costs, resulting in significantly lower fees — but with a different security model for data availability.

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Connect to Mantle mainnet — standard EVM JSON-RPC interface
const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");

// Verify we're on Mantle (chainId 5000)
const network = await provider.getNetwork();
console.log(`Connected to chain: ${network.chainId}`); // 5000

// Mantle blocks are produced approximately every 2 seconds
const block = await provider.getBlock("latest");
console.log(`Block number: ${block?.number}`);
console.log(`Timestamp: ${new Date((block?.timestamp ?? 0) * 1000).toISOString()}`);

// Mantle uses MNT as the native gas token (not ETH)
const balance = await provider.getBalance("0xYourAddress");
console.log(`MNT balance: ${ethers.formatEther(balance)} MNT`);
```

### MNT: The Native Gas Token

Unlike most L2s that use ETH for gas, Mantle uses its own native token **MNT** for gas fees. This is a key architectural decision:

- Gas fees are paid in MNT, not ETH
- MNT is also the governance token for Mantle DAO
- Users need to bridge MNT (or swap on Mantle) before transacting
- Smart contracts that assume `msg.value` is ETH need adjustment for MNT

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MantleGasToken
/// @notice Demonstrates that Mantle uses MNT as native gas token
contract MantleGasToken {
    // On Mantle, msg.value is denominated in MNT, not ETH
    // This is critical for protocols that handle native token payments

    /// @notice Accept MNT payment (native token on Mantle)
    /// @dev msg.value here is MNT wei, not ETH wei
    function acceptPayment() external payable {
        require(msg.value > 0, "Must send MNT");
        // msg.value is in MNT (18 decimals, same as ETH)
    }

    /// @notice Get contract's MNT balance
    function getBalance() external view returns (uint256) {
        return address(this).balance; // Returns MNT balance
    }

    /// @notice Transfer MNT to recipient
    function transferMNT(address payable recipient, uint256 amount) external {
        require(address(this).balance >= amount, "Insufficient MNT");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "MNT transfer failed");
    }
}
```

### Sequencer and Finality Levels

Mantle has multiple levels of finality, similar to other optimistic rollups:

| Finality Level | Time | Trust Assumption |
|---|---|---|
| Soft confirmation | ~2s | Trust the sequencer won't reorder |
| DA attested | ~10-30 min | Data posted to Mantle DA, attested by operators |
| L1 state root posted | ~1 hour | State commitment on Ethereum |
| L1 finalized | ~7 days | Challenge window passed, state is final |

### Mantle DA and EigenLayer

Mantle's data availability layer is inspired by EigenDA and secured by restaked ETH through EigenLayer:

1. The sequencer produces blocks and posts transaction data to Mantle DA nodes
2. DA nodes are operators who have restaked ETH via EigenLayer
3. Operators attest to data availability by signing commitments
4. These attestations are posted to Ethereum L1 alongside state roots
5. If data is unavailable, the fraud proof system can challenge the state

This means Mantle's DA security is proportional to the amount of restaked ETH backing the DA operators — a different trust model than posting data directly to Ethereum.

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Mantle's rollup contract on Ethereum L1
// This is where state roots and DA attestations are posted
const L1_ROLLUP_ADDRESS = "0x31d543e7BE1dA6eFDc2206Ef7822879045B9f481";

const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");

// Read the latest state batch from L1
const rollupAbi = [
  "function lastBatchIndex() view returns (uint256)",
  "function batches(uint256) view returns (bytes32 batchRoot, uint256 batchSize, uint256 prevTotalElements, bytes extraData)"
];

const rollupContract = new ethers.Contract(L1_ROLLUP_ADDRESS, rollupAbi, l1Provider);

try {
  const lastBatch = await rollupContract.lastBatchIndex();
  console.log(`Latest state batch index: ${lastBatch}`);
} catch (error) {
  console.error("Failed to read rollup contract:", error);
  // Fallback: check Mantle explorer for latest batch info
  // https://explorer.mantle.xyz
}
```

### Comparison with Other Optimistic Rollups

| Feature | Arbitrum | Optimism | Mantle |
|---|---|---|---|
| Rollup Type | Optimistic | Optimistic (OP Stack) | Optimistic (OP Stack fork) |
| DA Layer | Ethereum (blobs) | Ethereum (blobs) | Mantle DA (EigenDA-based) |
| Gas Token | ETH | ETH | MNT |
| Block Time | ~250ms | ~2s | ~2s |
| Challenge Period | 7 days | 7 days | 7 days |
| Fraud Proof | Interactive (BOLD) | Cannon (non-interactive) | In development |
| EVM Compatibility | EVM-equivalent | EVM-equivalent | EVM-compatible |

## Common Pitfalls

1. **Assuming ETH is the gas token** — Mantle uses MNT for gas, not ETH. If your contract or frontend hardcodes ETH as the native token, transactions will fail or display incorrect values. Always check `chainId === 5000` and label the native token as MNT.

2. **Equating Mantle's DA security with Ethereum DA** — Mantle's data availability is secured by restaked ETH operators, not by Ethereum's full validator set. This is a weaker guarantee than posting data directly to L1. For extremely high-value protocols, understand this tradeoff.

3. **Ignoring the fraud proof status** — As of early 2025, Mantle's fraud proof system is still being developed. This means the chain currently relies on the honesty of the sequencer and proposer without a permissionless challenge mechanism. Monitor Mantle's roadmap for fraud proof activation.

4. **Not accounting for MNT price volatility in gas estimates** — Since gas is paid in MNT, your gas costs in USD terms fluctuate with MNT's market price, not ETH's. Budget accordingly and don't assume stable gas costs.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Understand gas model, opcodes, and block semantics that differ on Mantle
- [Mantle Docs: Architecture Overview](https://docs.mantle.xyz/network/introduction/a-gentle-introduction) — Official deep dive into Mantle's modular design
- [Mantle GitHub](https://github.com/mantlenetworkio) — Source code for Mantle's node and contracts
