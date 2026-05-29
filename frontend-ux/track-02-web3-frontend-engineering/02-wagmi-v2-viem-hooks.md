# wagmi v2 + Viem: Hooks, Connectors, and Type Safety

**Track:** Intermediate
**Read time:** 10 min

---

## The Problem

You can write a dApp frontend with raw viem. You probably shouldn't. You'd end up reimplementing the same five things every page: caching contract reads, refreshing on new blocks, connecting wallets, switching networks, and tracking the state of pending transactions. wagmi solves all of that, well, with React hooks built specifically for Web3.

But "use wagmi" hides a lot. wagmi v2 is a substantial rewrite of v1 — different API, different mental model, different caching layer (TanStack Query). If you're coming from v1 examples (which most blog posts still are), you'll get tripped up. And if you've never used wagmi at all, the official docs assume more familiarity with viem and React than is comfortable. This is the practical version.

---

## Core Concepts

### What wagmi actually is

wagmi is a set of React hooks built on top of viem and TanStack Query (formerly React Query). It gives you:

- **Hooks for reads** (`useReadContract`, `useReadContracts`, `useBalance`, `useBlockNumber`)
- **Hooks for writes** (`useWriteContract`, `useSendTransaction`, `useSignMessage`)
- **Hooks for accounts and connections** (`useAccount`, `useConnect`, `useDisconnect`, `useSwitchChain`)
- **A configuration system** for chains, transports, and connectors

The key insight: wagmi hooks return TanStack Query objects. That means you get `data`, `isPending`, `isError`, `error`, `refetch` and the entire query lifecycle for free, with caching and background refetching handled for you.

### The config: where everything starts

Every wagmi v2 app has a `config` object that defines which chains you support, how to talk to them, and which wallet connectors to expose:

```typescript
// wagmi.config.ts
import { http, createConfig } from "wagmi";
import { mainnet, base, arbitrum } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, base, arbitrum],
  connectors: [
    injected(), // MetaMask, Brave, Rabby, etc.
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID! }),
    coinbaseWallet({ appName: "My dApp" }),
  ],
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC),
  },
});
```

Wrap your app in `WagmiProvider` and a `QueryClientProvider`:

```tsx
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./wagmi.config";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
```

This is the minimum. Every hook downstream uses this config.

### Reading contract state with hooks

`useReadContract` is the bread-and-butter:

```typescript
import { useReadContract } from "wagmi";
import { erc20Abi } from "viem";

function TokenBalance({ token, owner }: { token: `0x${string}`; owner: `0x${string}` }) {
  const { data: balance, isPending, error } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    query: {
      // TanStack Query options nest under `query`
      refetchInterval: 12_000, // poll every 12s
      enabled: !!owner,
    },
  });

  if (isPending) return <span>Loading…</span>;
  if (error) return <span>Error: {error.message}</span>;
  return <span>{balance?.toString()}</span>;
}
```

Three things worth noting:

1. `data` is typed as `bigint | undefined` because viem inferred the return type from `erc20Abi`.
2. `enabled: !!owner` prevents the query from firing before you have an address — without this, you'll see a flash of "user 0x000...000".
3. `refetchInterval: 12_000` is the right default for Ethereum mainnet (1 block ≈ 12s). For faster chains, set it to match block time.

### Writing transactions

`useWriteContract` is more involved because writes have multi-stage state — wallet popup, broadcast, pending, mined, finalized:

```typescript
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";

function ApproveButton({ token, spender, amount }: Props) {
  const { writeContract, data: hash, isPending: isSending, error } =
    useWriteContract();

  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const handleClick = () => {
    writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });
  };

  return (
    <button onClick={handleClick} disabled={isSending || isMining}>
      {isSending && "Confirm in wallet…"}
      {isMining && "Pending on-chain…"}
      {isSuccess && "Approved ✓"}
      {!isSending && !isMining && !isSuccess && "Approve"}
    </button>
  );
}
```

The split is intentional: `writeContract` handles the "user signs in their wallet, tx is broadcast" part, and `useWaitForTransactionReceipt` watches for the receipt. You almost always need both.

### Connectors and account state

```typescript
import { useAccount, useConnect, useDisconnect } from "wagmi";

function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div>
        <span>{address} on {chain?.name}</span>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((c) => (
        <button key={c.uid} onClick={() => connect({ connector: c })}>
          Connect {c.name}
        </button>
      ))}
    </div>
  );
}
```

For most production dApps you'd use RainbowKit or ConnectKit on top of wagmi for the actual modal UI — they handle WalletConnect QR codes, recent wallets, and wallet detection better than you'd build yourself.

---

## Code Walkthrough

A complete "approve and swap" two-step flow, the kind you actually ship:

```typescript
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { maxUint256 } from "viem";

export function SwapButton({ tokenIn, amountIn, router }: Props) {
  const { address } = useAccount();

  // Step 1: check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, router] : undefined,
    query: { enabled: !!address },
  });

  const needsApproval = allowance !== undefined && allowance < amountIn;

  // Step 2: approve hook
  const { writeContract: writeApprove, data: approveHash } = useWriteContract();
  const { isSuccess: approveDone } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  // refetch allowance once approval mines
  if (approveDone) refetchAllowance();

  // Step 3: swap hook
  const { writeContract: writeSwap, data: swapHash } = useWriteContract();
  const { isLoading: swapMining, isSuccess: swapDone } =
    useWaitForTransactionReceipt({ hash: swapHash });

  if (!address) return <button disabled>Connect wallet</button>;

  if (needsApproval) {
    return (
      <button
        onClick={() =>
          writeApprove({
            address: tokenIn,
            abi: erc20Abi,
            functionName: "approve",
            args: [router, maxUint256],
          })
        }
      >
        Approve {tokenIn}
      </button>
    );
  }

  return (
    <button
      onClick={() =>
        writeSwap({
          address: router,
          abi: routerAbi,
          functionName: "swap",
          args: [tokenIn, amountIn /* ... */],
        })
      }
      disabled={swapMining}
    >
      {swapMining ? "Swapping…" : swapDone ? "Done ✓" : "Swap"}
    </button>
  );
}
```

This is the canonical pattern for any DeFi action. The state machine is approval-needed → approving → approved → executing → done.

---

## Common Mistakes and Gotchas

**1. Using `enabled: !!address` is not optional**
If you don't gate queries on the user being connected, every contract hook fires immediately on page load against `address = undefined`, which is either an error or wasted RPC calls. Always pass `enabled` for queries that depend on user state.

**2. Forgetting to `refetch` after a write**
TanStack Query won't automatically know that your contract write invalidated the read. You either call `refetch()` after the receipt arrives, or use `queryClient.invalidateQueries()` for broader invalidation, or set `refetchInterval` so the data is eventually consistent.

**3. Using v1 hook names with v2**
v1 had `useContractRead`, v2 renamed it to `useReadContract`. Same for `useContractWrite` → `useWriteContract`, `usePrepareContractWrite` (gone, no longer needed). If you're following a tutorial and TypeScript complains the hook doesn't exist, it's a v1 tutorial.

**4. Not wrapping `args` properly**
`args` must be a tuple, not an array. With `as const` ABIs, viem will type-error if you pass the wrong shape. Use the right number of args; for hooks where you don't have all args yet, pass `undefined` for the whole `args` and gate with `enabled`.

**5. Putting WagmiProvider inside QueryClientProvider**
The order matters. WagmiProvider must wrap QueryClientProvider — wagmi's hooks expect the query client to be available. If you reverse them, you get cryptic "no query client" errors only on certain hooks.

**6. Thinking connector list updates per-render is fine**
The `connectors` array from `useConnect()` is stable across renders. Don't `.filter()` or `.map()` it inside JSX every render unless you need to — memoize or compute once.

---

## How This Connects to Production

Real dApps live and die on transaction UX. Users will tolerate slow loads, but they will rage-quit a button that says "Confirm" with no feedback while their wallet popup is hidden behind a tab. The hook patterns above (split sending state from mining state from receipt state) are how you build a button that always tells the user what's happening.

Bigger codebases extend this with: a global toast system that subscribes to `useWaitForTransactionReceipt` for every pending hash; a "transactions" sidebar that lists pending and recent activity; per-network gas estimates surfaced before the user signs; and gasless flows via paymasters when ERC-4337 is in play. None of that is hard once you have the wagmi hook patterns down — but skipping the basics here means you'll fight the framework every step of the way.

---

## What to Learn Next

- **Next.js App Router for dApps: SSR, RSC, and Wallet State Hydration** — wagmi is a client-side library. Combining it with React Server Components is a real puzzle worth solving.
- **Reading Contract State: Multicall, Caching, and Subscriptions** — go deeper on the read side: batching dozens of reads into one RPC call.
- **Sending Transactions: UX Patterns for Pending, Mined, and Reverted States** — the button-state machine in detail, including how to handle replaced and dropped transactions.
