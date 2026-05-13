# Mantle vs Ethereum Mainnet: What's Different for Developers

**Track:** Mantle Network Development
**Lesson:** 2 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You have a working Solidity contract on Ethereum mainnet and you want to deploy it on Mantle. You've heard Mantle is "EVM-compatible," but you're not sure what that means in practice. Then you discover that gas is paid in MNT instead of ETH, the gas pricing model is different, and some opcodes behave unexpectedly. You need a clear map of what's different so you can port contracts safely without introducing subtle bugs.

## Core Concepts

### Native Gas Token: MNT vs ETH

The most fundamental difference: Mantle uses MNT as its native gas token. This affects every contract that handles native token transfers:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title NativeTokenDifferences
/// @notice Demonstrates native token handling differences between Ethereum and Mantle
contract NativeTokenDifferences {
    // ❌ MISLEADING: On Ethereum, this receives ETH
    // On Mantle, this receives MNT — same mechanics, different token
    receive() external payable {
        // msg.value is MNT on Mantle, ETH on Ethereum
        // The code works identically, but the VALUE is different
    }

    // ❌ WRONG: Hardcoding "ETH" in user-facing logic
    // function getEthBalance() external view returns (uint256) {
    //     return address(this).balance; // This is MNT on Mantle!
    // }

    // ✅ CORRECT: Use chain-aware naming
    function getNativeBalance() external view returns (uint256) {
        return address(this).balance; // MNT on Mantle, ETH on Ethereum
    }

    // ✅ CORRECT: If you need actual ETH on Mantle, use the wrapped ETH contract
    // WETH on Mantle: 0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111
    address constant WETH_ON_MANTLE = 0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111;

    function getWETHBalance(address user) external view returns (uint256) {
        // ETH exists as an ERC-20 (WETH) on Mantle
        (bool success, bytes memory data) = WETH_ON_MANTLE.staticcall(
            abi.encodeWithSignature("balanceOf(address)", user)
        );
        require(success, "WETH balance check failed");
        return abi.decode(data, (uint256));
    }
}
```

### Gas Model: Simplified L2 Fees

Mantle's gas model is simpler than Arbitrum's two-component system because DA costs are absorbed by the Mantle DA layer rather than passed directly to users as L1 data fees:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

interface MantleGasEstimate {
  gasLimit: bigint;        // Execution gas units
  gasPrice: bigint;        // MNT per gas unit (in wei)
  totalFeeMNT: bigint;     // Total fee in MNT wei
}

async function estimateMantleFee(
  provider: ethers.JsonRpcProvider,
  tx: { to: string; data: string; value?: bigint }
): Promise<MantleGasEstimate> {
  // Estimate gas — similar to Ethereum
  const gasLimit = await provider.estimateGas(tx);

  // Get current gas price in MNT
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 50_000_000n; // ~0.05 gwei typical on Mantle

  const totalFeeMNT = gasLimit * gasPrice;

  return {
    gasLimit,
    gasPrice,
    totalFeeMNT
  };
}

// Example usage
const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");
const estimate = await estimateMantleFee(provider, {
  to: "0x1234567890abcdef1234567890abcdef12345678",
  data: "0xa9059cbb" + "0".repeat(128) // ERC-20 transfer
});

console.log(`Gas limit: ${estimate.gasLimit}`);
console.log(`Gas price: ${ethers.formatUnits(estimate.gasPrice, "gwei")} gwei`);
console.log(`Total fee: ${ethers.formatEther(estimate.totalFeeMNT)} MNT`);
```

### Block Semantics

Mantle blocks differ from Ethereum in timing and structure:

| Property | Ethereum Mainnet | Mantle |
|---|---|---|
| Block time | ~12 seconds | ~2 seconds |
| `block.number` | L1 block number | L2 block number |
| `block.timestamp` | L1 timestamp | L2 timestamp (reliable) |
| `block.basefee` | Dynamic (EIP-1559) | Fixed or very low |
| `block.prevrandao` | Beacon chain randomness | Not reliable for randomness |
| `block.coinbase` | Block proposer | Sequencer address |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BlockSemantics
/// @notice Block-related differences on Mantle vs Ethereum
contract BlockSemantics {
    // ❌ WRONG: Using block.number for time calculations
    // Mantle blocks are ~2s, Ethereum blocks are ~12s
    // 100 blocks = 200 seconds on Mantle vs 1200 seconds on Ethereum
    uint256 public badLockEnd;

    function badTimeLock() external {
        badLockEnd = block.number + 43200; // Intended: 6 days on Ethereum
        // Actual on Mantle: 43200 × 2s = 24 hours!
    }

    // ✅ CORRECT: Use block.timestamp for time-based logic
    uint256 public goodLockEnd;

    function goodTimeLock() external {
        goodLockEnd = block.timestamp + 6 days; // Works correctly on both chains
    }

    // ⚠️ WARNING: block.prevrandao is NOT random on Mantle
    // Do NOT use for randomness — use Chainlink VRF or API3 QRNG
    function unsafeRandom() external view returns (uint256) {
        return block.prevrandao; // Predictable on Mantle!
    }
}
```

### Opcode Differences

Mantle is EVM-compatible but not EVM-equivalent. Most opcodes work identically, but some have different behavior:

| Opcode | Ethereum Behavior | Mantle Behavior |
|---|---|---|
| `BLOCKNUMBER` | L1 block number (~12s) | L2 block number (~2s) |
| `PREVRANDAO` | Beacon chain randomness | Not reliable (sequencer-controlled) |
| `COINBASE` | Block proposer address | Sequencer fee vault address |
| `BASEFEE` | Dynamic EIP-1559 base fee | Very low, near-constant |
| `GASPRICE` | Effective gas price | L2 gas price in MNT |
| `PUSH0` | Supported (Shanghai) | Supported |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OpcodeWarnings
/// @notice Opcodes that behave differently on Mantle
contract OpcodeWarnings {
    // ❌ DANGEROUS: Using prevrandao for randomness on Mantle
    function badRandom() external view returns (uint256) {
        return block.prevrandao; // Sequencer-controlled, NOT random!
    }

    // ✅ CORRECT: Use Chainlink VRF on Mantle
    // Chainlink VRF is available on Mantle mainnet
    // See: https://docs.chain.link/vrf/v2-5/supported-networks

    // ⚠️ NOTE: block.coinbase returns the sequencer fee vault
    // Not useful for MEV-related logic
    function getCoinbase() external view returns (address) {
        return block.coinbase; // Returns sequencer fee vault address
    }

    // ✅ SAFE: Standard arithmetic and storage opcodes work identically
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value; // Works the same (but value is MNT)
    }
}
```

### Contract Size and Deployment

Mantle supports the same 24KB contract size limit as Ethereum. Deployment is significantly cheaper due to lower gas costs:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DeploymentNotes
/// @notice Key differences in contract deployment on Mantle
contract DeploymentNotes {
    // Contract size limit: 24KB (same as Ethereum)
    // Deployment cost: significantly lower due to MNT gas pricing

    // CREATE2 works identically — same address derivation
    function computeCreate2Address(
        address deployer,
        bytes32 salt,
        bytes32 initCodeHash
    ) external pure returns (address) {
        return address(uint160(uint256(keccak256(
            abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)
        ))));
    }

    // Solidity compiler version support: 0.8.x fully supported
    // Recommended: Use 0.8.20+ for PUSH0 opcode support
}
```

### Transaction Types

Mantle supports standard Ethereum transaction types:

| Type | Description | Support |
|---|---|---|
| 0 (Legacy) | Pre-EIP-1559 | ✅ Supported |
| 2 (EIP-1559) | Priority fee + max fee | ✅ Supported |
| Deposit (L1→L2) | Cross-chain deposits | ✅ System-level |

Standard wallets and libraries (MetaMask, ethers.js, viem) work without modification — just configure the correct chain ID (5000) and RPC URL.

## Common Pitfalls

1. **Hardcoding ETH as the native token** — On Mantle, `msg.value` and `address.balance` are denominated in MNT. If your UI displays "ETH" or your contract logic assumes ETH pricing, users will be confused. Always check the chain ID and use appropriate token labels.

2. **Using `block.number` for time calculations** — Mantle produces blocks every ~2 seconds. A 7200-block delay means 4 hours on Mantle, not 24 hours like on Ethereum. Always use `block.timestamp` for time-based logic.

3. **Relying on `block.prevrandao` for randomness** — The sequencer controls block production on Mantle, making `prevrandao` predictable. Use Chainlink VRF (available on Mantle) or API3 QRNG for on-chain randomness.

4. **Not accounting for MNT/ETH price differences in DeFi logic** — If your protocol uses native token value for collateral or pricing, remember that 1 MNT ≠ 1 ETH in value. Oracle integrations need to price MNT separately from ETH.

5. **Assuming identical gas costs to other L2s** — Mantle's gas costs are denominated in MNT, not ETH. Comparing raw gas numbers between Mantle and Arbitrum/Optimism requires converting to a common denomination (USD or ETH equivalent).

## What to Learn Next

- [Bridging Assets on Mantle](./03-bridging-assets.md) — Move MNT, ETH, and tokens between Ethereum and Mantle
- [Mantle Docs: Technical Architecture](https://docs.mantle.xyz/network/introduction/a-gentle-introduction) — Official architecture documentation
- [Mantle GitHub: Contracts](https://github.com/mantlenetworkio/mantle-v2) — Source code for Mantle's L1 and L2 contracts
