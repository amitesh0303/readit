# OP Stack Architecture: How Optimism Works Under the Hood

**Track:** Optimism & OP Stack Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've heard Optimism is an "optimistic rollup" and that the OP Stack powers multiple chains (Base, Mode, Zora), but you don't understand what that actually means for your code. What's a sequencer? How does fraud proving work? What's the Superchain vision? Without understanding the architecture, you can't reason about finality guarantees, withdrawal delays, or why certain design patterns matter on OP Stack chains.

## Core Concepts

### Optimistic Rollup Classification

Optimism is an **optimistic rollup** — it assumes all transactions are valid by default and only runs computation (fraud proofs) when a challenge is submitted. This contrasts with zk-rollups that prove every batch cryptographically.

```
┌─────────────────────────────────────────────────────────┐
│                    OP Stack Architecture                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │   Sequencer  │───▶│   Batcher    │                   │
│  │  (orders tx) │    │ (posts to L1)│                   │
│  └──────────────┘    └──────┬───────┘                   │
│                             │                            │
│  ┌──────────────┐    ┌──────▼───────┐                   │
│  │   Proposer   │───▶│  L1 Contracts│                   │
│  │(state roots) │    │(OptimismPortal│                   │
│  └──────────────┘    │ L2OutputOracle)│                  │
│                      └──────┬───────┘                   │
│                             │                            │
│  ┌──────────────┐    ┌──────▼───────┐                   │
│  │  Challenger  │───▶│ Fault Proof  │                   │
│  │ (disputes)   │    │   System     │                   │
│  └──────────────┘    └──────────────┘                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Key Components

**Sequencer**: Orders and executes transactions on L2. Currently centralized (run by Optimism Foundation) but with plans for decentralization. Produces L2 blocks every 2 seconds.

**Batcher**: Compresses transaction batches and posts them to Ethereum L1 as calldata (or blobs post-EIP-4844). This is where L1 data availability costs come from.

**Proposer**: Periodically submits L2 state root outputs to the `L2OutputOracle` contract on L1. These outputs represent the L2 state at a given block.

**Fault Proof System (Cannon)**: If a proposed state root is incorrect, challengers can initiate a dispute game. The system uses bisection to identify the exact instruction where execution diverged, then runs it on-chain via the MIPS-based Cannon VM.

### The Superchain Vision

The OP Stack is designed as a modular, shared framework. Multiple chains (Optimism Mainnet, Base, Mode, Zora, Worldchain) run the same stack and will eventually share a unified bridging layer:

```typescript
// @eth-optimism/sdk@3.3.1
import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";

// The same SDK works across all OP Stack chains
// Only the contract addresses and RPC URLs differ
const messenger = new CrossChainMessenger({
  l1ChainId: 1,          // Ethereum mainnet
  l2ChainId: 10,         // OP Mainnet
  l1SignerOrProvider: l1Signer,
  l2SignerOrProvider: l2Signer,
  bedrock: true,
});

// Check message status (works for any OP Stack chain)
const status = await messenger.getMessageStatus(txHash);
console.log("Message status:", MessageStatus[status]);
// Possible values: UNCONFIRMED_L1_TO_L2_MESSAGE, 
//                  FAILED_L1_TO_L2_MESSAGE,
//                  STATE_ROOT_NOT_PUBLISHED,
//                  READY_TO_PROVE,
//                  IN_CHALLENGE_PERIOD,
//                  READY_FOR_RELAY,
//                  RELAYED
```

### Finality Timeline

Understanding finality is critical for building on Optimism:

```
Transaction submitted
    │
    ▼ (~2 seconds)
Sequencer confirms (soft finality — sequencer could reorg)
    │
    ▼ (~2-10 minutes)
Batch posted to L1 (data availability guaranteed)
    │
    ▼ (~1 hour)
State root proposed to L1
    │
    ▼ (7 days challenge period)
State root finalized (hard finality — withdrawals can complete)
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IL2ToL1MessagePasser} from "@eth-optimism/contracts-bedrock/src/L2/IL2ToL1MessagePasser.sol";

/**
 * @title FinalityAwareContract
 * @notice Demonstrates how to reason about finality on OP Stack chains.
 * @dev On Optimism, block.number returns the L2 block number.
 *      Use the L1Block precompile for L1 block info.
 */
contract FinalityAwareContract {
    // L1Block predeploy address on all OP Stack chains
    address constant L1_BLOCK = 0x4200000000000000000000000000000000000015;

    event ActionRecorded(
        uint256 indexed l2Block,
        uint256 indexed l1Block,
        uint256 timestamp
    );

    function recordAction() external {
        // L2 block number (fast, ~2s blocks)
        uint256 l2Block = block.number;

        // Get the L1 block number from the predeploy
        // This is the L1 block at which the L2 block was derived
        (bool success, bytes memory data) = L1_BLOCK.staticcall(
            abi.encodeWithSignature("number()")
        );
        require(success, "L1Block call failed");
        uint256 l1Block = abi.decode(data, (uint256));

        emit ActionRecorded(l2Block, l1Block, block.timestamp);
    }
}
```

### EIP-4844 Blob Support

Since the Ecotone upgrade (March 2024), Optimism posts transaction data as EIP-4844 blobs instead of calldata, reducing L1 data costs by ~10x:

```typescript
// Checking blob vs calldata cost savings
// @ethersproject/providers@5.7.2
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

// The L1 fee is now calculated differently post-Ecotone
// L1Fee = (baseFeeScalar * l1BaseFee * txDataGas + 
//          blobBaseFeeScalar * blobBaseFee * txDataGas) / 16e6
async function estimateL1Fee(txData: string): Promise<bigint> {
  const gasPriceOracle = new ethers.Contract(
    "0x420000000000000000000000000000000000000F", // GasPriceOracle predeploy
    [
      "function getL1Fee(bytes) view returns (uint256)",
      "function baseFeeScalar() view returns (uint32)",
      "function blobBaseFeeScalar() view returns (uint32)",
    ],
    provider
  );

  try {
    const l1Fee = await gasPriceOracle.getL1Fee(txData);
    console.log("Estimated L1 fee:", ethers.formatEther(l1Fee), "ETH");
    return l1Fee;
  } catch (error) {
    console.error("Failed to estimate L1 fee:", error);
    throw error;
  }
}
```

## Common Pitfalls

1. **Assuming instant finality** — Sequencer confirmations (~2s) are soft finality. For high-value operations, wait for the batch to be posted to L1 (~2-10 min). For withdrawals to L1, the full 7-day challenge period applies.

2. **Ignoring the L1 data fee component** — Gas on Optimism has two parts: L2 execution fee (cheap) and L1 data fee (variable). Your gas estimates must account for both. The L1 component depends on Ethereum's blob base fee.

3. **Using `block.number` for time calculations** — L2 blocks are produced every 2 seconds, not 12 seconds like Ethereum. If you're porting code that uses block numbers as a time proxy, recalculate your constants or switch to `block.timestamp`.

4. **Not understanding the sequencer's role** — The sequencer is currently centralized. If it goes down, transactions queue on L1 and can be force-included after a timeout. Design your protocol to handle sequencer downtime gracefully.

5. **Confusing OP Mainnet with other OP Stack chains** — Base, Mode, and Zora all use the OP Stack but have different contract addresses, different sequencers, and different governance. Don't assume addresses are the same across chains.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — understand the specific opcode and gas behavior differences when deploying to Optimism
- [Bridging Assets on Optimism](./03-bridging-assets.md) — learn how to move ETH and ERC-20 tokens between L1 and Optimism
- [OP Stack Documentation](https://docs.optimism.io/) — official Optimism developer documentation
- [OP Stack GitHub Repository](https://github.com/ethereum-optimism/optimism) — source code for the OP Stack
