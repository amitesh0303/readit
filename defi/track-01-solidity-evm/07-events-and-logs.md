# Events and Logs: How Frontends Listen to Smart Contracts

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You build a DeFi protocol. Users swap tokens, add liquidity, earn rewards. But your frontend has no idea any of this happened unless the user manually refreshes. You could poll the contract state every few seconds, but that's 50 RPC calls per minute per user — expensive, slow, and still not real-time.

The right solution is events. But most developers treat events as an afterthought — they emit them because the ERC-20 standard requires it, not because they understand how they work. This blog explains the full event system: how logs are stored, how to query them efficiently, how to listen in real-time, and how to design events that make your protocol indexable.

---

## Core Concepts

### What Events Actually Are

When you `emit` an event in Solidity, the EVM writes a log entry to the transaction receipt. Logs are NOT stored in contract storage — they live in a separate, cheaper data structure attached to the block.

A log entry has:
- **Address** — the contract that emitted it
- **Topics** — up to 4 indexed fields (32 bytes each), used for filtering
- **Data** — non-indexed fields, ABI-encoded, not filterable but cheaper

```
Log Entry:
┌─────────────────────────────────────────────────────────┐
│ address: 0xContractAddress                              │
│ topics[0]: keccak256("Transfer(address,address,uint256)")│  ← event signature
│ topics[1]: 0x000...Alice (indexed: from)                │  ← filterable
│ topics[2]: 0x000...Bob   (indexed: to)                  │  ← filterable
│ data: 0x000...1000000000 (non-indexed: value)           │  ← not filterable
└─────────────────────────────────────────────────────────┘
```

`topics[0]` is always the keccak256 hash of the event signature. This is how the EVM identifies which event was emitted.

### Indexed vs Non-Indexed Parameters

`indexed` parameters go into topics — they're filterable but limited to 32 bytes each. Non-indexed parameters go into data — they can be any size but can't be filtered.

```solidity
// Good event design — index what you'll filter by
event Transfer(
    address indexed from,   // filter: "all transfers FROM Alice"
    address indexed to,     // filter: "all transfers TO Bob"
    uint256 value           // not indexed — you rarely filter by exact amount
);

event Swap(
    address indexed pool,       // filter: "all swaps in this pool"
    address indexed trader,     // filter: "all swaps by this trader"
    address tokenIn,            // not indexed — part of the data payload
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    uint256 indexed fee         // indexed — filter by fee tier
);
```

**The 3-indexed-parameter limit** (plus topics[0] for the signature) means you have 3 filterable fields per event. Choose them wisely — index the fields you'll actually filter by.

### Anonymous Events

Events can be declared `anonymous` — this omits topics[0] (the event signature hash). This saves gas but makes the event harder to identify. Rarely used in practice.

### Gas Costs

Events are much cheaper than storage:
- `SSTORE` (new storage slot): 20,000 gas
- `LOG1` (1 topic, 32 bytes data): ~375 gas + 8 gas/byte
- `LOG3` (3 topics, 32 bytes data): ~1,125 gas + 8 gas/byte

For data that only needs to be read off-chain (by frontends, indexers), events are the right choice. Never store data in contract storage just so frontends can read it — emit an event instead.

---

## Code Walkthrough

Here's a complete example showing event design, emission, and consumption:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EventDemo
 * @notice Demonstrates production-grade event design patterns.
 */
contract LiquidityPool {
    // ─── Well-Designed Events ──────────────────────────────────────────────

    /**
     * @notice Emitted when liquidity is added.
     * @dev Index provider and pool for efficient filtering.
     *      Amount fields are non-indexed (rarely filtered by exact amount).
     */
    event LiquidityAdded(
        address indexed provider,
        address indexed pool,
        uint256 amount0,
        uint256 amount1,
        uint256 lpTokensMinted,
        uint256 timestamp  // include timestamp for off-chain time-series data
    );

    event LiquidityRemoved(
        address indexed provider,
        address indexed pool,
        uint256 amount0,
        uint256 amount1,
        uint256 lpTokensBurned,
        uint256 timestamp
    );

    event Swap(
        address indexed trader,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    /**
     * @notice Emitted when protocol parameters change.
     * @dev Include both old and new values — makes it easy to track changes.
     */
    event FeeUpdated(uint256 oldFee, uint256 newFee, address indexed updatedBy);

    // ─── Functions ─────────────────────────────────────────────────────────

    function addLiquidity(address pool, uint256 amount0, uint256 amount1)
        external
        returns (uint256 lpTokens)
    {
        // ... liquidity logic ...
        lpTokens = 1000; // placeholder

        // Emit with all relevant data — frontends and indexers need this
        emit LiquidityAdded(
            msg.sender,
            pool,
            amount0,
            amount1,
            lpTokens,
            block.timestamp  // use block.timestamp for event timestamps
        );
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        // ... swap logic ...
        amountOut = amountIn * 997 / 1000; // 0.3% fee placeholder
        uint256 fee = amountIn - amountOut;

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }
}
```

Now the frontend side — querying past events and listening for new ones:

```typescript
import { ethers } from "ethers";

const POOL_ABI = [
  "event LiquidityAdded(address indexed provider, address indexed pool, uint256 amount0, uint256 amount1, uint256 lpTokensMinted, uint256 timestamp)",
  "event Swap(address indexed trader, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)",
];

const provider = new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/YOUR_KEY");
const wsProvider = new ethers.WebSocketProvider("wss://mainnet.infura.io/ws/v3/YOUR_KEY");

const poolAddress = "0xPoolAddress";
const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
const poolWs = new ethers.Contract(poolAddress, POOL_ABI, wsProvider);

// ── Query Historical Events ─────────────────────────────────────────────────

async function getProviderHistory(providerAddress: string) {
  // Filter: only events where `provider` == providerAddress
  // null means "any value" for that indexed parameter
  const filter = pool.filters.LiquidityAdded(providerAddress, null);

  // Query last 10,000 blocks
  const currentBlock = await provider.getBlockNumber();
  const events = await pool.queryFilter(filter, currentBlock - 10000, currentBlock);

  events.forEach((event) => {
    if (event instanceof ethers.EventLog) {
      console.log({
        provider: event.args.provider,
        pool: event.args.pool,
        amount0: ethers.formatUnits(event.args.amount0, 18),
        amount1: ethers.formatUnits(event.args.amount1, 6),
        lpTokens: ethers.formatUnits(event.args.lpTokensMinted, 18),
        block: event.blockNumber,
        txHash: event.transactionHash,
      });
    }
  });
}

// ── Listen for Real-Time Events ─────────────────────────────────────────────

function listenForSwaps() {
  // Listen to ALL swaps on this pool
  poolWs.on("Swap", (trader, tokenIn, tokenOut, amountIn, amountOut, fee, event) => {
    console.log(`Swap: ${trader} swapped ${ethers.formatUnits(amountIn, 18)} ${tokenIn}`);
    console.log(`  → ${ethers.formatUnits(amountOut, 18)} ${tokenOut}`);
    console.log(`  Fee: ${ethers.formatUnits(fee, 18)}`);
    console.log(`  Tx: ${event.log.transactionHash}`);
  });

  // Handle WebSocket disconnection — reconnect automatically
  wsProvider.on("error", (error) => {
    console.error("WebSocket error:", error);
    // In production: implement reconnection logic
  });
}

// ── Low-Level Log Querying ──────────────────────────────────────────────────
// Sometimes you need to query logs without a contract instance

async function queryRawLogs() {
  // Compute the event topic manually
  const swapTopic = ethers.id("Swap(address,address,address,uint256,uint256,uint256)");

  // Filter for swaps involving USDC as tokenIn
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  // Pad address to 32 bytes for topic matching
  const usdcTopic = ethers.zeroPadValue(usdcAddress, 32);

  const logs = await provider.getLogs({
    address: poolAddress,
    topics: [
      swapTopic,    // topics[0]: event signature
      null,         // topics[1]: trader (any)
      usdcTopic,    // topics[2]: tokenIn == USDC
    ],
    fromBlock: "latest",
    toBlock: "latest",
  });

  // Decode the log data
  const iface = new ethers.Interface(POOL_ABI);
  logs.forEach((log) => {
    const decoded = iface.parseLog(log);
    if (decoded) {
      console.log("Decoded swap:", decoded.args);
    }
  });
}

// ── Pagination for Large Ranges ─────────────────────────────────────────────

async function getAllSwapsEver(fromBlock: number): Promise<ethers.EventLog[]> {
  const toBlock = await provider.getBlockNumber();
  const CHUNK = 2000;
  const allEvents: ethers.EventLog[] = [];

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    const events = await pool.queryFilter(pool.filters.Swap(), start, end);
    allEvents.push(...events.filter((e): e is ethers.EventLog => e instanceof ethers.EventLog));
    console.log(`Processed blocks ${start}-${end}, total: ${allEvents.length}`);
  }

  return allEvents;
}
```

---

## Common Mistakes and Gotchas

**1. Indexing too many parameters (or the wrong ones)**  
You have 3 indexed slots. Don't waste them on fields you'll never filter by. Index the fields that answer "show me all events involving address X" or "show me all events of type Y." Amount fields are rarely worth indexing.

**2. Not including enough data in events**  
Events are your protocol's audit trail. If you emit `Transfer(from, to, amount)` but not the token address, you can't tell which token was transferred from the event alone. Include all context needed to reconstruct what happened without querying additional state.

**3. Relying on events for on-chain logic**  
Events are write-only from the contract's perspective. A contract cannot read its own events. If you need to track something on-chain (like a running total), use storage. Events are for off-chain consumers only.

**4. Not handling event log pagination**  
`getLogs` has a block range limit (usually 2,000 blocks per request on most providers). If you try to query from block 0 to current, you'll get an error. Always paginate. The code above shows the pattern.

**5. Missing events on contract upgrades**  
If you upgrade a proxy contract, the new implementation might emit different events or change event signatures. Indexers that were tracking the old events will miss the new ones. Document event changes in your upgrade notes and update your indexer accordingly.

---

## How This Connects to Production

The Graph Protocol is built entirely on top of event logs — it indexes blockchain events into a queryable GraphQL API. Uniswap's analytics (info.uniswap.org) is powered by a subgraph that indexes Swap, Mint, and Burn events. Etherscan's token transfer history is built from Transfer event logs. Aave's liquidation bots monitor HealthFactorUpdated events to know when positions become liquidatable. Every serious DeFi frontend uses event subscriptions for real-time updates — the "live" price feeds and position updates you see on dYdX, GMX, and Uniswap are all driven by event listeners. Designing your events well from day one means your protocol is indexable, auditable, and frontend-friendly without extra work.

---

## What to Learn Next

- **The Graph Protocol vs Custom Indexers: When to Use Each** — build a production indexer on top of your events.
- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — understand how event data can be used to detect and respond to attacks.
- **MetaMask Integration with ethers.js and wagmi** — put event listeners to work in a real frontend.
