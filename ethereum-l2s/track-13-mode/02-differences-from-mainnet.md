# Mode vs Ethereum Mainnet: Key Differences for Developers

**Track:** Mode Network Development
**Level:** Intermediate
**Read time:** 9 min

---

## The Problem

You're porting a Solidity contract from Ethereum mainnet to Mode. Since Mode is "EVM-equivalent," you assume everything works identically. But subtle differences in gas pricing, block timing, opcode behavior, and transaction fee structure can break your assumptions. Without understanding these differences, you'll write contracts that overpay for gas, mishandle timestamps, or fail to account for L1 data fees — the hidden cost component that doesn't exist on mainnet.

## Core Concepts

### EVM Equivalence on Mode

Mode runs op-geth, a minimally modified version of go-ethereum. This makes it EVM-equivalent (not just EVM-compatible), meaning:

- All Solidity/Vyper code compiles and deploys without modification
- All opcodes behave identically (with a few exceptions noted below)
- Standard tooling (Hardhat, Foundry, ethers.js) works out of the box
- Contract addresses are computed the same way (CREATE and CREATE2)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ModeBlockInfo
/// @notice Demonstrates block-level differences on Mode vs Ethereum
contract ModeBlockInfo {
    /// @notice On Mode, block.number increments every 2 seconds (not 12 seconds)
    /// @dev This means ~43,200 blocks/day on Mode vs ~7,200 on Ethereum
    function getBlockInfo() external view returns (
        uint256 blockNumber,
        uint256 timestamp,
        uint256 baseFee,
        uint256 chainId
    ) {
        return (
            block.number,      // Increments every ~2 seconds on Mode
            block.timestamp,   // Unix timestamp, same semantics
            block.basefee,     // Much lower than Ethereum (~0.001 gwei vs ~30 gwei)
            block.chainid      // 34443 on Mode Mainnet, 919 on Mode Sepolia
        );
    }

    /// @notice IMPORTANT: block.number on Mode refers to the L2 block, not L1
    /// @dev Use L1Block precompile if you need the L1 block number
    function getL1BlockNumber() external view returns (uint256) {
        // L1Block predeploy at 0x4200000000000000000000000000000000000015
        // Provides the latest known L1 block number
        (bool success, bytes memory data) = address(0x4200000000000000000000000000000000000015)
            .staticcall(abi.encodeWithSignature("number()"));
        require(success, "L1Block call failed");
        return abi.decode(data, (uint256));
    }
}
```

### Gas Fee Structure: Two Components

On Ethereum mainnet, you pay a single gas fee: `gasUsed × gasPrice`. On Mode (and all OP Stack chains), you pay two fees:

1. **L2 execution fee**: `gasUsed × L2_gasPrice` (very cheap, ~0.001 gwei)
2. **L1 data fee**: Cost of posting your transaction's calldata to Ethereum L1

The L1 data fee is the dominant cost and varies with Ethereum L1 gas prices.

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Understanding Mode's fee structure
async function analyzeModeGasCost(txHash: string): Promise<void> {
  const provider = new ethers.JsonRpcProvider("https://mainnet.mode.network");
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new Error("Transaction not found");
  }

  // L2 execution cost
  const l2ExecutionCost = receipt.gasUsed * receipt.gasPrice;
  console.log(`L2 execution gas used: ${receipt.gasUsed}`);
  console.log(`L2 gas price: ${ethers.formatUnits(receipt.gasPrice, "gwei")} gwei`);
  console.log(`L2 execution cost: ${ethers.formatEther(l2ExecutionCost)} ETH`);

  // L1 data fee (accessed via the GasPriceOracle predeploy)
  const gasPriceOracle = new ethers.Contract(
    "0x420000000000000000000000000000000000000F", // GasPriceOracle predeploy
    [
      "function l1BaseFee() view returns (uint256)",
      "function baseFeeScalar() view returns (uint32)",
      "function blobBaseFeeScalar() view returns (uint32)",
      "function blobBaseFee() view returns (uint256)"
    ],
    provider
  );

  const l1BaseFee = await gasPriceOracle.l1BaseFee();
  const blobBaseFee = await gasPriceOracle.blobBaseFee();
  console.log(`\nL1 base fee: ${ethers.formatUnits(l1BaseFee, "gwei")} gwei`);
  console.log(`Blob base fee: ${ethers.formatUnits(blobBaseFee, "gwei")} gwei`);
}
```

### Block Timing Differences

| Property | Ethereum Mainnet | Mode |
|---|---|---|
| Block time | ~12 seconds | ~2 seconds |
| Blocks per day | ~7,200 | ~43,200 |
| Block gas limit | 30M gas | 30M gas |
| Finality | ~15 minutes (2 epochs) | ~7 days (challenge window) |

This matters for time-dependent logic:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TimelockMode
/// @notice Demonstrates correct time-based logic on Mode
contract TimelockMode {
    uint256 public constant LOCK_DURATION = 1 days;
    mapping(address => uint256) public lockExpiry;

    /// @notice CORRECT: Use block.timestamp for time-based logic
    /// @dev block.timestamp works identically on Mode and Ethereum
    function lock() external {
        lockExpiry[msg.sender] = block.timestamp + LOCK_DURATION;
    }

    function unlock() external view returns (bool) {
        return block.timestamp >= lockExpiry[msg.sender];
    }

    /// @notice WRONG: Don't use block.number for time calculations on Mode
    /// @dev On Ethereum: 7200 blocks ≈ 1 day. On Mode: 43200 blocks ≈ 1 day
    /// If you hardcode 7200 blocks as "1 day", your timelock is only ~4 hours on Mode
    function incorrectBlockBasedLock() external view returns (uint256) {
        // DON'T DO THIS — block.number cadence differs across chains
        return block.number + 7200; // This is NOT 1 day on Mode!
    }
}
```

### Predeploy Contracts (OP Stack Standard)

Mode includes the standard OP Stack predeploy contracts at fixed addresses:

| Address | Contract | Purpose |
|---|---|---|
| `0x4200...0006` | WETH9 | Wrapped ETH |
| `0x4200...000F` | GasPriceOracle | L1 fee estimation |
| `0x4200...0010` | L2ToL1MessagePasser | Initiate withdrawals to L1 |
| `0x4200...0011` | L2CrossDomainMessenger | Cross-domain messaging |
| `0x4200...0012` | L2StandardBridge | Standard token bridge |
| `0x4200...0015` | L1Block | L1 block attributes on L2 |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ModeL1DataReader
/// @notice Read L1 state from within Mode L2 contracts
contract ModeL1DataReader {
    /// @dev L1Block predeploy — provides L1 context to L2
    address constant L1_BLOCK = 0x4200000000000000000000000000000000000015;

    struct L1Context {
        uint64 l1BlockNumber;
        uint64 l1Timestamp;
        uint256 l1BaseFee;
        bytes32 l1BlockHash;
    }

    /// @notice Get current L1 context available on Mode
    function getL1Context() external view returns (L1Context memory ctx) {
        // Each field is a separate view function on the L1Block contract
        (bool s1, bytes memory d1) = L1_BLOCK.staticcall(abi.encodeWithSignature("number()"));
        (bool s2, bytes memory d2) = L1_BLOCK.staticcall(abi.encodeWithSignature("timestamp()"));
        (bool s3, bytes memory d3) = L1_BLOCK.staticcall(abi.encodeWithSignature("basefee()"));
        (bool s4, bytes memory d4) = L1_BLOCK.staticcall(abi.encodeWithSignature("hash()"));

        require(s1 && s2 && s3 && s4, "L1Block read failed");

        ctx.l1BlockNumber = abi.decode(d1, (uint64));
        ctx.l1Timestamp = abi.decode(d2, (uint64));
        ctx.l1BaseFee = abi.decode(d3, (uint256));
        ctx.l1BlockHash = abi.decode(d4, (bytes32));
    }
}
```

### Transaction Types

Mode supports the same transaction types as Ethereum post-EIP-4844:

- **Type 0**: Legacy transactions (gasPrice)
- **Type 1**: EIP-2930 access list transactions
- **Type 2**: EIP-1559 transactions (maxFeePerGas + maxPriorityFeePerGas)

The L1 data fee is charged regardless of transaction type and is not configurable by the user.

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Sending an EIP-1559 transaction on Mode
async function sendModeTransaction(): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider("https://sepolia.mode.network");
  const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

  // Mode's L2 gas prices are extremely low
  const feeData = await provider.getFeeData();
  console.log(`Max fee per gas: ${ethers.formatUnits(feeData.maxFeePerGas ?? 0n, "gwei")} gwei`);
  console.log(`Max priority fee: ${ethers.formatUnits(feeData.maxPriorityFeePerGas ?? 0n, "gwei")} gwei`);

  const tx = await wallet.sendTransaction({
    to: "0x1234567890123456789012345678901234567890",
    value: ethers.parseEther("0.001"),
    type: 2, // EIP-1559
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
  });

  console.log(`Transaction hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Gas used: ${receipt?.gasUsed}`);
  console.log(`Effective gas price: ${ethers.formatUnits(receipt?.gasPrice ?? 0n, "gwei")} gwei`);

  return receipt;
}
```

## Common Pitfalls

1. **Using `block.number` for time calculations** — Mode produces blocks every 2 seconds vs Ethereum's 12 seconds. If your contract uses block numbers as a proxy for time (e.g., "7200 blocks = 1 day"), it will be off by 6x on Mode. Always use `block.timestamp` for time-dependent logic.

2. **Ignoring L1 data fees in gas estimates** — `eth_estimateGas` on Mode returns only the L2 execution gas. The actual transaction cost includes the L1 data fee, which can be 5-50x the L2 execution cost. Use the GasPriceOracle predeploy to estimate total costs.

3. **Hardcoding chain-specific addresses** — While OP Stack predeploys are at the same addresses across all OP Stack chains, the SFS contract and other Mode-specific contracts have different addresses on mainnet vs testnet. Use configuration patterns, not hardcoded addresses.

4. **Assuming instant finality** — Mode's 2-second blocks give fast soft confirmations, but true finality requires the 7-day challenge window to pass. For high-value operations, consider the finality level appropriate for your use case.

## What to Learn Next

- [Bridging Assets on Mode](./03-bridging-assets.md) — Move ETH and tokens between Ethereum and Mode
- [Mode Docs: Network Information](https://docs.mode.network/general-info/network-details) — Official network parameters and RPC endpoints
- [OP Stack Predeploys](https://github.com/ethereum-optimism/optimism/blob/develop/specs/predeploys.md) — Full specification of predeploy contracts
