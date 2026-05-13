# Solidity Data Types, Storage vs Memory vs Calldata — Deep Dive

**Track:** Beginner → Intermediate  
**Read time:** 13 min

---

## The Problem

You write a Solidity function, pass in an array, and get a compiler error: "Data location must be 'memory' or 'calldata' for parameter in function." You add `memory`, it compiles. But you don't know why, and you don't know if you made the right choice.

Or you're optimizing a contract and realize that a function that should be cheap is burning 50,000 gas — because you're copying a large array into memory when you could have used calldata. The Solidity data location system is one of the most important things to understand for writing correct, gas-efficient contracts. This blog explains it completely.

---

## Core Concepts

### The Three Data Locations

Solidity has three places where data can live:

**Storage** — permanent, on-chain. Persists between function calls. Expensive to read (~200 gas) and very expensive to write (~20,000 gas for a new slot, ~5,000 to update). This is the contract's "hard drive."

**Memory** — temporary, in-memory. Exists only during a function call. Cheap to read/write. Automatically freed when the function returns. This is the contract's "RAM."

**Calldata** — read-only, temporary. Contains the raw bytes of the transaction's input data. Cheapest of all — no copying. Only available for external function parameters.

```
┌─────────────────────────────────────────────────────────────┐
│                    EVM Execution Context                     │
│                                                             │
│  STORAGE (persistent)          MEMORY (temporary)           │
│  ┌──────────────────┐          ┌──────────────────┐         │
│  │ slot 0: 0x...    │          │ 0x00: ...        │         │
│  │ slot 1: 0x...    │          │ 0x20: ...        │         │
│  │ slot 2: 0x...    │          │ 0x40: free ptr   │         │
│  │ ...              │          │ ...              │         │
│  └──────────────────┘          └──────────────────┘         │
│                                                             │
│  CALLDATA (read-only input)                                 │
│  ┌──────────────────────────────────────────────────┐       │
│  │ function selector (4 bytes) + encoded arguments  │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### When to Use Each Location

**Use `storage`** for:
- State variables (they're always in storage)
- Storage pointers inside functions (reference to existing storage data)

**Use `memory`** for:
- Function parameters that need to be modified
- Local variables of reference types (arrays, structs, strings)
- Return values of reference types
- When you need to build a new array/struct inside a function

**Use `calldata`** for:
- External function parameters that you only read (never modify)
- The cheapest way to pass arrays and strings into functions

### Value Types vs Reference Types

This distinction determines whether you need a data location specifier:

**Value types** — copied on assignment. No location needed for local variables.
- `uint`, `int`, `bool`, `address`, `bytes1`-`bytes32`, `enum`

**Reference types** — point to data. Always need a location specifier.
- `array` (fixed and dynamic)
- `struct`
- `mapping` (always storage)
- `string`, `bytes`

```solidity
contract LocationDemo {
    // State variables are implicitly in storage
    uint256 public counter;           // value type in storage
    uint256[] public numbers;         // reference type in storage
    mapping(address => uint256) public balances; // always storage

    function valueTypeCopy() external {
        uint256 a = counter;  // copies the VALUE — a and counter are independent
        a = 999;              // doesn't affect counter
    }

    function storagePointer() external {
        // This creates a POINTER to storage — not a copy
        uint256[] storage ref = numbers;
        ref.push(42); // modifies the actual storage array
    }

    function memoryArray() external pure returns (uint256[] memory) {
        // Creates a new array in memory — temporary
        uint256[] memory arr = new uint256[](3);
        arr[0] = 1;
        arr[1] = 2;
        arr[2] = 3;
        return arr; // returned to caller, then freed
    }

    // calldata: cheapest for read-only array params
    function sumArray(uint256[] calldata arr) external pure returns (uint256 total) {
        for (uint256 i = 0; i < arr.length; i++) {
            total += arr[i]; // reads directly from calldata — no copy
        }
    }

    // memory: needed if you modify the array
    function doubleArray(uint256[] memory arr) external pure returns (uint256[] memory) {
        for (uint256 i = 0; i < arr.length; i++) {
            arr[i] *= 2; // modifying — needs memory, not calldata
        }
        return arr;
    }
}
```

### Storage Layout: How Slots Work

Storage is a key-value store with 2^256 slots, each 32 bytes. The EVM packs variables into slots to save space:

```solidity
contract StorageLayout {
    // Slot 0: uint256 takes a full 32-byte slot
    uint256 public a; // slot 0

    // Slot 1: uint128 takes 16 bytes — two fit in one slot
    uint128 public b; // slot 1, bytes 0-15
    uint128 public c; // slot 1, bytes 16-31 (packed!)

    // Slot 2: bool takes 1 byte, address takes 20 bytes — both fit
    bool public d;      // slot 2, byte 0
    address public e;   // slot 2, bytes 1-20 (packed!)
    // 11 bytes wasted in slot 2

    // Slot 3: uint256 — won't fit in slot 2's remaining 11 bytes
    uint256 public f; // slot 3

    // Dynamic arrays: slot stores the length, data at keccak256(slot)
    uint256[] public arr; // slot 4 stores length; data at keccak256(4), keccak256(4)+1, etc.

    // Mappings: slot is empty; value at keccak256(key . slot)
    mapping(address => uint256) public map; // slot 5 is empty
    // map[addr] is at keccak256(abi.encode(addr, 5))
}
```

Understanding storage layout matters for:
- Gas optimization (pack small variables together)
- Proxy patterns (storage layout must match between proxy and implementation)
- Direct storage reads via `eth_getStorageAt`

### The `immutable` and `constant` Keywords

Two special variable types that avoid storage costs entirely:

```solidity
contract ImmutableDemo {
    // constant: value known at compile time, inlined into bytecode
    // Zero storage cost — reads are essentially free
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // immutable: value set in constructor, then inlined into bytecode
    // More flexible than constant — can use constructor arguments
    address public immutable owner;
    uint256 public immutable deployedAt;

    constructor() {
        owner = msg.sender;        // set once in constructor
        deployedAt = block.number; // set once in constructor
        // After construction, these are baked into the bytecode
        // Reading them costs ~3 gas (PUSH opcode) vs ~200 gas (SLOAD)
    }
}
```

Use `constant` for values known at compile time. Use `immutable` for values set in the constructor that never change. Both are dramatically cheaper than regular storage variables.

---

## Code Walkthrough

Here's a gas-optimized struct and array pattern showing the difference between storage, memory, and calldata in a realistic context:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OrderBook {
    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint128 amountIn;   // uint128 instead of uint256 — packs with amountOut
        uint128 amountOut;  // these two pack into one 32-byte slot
        uint64 deadline;    // uint64 for timestamp — packs with filled
        bool filled;        // 1 byte — packs with deadline
        // Total struct: 3 slots (address=20b, address=20b, address=20b, uint128+uint128=32b, uint64+bool=9b padded to 32b)
    }

    Order[] public orders;
    mapping(address => uint256[]) public makerOrders; // maker → order indices

    event OrderCreated(uint256 indexed orderId, address indexed maker);
    event OrderFilled(uint256 indexed orderId, address indexed taker);

    /**
     * @notice Create a new order.
     * @dev Parameters use calldata — we only read them, never modify.
     *      Cheaper than memory for external functions.
     */
    function createOrder(
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint128 amountOut,
        uint64 deadline
    ) external returns (uint256 orderId) {
        orderId = orders.length;

        // Push a new Order struct to storage
        // We build it in memory first, then push — one SSTORE per slot
        orders.push(Order({
            maker: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOut: amountOut,
            deadline: deadline,
            filled: false
        }));

        makerOrders[msg.sender].push(orderId);
        emit OrderCreated(orderId, msg.sender);
    }

    /**
     * @notice Fill an order.
     * @dev Uses a storage pointer to avoid copying the entire struct.
     *      `storage` pointer: reads/writes go directly to storage slots.
     *      `memory` copy: would copy all fields, then write back — more gas.
     */
    function fillOrder(uint256 orderId) external {
        // Storage pointer — NOT a copy. Reads/writes hit storage directly.
        Order storage order = orders[orderId];

        require(!order.filled, "Already filled");
        require(block.timestamp <= order.deadline, "Expired");
        require(order.maker != msg.sender, "Can't fill own order");

        // Single SSTORE — marks as filled
        order.filled = true;

        emit OrderFilled(orderId, msg.sender);
        // ... token transfer logic
    }

    /**
     * @notice Get all orders for a maker — returns memory array.
     * @dev Returns memory because we're building a new array to return.
     *      Can't return storage references to external callers.
     */
    function getMakerOrders(address maker) external view returns (Order[] memory) {
        uint256[] storage indices = makerOrders[maker]; // storage pointer
        Order[] memory result = new Order[](indices.length); // new memory array

        for (uint256 i = 0; i < indices.length; i++) {
            result[i] = orders[indices[i]]; // copies from storage to memory
        }

        return result;
    }

    /**
     * @notice Batch check if orders are valid — calldata for the array.
     * @dev calldata array: no copy, reads directly from transaction input.
     *      If we used memory here, the EVM would copy the entire array.
     */
    function batchCheckValid(uint256[] calldata orderIds)
        external
        view
        returns (bool[] memory valid)
    {
        valid = new bool[](orderIds.length);
        for (uint256 i = 0; i < orderIds.length; i++) {
            Order storage order = orders[orderIds[i]]; // storage pointer
            valid[i] = !order.filled && block.timestamp <= order.deadline;
        }
    }
}
```

---

## Common Mistakes and Gotchas

**1. Using `memory` instead of `calldata` for external function parameters**  
This is the most common gas waste. If you have `function process(uint256[] memory data) external`, change it to `calldata`. The `memory` version copies the entire array from calldata into memory. The `calldata` version reads directly. For a 100-element array, this can save thousands of gas.

**2. Accidentally copying storage to memory when you want a pointer**  
```solidity
// WRONG — copies the entire struct to memory
Order memory order = orders[id];
order.filled = true; // modifies the memory copy, NOT storage!

// RIGHT — storage pointer, writes go to storage
Order storage order = orders[id];
order.filled = true; // modifies storage directly
```
This is a silent bug — the code compiles and runs, but the state change doesn't persist.

**3. Storing large strings or bytes in storage**  
Strings and dynamic bytes arrays in storage are expensive. A 100-character string costs ~6 storage slots. If you need to store large data, consider storing a hash on-chain and the actual data off-chain (IPFS, Arweave).

**4. Not packing struct fields**  
The EVM reads storage in 32-byte slots. If your struct has `uint256, uint128, uint256`, that's 3 slots. If you reorder to `uint256, uint256, uint128`, that's still 3 slots. But `uint128, uint128, uint256` is 2 slots — the two uint128s pack together. Order your struct fields from largest to smallest, or group small types together.

**5. Reading the same storage variable multiple times in a loop**  
Each `SLOAD` costs ~200 gas. If you read `orders.length` in every loop iteration, you're paying 200 gas per iteration. Cache it in a local variable first:
```solidity
uint256 len = orders.length; // one SLOAD
for (uint256 i = 0; i < len; i++) { ... } // free reads after
```

---

## How This Connects to Production

Storage layout is a critical concern in upgradeable contracts. Uniswap V3's pool contracts are carefully laid out so that the most frequently accessed variables (sqrtPriceX96, tick, liquidity) are in the same storage slot — reducing the number of SLOADs per swap. OpenZeppelin's upgradeable contracts use "storage gaps" (`uint256[50] private __gap`) to reserve storage slots for future variables, preventing storage collisions on upgrade. Aave V3 uses packed structs extensively to minimize storage costs for position data. When you're writing a protocol that will process millions of transactions, every SLOAD you eliminate is real money saved for your users.

---

## What to Learn Next

- **Gas Optimization Patterns Every Solidity Dev Should Know** — build on this foundation with advanced optimization techniques.
- **ERC-20 Standard: Building a Token from Scratch** — apply storage knowledge to a production token implementation.
- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — understand how storage patterns relate to security vulnerabilities.
