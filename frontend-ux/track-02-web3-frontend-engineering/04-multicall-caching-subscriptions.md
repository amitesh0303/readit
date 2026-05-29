# Reading Contract State: Multicall, Caching, and Subscriptions

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Your token list page has 30 ERC-20 tokens. For each, you need name, symbol, decimals, and the user's balance. That's 4 reads × 30 tokens = 120 RPC calls. On a public RPC, that's seconds of loading. On a paid Alchemy plan, that's eating into your monthly quota for one page-load. On a cold cache, the user sees a flicker of empty state for everything.

There's a better way. Three of them, actually: multicall (batch many reads into one), caching (don't refetch what you already know), and subscriptions (push updates instead of polling). Combined, you get a list page that loads in one round-trip and stays fresh without hammering RPC.

---

## Core Concepts

### What multicall actually is

Multicall is a deployed contract — `Multicall3` at the same address (`0xcA11bde05977b3631167028862bE2a173976CA11`) on most major chains — that takes a list of `(target, calldata)` pairs and returns the list of return values. Calling it lets you do many contract reads in a single `eth_call`.

Two key benefits:

1. **One RPC round-trip** instead of N. If you're talking to a remote RPC, the latency saving is dramatic — going from 200ms × 30 calls (sequential) or 200ms (parallel, but rate-limited) to one 200ms request.
2. **Atomic snapshot**: all reads happen at the same block. If you read `token.balanceOf(user)` and `pool.totalSupply()` separately, the second one might see a state change between them. With multicall, both are read at the same `blockNumber`, so the values are mutually consistent.

### viem's automatic batching

viem can do this for you transparently. When you create a `publicClient` with `batch: { multicall: true }`, *every* `readContract` call gets queued for ~32ms and then flushed as a single multicall. You write your code as if doing 30 separate reads; viem rolls them up.

```typescript
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL),
  batch: {
    multicall: {
      batchSize: 1024, // bytes
      wait: 32, // ms — how long to wait collecting calls before flushing
    },
  },
});

// Each of these looks like a separate call but viem batches them
const balances = await Promise.all(
  TOKEN_LIST.map((token) =>
    client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user],
    }),
  ),
);
```

What hits the RPC: one `eth_call` to Multicall3. What you get: 30 typed `bigint` results.

### wagmi's `useReadContracts` for explicit batching

When you want to read different functions on different contracts in one shot, `useReadContracts` is more explicit:

```typescript
import { useReadContracts } from "wagmi";

const { data } = useReadContracts({
  contracts: [
    { address: tokenA, abi: erc20Abi, functionName: "name" },
    { address: tokenA, abi: erc20Abi, functionName: "symbol" },
    { address: tokenA, abi: erc20Abi, functionName: "decimals" },
    { address: tokenA, abi: erc20Abi, functionName: "balanceOf", args: [user] },
    { address: tokenB, abi: erc20Abi, functionName: "name" },
    // ...
  ],
  allowFailure: true, // if one revert, return error for it but succeed for others
});
```

`data` is an array of `{ status: 'success' | 'failure', result, error }` objects. `allowFailure: true` is what you want for token lists — one bad token shouldn't crash the whole page.

### Caching: TanStack Query, mostly for free

Every wagmi hook is backed by TanStack Query. The default cache key is derived from the call (address + function + args + chainId). That means:

- Two components asking for the same token's balance share one query.
- Navigating away and back doesn't re-fetch (within `staleTime`).
- Background refetching keeps things fresh without flickering.

You tune this with the `query` option:

```typescript
useReadContract({
  address,
  abi,
  functionName: "balanceOf",
  args: [user],
  query: {
    staleTime: 12_000,        // data is "fresh" for 12s — no refetch on remount
    gcTime: 5 * 60_000,       // garbage-collect after 5min idle
    refetchOnWindowFocus: false, // disable if you don't want a refetch when tab refocuses
  },
});
```

The default `staleTime` is 0 (always re-fetch on mount). For on-chain data that doesn't change often, bumping this up to 30s-2min is usually safe and saves a lot of RPC calls.

### Subscriptions: stop polling

Polling every block is wasteful. WebSocket subscriptions push updates only when the relevant state changes.

```typescript
import { useWatchContractEvent } from "wagmi";

useWatchContractEvent({
  address: token,
  abi: erc20Abi,
  eventName: "Transfer",
  args: { to: user }, // filter: only events where `to == user`
  onLogs: (logs) => {
    // refetch the user's balance — it just changed
    queryClient.invalidateQueries({ queryKey: ["readContract", { ... }] });
  },
});
```

This requires a WebSocket transport. Alchemy, Infura, and most providers offer one. The transport in your wagmi config:

```typescript
import { webSocket } from "viem";

createConfig({
  transports: {
    [mainnet.id]: webSocket(process.env.MAINNET_WSS),
  },
});
```

The pattern: fetch the initial state via `useReadContract`, then `useWatchContractEvent` to invalidate on changes. The user gets fast initial load + real-time updates without hammering RPC.

---

## Code Walkthrough

A multi-token portfolio page with multicall, caching, and event-driven invalidation:

```typescript
"use client";
import { useAccount, useReadContracts, useWatchContractEvent } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";

const TOKENS = [
  { address: "0xA0b8...eb48", chainId: 1 }, // USDC
  { address: "0xdAC1...1ec7", chainId: 1 }, // USDT
  // ...
];

export function Portfolio() {
  const { address } = useAccount();
  const qc = useQueryClient();

  // One multicall: 4 reads × N tokens = 1 RPC call
  const { data, isLoading } = useReadContracts({
    contracts: address
      ? TOKENS.flatMap((t) => [
          { address: t.address, abi: erc20Abi, functionName: "symbol" },
          { address: t.address, abi: erc20Abi, functionName: "decimals" },
          { address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] },
        ])
      : [],
    allowFailure: true,
    query: {
      staleTime: 30_000, // OK to be 30s stale
      enabled: !!address,
    },
  });

  // Subscribe to Transfer events involving the user — refetch on change
  TOKENS.forEach((t) => {
    useWatchContractEvent({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      eventName: "Transfer",
      args: address ? { to: address } : undefined,
      onLogs: () => qc.invalidateQueries({ queryKey: ["readContracts"] }),
    });
  });

  if (!address) return <p>Connect wallet</p>;
  if (isLoading) return <p>Loading…</p>;

  return (
    <ul>
      {TOKENS.map((t, i) => {
        const symbol = data?.[i * 3]?.result;
        const decimals = data?.[i * 3 + 1]?.result;
        const balance = data?.[i * 3 + 2]?.result;
        return (
          <li key={t.address}>
            {symbol}: {formatUnits(balance, decimals)}
          </li>
        );
      })}
    </ul>
  );
}
```

What this gives you:

- One RPC call to load all token data.
- Cached for 30s — navigating away and back is instant.
- Auto-refresh when any of the user's tokens move.
- Graceful failure if one token's contract reverts (e.g. paused).

---

## Common Mistakes and Gotchas

**1. Forgetting `allowFailure: true` in token lists**
A single token revert (paused contract, deprecated, malicious) will crash the whole batch and you lose all 30 reads. `allowFailure: true` returns per-call status so the rest still resolve.

**2. Calling Multicall3 on a chain that doesn't have it**
Most major EVM chains have Multicall3 deployed at the canonical address. New chains and L3s might not. viem's chain definitions include the multicall address — if your custom chain doesn't, batching will fail. Either add the address to your chain config or set `batch: { multicall: false }`.

**3. Subscribing to too many events**
WebSocket subscriptions cost on the provider side. Subscribing to every `Transfer` event on every popular ERC-20 will get you rate-limited or banned. Always filter with `args` so only relevant logs come through, and unsubscribe when components unmount (wagmi's `useWatchContractEvent` does this automatically; raw viem requires explicit cleanup).

**4. Trusting `staleTime` for things that change every block**
Active price feeds, current block, dynamic gas estimates — these need short staleTimes (or pure subscriptions). Long staleTimes are for data that doesn't change often: token metadata, vesting schedules, historical totals.

**5. Polling and subscribing at the same time**
If you set both `refetchInterval` and `useWatchContractEvent` for the same data, you're doing twice the work. Pick one strategy per data type. Polling is simpler and works without WebSockets; subscriptions are more efficient but only work when you have a stable WSS endpoint.

**6. Not handling reorgs in event-driven invalidation**
If a Transfer event is emitted and then reorged out, you'll have invalidated your cache on bad data. For most UI cases this is fine — the user's balance will be re-fetched and shown correctly. For accounting or auditing, you need to wait for confirmations before trusting the event.

---

## How This Connects to Production

Production dApps with serious traffic — Uniswap, Aave's UIs, top NFT marketplaces — all use these techniques aggressively. Multicall is *the* reason their pages load fast despite querying dozens of contract states. WebSocket subscriptions are *the* reason your "swap" page updates instantly when your transaction lands. TanStack Query caching is *the* reason hopping between pages doesn't reload the same data.

Beyond the basics: the next layer is server-side caching. Subgraphs or your own indexer can serve aggregated data (TVL, top holders, historical curves) faster than any RPC can. Multicall is for "current state across many contracts in one go." Indexers are for "history, aggregates, and joins." Most real dApps use both.

---

## What to Learn Next

- **Sending Transactions: UX Patterns for Pending, Mined, and Reverted States** — the write side of the same problem.
- **Real-Time Data: WebSocket Subscriptions and Optimistic UI** — go deeper on the subscription side, plus optimistic updates.
- **The Graph & Subgraph Development** (separate track) — when you outgrow what multicall can give you, indexing is the next step.
