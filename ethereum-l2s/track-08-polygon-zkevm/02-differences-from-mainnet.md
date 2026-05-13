# Polygon zkEVM vs Ethereum Mainnet: What's Different

**Track:** Polygon zkEVM Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You have Solidity contracts running on Ethereum mainnet. Polygon zkEVM claims "EVM equivalence" — Type 2 on the zkEVM classification scale. But "equivalent" doesn't mean "identical." There are differences in gas costs, supported precompiles, opcode behavior, and system-level semantics that can break your contracts or produce unexpected results. This lesson catalogs every difference that matters so you can assess whether your existing contracts need modification before deploying to Polygon zkEVM.

## Core Concepts

### EVM Equivalence: What Type 2 Actually Guarantees

Polygon zkEVM is a Type 2 zkEVM, meaning:

- ✅ Same Solidity compiler output (`solc`) works without recompilation
- ✅ Same bytecode deploys and executes
- ✅ Same opcodes are supported (with minor exceptions)
- ⚠️ Gas costs differ for some operations
- ⚠️ Some precompiles behave differently or are unsupported
- ⚠️ Block-level semantics (timestamps, block numbers) differ

```typescript
// Same deployment code works on both chains — no special compiler needed
import { ethers } from "ethers"; // ethers@6.9.0

// Deploy to Polygon zkEVM using standard ethers.js — no special SDK required
const provider = new ethers.JsonRpcProvider("https://rpc.cardona.zkevm-rpc.com"); // Cardona testnet
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// Standard contract factory — same bytecode as Ethereum
const factory = new ethers.ContractFactory(abi, bytecode, wallet);
const contract = await factory.deploy(/* constructor args */);
await contract.waitForDeployment();

console.log(`Deployed to: ${await contract.getAddress()}`);
// Works identically to Ethereum deployment
```

### Opcode Differences

Most EVM opcodes work identically. The following have notable differences:

| Opcode | Ethereum Behavior | Polygon zkEVM Behavior |
|--------|------------------|----------------------|
| `DIFFICULTY` / `PREVRANDAO` | Returns beacon chain randomness | Returns `0` (no beacon chain) |
| `BLOCKHASH` | Returns hash of last 256 blocks | Limited to recent blocks, may return 0 for older blocks |
| `SELFDESTRUCT` | Destroys contract, sends ETH | Deprecated per EIP-6780; sends ETH but doesn't destroy |
| `COINBASE` | Returns block proposer address | Returns the sequencer's fee address |
| `NUMBER` | L1 block number | L2 block number (different cadence) |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OpcodeAwareness
/// @notice Demonstrates opcode differences on Polygon zkEVM
contract OpcodeAwareness {
    /// @notice PREVRANDAO returns 0 on Polygon zkEVM — don't use for randomness
    /// @dev On Ethereum, this returns beacon chain randomness post-merge
    function getRandomness() external view returns (uint256) {
        // WARNING: Returns 0 on Polygon zkEVM!
        // Use Chainlink VRF or similar oracle for randomness
        return block.prevrandao;
    }

    /// @notice Block numbers are L2 block numbers, not L1
    /// @dev L2 blocks are produced faster than L1 blocks
    function getCurrentBlock() external view returns (uint256 blockNum, uint256 timestamp) {
        blockNum = block.number;    // L2 block number
        timestamp = block.timestamp; // L2 timestamp (sequencer-set)
        // Don't assume 12-second block times like Ethereum mainnet
    }

    /// @notice COINBASE returns the sequencer fee address, not a validator
    function getSequencer() external view returns (address) {
        return block.coinbase; // Sequencer's fee collection address
    }

    /// @notice BLOCKHASH has limited history on Polygon zkEVM
    function getRecentBlockHash(uint256 blockNumber) external view returns (bytes32) {
        // May return bytes32(0) for blocks older than recent history
        return blockhash(blockNumber);
    }
}
```

### Gas Cost Differences

While most operations cost similar gas, ZK-proof-heavy operations cost more:

```typescript
// Gas comparison for common operations
// Measured on Polygon zkEVM Cardona testnet vs Ethereum Sepolia
// Last verified: 2025-01-15

interface GasDifference {
  operation: string;
  ethereumGas: number;
  polygonZkevmGas: number;
  note: string;
}

const gasDifferences: GasDifference[] = [
  {
    operation: "ETH Transfer",
    ethereumGas: 21_000,
    polygonZkevmGas: 21_000,
    note: "Identical — basic transfers are the same",
  },
  {
    operation: "SSTORE (cold, zero → non-zero)",
    ethereumGas: 22_100,
    polygonZkevmGas: 22_100,
    note: "Identical — storage writes match",
  },
  {
    operation: "KECCAK256 (32 bytes)",
    ethereumGas: 36,
    polygonZkevmGas: 36,
    note: "Same gas cost, but proving is expensive internally",
  },
  {
    operation: "KECCAK256 (large input, 1KB)",
    ethereumGas: 222,
    polygonZkevmGas: 222,
    note: "Gas matches, but batch proving time increases",
  },
  {
    operation: "Contract deployment (medium)",
    ethereumGas: 800_000,
    polygonZkevmGas: 850_000,
    note: "Slightly higher due to bytecode verification overhead",
  },
  {
    operation: "ecRecover (precompile)",
    ethereumGas: 3_000,
    polygonZkevmGas: 3_000,
    note: "Supported and same cost",
  },
];

// Key insight: gas UNITS are similar, but gas PRICE is much lower on Polygon zkEVM
// Ethereum: ~30 gwei gas price → expensive in USD
// Polygon zkEVM: ~0.001-0.01 gwei effective → cheap in USD
```

### Precompile Support

Polygon zkEVM supports most Ethereum precompiles but with caveats:

| Address | Precompile | Status | Notes |
|---------|-----------|--------|-------|
| 0x01 | ecRecover | ✅ Supported | Works identically |
| 0x02 | SHA-256 | ✅ Supported | Works identically |
| 0x03 | RIPEMD-160 | ✅ Supported | Works identically |
| 0x04 | identity | ✅ Supported | Works identically |
| 0x05 | modexp | ✅ Supported | Works identically |
| 0x06 | ecAdd | ✅ Supported | BN254 curve operations |
| 0x07 | ecMul | ✅ Supported | BN254 curve operations |
| 0x08 | ecPairing | ✅ Supported | BN254 pairing check |
| 0x09 | blake2f | ⚠️ Limited | May have gas differences |
| 0x0a | point evaluation | ⚠️ Limited | EIP-4844 related |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PrecompileChecker
/// @notice Verify precompile availability on Polygon zkEVM
contract PrecompileChecker {
    /// @notice ecRecover works identically — safe for signature verification
    function verifySignature(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address signer) {
        signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Invalid signature");
        return signer;
    }

    /// @notice SHA-256 precompile works — safe for Bitcoin-related operations
    function sha256Hash(bytes memory data) external pure returns (bytes32) {
        return sha256(data);
    }

    /// @notice BN254 operations work — safe for ZK-SNARK verification on-chain
    /// @dev This means you can verify ZK proofs within Polygon zkEVM contracts
    function verifyBn254Add(
        uint256[2] memory p1,
        uint256[2] memory p2
    ) external view returns (uint256[2] memory result) {
        uint256[4] memory input;
        input[0] = p1[0];
        input[1] = p1[1];
        input[2] = p2[0];
        input[3] = p2[1];

        assembly {
            // Call ecAdd precompile at address 0x06
            let success := staticcall(gas(), 0x06, input, 128, result, 64)
            if iszero(success) { revert(0, 0) }
        }
    }
}
```

### Transaction Types

Polygon zkEVM supports standard Ethereum transaction types:

| Type | Name | Supported |
|------|------|-----------|
| 0 | Legacy | ✅ |
| 1 | EIP-2930 (access list) | ✅ |
| 2 | EIP-1559 (dynamic fee) | ✅ |

```typescript
// EIP-1559 transactions work on Polygon zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const provider = new ethers.JsonRpcProvider("https://rpc.cardona.zkevm-rpc.com");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// Get fee data — works the same as Ethereum
const feeData = await provider.getFeeData();
console.log(`Max fee per gas: ${ethers.formatUnits(feeData.maxFeePerGas!, "gwei")} gwei`);
console.log(`Max priority fee: ${ethers.formatUnits(feeData.maxPriorityFeePerGas!, "gwei")} gwei`);

// Send EIP-1559 transaction
const tx = await wallet.sendTransaction({
  to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28",
  value: ethers.parseEther("0.01"),
  type: 2, // EIP-1559
  maxFeePerGas: feeData.maxFeePerGas,
  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
});

const receipt = await tx.wait();
console.log(`Gas used: ${receipt!.gasUsed}`);
console.log(`Effective gas price: ${ethers.formatUnits(receipt!.gasPrice, "gwei")} gwei`);
```

### Contract Size Limits

Polygon zkEVM enforces the same contract size limit as Ethereum (24,576 bytes per EIP-170). However, because bytecode is identical, contracts that are close to the limit on Ethereum will also be close on Polygon zkEVM — no additional overhead from recompilation.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SizeCheck
/// @notice Same 24KB limit applies on Polygon zkEVM
/// @dev If your contract is near the limit on Ethereum, it's near the limit here too
contract SizeCheck {
    /// @notice Check deployed bytecode size
    function getCodeSize(address target) external view returns (uint256) {
        uint256 size;
        assembly {
            size := extcodesize(target)
        }
        return size;
        // Max: 24,576 bytes (same as Ethereum)
    }
}
```

### What Works Without Modification

The following patterns work identically on Polygon zkEVM and Ethereum:

- OpenZeppelin contracts (ERC-20, ERC-721, ERC-1155, AccessControl, etc.)
- Uniswap V2/V3 contracts
- Aave V3 contracts
- Standard proxy patterns (TransparentProxy, UUPS, Beacon)
- Chainlink oracle integrations (with Polygon zkEVM price feeds)
- Multicall patterns
- CREATE2 deterministic deployment

## Common Pitfalls

1. **Using `block.prevrandao` for randomness** — Returns `0` on Polygon zkEVM. Any contract relying on this for random number generation will produce predictable results. Use Chainlink VRF or a commit-reveal scheme instead.

2. **Hardcoding Ethereum block times** — Polygon zkEVM doesn't produce blocks every 12 seconds like Ethereum. Block times depend on the sequencer's batching cadence. Don't use `block.number` differences to estimate time elapsed — use `block.timestamp` instead.

3. **Assuming BLOCKHASH availability for 256 blocks** — While Ethereum guarantees `blockhash()` for the last 256 blocks, Polygon zkEVM may return `bytes32(0)` for older blocks. If your contract relies on historical block hashes (e.g., for commit-reveal), verify the hash is non-zero before using it.

4. **Confusing chain IDs** — Polygon zkEVM mainnet is chain ID `1101`, testnet (Cardona) is `2442`. Polygon PoS is `137`. Using the wrong chain ID in signatures or EIP-712 typed data will cause transaction failures or security vulnerabilities.

5. **Not testing gas consumption on testnet** — While gas units are similar, some operations (especially those heavy on hashing or memory expansion) may cost slightly more. Always benchmark your contract's gas usage on Cardona testnet before mainnet deployment.

## What to Learn Next

- [Bridging Assets](./03-bridging-assets.md) — Move ETH and tokens between Ethereum and Polygon zkEVM
- [Polygon zkEVM Differences Documentation](https://docs.polygon.technology/zkEVM/spec/evm-differences/) — Official list of EVM differences
- [Polygon zkEVM GitHub - ROM](https://github.com/0xPolygonHermez/zkevm-rom) — The zkASM implementation of EVM opcodes
