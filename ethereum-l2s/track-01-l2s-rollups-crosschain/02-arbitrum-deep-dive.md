# Arbitrum Deep Dive: Architecture and What Developers Need to Know

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You're deploying to Arbitrum. You know it's an optimistic rollup and it's cheaper than Ethereum. But when you actually start building, you hit unexpected behavior: `block.number` returns the wrong value, gas estimation is different, some contracts behave differently. You need to understand Arbitrum's architecture to build on it correctly.

---

## Core Concepts

### Arbitrum's Architecture

Arbitrum One uses the Nitro stack — a rewrite of the original Arbitrum that runs the EVM inside a WASM environment for fraud proofs.

```
User submits tx
    ↓
Arbitrum Sequencer (centralized, run by Offchain Labs)
    ↓  orders transactions, produces L2 blocks
Arbitrum Nodes (full nodes)
    ↓  execute transactions, maintain state
L1 Inbox Contract (on Ethereum)
    ↓  receives compressed transaction data
Ethereum (data availability + settlement)
```

**The Sequencer**: Arbitrum currently uses a single centralized sequencer run by Offchain Labs. It orders transactions and produces L2 blocks. This is a centralization point — the sequencer can censor transactions (though users can force-include transactions via L1 after a delay). Arbitrum is working toward decentralizing the sequencer.

**Nitro**: Arbitrum's current stack. It compiles the EVM to WASM for fraud proof execution. This means Arbitrum is EVM-equivalent — the same bytecode runs on Arbitrum as on Ethereum.

### Block Numbers and Timestamps

This is the most common source of bugs when porting Ethereum contracts to Arbitrum:

```solidity
// On Ethereum: block.number increments every ~12 seconds
// On Arbitrum: block.number increments every ~0.25 seconds (L2 blocks)
//              BUT it also tracks L1 block numbers via ArbSys

// WRONG: using block.number for time-based logic
uint256 vestingEnd = startBlock + 100; // 100 blocks = 25 seconds on Arbitrum, not 20 minutes!

// RIGHT: use block.timestamp (same semantics as Ethereum)
uint256 vestingEnd = startTime + 30 days;

// If you need L1 block number:
interface ArbSys {
    function arbBlockNumber() external view returns (uint256);
}
ArbSys constant arbsys = ArbSys(address(100));
uint256 l1BlockNumber = arbsys.arbBlockNumber(); // returns L1 block number
```

### Gas on Arbitrum

Arbitrum gas has two components:

**L2 execution gas**: similar to Ethereum gas, but much cheaper. Arbitrum's base fee is typically 0.1 gwei vs Ethereum's 10-50 gwei.

**L1 data fee**: the cost of posting your transaction data to Ethereum. This is the dominant cost for most transactions. It depends on:
- The size of your transaction data (calldata bytes)
- The current Ethereum base fee
- Arbitrum's L1 pricing algorithm

```
Total fee = L2 execution fee + L1 data fee

L2 execution fee = gasUsed × L2 gasPrice (cheap)
L1 data fee = txDataSize × L1 gasPrice × L1 pricing factor (variable)

For a simple swap:
L2 execution: ~100,000 gas × 0.1 gwei = 0.00001 ETH = ~$0.03
L1 data fee: ~200 bytes × 30 gwei × factor = ~0.0001 ETH = ~$0.30
Total: ~$0.33
```

After EIP-4844 (blobs), the L1 data fee dropped significantly because rollup data is now posted as blobs instead of calldata.

### Arbitrum-Specific Precompiles

Arbitrum has special precompile contracts that expose L2-specific functionality:

```solidity
// ArbSys (address 0x64): L2-specific system calls
interface ArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 arbBlockNum) external view returns (bytes32);
    function arbChainID() external view returns (uint256);
    function arbOSVersion() external view returns (uint256);
    // Withdraw ETH to L1
    function withdrawEth(address destination) external payable returns (uint256);
    // Send message to L1
    function sendTxToL1(address destination, bytes calldata data) external payable returns (uint256);
}

// ArbGasInfo (address 0x6C): gas pricing information
interface ArbGasInfo {
    function getPricesInWei() external view returns (
        uint256 perL2Tx,
        uint256 perL1CalldataUnit,
        uint256 perStorageAllocation,
        uint256 perArbGasBase,
        uint256 perArbGasCongestion,
        uint256 perArbGasTotal
    );
    function getL1BaseFeeEstimate() external view returns (uint256);
}

// NodeInterface (address 0xC8): off-chain gas estimation
// Only callable off-chain (not from contracts)
interface NodeInterface {
    function gasEstimateL1Component(
        address to,
        bool contractCreation,
        bytes calldata data
    ) external view returns (
        uint64 gasEstimateForL1,
        uint256 baseFee,
        uint256 l1BaseFeeEstimate
    );
}
```

### L1 ↔ L2 Messaging

Arbitrum has a native messaging system for passing data between L1 and L2:

**L1 → L2 (Retryable Tickets)**:
```solidity
// On L1: send a message to L2
IInbox inbox = IInbox(0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f);
inbox.createRetryableTicket{value: msg.value}(
    l2Target,           // L2 contract to call
    l2CallValue,        // ETH to send on L2
    maxSubmissionCost,  // fee for submitting the ticket
    excessFeeRefundAddress,
    callValueRefundAddress,
    gasLimit,           // L2 gas limit
    maxFeePerGas,       // L2 gas price
    data                // calldata for L2 call
);
```

**L2 → L1 (Outbox)**:
```solidity
// On L2: send a message to L1
ArbSys(address(100)).sendTxToL1{value: msg.value}(
    l1Target,
    data
);
// Message is available on L1 after the challenge period (7 days)
```

---

## Code Walkthrough

Arbitrum-aware contract patterns:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbChainID() external view returns (uint256);
}

interface ArbGasInfo {
    function getL1BaseFeeEstimate() external view returns (uint256);
}

/**
 * @title ArbitrumAware
 * @notice Base contract with Arbitrum-specific utilities.
 * Inherit from this for contracts deployed on Arbitrum.
 */
abstract contract ArbitrumAware {
    ArbSys constant ARBSYS = ArbSys(address(100));
    ArbGasInfo constant ARB_GAS_INFO = ArbGasInfo(address(0x6C));

    bool public immutable isArbitrum;

    constructor() {
        // Detect if we're on Arbitrum by checking chain ID
        // Arbitrum One: 42161, Arbitrum Goerli: 421613, Arbitrum Sepolia: 421614
        uint256 chainId = block.chainid;
        isArbitrum = (chainId == 42161 || chainId == 421614);
    }

    /**
     * @dev Get the L1 block number (for Arbitrum) or L2 block number (for others).
     * Use this instead of block.number for cross-chain compatible timing.
     */
    function _getL1BlockNumber() internal view returns (uint256) {
        if (isArbitrum) {
            return ARBSYS.arbBlockNumber();
        }
        return block.number;
    }

    /**
     * @dev Get current L1 base fee estimate (for fee calculations).
     */
    function _getL1BaseFee() internal view returns (uint256) {
        if (isArbitrum) {
            return ARB_GAS_INFO.getL1BaseFeeEstimate();
        }
        return block.basefee;
    }
}

/**
 * @title CrossChainVesting
 * @notice Vesting contract that works correctly on both Ethereum and Arbitrum.
 */
contract CrossChainVesting is ArbitrumAware {
    struct VestingSchedule {
        uint256 startTime;    // timestamp (works on all chains)
        uint256 duration;     // seconds
        uint256 totalAmount;
        uint256 released;
    }

    mapping(address => VestingSchedule) public schedules;

    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 durationSeconds
    ) external {
        schedules[beneficiary] = VestingSchedule({
            startTime: block.timestamp,  // timestamp is reliable on all chains
            duration: durationSeconds,
            totalAmount: amount,
            released: 0
        });
    }

    function vestedAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule memory schedule = schedules[beneficiary];
        if (block.timestamp < schedule.startTime) return 0;

        uint256 elapsed = block.timestamp - schedule.startTime;
        if (elapsed >= schedule.duration) return schedule.totalAmount;

        return (schedule.totalAmount * elapsed) / schedule.duration;
    }
}
```

TypeScript: Arbitrum-specific gas estimation:

```typescript
import { ethers } from "ethers";

const NODE_INTERFACE_ABI = [
  "function gasEstimateL1Component(address to, bool contractCreation, bytes calldata data) view returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
];

const ARB_GAS_INFO_ABI = [
  "function getL1BaseFeeEstimate() view returns (uint256)",
  "function getPricesInWei() view returns (uint256, uint256, uint256, uint256, uint256, uint256)",
];

async function estimateArbitrumGas(
  provider: ethers.Provider,
  to: string,
  data: string
): Promise<{ l2Gas: bigint; l1Gas: bigint; totalCostWei: bigint }> {
  // L2 execution gas estimate
  const l2Gas = await provider.estimateGas({ to, data });

  // L1 data fee estimate via NodeInterface (off-chain only)
  const nodeInterface = new ethers.Contract(
    "0x00000000000000000000000000000000000000C8",
    NODE_INTERFACE_ABI,
    provider
  );

  const [l1Gas] = await nodeInterface.gasEstimateL1Component(to, false, data);

  // Get current gas prices
  const feeData = await provider.getFeeData();
  const l2GasPrice = feeData.gasPrice ?? 100_000_000n; // 0.1 gwei default

  const arbGasInfo = new ethers.Contract(
    "0x000000000000000000000000000000000000006C",
    ARB_GAS_INFO_ABI,
    provider
  );
  const l1BaseFee = await arbGasInfo.getL1BaseFeeEstimate();

  const l2Cost = l2Gas * l2GasPrice;
  const l1Cost = l1Gas * l1BaseFee;
  const totalCostWei = l2Cost + l1Cost;

  console.log(`L2 gas: ${l2Gas}, L1 gas: ${l1Gas}`);
  console.log(`Total cost: ${ethers.formatEther(totalCostWei)} ETH`);

  return { l2Gas, l1Gas, totalCostWei };
}
```

---

## Common Mistakes and Gotchas

**1. Using `block.number` for time-based logic**  
Arbitrum produces L2 blocks every ~250ms. 100 blocks on Arbitrum = 25 seconds, not 20 minutes. Always use `block.timestamp` for time-based logic. If you need L1 block numbers, use `ArbSys.arbBlockNumber()`.

**2. Not accounting for L1 data fees in gas estimates**  
`provider.estimateGas()` only estimates L2 execution gas. The L1 data fee is additional and can be the dominant cost. Always use `NodeInterface.gasEstimateL1Component()` for accurate total cost estimates.

**3. Assuming the sequencer is decentralized**  
Arbitrum's sequencer is currently centralized. It can theoretically censor transactions (though users can force-include via L1 after a delay). Don't build protocols that assume the sequencer is trustless.

**4. Not testing retryable ticket failures**  
L1 → L2 messages via retryable tickets can fail if the L2 gas limit is too low. Failed tickets can be retried, but this requires monitoring. Always set generous gas limits for retryable tickets and implement retry logic.

**5. Forgetting that Arbitrum has its own mempool**  
Arbitrum's sequencer has its own mempool. MEV on Arbitrum is different from Ethereum — the sequencer controls ordering. Some MEV strategies that work on Ethereum don't work on Arbitrum, and vice versa.

---

## How This Connects to Production

GMX is Arbitrum-native — it was built specifically for Arbitrum's low fees and fast finality. Camelot DEX is Arbitrum-native. Radiant Capital (lending) is Arbitrum-native. Arbitrum has the highest TVL of any L2 as of 2024, largely because of its EVM equivalence (easy to port Ethereum protocols) and its DeFi ecosystem. The Arbitrum DAO (governed by ARB token holders) controls protocol upgrades and treasury — it's one of the most active DAOs in the space.

---

## What to Learn Next

- **Deploying to Arbitrum: What's Different from Ethereum Mainnet** — practical deployment guide.
- **Cross-Chain Bridges: How They Work and Where They Break** — understand the infrastructure connecting L1 and L2.
- **What is Caldera? Customizable Rollups and the Modular Blockchain Stack** — understand the next evolution of rollup infrastructure.
