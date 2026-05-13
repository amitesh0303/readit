# Scroll vs Ethereum Mainnet: What's Different

**Track:** Scroll Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

Scroll markets itself as "bytecode-equivalent" to Ethereum, and that's largely true — your contracts deploy without recompilation. But "bytecode-equivalent" doesn't mean "identical in every way." There are subtle differences in gas costs, block properties, and a few edge-case behaviors that can trip you up. If you're porting a production protocol from mainnet to Scroll, you need to know exactly where the seams are so you don't discover them in production.

## Core Concepts

### What's Truly Identical

The good news: most things work exactly as on Ethereum mainnet.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// All of these work identically on Scroll:
contract IdenticalBehavior {
    // ✅ Standard storage layout
    mapping(address => uint256) public balances;
    uint256[] public values;

    // ✅ All arithmetic, comparison, and bitwise opcodes
    function math(uint256 a, uint256 b) external pure returns (uint256) {
        return (a * b) + (a >> 2) ^ b;
    }

    // ✅ CREATE and CREATE2 produce same addresses as mainnet
    function deploy(bytes32 salt) external returns (address) {
        return address(new Child{salt: salt}());
    }

    // ✅ All precompiles: ecrecover, sha256, ripemd160, identity,
    //    modexp, ecAdd, ecMul, ecPairing, blake2f
    function recover(
        bytes32 hash, uint8 v, bytes32 r, bytes32 s
    ) external pure returns (address) {
        return ecrecover(hash, v, r, s);
    }

    // ✅ Events, reverts, require, assert — all identical
    event Deposited(address indexed user, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // ✅ Inheritance, interfaces, libraries — all work
    // ✅ Inline assembly — all standard opcodes supported
    // ✅ ABI encoding/decoding — identical
}

contract Child {
    address public immutable creator;
    constructor() { creator = msg.sender; }
}
```

### Block and Transaction Properties

Some `block.*` and `tx.*` values have different semantics on Scroll:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BlockDifferences {
    // ⚠️ block.number — returns L2 block number (not L1)
    // Scroll L2 blocks are produced every ~3 seconds
    // L1 block number is NOT directly accessible in the EVM
    function getBlockNumber() external view returns (uint256) {
        return block.number; // L2 block number
    }

    // ✅ block.timestamp — works as expected
    // Reflects the L2 block timestamp set by the sequencer
    function getTimestamp() external view returns (uint256) {
        return block.timestamp;
    }

    // ⚠️ block.basefee — exists but follows Scroll's fee model
    // Scroll uses EIP-1559 but with different parameters
    // Base fee adjusts based on L2 congestion, not L1
    function getBaseFee() external view returns (uint256) {
        return block.basefee;
    }

    // ⚠️ DIFFICULTY / PREVRANDAO — returns 0 on Scroll
    // Do NOT use for randomness (it's not random on L2)
    function getDifficulty() external view returns (uint256) {
        return block.prevrandao; // Always 0 on Scroll
    }

    // ✅ tx.origin and msg.sender — work as expected
    // No native account abstraction (unlike zkSync Era)
    // ERC-4337 works the same as on mainnet
    function getSender() external view returns (address, address) {
        return (msg.sender, tx.origin);
    }

    // ⚠️ block.gaslimit — different from Ethereum
    // Scroll has its own block gas limit (~10M gas per block)
    function getGasLimit() external view returns (uint256) {
        return block.gaslimit;
    }
}
```

### Gas Cost Differences

While opcodes are the same, gas costs differ because Scroll adds an **L1 data fee** on top of L2 execution gas:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Scroll gas model explanation
/// Total cost = L2 execution gas + L1 data fee
///
/// L2 execution gas: Same opcode costs as Ethereum
///   - SSTORE: 20,000 gas (cold), 5,000 gas (warm)
///   - CALL: 2,600 gas (cold address)
///   - ADD/MUL: 3-5 gas
///
/// L1 data fee: Cost of posting calldata/state diffs to Ethereum
///   - Proportional to transaction size (bytes)
///   - Varies with L1 gas price
///   - Calculated by L1GasPriceOracle system contract
///
/// The L1 data fee is the dominant cost for most transactions

interface IL1GasPriceOracle {
    /// @notice Returns the L1 data fee for a given raw transaction
    function getL1Fee(bytes memory data) external view returns (uint256);

    /// @notice Returns the current L1 base fee as seen by Scroll
    function l1BaseFee() external view returns (uint256);

    /// @notice Returns the overhead added to L1 data cost
    function overhead() external view returns (uint256);

    /// @notice Returns the scalar applied to L1 data cost
    function scalar() external view returns (uint256);
}

contract GasEstimation {
    // L1GasPriceOracle is deployed at a fixed address on Scroll
    IL1GasPriceOracle constant L1_ORACLE =
        IL1GasPriceOracle(0x5300000000000000000000000000000000000002);

    /// @notice Estimate the L1 portion of gas cost for a transaction
    function estimateL1Cost(bytes calldata txData) external view returns (uint256) {
        return L1_ORACLE.getL1Fee(txData);
    }

    /// @notice Get current L1 gas price as seen by Scroll
    function currentL1GasPrice() external view returns (uint256) {
        return L1_ORACLE.l1BaseFee();
    }
}
```

### The L1 Data Fee Formula

```typescript
// How Scroll calculates the L1 data fee component
// This is added ON TOP of normal L2 execution gas

interface L1FeeCalculation {
  // Step 1: Count non-zero and zero bytes in the transaction
  nonZeroBytes: number;  // Each costs 16 gas on L1
  zeroBytes: number;     // Each costs 4 gas on L1

  // Step 2: Calculate L1 gas used
  // l1Gas = (nonZeroBytes * 16 + zeroBytes * 4) + overhead
  l1Gas: number;

  // Step 3: Apply scalar and L1 gas price
  // l1Fee = l1Gas * l1BaseFee * scalar / 1e9
  l1Fee: bigint;
}

// Practical implication: smaller transactions are cheaper
// Calldata optimization matters MORE on Scroll than on Ethereum
// because you're paying L1 prices for every byte

// Example: ERC-20 transfer
// Transaction data: ~68 bytes (4 selector + 32 address + 32 amount)
// L1 gas: ~68 * 16 + overhead ≈ 1,200 L1 gas
// At 30 gwei L1 gas price: 1,200 * 30 gwei ≈ 36,000 gwei ≈ 0.000036 ETH
// This L1 fee is added to the L2 execution cost
```

### SELFDESTRUCT Behavior

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SelfDestructNote {
    // ⚠️ SELFDESTRUCT on Scroll follows EIP-6780 (same as Ethereum post-Dencun)
    // - Only destroys the contract if called in the same transaction as creation
    // - Otherwise, it only sends ETH but does NOT destroy the contract
    //
    // This is IDENTICAL to Ethereum mainnet behavior post-Dencun upgrade.
    // No Scroll-specific difference here.

    function emergencyWithdraw(address payable recipient) external {
        // Sends ETH to recipient but contract persists (post-EIP-6780)
        selfdestruct(recipient);
    }
}
```

### Precompile Support

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PrecompileSupport {
    // All Ethereum precompiles are supported on Scroll:
    //
    // 0x01 — ecrecover ✅
    // 0x02 — SHA-256 ✅
    // 0x03 — RIPEMD-160 ✅
    // 0x04 — identity (datacopy) ✅
    // 0x05 — modexp ✅
    // 0x06 — ecAdd (BN254) ✅
    // 0x07 — ecMul (BN254) ✅
    // 0x08 — ecPairing (BN254) ✅
    // 0x09 — blake2f ✅
    //
    // ⚠️ Point evaluation precompile (0x0a, EIP-4844) — check Scroll docs
    //    for current support status

    /// @notice Verify a BLS signature using ecPairing precompile
    function verifyPairing(
        bytes memory input
    ) external view returns (bool) {
        (bool success, bytes memory result) = address(0x08).staticcall(input);
        require(success, "Pairing check failed");
        return abi.decode(result, (bool));
    }
}
```

### What This Means for Your Contracts

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ScrollMigrationChecklist {
    // ✅ SAFE TO DEPLOY WITHOUT CHANGES:
    // - ERC-20, ERC-721, ERC-1155 tokens
    // - Uniswap V2/V3 forks
    // - Aave/Compound forks
    // - Multisig wallets (Safe)
    // - Governance contracts (OpenZeppelin Governor)
    // - Proxy patterns (UUPS, Transparent, Beacon)
    // - Any standard DeFi protocol

    // ⚠️ REVIEW BEFORE DEPLOYING:
    // - Contracts using block.prevrandao for randomness (returns 0)
    // - Contracts with hardcoded gas limits (L1 fee changes effective cost)
    // - Cross-chain messaging contracts (need Scroll bridge integration)
    // - Contracts that read L1 state (use Scroll's message passing)

    // ❌ WON'T WORK AS EXPECTED:
    // - Contracts relying on block.prevrandao for entropy
    // - Contracts assuming Ethereum's 12-second block time
    // - Contracts that need to read L1 block hashes directly
}
```

## Common Pitfalls

1. **Using `block.prevrandao` for randomness** — On Scroll, `PREVRANDAO` returns 0. If your contract uses it as a source of randomness (common in NFT mints or lottery contracts), it will be completely predictable. Use Chainlink VRF or a commit-reveal scheme instead.

2. **Hardcoding gas limits in `.call{gas: X}()`** — The L1 data fee component means effective gas costs fluctuate with L1 gas prices. Hardcoded gas limits that work today may fail tomorrow if L1 gets congested. Let the RPC estimate gas or use generous limits.

3. **Assuming Ethereum block times** — Scroll produces L2 blocks every ~3 seconds, not 12 seconds like Ethereum. If your contract uses `block.number` for time-based logic (e.g., "wait 100 blocks"), the actual wall-clock time will be different. Use `block.timestamp` for time-based logic.

4. **Ignoring the L1 data fee in gas optimization** — On Scroll, reducing calldata size saves more money than reducing computation. Packing function arguments, using shorter error messages, and minimizing event data all reduce the L1 fee component. Standard Ethereum gas optimization (reducing SLOADs) still helps but is less impactful.

5. **Not accounting for finalization delay in bridges** — While your transaction confirms in ~3 seconds on L2, it's not finalized on L1 for 4-8 hours. If you're building a bridge or cross-chain protocol, don't treat L2 confirmation as final.

## What to Learn Next

- [Bridging Assets on Scroll](./03-bridging-assets.md) — Moving ETH and tokens between Ethereum and Scroll
- [Scroll Developer Documentation](https://docs.scroll.io/en/developers/) — Official reference for Scroll-specific details
- [L1GasPriceOracle Contract](https://docs.scroll.io/en/developers/l1-and-l2-bridging/the-scroll-messenger/) — Understanding Scroll's fee model
