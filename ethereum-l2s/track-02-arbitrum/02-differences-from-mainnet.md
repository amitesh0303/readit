# Arbitrum vs Ethereum Mainnet: What's Different for Developers

**Track:** Arbitrum Development
**Lesson:** 2 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You have a working Solidity contract on Ethereum mainnet and you want to deploy it on Arbitrum. You've heard Arbitrum is "EVM-equivalent," so you assume everything works identically. Then you discover `block.number` increments every 250ms instead of every 12 seconds, gas estimation returns unexpected values, and your time-locked contract unlocks 2,880x faster than expected. You need a clear map of what's different so you can port contracts safely.

## Core Concepts

### Block Numbers and Timestamps

The most common source of bugs when porting from Ethereum to Arbitrum:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BlockDifferences
/// @notice Demonstrates block.number behavior differences between Ethereum and Arbitrum
contract BlockDifferences {
    // ❌ WRONG: Using block.number for time-based logic
    // On Ethereum: 1 block ≈ 12 seconds → 100 blocks ≈ 20 minutes
    // On Arbitrum: 1 block ≈ 0.25 seconds → 100 blocks ≈ 25 seconds!
    uint256 public badLockEnd;

    function badTimeLock() external {
        badLockEnd = block.number + 7200; // Intended: 1 day on Ethereum
        // Actual on Arbitrum: 7200 × 0.25s = 30 minutes!
    }

    // ✅ CORRECT: Using block.timestamp for time-based logic
    uint256 public goodLockEnd;

    function goodTimeLock() external {
        goodLockEnd = block.timestamp + 1 days; // Works identically on both chains
    }

    // ✅ CORRECT: If you need L1 block number, use ArbSys precompile
    function getL1BlockNumber() external view returns (uint256) {
        // ArbSys at address(100) provides L1 block number
        (bool success, bytes memory data) = address(100).staticcall(
            abi.encodeWithSignature("arbBlockNumber()")
        );
        require(success, "ArbSys call failed");
        return abi.decode(data, (uint256));
    }
}
```

### Gas Model: Two Components

Arbitrum gas has two distinct parts that combine into the total fee:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Arbitrum gas breakdown
interface ArbitrumGasEstimate {
  l2ExecutionGas: bigint;   // Gas for EVM execution (cheap)
  l1DataFee: bigint;        // Fee for posting tx data to Ethereum (dominant cost)
  totalFeeWei: bigint;      // Sum of both components
}

async function estimateArbitrumFee(
  provider: ethers.JsonRpcProvider,
  tx: { to: string; data: string }
): Promise<ArbitrumGasEstimate> {
  // 1. L2 execution gas — same as estimateGas on Ethereum
  const l2ExecutionGas = await provider.estimateGas(tx);

  // 2. L1 data fee — use NodeInterface precompile (off-chain only)
  const nodeInterface = new ethers.Contract(
    "0x00000000000000000000000000000000000000C8",
    [
      "function gasEstimateL1Component(address to, bool contractCreation, bytes data) view returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"
    ],
    provider
  );

  const [l1GasEstimate, , l1BaseFee] = await nodeInterface.gasEstimateL1Component(
    tx.to,
    false,
    tx.data
  );

  // Calculate costs
  const feeData = await provider.getFeeData();
  const l2GasPrice = feeData.gasPrice ?? 100_000_000n; // ~0.1 gwei typical

  const l2Cost = l2ExecutionGas * l2GasPrice;
  const l1Cost = BigInt(l1GasEstimate) * l1BaseFee;

  return {
    l2ExecutionGas,
    l1DataFee: l1Cost,
    totalFeeWei: l2Cost + l1Cost
  };
}

// Example usage
const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
const estimate = await estimateArbitrumFee(provider, {
  to: "0x1234567890abcdef1234567890abcdef12345678",
  data: "0xa9059cbb" + "0".repeat(128) // ERC-20 transfer
});

console.log(`L2 execution gas: ${estimate.l2ExecutionGas}`);
console.log(`L1 data fee: ${ethers.formatEther(estimate.l1DataFee)} ETH`);
console.log(`Total fee: ${ethers.formatEther(estimate.totalFeeWei)} ETH`);
```

### Opcode Differences

Most EVM opcodes work identically, but a few behave differently:

| Opcode | Ethereum Behavior | Arbitrum Behavior |
|---|---|---|
| `BLOCKNUMBER` | L1 block number (~12s) | L2 block number (~250ms) |
| `DIFFICULTY` / `PREVRANDAO` | Beacon chain randomness | Returns constant 1 (not random!) |
| `COINBASE` | Block proposer address | Returns zero address |
| `BASEFEE` | L1 base fee | L2 base fee (much lower) |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OpcodeWarnings
/// @notice Opcodes that behave differently on Arbitrum
contract OpcodeWarnings {
    // ❌ DANGEROUS: Using prevrandao for randomness on Arbitrum
    // On Ethereum: returns beacon chain randomness (reasonably unpredictable)
    // On Arbitrum: returns constant 1 — NOT random at all!
    function badRandom() external view returns (uint256) {
        return block.prevrandao; // Always returns 1 on Arbitrum!
    }

    // ✅ CORRECT: Use Chainlink VRF or commit-reveal for randomness
    // Chainlink VRF is available on Arbitrum One
    // See: https://docs.chain.link/vrf/v2-5/supported-networks#arbitrum-one

    // ❌ WRONG: Using coinbase for MEV-related logic
    // On Ethereum: returns the block proposer's address
    // On Arbitrum: returns address(0)
    function getCoinbase() external view returns (address) {
        return block.coinbase; // Always address(0) on Arbitrum
    }
}
```

### Contract Size and Deployment Limits

Arbitrum supports the same 24KB contract size limit as Ethereum, but there are nuances:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DeploymentNotes
/// @notice Key differences in contract deployment on Arbitrum
contract DeploymentNotes {
    // Contract size limit: 24KB (same as Ethereum)
    // But deployment is much cheaper due to lower gas costs

    // Constructor execution gas is L2 gas (cheap)
    // But constructor BYTECODE is posted to L1 (costs L1 data fee)
    // Optimization: minimize constructor parameters and bytecode size

    // Arbitrum supports CREATE2 with identical behavior to Ethereum
    // Same address derivation: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)
    function computeCreate2Address(
        address deployer,
        bytes32 salt,
        bytes32 initCodeHash
    ) external pure returns (address) {
        return address(uint160(uint256(keccak256(
            abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)
        ))));
    }
}
```

### Transaction Types

Arbitrum supports all standard Ethereum transaction types plus Arbitrum-specific types:

| Type | Description | Use Case |
|---|---|---|
| 0 (Legacy) | Pre-EIP-1559 | Backward compatibility |
| 2 (EIP-1559) | Priority fee + max fee | Standard transactions |
| 100 | Arbitrum deposit (L1→L2) | Cross-chain deposits |
| 101 | Arbitrum unsigned | Internal system transactions |
| 104 | Arbitrum retry | Retryable ticket redemption |
| 105 | Arbitrum submit retryable | Create retryable ticket |

Standard wallets and libraries handle types 0 and 2 automatically. Types 100-105 are used by the bridge and system contracts.

## Common Pitfalls

1. **Using `block.number` for time calculations** — This is the #1 bug when porting from Ethereum. Arbitrum L2 blocks are produced every ~250ms. A 7200-block delay means 30 minutes on Arbitrum, not 24 hours. Always use `block.timestamp` for time-based logic.

2. **Relying on `block.prevrandao` for randomness** — On Arbitrum, `PREVRANDAO` returns a constant value of 1. It provides zero randomness. Use Chainlink VRF (available on Arbitrum) or a commit-reveal scheme instead.

3. **Not accounting for L1 data fees in gas estimates** — `eth_estimateGas` only returns L2 execution gas. The L1 data fee (often the dominant cost) is separate. Use the NodeInterface precompile at `0xC8` for accurate total cost estimates.

4. **Assuming MEV works the same way** — Arbitrum's centralized sequencer uses first-come-first-served ordering (no priority gas auction). Traditional MEV strategies like frontrunning via higher gas prices don't work. The sequencer sees transactions in arrival order.

5. **Hardcoding gas prices from Ethereum** — Arbitrum's L2 base fee is typically 0.01-0.1 gwei vs Ethereum's 10-50 gwei. Hardcoding Ethereum-level gas prices wastes user funds. Always query the network's current fee data.

## What to Learn Next

- [Bridging Assets on Arbitrum](./03-bridging-assets.md) — Move ETH and tokens between Ethereum and Arbitrum in both directions
- [Arbitrum Docs: Differences from Ethereum](https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/comparison-overview) — Official comparison reference
- [Arbitrum Nitro GitHub](https://github.com/OffchainLabs/nitro) — Source code showing EVM equivalence implementation
