# Optimism vs Ethereum Mainnet: What's Different for Developers

**Track:** Optimism & OP Stack Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You have a working Ethereum mainnet contract and you want to deploy it to Optimism. The marketing says "EVM equivalent" — but equivalent doesn't mean identical. There are differences in gas calculation, block timing, available precompiles, and transaction types that can break your assumptions. You need to know exactly what changes and what stays the same so you don't ship bugs to production.

## Core Concepts

### What's the Same (EVM Equivalence)

Optimism achieved EVM equivalence with the Bedrock upgrade. This means:

- All EVM opcodes work identically (including `PUSH0`, `SELFDESTRUCT` deprecation)
- Solidity, Vyper, and Huff compile without changes
- The same ABI encoding, storage layout, and contract creation semantics
- OpenZeppelin contracts deploy without modification
- Hardhat, Foundry, Remix all work with just an RPC URL change
- ERC-20, ERC-721, ERC-1155 standards are fully supported

### What's Different

#### 1. Gas Pricing — Two-Component Fee Model

The biggest difference. Every transaction on Optimism pays two fees:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GasInfoReader
 * @notice Reads gas pricing information from OP Stack predeploys.
 * @dev The GasPriceOracle at 0x420...00F provides L1 fee estimates.
 */
contract GasInfoReader {
    // GasPriceOracle predeploy — exists on all OP Stack chains
    address constant GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;

    struct GasInfo {
        uint256 l2GasPrice;      // L2 execution gas price (very low)
        uint256 l1BaseFee;       // Current L1 base fee (for data cost)
        uint256 baseFeeScalar;   // Multiplier for L1 base fee component
        uint256 blobBaseFeeScalar; // Multiplier for blob fee component
    }

    function getGasInfo() external view returns (GasInfo memory info) {
        info.l2GasPrice = block.basefee; // L2 base fee (~0.001 gwei)

        // Read L1 fee parameters from the oracle
        (bool success, bytes memory data) = GAS_PRICE_ORACLE.staticcall(
            abi.encodeWithSignature("l1BaseFee()")
        );
        require(success, "Failed to read l1BaseFee");
        info.l1BaseFee = abi.decode(data, (uint256));

        (success, data) = GAS_PRICE_ORACLE.staticcall(
            abi.encodeWithSignature("baseFeeScalar()")
        );
        require(success, "Failed to read baseFeeScalar");
        info.baseFeeScalar = abi.decode(data, (uint32));

        (success, data) = GAS_PRICE_ORACLE.staticcall(
            abi.encodeWithSignature("blobBaseFeeScalar()")
        );
        require(success, "Failed to read blobBaseFeeScalar");
        info.blobBaseFeeScalar = abi.decode(data, (uint32));

        return info;
    }
}
```

#### 2. Block Timing

```typescript
// viem@2.21.0
import { createPublicClient, http } from "viem";
import { optimism } from "viem/chains";

const client = createPublicClient({
  chain: optimism,
  transport: http("https://mainnet.optimism.io"),
});

async function demonstrateBlockTiming() {
  const block = await client.getBlock();

  // OP Mainnet: 2-second block time (vs Ethereum's 12 seconds)
  // This means:
  // - 6x more blocks per minute
  // - block.number increases 6x faster
  // - Any code using block.number as a time proxy needs adjustment
  console.log("Current block:", block.number);
  console.log("Timestamp:", new Date(Number(block.timestamp) * 1000));

  // Example: If you had a 7200-block lock on Ethereum (24 hours),
  // on Optimism that's only 4 hours (7200 * 2s = 14400s = 4h)
  // Correct equivalent: 43200 blocks on OP (43200 * 2s = 86400s = 24h)
  const ETHEREUM_BLOCKS_PER_DAY = 7200;   // 12s blocks
  const OPTIMISM_BLOCKS_PER_DAY = 43200;  // 2s blocks

  console.log("Ethereum blocks/day:", ETHEREUM_BLOCKS_PER_DAY);
  console.log("Optimism blocks/day:", OPTIMISM_BLOCKS_PER_DAY);
}

demonstrateBlockTiming().catch(console.error);
```

#### 3. Predeploy Contracts

OP Stack chains have predeploy contracts at fixed addresses (0x4200...0000 to 0x4200...0017):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OPPredeploys
 * @notice Reference for commonly used OP Stack predeploy addresses.
 */
library OPPredeploys {
    // L2 → L1 message passing
    address constant L2_TO_L1_MESSAGE_PASSER = 0x4200000000000000000000000000000000000016;

    // Cross-domain messenger (send messages L2 → L1)
    address constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;

    // L1 block info (number, timestamp, basefee, hash)
    address constant L1_BLOCK = 0x4200000000000000000000000000000000000015;

    // Gas price oracle (L1 fee estimation)
    address constant GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;

    // L2 standard bridge (deposit/withdraw ERC-20)
    address constant L2_STANDARD_BRIDGE = 0x4200000000000000000000000000000000000010;

    // Wrapped ETH (WETH) on L2
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Sequencer fee vault
    address constant SEQUENCER_FEE_VAULT = 0x4200000000000000000000000000000000000011;
}

interface IL1Block {
    function number() external view returns (uint64);
    function timestamp() external view returns (uint64);
    function basefee() external view returns (uint256);
    function hash() external view returns (bytes32);
    function sequenceNumber() external view returns (uint64);
    function batcherHash() external view returns (bytes32);
}

contract L1BlockReader {
    IL1Block constant l1Block = IL1Block(0x4200000000000000000000000000000000000015);

    function getL1Info() external view returns (
        uint64 l1Number,
        uint64 l1Timestamp,
        uint256 l1Basefee
    ) {
        l1Number = l1Block.number();
        l1Timestamp = l1Block.timestamp();
        l1Basefee = l1Block.basefee();
    }
}
```

#### 4. Transaction Types

Optimism supports standard Ethereum transaction types plus a special deposit type:

| Type | Description | Origin |
|------|-------------|--------|
| 0 (Legacy) | Pre-EIP-1559 | User on L2 |
| 2 (EIP-1559) | Priority fee + max fee | User on L2 |
| 0x7E (Deposit) | L1 → L2 deposit | System (from L1) |

Deposit transactions (type 0x7E) are created by the system when L1 deposits are processed. You cannot submit them directly.

#### 5. Address Aliasing

When an L1 contract sends a message to L2, its address is aliased to prevent collision:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AddressAliasHelper
 * @notice Handles L1 → L2 address aliasing on OP Stack chains.
 * @dev When a contract on L1 sends a message to L2, msg.sender on L2
 *      is the L1 address + 0x1111000000000000000000000000000000001111.
 *      This prevents an L1 contract from impersonating an L2 EOA.
 */
library AddressAliasHelper {
    uint160 constant OFFSET = uint160(0x1111000000000000000000000000000000001111);

    function applyL1ToL2Alias(address l1Address) internal pure returns (address) {
        return address(uint160(l1Address) + OFFSET);
    }

    function undoL1ToL2Alias(address l2Address) internal pure returns (address) {
        return address(uint160(l2Address) - OFFSET);
    }
}

contract L2Receiver {
    address public immutable l1Sender;

    constructor(address _l1Sender) {
        l1Sender = _l1Sender;
    }

    /// @notice Only callable by the aliased L1 sender address
    function onlyFromL1() external view {
        address aliased = AddressAliasHelper.applyL1ToL2Alias(l1Sender);
        require(msg.sender == aliased, "Not from L1 sender");
    }
}
```

## Common Pitfalls

1. **Porting block-number-based timelocks without adjustment** — A 7200-block timelock on Ethereum is ~24 hours. On Optimism with 2-second blocks, that's only ~4 hours. Always use `block.timestamp` for time-based logic, or multiply your block counts by 6.

2. **Not accounting for L1 data fees in gas estimates** — If you call `eth_estimateGas`, you get the L2 execution gas. The L1 data fee is separate and can be 10-100x the L2 execution cost for data-heavy transactions. Use the GasPriceOracle predeploy to estimate total cost.

3. **Expecting L1 contract addresses to work on L2** — Uniswap, Aave, Chainlink, and other protocols have different addresses on Optimism. Always use a chain-aware address registry. The Optimism token list at [https://github.com/ethereum-optimism/ethereum-optimism.github.io](https://github.com/ethereum-optimism/ethereum-optimism.github.io) maps L1 tokens to their L2 equivalents.

4. **Forgetting address aliasing in cross-chain messages** — If your L1 contract sends a message to L2, the `msg.sender` on L2 is the aliased address (L1 address + offset). Your L2 contract must account for this or access control will fail silently.

5. **Assuming the sequencer is always available** — The centralized sequencer can have downtime. After 12 hours of sequencer downtime, users can force-include transactions via L1. Design your protocol to handle this edge case.

## What to Learn Next

- [Bridging Assets on Optimism](./03-bridging-assets.md) — move ETH and tokens between Ethereum and Optimism
- [OP Stack Predeploys Reference](https://docs.optimism.io/builders/chain-operators/features/predeploys) — official documentation for all predeploy contracts
- [Optimism Specs GitHub](https://github.com/ethereum-optimism/specs) — formal specifications for the OP Stack
