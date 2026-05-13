# Differences from Ethereum Mainnet on Immutable zkEVM

**Track:** Immutable zkEVM Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You have Solidity contracts that work on Ethereum mainnet and you want to deploy them on Immutable zkEVM. The chain claims "EVM equivalence," but you've been burned before by L2s that break subtle assumptions — different gas costs, missing opcodes, or unexpected behavior in precompiles. You need to know exactly what's different so you can audit your contracts before deployment. For gaming contracts specifically, you need to understand how the IMX gas token, Immutable's royalty enforcement, and the allowlist system affect your contract design.

## Core Concepts

### EVM Equivalence (Type 2 zkEVM)

Immutable zkEVM is a Type 2 zkEVM (same classification as Polygon zkEVM). This means bytecode-level compatibility — contracts compiled for Ethereum work without recompilation. The differences are at the edges:

| Feature | Ethereum Mainnet | Immutable zkEVM |
|---------|-----------------|-----------------|
| Gas token | ETH | IMX |
| Block time | ~12 seconds | ~2 seconds |
| Block gas limit | 30M | 30M (configurable) |
| `DIFFICULTY` opcode | Returns difficulty/prevrandao | Returns 0 |
| `BLOCKHASH` | Last 256 blocks | Last 256 blocks |
| Precompiles | All standard | All standard supported |
| `tx.gasprice` | Market-driven | Sequencer-set minimum |
| Finality | ~12 min (32 slots) | Minutes (after ZK proof) |

### The IMX Gas Token

The most impactful difference: gas is paid in IMX, not ETH. This affects contract patterns that assume ETH as the native currency:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NativePayment
/// @notice Demonstrates handling IMX (native token) payments on Immutable zkEVM
/// @dev msg.value on Immutable zkEVM is denominated in IMX, not ETH
contract NativePayment {
    address public owner;
    uint256 public priceInIMX;

    error InsufficientPayment(uint256 sent, uint256 required);
    error TransferFailed();
    error Unauthorized();

    constructor(uint256 _priceInIMX) {
        owner = msg.sender;
        priceInIMX = _priceInIMX;
    }

    /// @notice Purchase an item — msg.value is in IMX on Immutable zkEVM
    /// @dev Players send IMX (native token), not ETH
    function purchase() external payable {
        if (msg.value < priceInIMX) {
            revert InsufficientPayment(msg.value, priceInIMX);
        }

        // Refund excess
        uint256 excess = msg.value - priceInIMX;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}("");
            if (!refunded) revert TransferFailed();
        }

        // Process purchase logic...
    }

    /// @notice Withdraw collected IMX to owner
    function withdraw() external {
        if (msg.sender != owner) revert Unauthorized();
        (bool sent, ) = owner.call{value: address(this).balance}("");
        if (!sent) revert TransferFailed();
    }

    receive() external payable {}
}
```

### Gas Pricing Model

Immutable zkEVM uses a different gas pricing model than Ethereum mainnet:

```typescript
// Gas price comparison — Immutable zkEVM vs Ethereum
import { ethers } from "ethers"; // ethers@6.9.0

const immutableProvider = new ethers.JsonRpcProvider(
  "https://rpc.testnet.immutable.com"
);

async function getGasInfo(): Promise<void> {
  const feeData = await immutableProvider.getFeeData();

  console.log("Immutable zkEVM Gas Info:");
  console.log(`  Gas price: ${ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei")} gwei`);
  console.log(`  Max fee per gas: ${ethers.formatUnits(feeData.maxFeePerGas ?? 0n, "gwei")} gwei`);
  console.log(`  Max priority fee: ${ethers.formatUnits(feeData.maxPriorityFeePerGas ?? 0n, "gwei")} gwei`);

  // Gas prices on Immutable zkEVM are significantly lower than mainnet
  // Typical: 10-100 gwei vs Ethereum's 20-100+ gwei
  // But remember: gas is priced in IMX, not ETH
  // Actual USD cost depends on IMX price

  // Estimate a simple transfer cost
  const gasEstimate = 21_000n; // Standard transfer
  const gasPrice = feeData.gasPrice ?? 0n;
  const costInIMX = gasEstimate * gasPrice;
  console.log(`\nETH transfer cost: ${ethers.formatEther(costInIMX)} IMX`);
}

await getGasInfo();
```

### Immutable Allowlist (Operator Allowlist)

Immutable enforces an operator allowlist on NFT contracts to prevent marketplace royalty circumvention. This is a key difference from mainnet where any contract can transfer any NFT:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts@5.0.1/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

// Immutable's OperatorAllowlist interface
// Source: https://github.com/immutable/contracts
interface IOperatorAllowlist {
    function isAllowlisted(address target) external view returns (bool);
}

/// @title GameNFT
/// @notice ERC-721 with Immutable's operator allowlist for royalty enforcement
/// @dev On Immutable zkEVM, transfers are restricted to allowlisted operators
contract GameNFT is ERC721, Ownable {
    IOperatorAllowlist public operatorAllowlist;
    uint256 private _nextTokenId;

    error OperatorNotAllowlisted(address operator);
    error ZeroAddress();

    constructor(
        address _operatorAllowlist
    ) ERC721("Game Asset", "GASSET") Ownable(msg.sender) {
        if (_operatorAllowlist == address(0)) revert ZeroAddress();
        operatorAllowlist = IOperatorAllowlist(_operatorAllowlist);
    }

    /// @notice Override _update to enforce operator allowlist
    /// @dev This prevents transfers through non-allowlisted contracts
    ///      ensuring marketplace royalties are always paid
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Allow minting (from == address(0)) and burning (to == address(0))
        if (from != address(0) && to != address(0)) {
            // For transfers, check if the caller is allowlisted
            if (msg.sender != from && !operatorAllowlist.isAllowlisted(msg.sender)) {
                revert OperatorNotAllowlisted(msg.sender);
            }
        }

        return super._update(to, tokenId, auth);
    }

    /// @notice Mint a new game asset
    function mint(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }
}
```

### Block Semantics Differences

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BlockInfo
/// @notice Demonstrates block-level differences on Immutable zkEVM
contract BlockInfo {
    /// @notice Get block information — note differences from mainnet
    function getBlockInfo() external view returns (
        uint256 blockNumber,
        uint256 timestamp,
        uint256 difficulty,
        uint256 chainId,
        address coinbase
    ) {
        return (
            block.number,       // Increments every ~2 seconds
            block.timestamp,    // Unix timestamp, ~2s granularity
            block.prevrandao,   // Returns 0 on zkEVM — DO NOT use for randomness
            block.chainid,      // 13371 (mainnet) or 13473 (testnet)
            block.coinbase      // Sequencer address
        );
    }

    /// @notice UNSAFE: Do not use block.prevrandao for randomness on zkEVM
    /// @dev On Ethereum mainnet, prevrandao provides weak randomness from beacon chain
    ///      On Immutable zkEVM, it returns 0 — use Chainlink VRF or commit-reveal instead
    function unsafeRandom() external view returns (uint256) {
        // This ALWAYS returns 0 on Immutable zkEVM!
        return block.prevrandao;
    }
}
```

### Transaction Type Support

Immutable zkEVM supports EIP-1559 (Type 2) transactions:

```typescript
// Sending transactions on Immutable zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const provider = new ethers.JsonRpcProvider("https://rpc.testnet.immutable.com");
const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

async function sendTransaction(): Promise<void> {
  const feeData = await provider.getFeeData();

  // EIP-1559 transaction (recommended)
  const tx = await wallet.sendTransaction({
    to: "0xRecipientAddress",
    value: ethers.parseEther("1.0"), // 1 IMX (not ETH!)
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    type: 2, // EIP-1559
  });

  console.log(`TX hash: ${tx.hash}`);
  console.log(`Explorer: https://explorer.testnet.immutable.com/tx/${tx.hash}`);

  const receipt = await tx.wait();
  if (receipt) {
    console.log(`Confirmed in block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  }
}

await sendTransaction();
```

## Common Pitfalls

1. **Using `block.prevrandao` for randomness** — Returns 0 on Immutable zkEVM. Games that need on-chain randomness (loot drops, card draws) must use Chainlink VRF or a commit-reveal scheme. This is the most common bug when porting mainnet game contracts.

2. **Hardcoding ETH assumptions in payment logic** — The native token is IMX. If your contract has comments like "price in ETH" or uses ETH-denominated constants, update them. `msg.value` sends IMX, not ETH. Wrapped ETH (WETH) is available as an ERC-20 if you need ETH-denominated pricing.

3. **Ignoring the operator allowlist for NFTs** — If you deploy an ERC-721 without integrating the operator allowlist, your NFTs won't be tradeable on Immutable's marketplace. The allowlist ensures royalties are enforced — it's not optional for gaming NFTs that need marketplace liquidity.

4. **Assuming instant L1 finality** — While ZK proofs are faster than optimistic rollup challenge windows, proof generation still takes minutes. For high-value operations (bridging large amounts), wait for L1 proof confirmation rather than relying on sequencer soft-confirmations alone.

## What to Learn Next

- [Bridging Assets](./03-bridging-assets.md) — Move IMX, ETH, and NFTs between Ethereum and Immutable zkEVM
- [Immutable Contracts GitHub](https://github.com/immutable/contracts) — Reference implementations for allowlist-compatible NFTs
- [Polygon zkEVM Differences](https://docs.polygon.technology/zkEVM/spec/evm-differences/) — Underlying zkEVM specification differences
