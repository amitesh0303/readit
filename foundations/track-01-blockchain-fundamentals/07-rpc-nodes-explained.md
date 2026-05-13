# RPC Nodes Explained: How Your dApp Talks to the Blockchain

**Track:** Beginner  
**Read time:** 10 min

---

## The Problem

You're building a dApp. Your frontend needs to read token balances, listen for events, and submit transactions. But you're not running an Ethereum node on your laptop. So how does your app actually talk to the blockchain?

The answer is RPC nodes — and understanding how they work is the difference between a dApp that's reliable and one that randomly breaks, rate-limits users, or leaks sensitive data. This blog explains what RPC nodes are, how providers like Alchemy and Infura fit in, and how to use them correctly in production.

---

## Core Concepts

### What RPC Means

RPC stands for Remote Procedure Call. It's a protocol for calling functions on a remote server as if they were local. In the blockchain context, JSON-RPC is the standard interface that Ethereum nodes expose.

When your dApp calls `eth_getBalance`, it's making an HTTP POST request to a node's JSON-RPC endpoint with a JSON payload. The node executes the query against its local copy of the blockchain state and returns the result.

```
Your dApp (browser/Node.js)
    │
    │  HTTP POST to https://mainnet.infura.io/v3/YOUR_KEY
    │  Body: {"jsonrpc":"2.0","method":"eth_getBalance","params":["0xAddress","latest"],"id":1}
    │
    ▼
Ethereum Node (running geth/erigon/nethermind)
    │
    │  Queries local blockchain state
    │
    ▼
Response: {"jsonrpc":"2.0","id":1,"result":"0x1BC16D674EC80000"}
    │
    ▼
Your dApp parses result: 2000000000000000000 wei = 2 ETH
```

### Core JSON-RPC Methods You'll Use

These are the methods your dApp calls constantly, even if ethers.js or wagmi abstracts them:

| Method | What it does | ethers.js equivalent |
|--------|-------------|---------------------|
| `eth_getBalance` | Get ETH balance of an address | `provider.getBalance(address)` |
| `eth_call` | Call a contract function (read-only, no gas) | `contract.functionName()` |
| `eth_sendRawTransaction` | Broadcast a signed transaction | `provider.broadcastTransaction(signedTx)` |
| `eth_getTransactionReceipt` | Get receipt for a tx hash | `provider.getTransactionReceipt(hash)` |
| `eth_getLogs` | Query event logs with filters | `contract.queryFilter(filter)` |
| `eth_blockNumber` | Get current block number | `provider.getBlockNumber()` |
| `eth_getCode` | Get bytecode at an address | `provider.getCode(address)` |
| `eth_estimateGas` | Estimate gas for a transaction | `contract.functionName.estimateGas()` |
| `eth_getStorageAt` | Read raw storage slot | `provider.getStorage(address, slot)` |

### Node Types and What They Store

Not all nodes are equal. The type of node determines what queries it can answer:

**Full node** — stores all blocks and current state. Can answer most queries. Can't answer historical state queries (e.g., "what was this address's balance at block 15,000,000?").

**Archive node** — stores all blocks AND all historical state. Can answer any query at any block. Requires ~2TB+ of storage. Expensive to run. Needed for: historical balance queries, backtesting, analytics.

**Light node** — only stores block headers. Relies on full nodes for data. Used in mobile wallets. Can't serve RPC queries.

When you use Alchemy or Infura, you're getting access to their archive nodes — which is why you can query historical state without running your own hardware.

### RPC Providers: Managed vs Self-Hosted

**Managed providers** (Alchemy, Infura, QuickNode, Ankr):
- No infrastructure to manage
- Rate limits (free tiers: 300-500 req/s, paid: higher)
- Reliability SLAs
- Additional APIs (NFT API, Transfers API, Webhooks)
- Your requests go through their servers — privacy consideration
- Single point of failure if provider goes down

**Self-hosted nodes** (geth, erigon, nethermind):
- Full control and privacy
- No rate limits
- High uptime requires DevOps expertise
- Full node: ~1TB SSD, 16GB RAM, decent CPU
- Archive node: ~2TB+ SSD, 32GB+ RAM
- Sync time: days to weeks for archive

For most dApps, start with a managed provider. Run your own node when you hit rate limits, need privacy, or need guaranteed uptime.

### WebSocket vs HTTP

JSON-RPC works over both HTTP and WebSocket. The difference matters:

**HTTP** — request/response. Good for one-off queries. Each request opens a new connection (or reuses a connection pool). Use for: balance checks, transaction submission, one-time reads.

**WebSocket** — persistent bidirectional connection. Good for subscriptions. Use for: listening to new blocks, watching for events in real-time, monitoring pending transactions.

```typescript
import { ethers } from "ethers";

// HTTP provider — for reads and writes
const httpProvider = new ethers.JsonRpcProvider(
  "https://mainnet.infura.io/v3/YOUR_KEY"
);

// WebSocket provider — for subscriptions
const wsProvider = new ethers.WebSocketProvider(
  "wss://mainnet.infura.io/ws/v3/YOUR_KEY"
);

// Subscribe to new blocks via WebSocket
wsProvider.on("block", (blockNumber) => {
  console.log("New block:", blockNumber);
});

// Subscribe to contract events via WebSocket
const contract = new ethers.Contract(contractAddress, abi, wsProvider);
contract.on("Transfer", (from, to, value, event) => {
  console.log(`Transfer: ${from} → ${to}: ${ethers.formatEther(value)} ETH`);
});
```

---

## Code Walkthrough

Here's a production-grade RPC setup with fallback providers, retry logic, and proper error handling:

```typescript
import { ethers } from "ethers";

// Production pattern: use multiple providers with fallback
// If primary fails, automatically falls back to secondary
function createProvider(): ethers.AbstractProvider {
  const providers = [
    new ethers.JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`),
    new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`),
    new ethers.JsonRpcProvider("https://rpc.ankr.com/eth"), // public fallback
  ];

  // FallbackProvider tries providers in order, requires quorum agreement
  return new ethers.FallbackProvider(providers, 1); // quorum of 1 = first success wins
}

const provider = createProvider();

// Robust query with retry logic
async function queryWithRetry<T>(
  queryFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error: unknown) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) throw error;

      // Check if it's a rate limit error (429)
      const errMsg = error instanceof Error ? error.message : String(error);
      const isRateLimit = errMsg.includes("429") || errMsg.includes("rate limit");
      const waitTime = isRateLimit ? delayMs * attempt * 2 : delayMs * attempt;

      console.warn(`Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
  throw new Error("Should not reach here");
}

// Example: batch multiple RPC calls efficiently
// Instead of making 100 separate calls, use multicall
async function batchGetBalances(addresses: string[]): Promise<Map<string, bigint>> {
  // Multicall3 — deployed on mainnet at this address
  // Batches multiple eth_call requests into a single RPC call
  const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const multicallAbi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)",
  ];

  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, multicallAbi, provider);

  // Encode eth_getBalance calls for each address
  const calls = addresses.map((addr) => ({
    target: MULTICALL3_ADDRESS,
    allowFailure: true,
    callData: new ethers.Interface([
      "function getEthBalance(address addr) view returns (uint256)",
    ]).encodeFunctionData("getEthBalance", [addr]),
  }));

  const results = await queryWithRetry(() => multicall.aggregate3(calls));

  const balances = new Map<string, bigint>();
  results.forEach((result: { success: boolean; returnData: string }, i: number) => {
    if (result.success) {
      const balance = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        result.returnData
      )[0] as bigint;
      balances.set(addresses[i], balance);
    }
  });

  return balances;
}

// Event log querying with pagination
// getLogs has a block range limit (usually 2000 blocks per request)
async function getAllLogs(
  contractAddress: string,
  eventTopic: string,
  fromBlock: number,
  toBlock: number
): Promise<ethers.Log[]> {
  const CHUNK_SIZE = 2000; // stay under provider limits
  const allLogs: ethers.Log[] = [];

  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);

    const logs = await queryWithRetry(() =>
      provider.getLogs({
        address: contractAddress,
        topics: [eventTopic],
        fromBlock: start,
        toBlock: end,
      })
    );

    allLogs.push(...logs);
    console.log(`Fetched blocks ${start}-${end}, total logs: ${allLogs.length}`);
  }

  return allLogs;
}
```

---

## Common Mistakes and Gotchas

**1. Hardcoding a single RPC URL with no fallback**  
Infura had a major outage in 2020 that took down MetaMask and most dApps simultaneously. Any production dApp should have at least two RPC providers configured with automatic fallback. ethers.js `FallbackProvider` handles this elegantly.

**2. Using HTTP polling instead of WebSocket subscriptions for real-time data**  
Polling `eth_blockNumber` every second is wasteful and slow. Use WebSocket subscriptions for anything that needs to react to new blocks or events. But also handle WebSocket disconnections — they happen, especially on long-running processes.

**3. Ignoring `getLogs` block range limits**  
Most providers cap `eth_getLogs` at 2,000 blocks per request (some allow 10,000). If you try to query 100,000 blocks in one call, you'll get an error. Always paginate log queries.

**4. Exposing your RPC API key in frontend code**  
Your Alchemy or Infura key in client-side JavaScript is visible to anyone who opens DevTools. They can use your key, exhaust your rate limits, and run up your bill. Use a backend proxy for RPC calls, or use Alchemy's allowlist feature to restrict which domains can use your key.

**5. Not handling `eth_call` reverts properly**  
When a read-only call reverts (e.g., calling a function with invalid params), the RPC returns an error. ethers.js throws an exception. Many developers don't catch this and their UI crashes silently. Always wrap contract reads in try/catch and decode the revert reason for debugging.

---

## How This Connects to Production

Alchemy and Infura serve billions of RPC requests per day — they're the invisible infrastructure layer under most dApps. Uniswap's frontend uses Alchemy. OpenSea uses Infura. But serious protocols also run their own nodes for critical operations: Chainlink runs its own nodes to submit price feed updates, Aave's liquidation bots run against self-hosted archive nodes to avoid rate limits, and Helius (Solana's equivalent of Alchemy) powers most of the Solana ecosystem's RPC needs. As your protocol grows, RPC infrastructure becomes a reliability and cost concern — understanding it from day one means you won't be surprised when you hit limits at scale.

---

## What to Learn Next

- **Alchemy vs Infura vs Self-Hosted Nodes: Which RPC Provider Should You Use?** — go deeper on provider selection and when to run your own node.
- **The Graph Protocol vs Custom Indexers: When to Use Each** — learn how to query historical blockchain data efficiently beyond basic RPC calls.
- **Tenderly: Debugging and Simulating Transactions Like a Pro** — use RPC simulation to debug transactions before they hit mainnet.
