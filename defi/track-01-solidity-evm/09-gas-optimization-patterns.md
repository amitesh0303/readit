# Gas Optimization Patterns Every Solidity Dev Should Know

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You deploy a DEX. Your swap function costs 180,000 gas. Uniswap V3's swap costs 120,000 gas. At 30 gwei and $3,000 ETH, that's $16.20 vs $10.80 per swap. Multiply by 10 million swaps per month and you've cost your users $54 million extra in gas fees.

Gas optimization isn't premature optimization — it's a product requirement for any protocol that expects real usage. But it's also a minefield: bad optimizations introduce bugs, and some "optimizations" actually cost more gas than the naive approach. This blog covers the patterns that actually work, with benchmarks.

---

## Core Concepts

### How the EVM Charges Gas

Every EVM opcode has a fixed gas cost. The expensive ones:

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| `SSTORE` (new slot) | 20,000 | Writing a new storage slot |
| `SSTORE` (update) | 5,000 | Updating existing non-zero slot |
| `SSTORE` (zero → zero) | 100 | No-op, but still costs |
| `SLOAD` | 2,100 (cold) / 100 (warm) | Reading storage |
| `CALL` | 700 + gas forwarded | External call overhead |
| `CREATE` | 32,000 | Deploying a contract |
| `LOG3` | 1,125 + data | Emitting a 3-topic event |
| `ADD`, `MUL` | 3-5 | Arithmetic |
| `KECCAK256` | 30 + 6/word | Hashing |

The key insight: storage operations dominate gas costs. Minimize `SLOAD` and `SSTORE`.

### Pattern 1: Cache Storage Variables in Memory

Every `SLOAD` costs 2,100 gas (cold) or 100 gas (warm). Reading the same storage variable multiple times in a function is wasteful.

```solidity
// BAD — 3 SLOADs
function badLoop() external view returns (uint256 total) {
    for (uint256 i = 0; i < items.length; i++) { // items.length = SLOAD each iteration
        total += items[i].value;                   // items[i] = SLOAD each iteration
    }
}

// GOOD — 1 SLOAD for length, cached
function goodLoop() external view returns (uint256 total) {
    uint256 len = items.length; // 1 SLOAD, cached in memory (free reads after)
    Item[] memory cachedItems = items; // copy array to memory (1 SLOAD per element, once)
    for (uint256 i = 0; i < len; ) {
        total += cachedItems[i].value; // MLOAD — ~3 gas
        unchecked { i++; }
    }
}
```

### Pattern 2: Pack Storage Variables

The EVM reads storage in 32-byte slots. If you pack multiple small variables into one slot, you pay for one `SLOAD` instead of multiple.

```solidity
// BAD — 3 storage slots (3 SLOADs to read all three)
contract Unpacked {
    uint256 public a; // slot 0
    uint256 public b; // slot 1
    uint256 public c; // slot 2
}

// GOOD — 1 storage slot (1 SLOAD to read all three)
contract Packed {
    uint128 public a; // slot 0, bytes 0-15
    uint64 public b;  // slot 0, bytes 16-23
    uint64 public c;  // slot 0, bytes 24-31
}
```

But packing has a cost: reading a packed variable requires masking and shifting. If you read `a` and `b` together frequently, packing saves gas. If you always read them separately, packing might cost more. Profile before packing.

### Pattern 3: Use `calldata` Instead of `memory` for External Parameters

Already covered in the data types blog, but worth repeating: `calldata` avoids copying the input data into memory.

```solidity
// BAD — copies array to memory
function process(uint256[] memory data) external pure returns (uint256) { ... }

// GOOD — reads directly from calldata
function process(uint256[] calldata data) external pure returns (uint256) { ... }
```

For a 100-element array, this saves ~2,000 gas.

### Pattern 4: Use `unchecked` for Safe Arithmetic

Solidity 0.8+ adds overflow checks to every arithmetic operation. These checks cost gas. When you know overflow is impossible, use `unchecked`:

```solidity
// Loop counter — can't overflow if i < length
for (uint256 i = 0; i < length; ) {
    // ... body ...
    unchecked { i++; } // saves ~30 gas per iteration
}

// Subtraction after a >= check
function safeSubtract(uint256 a, uint256 b) internal pure returns (uint256) {
    require(a >= b, "Underflow");
    unchecked { return a - b; } // safe: checked above
}
```

### Pattern 5: Short-Circuit Conditions

Put cheap checks before expensive ones. If the cheap check fails, you avoid the expensive one.

```solidity
// BAD — expensive SLOAD before cheap comparison
function badCheck(address user) external view returns (bool) {
    return balances[user] > 0 && user != address(0); // SLOAD first, then comparison
}

// GOOD — cheap comparison first
function goodCheck(address user) external view returns (bool) {
    return user != address(0) && balances[user] > 0; // comparison first, SLOAD only if needed
}
```

### Pattern 6: Use Events Instead of Storage for Historical Data

If data only needs to be read off-chain, emit an event instead of storing it.

```solidity
// BAD — stores history in storage (expensive)
uint256[] public priceHistory;
function updatePrice(uint256 price) external {
    priceHistory.push(price); // SSTORE for each price
}

// GOOD — emit event (cheap), index off-chain
event PriceUpdated(uint256 indexed price, uint256 timestamp);
function updatePrice(uint256 price) external {
    currentPrice = price; // one SSTORE
    emit PriceUpdated(price, block.timestamp); // ~1,000 gas vs ~20,000
}
```

### Pattern 7: Bitmap for Boolean Arrays

Storing 256 booleans as `bool[256]` uses 256 storage slots. Storing them as a `uint256` bitmap uses 1 slot.

```solidity
// BAD — 256 storage slots for 256 booleans
mapping(uint256 => bool) public claimed;

// GOOD — 1 storage slot per 256 booleans
uint256 private _claimedBitmap;

function isClaimed(uint256 index) public view returns (bool) {
    return (_claimedBitmap >> index) & 1 == 1;
}

function setClaimed(uint256 index) internal {
    _claimedBitmap |= (1 << index);
}
```

This is how Uniswap V3 tracks which tick spacings have been initialized.

---

## Code Walkthrough

A gas-optimized airdrop contract demonstrating multiple patterns:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OptimizedAirdrop
 * @notice Gas-optimized Merkle tree airdrop.
 * Demonstrates: bitmap, calldata, unchecked, storage caching, immutable.
 */
contract OptimizedAirdrop {
    // immutable: set in constructor, stored in bytecode (not storage)
    // Reading costs ~3 gas vs ~2100 gas for storage
    address public immutable token;
    bytes32 public immutable merkleRoot;

    // Bitmap: 1 slot per 256 claims instead of 1 slot per claim
    // For 10,000 claimants: 40 slots vs 10,000 slots
    mapping(uint256 => uint256) private _claimedBitmap;

    event Claimed(address indexed account, uint256 amount);

    constructor(address _token, bytes32 _merkleRoot) {
        token = _token;
        merkleRoot = _merkleRoot;
    }

    /**
     * @notice Claim tokens with Merkle proof.
     * @param index Claimant's index in the Merkle tree
     * @param account Claimant's address
     * @param amount Token amount to claim
     * @param proof Merkle proof — calldata (not memory) saves gas
     */
    function claim(
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof  // calldata: no copy, reads directly from tx input
    ) external {
        // Check bitmap — 1 SLOAD for 256 claims
        require(!isClaimed(index), "Already claimed");

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(index, account, amount));
        require(_verifyProof(proof, merkleRoot, leaf), "Invalid proof");

        // Mark as claimed BEFORE transfer (CEI pattern)
        _setClaimed(index);

        emit Claimed(account, amount);

        // Transfer tokens
        (bool success, ) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", account, amount)
        );
        require(success, "Transfer failed");
    }

    function isClaimed(uint256 index) public view returns (bool) {
        // index / 256 = which uint256 in the bitmap
        // index % 256 = which bit within that uint256
        uint256 wordIndex = index >> 8;   // equivalent to index / 256
        uint256 bitIndex = index & 0xff;  // equivalent to index % 256
        uint256 word = _claimedBitmap[wordIndex]; // 1 SLOAD
        return (word >> bitIndex) & 1 == 1;
    }

    function _setClaimed(uint256 index) private {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 0xff;
        _claimedBitmap[wordIndex] |= (1 << bitIndex); // 1 SSTORE
    }

    /**
     * @dev Verify Merkle proof — optimized with calldata and unchecked counter.
     */
    function _verifyProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) private pure returns (bool) {
        bytes32 computedHash = leaf;
        uint256 len = proof.length; // cache length

        for (uint256 i = 0; i < len; ) {
            bytes32 proofElement = proof[i]; // reads from calldata — cheap
            // Sort pair to ensure consistent hashing regardless of order
            computedHash = computedHash <= proofElement
                ? keccak256(abi.encodePacked(computedHash, proofElement))
                : keccak256(abi.encodePacked(proofElement, computedHash));
            unchecked { i++; } // safe: i < len
        }

        return computedHash == root;
    }
}
```

Gas comparison for a 10,000-person airdrop:
- Naive approach (bool mapping): ~25,000 gas per claim
- Optimized (bitmap + calldata + unchecked): ~18,000 gas per claim
- Savings: ~7,000 gas × 10,000 claims = 70,000,000 gas saved

---

## Common Mistakes and Gotchas

**1. Optimizing before profiling**  
Don't guess where gas is being spent. Use Hardhat's gas reporter or Foundry's `forge test --gas-report` to measure actual gas costs before and after optimization. Many "optimizations" have negligible impact or even increase gas.

**2. Packing variables that are always accessed separately**  
Packing `uint128 a` and `uint128 b` into one slot saves gas when you read both together. But if you always read them separately, packing adds masking/shifting overhead. The EVM reads the full 32-byte slot regardless — packing only helps when you use multiple packed variables in the same transaction.

**3. Using `string` for short fixed data**  
`string` is a dynamic type with overhead. For short strings (≤32 bytes), use `bytes32` instead. `bytes32 public constant NAME = "MyToken"` is much cheaper than `string public name = "MyToken"`.

**4. Forgetting that `delete` refunds gas**  
Setting a storage slot to zero refunds 4,800 gas (EIP-3529 reduced this from 15,000). If you're done with a storage variable, `delete` it to get the refund. This is why some protocols "clean up" storage after use.

**5. Over-optimizing at the cost of readability and security**  
Gas optimization that makes code harder to audit is a bad tradeoff. A 5% gas saving that introduces a subtle bug is not worth it. Optimize the hot paths (functions called millions of times), leave the cold paths readable.

---

## How This Connects to Production

Uniswap V3 is one of the most gas-optimized contracts ever written. Their tick bitmap (for tracking initialized price ranges) uses the exact bitmap pattern shown above. Their assembly-heavy swap path avoids Solidity overhead for the most critical code path. Seaport (OpenSea's marketplace contract) was rewritten from scratch specifically for gas efficiency — it uses assembly for critical paths and saves users millions in gas fees. 1inch's aggregator uses complex routing logic that's heavily optimized because every extra gas unit directly reduces the value delivered to users. Gas optimization at the protocol level is a competitive advantage — cheaper protocols attract more users, which generates more fees, which funds more development.

---

## What to Learn Next

- **Hardhat vs Foundry: Which Testing Framework Should You Use?** — learn how to benchmark gas costs with both frameworks.
- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — understand the security tradeoffs of optimization.
- **EVM vs Non-EVM Chains: What's the Difference and Why It Matters** — see how other chains handle computation costs differently.
