# Differences from Ethereum Mainnet on Linea

**Track:** Linea Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

Linea advertises itself as a type 2 zkEVM — meaning most Solidity contracts deploy without changes. But "most" isn't "all." There are subtle differences in gas costs, opcode behavior, block properties, and precompile support that can break contracts or cause unexpected behavior. You need to know exactly what differs so you can audit existing contracts before deploying them to Linea and avoid debugging production issues that stem from L2-specific behavior.

## Core Concepts

### EVM Equivalence vs EVM Identity

Linea targets EVM equivalence at the bytecode level. This means:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// This contract deploys and works identically on Linea and Ethereum mainnet
contract SimpleStorage {
    uint256 private value;

    event ValueChanged(uint256 indexed oldValue, uint256 indexed newValue);

    error ValueUnchanged();

    function setValue(uint256 newValue) external {
        if (newValue == value) revert ValueUnchanged();
        uint256 oldValue = value;
        value = newValue;
        emit ValueChanged(oldValue, newValue);
    }

    function getValue() external view returns (uint256) {
        return value;
    }
}
```

Standard Solidity compiles with `solc` and deploys directly — no custom compiler needed. However, the execution environment has differences.

### Block Properties

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Demonstrates block property differences on Linea
contract BlockInfo {
    struct BlockData {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 baseFee;
        uint256 chainId;
        address coinbase;
        uint256 gasLimit;
        bytes32 prevRandao;
    }

    function getBlockData() external view returns (BlockData memory) {
        return BlockData({
            blockNumber: block.number,       // L2 block number (not L1)
            timestamp: block.timestamp,      // L2 block timestamp
            baseFee: block.basefee,          // Linea's dynamic base fee
            chainId: block.chainid,          // 59144 (mainnet) or 59141 (Sepolia)
            coinbase: block.coinbase,        // Sequencer address
            gasLimit: block.gaslimit,        // Linea block gas limit
            prevRandao: block.prevrandao     // NOT truly random — sequencer-determined
        });
    }
}

// Key differences:
// 1. block.number — Linea L2 block numbers, not Ethereum L1 block numbers
// 2. block.timestamp — L2 timestamps, may differ from L1 by seconds/minutes
// 3. block.prevrandao — NOT a secure randomness source on Linea
//    (sequencer controls this value, unlike post-merge Ethereum)
// 4. block.coinbase — Always the sequencer operator address
// 5. block.basefee — Linea's own EIP-1559 implementation (much lower than L1)
```

### Gas Cost Differences

While opcodes are functionally identical, their gas costs differ on Linea:

```typescript
// Gas cost comparison: Linea vs Ethereum mainnet
// These differences exist because proving costs differ from execution costs

interface GasDifferences {
  // Storage operations — relatively more expensive on Linea
  // because state diffs must be proven and posted to L1
  SSTORE_cold: {
    ethereum: 22_100;
    linea: "~22,100 (similar, but L1 data cost added)";
    note: "First write to a slot includes L1 pubdata cost";
  };

  // Computation — relatively cheaper on Linea
  // because pure computation is cheap to prove
  ADD: {
    ethereum: 3;
    linea: 3;
    note: "Arithmetic opcodes cost the same";
  };

  // Memory operations — similar
  MLOAD: {
    ethereum: 3;
    linea: 3;
    note: "Memory access unchanged";
  };

  // External calls — similar base cost, different total
  CALL: {
    ethereum: 2_600; // cold
    linea: "~2,600 base + variable L1 cost";
    note: "Calldata passed in calls adds to L1 data cost";
  };
}
```

The key insight: **Linea's total gas = execution gas + L1 data publication cost**. Operations that write state or produce calldata cost more relative to pure computation.

### Precompile Support

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Precompile availability on Linea
/// Most precompiles work identically, with some exceptions
contract PrecompileCheck {
    // ✅ Supported — works identically to mainnet
    function ecRecover(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address) {
        return ecrecover(hash, v, r, s);
    }

    // ✅ Supported — SHA-256
    function sha256Hash(bytes memory data) external pure returns (bytes32) {
        return sha256(data);
    }

    // ✅ Supported — RIPEMD-160
    function ripemd160Hash(bytes memory data) external pure returns (bytes20) {
        return ripemd160(data);
    }

    // ✅ Supported — modular exponentiation (0x05)
    // Used by RSA verification and some cryptographic operations

    // ✅ Supported — BN256 curve operations (0x06, 0x07, 0x08)
    // ecAdd, ecMul, ecPairing — used by many ZK verification contracts

    // ⚠️ BLAKE2F (0x09) — Check current support status
    // May have gas cost differences

    // ⚠️ Point evaluation (0x0a, EIP-4844) — Not applicable on L2
    // Blob transactions are an L1 concept
}
```

### Opcode Differences

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Opcodes with behavioral differences on Linea
contract OpcodeNotes {
    // ⚠️ SELFDESTRUCT — Deprecated per EIP-6780
    // On Linea (like post-Dencun Ethereum): only sends ETH, doesn't delete code
    // unless called in the same transaction as contract creation

    // ⚠️ DIFFICULTY / PREVRANDAO
    // Returns a value, but it is NOT cryptographically random
    // The sequencer determines this value
    // DO NOT use for randomness in production
    function unsafeRandom() external view returns (uint256) {
        // This is NOT secure on Linea!
        return block.prevrandao;
    }

    // ✅ CREATE2 — Works identically, produces same addresses as mainnet
    // This is a major advantage over type 4 zkEVMs (like zkSync Era)
    function deployWithCreate2(
        bytes32 salt,
        bytes memory bytecode
    ) external returns (address deployed) {
        assembly {
            deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        require(deployed != address(0), "CREATE2 failed");
    }

    // ✅ PUSH0 — Supported (Solidity 0.8.20+)
    // Linea supports Shanghai opcodes

    // ✅ MCOPY — Supported (Cancun opcode)
    // Linea tracks Ethereum upgrades
}
```

### Transaction Types

```typescript
// Linea supports standard Ethereum transaction types
import { ethers } from "ethers";

// Type 0: Legacy transactions — ✅ Supported
const legacyTx = {
  to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28",
  value: ethers.parseEther("0.1"),
  gasPrice: ethers.parseUnits("0.1", "gwei"), // Linea gas prices are very low
  gasLimit: 21000,
};

// Type 2: EIP-1559 transactions — ✅ Supported (recommended)
const eip1559Tx = {
  to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28",
  value: ethers.parseEther("0.1"),
  maxFeePerGas: ethers.parseUnits("1.5", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
  gasLimit: 21000,
  type: 2,
  chainId: 59144, // Linea mainnet
};

// Type 3: EIP-4844 blob transactions — ❌ Not applicable
// Blob transactions are an L1 concept; Linea uses blobs for DA
// but users don't submit blob txs to Linea directly

// Chain IDs:
// Linea Mainnet: 59144
// Linea Sepolia: 59141
```

### Contract Size Limits

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Contract size limit on Linea: 24,576 bytes (same as Ethereum mainnet)
// This is the EIP-170 limit and applies identically

// If your contract is too large, use the same patterns as on mainnet:
// 1. Split into libraries
// 2. Use the diamond pattern (EIP-2535)
// 3. Use proxy patterns

// ✅ All standard proxy patterns work on Linea:
// - TransparentUpgradeableProxy (OpenZeppelin)
// - UUPS (EIP-1822)
// - Beacon Proxy
// - Diamond (EIP-2535)

// Because Linea uses standard EVM bytecode, proxy patterns
// produce identical behavior to Ethereum mainnet.
```

### What Works Identically (No Changes Needed)

```
✅ Standard Solidity compilation (solc)
✅ OpenZeppelin contracts (all versions)
✅ Hardhat and Foundry tooling
✅ CREATE2 address derivation
✅ EIP-1559 fee market
✅ All standard precompiles
✅ Proxy patterns (Transparent, UUPS, Beacon, Diamond)
✅ ERC-20, ERC-721, ERC-1155 standards
✅ Multicall patterns
✅ Gnosis Safe / Safe{Wallet}
✅ Standard signature verification (EIP-712, EIP-191)
✅ Chainlink oracles (where deployed on Linea)
```

### What Requires Attention

```
⚠️ Gas estimation — Use Linea RPC, not mainnet estimates
⚠️ block.prevrandao — Not secure randomness (use Chainlink VRF)
⚠️ Finality assumptions — 1-3 hours for L1 finality, not 12 seconds
⚠️ L1 block references — block.number is L2, not L1
⚠️ Cross-chain messaging — Use Linea's message service, not arbitrary bridges
⚠️ Gas price — Much lower than mainnet (sub-gwei), adjust hardcoded values
```

## Common Pitfalls

1. **Hardcoding gas prices from mainnet** — Linea gas prices are orders of magnitude lower than Ethereum mainnet (often 0.05-0.5 gwei vs 20-100 gwei). Contracts or scripts with hardcoded gas prices will either overpay massively or fail if they assume mainnet-level prices. Always use `provider.getFeeData()` for dynamic pricing.

2. **Using `block.prevrandao` for randomness** — On Ethereum mainnet post-merge, `prevrandao` provides reasonable randomness from the beacon chain. On Linea, the sequencer controls this value, making it predictable and manipulable. Use Chainlink VRF or commit-reveal schemes for any randomness needs.

3. **Assuming 12-second block times** — Linea's block time is approximately 2-3 seconds, not Ethereum's 12 seconds. Time-based logic (vesting, auctions, cooldowns) using `block.timestamp` will execute faster than expected if you designed for mainnet timing. Adjust your time constants accordingly.

4. **Not testing gas consumption on Linea testnet** — While opcodes are the same, the total cost includes L1 data publication. A contract that's gas-efficient on mainnet might be relatively expensive on Linea if it produces large state diffs. Always profile on Linea Sepolia before mainnet deployment.

## What to Learn Next

- [Bridging Assets on Linea](./03-bridging-assets.md) — How to move ETH and tokens between Ethereum and Linea
- [Linea EVM Differences Documentation](https://docs.linea.build/developers/quickstart/ethereum-differences) — Official reference for all differences
- [EIP-1559 on Linea](https://docs.linea.build/developers/reference/api) — How the fee market works on Linea
