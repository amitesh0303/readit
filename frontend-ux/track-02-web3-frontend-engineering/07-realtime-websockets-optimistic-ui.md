# Real-Time Data: WebSocket Subscriptions and Optimistic UI

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

Polling RPC every 5 seconds works. It's also wasteful, slow, and feels laggy. A user opens your DEX, makes a swap, sees their balance update… 5 seconds later, after a polling round trip. Their internal monologue: "did it work? did I lose money?" The bar for fluid UX in dApps in 2026 is the same as for any consumer app — instant feedback, real-time state, optimistic updates.

There are two problems folded into this. **Real-time fetching** — getting state changes pushed to the browser as they happen. **Optimistic UI** — showing the new state *before* it's confirmed on-chain, so the user perceives instant response. Both are solvable. Most dApps half-solve them and shrug.

---

## Core Concepts

### WebSocket transports vs HTTP transports

An HTTP RPC connection is request-response: every `eth_getBalance` is a new TCP connection (or pooled connection), every poll is another round-trip. A WebSocket connection is persistent — opened once, kept open, used for both requests and subscriptions.

The crucial feature of WebSocket transports: **subscriptions**. Once connected, you can subscribe to:

- `newHeads` — every new block
- `logs` — events matching a filter (address, topics)
- `newPendingTransactions` — every new tx hitting the mempool

The node *pushes* updates to your client. No polling. Latency is roughly RPC ↔ block producer ↔ your browser, which on a fast WebSocket is single-digit hundreds of milliseconds.

### Setting it up in viem and wagmi

```typescript
import { webSocket } from "viem";
import { createConfig } from "wagmi";

const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: webSocket(process.env.NEXT_PUBLIC_MAINNET_WSS),
  },
});
```

WSS endpoints from Alchemy, Infura, Quicknode, etc. look like `wss://eth-mainnet.g.alchemy.com/v2/KEY`. Once configured, every wagmi hook that supports it will use the WebSocket. Reads still work the same way — the difference shows up when you use event watchers or block subscriptions.

### Watching events in real-time

```typescript
import { useWatchContractEvent } from "wagmi";

useWatchContractEvent({
  address: pool,
  abi: poolAbi,
  eventName: "Swap",
  onLogs: (logs) => {
    for (const log of logs) {
      // log.args is fully typed from the ABI
      console.log("New swap:", log.args);
      // update local state, invalidate caches, animate UI, etc.
    }
  },
});
```

Behind the scenes wagmi opens a `eth_subscribe(logs, {...})` subscription on the WebSocket. The browser doesn't poll. You get `onLogs` calls whenever a matching event is emitted.

### Watching new blocks

```typescript
import { useWatchBlockNumber } from "wagmi";

useWatchBlockNumber({
  onBlockNumber: (blockNumber) => {
    setLatestBlock(blockNumber);
  },
});
```

Useful for "current block" displays, latency monitors, and as a tick to invalidate stale data:

```typescript
const queryClient = useQueryClient();
useWatchBlockNumber({
  onBlockNumber: () => {
    // Every new block, mark our gas estimate stale
    queryClient.invalidateQueries({ queryKey: ["gasEstimate"] });
  },
});
```

### Optimistic UI: the basic pattern

Optimistic UI = update the local state *before* the chain confirms, then reconcile when the truth arrives.

For a token transfer:

```typescript
const { writeContract, data: hash } = useWriteContract();
const queryClient = useQueryClient();

function transfer(to: string, amount: bigint) {
  // Optimistic: subtract from local balance immediately
  queryClient.setQueryData(
    ["balance", account, token],
    (old: bigint) => old - amount,
  );

  writeContract(
    {
      address: token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    },
    {
      onError: () => {
        // Rollback on rejection or revert
        queryClient.invalidateQueries({ queryKey: ["balance", account, token] });
      },
      onSuccess: () => {
        // Wait for actual confirmation, then re-sync from chain
        queryClient.invalidateQueries({ queryKey: ["balance", account, token] });
      },
    },
  );
}
```

The user sees their balance drop the instant they sign. If the tx fails, you re-fetch and the real balance comes back. If it succeeds, the chain catches up to your optimistic guess.

Important: **don't show optimistic state as final**. Mark it visually as "pending" — italic, faded, or with a small spinner. If the user sees "balance: 100" then 30 seconds later "balance: 200" because the tx reverted, they're confused. If they see "balance: 100 (pending)" → "balance: 200 (revert)" they understand.

### Reconciliation: making optimistic match reality

The trickiest part of optimistic UI is handling the gap between "we predicted X" and "the chain says Y." Two patterns:

**Replay-on-confirmation**: just re-fetch when the receipt arrives. Simple, slightly laggy, always correct. Best for most dApps.

**Event-driven reconciliation**: subscribe to the relevant event (e.g. `Transfer`) and use the event data as the source of truth. Faster, more code. Best for rapid-fire actions like rate-limited APIs or order books.

```typescript
useWatchContractEvent({
  address: token,
  abi: erc20Abi,
  eventName: "Transfer",
  args: { from: account, to: undefined },
  onLogs: (logs) => {
    for (const log of logs) {
      // If we sent this tx, we already optimistically updated. Just confirm.
      // If someone else sent us tokens, this is a real new state change.
      queryClient.invalidateQueries({ queryKey: ["balance", account, token] });
    }
  },
});
```

---

## Code Walkthrough

A live "recent swaps" feed for a Uniswap pool, with optimistic insertion when the user themselves swaps:

```tsx
"use client";
import { useState, useEffect } from "react";
import {
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";

type Swap = {
  user: string;
  amountIn: bigint;
  amountOut: bigint;
  txHash: `0x${string}`;
  pending?: boolean;
};

export function RecentSwaps({ pool }: { pool: `0x${string}` }) {
  const { address } = useAccount();
  const [swaps, setSwaps] = useState<Swap[]>([]);

  // 1) Subscribe to all swap events on this pool
  useWatchContractEvent({
    address: pool,
    abi: poolAbi,
    eventName: "Swap",
    onLogs: (logs) => {
      setSwaps((prev) => {
        const newOnes = logs.map((log) => ({
          user: log.args.sender as string,
          amountIn: log.args.amountIn as bigint,
          amountOut: log.args.amountOut as bigint,
          txHash: log.transactionHash,
        }));
        // Drop any pending entries we've now confirmed via event
        const stillPending = prev.filter(
          (s) => s.pending && !newOnes.find((n) => n.txHash === s.txHash),
        );
        return [...newOnes, ...stillPending].slice(0, 20);
      });
    },
  });

  // 2) Send a swap
  const { writeContract, data: hash } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  // 3) When we send, insert an optimistic row
  useEffect(() => {
    if (!hash || !address) return;
    setSwaps((prev) => [
      {
        user: address,
        amountIn: 0n, // we'd capture from the call
        amountOut: 0n,
        txHash: hash,
        pending: true,
      },
      ...prev,
    ]);
  }, [hash, address]);

  return (
    <ul>
      {swaps.map((s) => (
        <li
          key={s.txHash}
          style={{ opacity: s.pending ? 0.6 : 1, fontStyle: s.pending ? "italic" : "normal" }}
        >
          {short(s.user)} swapped {format(s.amountIn)} → {format(s.amountOut)}
          {s.pending && " (pending)"}
        </li>
      ))}
    </ul>
  );
}
```

Now: when *anyone* swaps on this pool, the list updates within ~half a second of the block being produced. When *you* swap, you see your own row appear immediately as "pending" and graduate to confirmed when the event arrives. No polling.

---

## Common Mistakes and Gotchas

**1. Opening a WebSocket per component**
Every wagmi hook shares the underlying transport. Don't create a new viem client (with its own WSS connection) inside every component — you'll exhaust your provider's connection limit. Use the wagmi config or a single shared client.

**2. WebSocket reconnection is on you**
WSS connections die: the user closes their laptop, switches networks, the provider does a deploy. viem auto-reconnects, but state subscribed before the disconnect *may* be missed. For exact correctness, fetch the gap on reconnect (`getLogs` from last seen block to current).

**3. Subscribing without cleanup**
`useWatchContractEvent` cleans up on unmount, but if you're using raw `client.watchContractEvent`, you must call the returned `unwatch()` function. Leaks here mean both connection cost (provider side) and memory (browser side).

**4. Optimistic updates without rollback**
If the user signs and the wallet pops "rejected," you've already optimistically updated. Forgetting to roll back leaves the user looking at bogus numbers until the next refetch. Always handle `onError`.

**5. Treating optimistic state as canonical**
Don't write business logic against optimistic values ("if balance > 0, show withdraw button"). The optimistic value is a hint. Real branching should be against the chain-confirmed value, possibly with a fallback "you have a pending tx that will affect this."

**6. Forgetting reorgs in event-driven UI**
On chains with frequent reorgs, an event you saw might be reorged out. For UI lists like "recent swaps," this is fine — the user briefly saw something that didn't end up canonical, no big deal. For accounting, you need to track confirmation depth and only commit at finality.

**7. Public WSS rate limits**
"Free" public WSS endpoints (like Ankr's open ones) often disconnect every minute or limit the number of subscriptions. For production, you need a paid endpoint with reasonable subscription limits.

---

## How This Connects to Production

The really good dApps in 2026 — Hyperliquid, Aevo, Uniswap V4 frontends, the top Solana terminals — feel as snappy as a Bloomberg terminal. The reason isn't faster blockchains. It's that they push updates over WebSocket the moment they happen and use optimistic UI for user actions. Underneath the polish is exactly the patterns above, scaled up to dozens of subscriptions per page and reconciliation logic that handles reorgs.

The other reason this matters: if you don't push state changes, your users will reload the page. Reloads are expensive: they re-run all your queries, re-fetch metadata, hit your RPC harder. A page that updates itself in the background reduces RPC load and improves UX simultaneously. Polling is the local maximum that prevents you from getting both.

---

## What to Learn Next

- **Account Abstraction & Smart Wallets** (separate track) — how transaction UX changes when you can sponsor gas and bundle operations.
- **The Graph & Subgraph Development** (separate track) — when on-chain events alone aren't enough and you need historical queries.
- **Web3 Backend Engineering** (separate track) — putting subscription logic on the backend so the frontend doesn't have to.
