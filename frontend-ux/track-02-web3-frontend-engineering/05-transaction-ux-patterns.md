# Sending Transactions: UX Patterns for Pending, Mined, and Reverted States

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

A blockchain transaction passes through at least four distinct states from the user's perspective: "I clicked the button," "I'm signing in my wallet," "I broadcast it," "it landed in a block," and "it succeeded or reverted." Treating any two of those as the same state — which most "Submit" buttons do — produces UX that looks broken when it isn't and looks fine when it just lost the user $200.

Worse, transactions can be replaced (the user speeds them up), dropped (they fall out of the mempool), or end up in a reorganized block. A button that says "Confirmed!" because the first receipt arrived can be wrong 30 seconds later. Real transaction UX has to account for all of this without overwhelming the user.

---

## Core Concepts

### The full state machine

```
┌──────────┐
│  Idle    │ ← user is looking at the button
└────┬─────┘
     │ click
     ▼
┌──────────────────┐
│  Awaiting        │ ← wallet popup is open, waiting for sig
│  signature       │
└────┬─────────────┘
     │
     ├──── user rejects ────► back to Idle
     │
     ▼
┌──────────────────┐
│  Broadcasting    │ ← signed, sending to mempool
└────┬─────────────┘
     │
     ▼
┌──────────────────┐
│  Pending         │ ← in mempool, waiting for inclusion
│  (we have hash)  │
└────┬─────────────┘
     │
     ├── replaced (speed up / cancel) ──► track new hash
     │
     ├── dropped from mempool ──► error
     │
     ▼
┌──────────────────┐
│  Mined           │ ← receipt received, but only 1 block deep
└────┬─────────────┘
     │
     ├── status: 0 ─────► Reverted
     │
     ├── reorged out ──► back to Pending or Dropped
     │
     ▼
┌──────────────────┐
│  Confirmed       │ ← N confirmations deep, safe
└──────────────────┘
```

A button that just shows "Confirm" and "Done" collapses all of that into two states. You need to surface, at minimum, signature pending, broadcast pending, and confirmed. For high-value actions, also surface "X confirmations" until you reach finality.

### wagmi's split between sending and waiting

The wagmi pattern is two hooks:

```typescript
const { writeContract, data: hash, isPending: isSigning, error } =
  useWriteContract();

const {
  isLoading: isMining,
  isSuccess,
  isError: isReverted,
  data: receipt,
} = useWaitForTransactionReceipt({ hash });
```

The first hook handles "user is signing" → "broadcast." The second hook starts watching once `hash` is set and resolves when the receipt arrives. Map these to UI states:

```tsx
const buttonState =
  !hash && isSigning ? "Confirm in wallet…"
  : !hash && error ? `Rejected: ${error.message}`
  : hash && isMining ? "Pending…"
  : hash && isSuccess ? "Done ✓"
  : hash && isReverted ? "Reverted ✗"
  : "Submit";
```

This is the bare minimum. It's already 5 distinct states.

### Replacement and cancellation

When a user opens MetaMask and clicks "Speed Up" on a stuck transaction, the wallet broadcasts a new transaction with a higher gas price and the same nonce. The old hash will never confirm; the new hash will. Your UI is still watching the old hash.

viem's `waitForTransactionReceipt` actually handles this — it watches by nonce and reports the replacement:

```typescript
const receipt = await client.waitForTransactionReceipt({
  hash,
  onReplaced: (replacement) => {
    if (replacement.reason === "cancelled") {
      // user cancelled it
    } else if (replacement.reason === "replaced") {
      // user sped up — replacement.transaction has the new hash
    } else if (replacement.reason === "repriced") {
      // edge case
    }
  },
});
```

`useWaitForTransactionReceipt` doesn't expose `onReplaced` directly in v2 (as of early 2026), so for sophisticated handling you sometimes drop down to viem's action. But for most dApps, the receipt arrives correctly even after a speed-up — wagmi quietly follows the nonce.

### Confirmations and finality

`useWaitForTransactionReceipt` resolves on 1 confirmation by default. For high-value transactions, you want more. On Ethereum mainnet, ~12 confirmations is standard for serious commitment. On Polygon or BNB chain, higher is safer because reorgs are more frequent.

```typescript
const { isSuccess } = useWaitForTransactionReceipt({
  hash,
  confirmations: 12,
});
```

Showing the user a progress indicator helps:

```tsx
const [confs, setConfs] = useState(0);

useEffect(() => {
  if (!hash) return;
  const interval = setInterval(async () => {
    const receipt = await client.getTransactionReceipt({ hash });
    if (!receipt) return;
    const head = await client.getBlockNumber();
    setConfs(Number(head - receipt.blockNumber + 1n));
  }, 4000);
  return () => clearInterval(interval);
}, [hash]);

return <span>{confs}/12 confirmations</span>;
```

Slightly more code, much more confidence.

### Reverts: the part everyone forgets

A transaction can succeed at the protocol level (it got included in a block) and still revert at the contract level (`receipt.status === "reverted"`). Users almost never know what reverted or why — they just see "your tx failed" and rage-quit.

The fix: simulate before you send. viem's `simulateContract` runs the call against a recent state and tells you if it would revert *and why*:

```typescript
import { useSimulateContract, useWriteContract } from "wagmi";

const { data: simResult, error: simError } = useSimulateContract({
  address: pool,
  abi: poolAbi,
  functionName: "swap",
  args: [tokenIn, amountIn, minOut],
  account: userAddress,
});

const { writeContract } = useWriteContract();

if (simError) {
  // simError.message often includes the revert reason
  return <button disabled>{parseRevertReason(simError)}</button>;
}

return (
  <button onClick={() => writeContract(simResult!.request)}>
    Swap
  </button>
);
```

The `simResult.request` object contains the exact request to send — pre-validated. If sim says it'll revert, you don't even let the user sign.

---

## Code Walkthrough

A complete production-grade button with simulation, multi-state UI, and confirmation tracking:

```tsx
"use client";
import { useSimulateContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useState } from "react";

export function SwapButton({ pool, tokenIn, amountIn, minOut }: Props) {
  const { address } = useAccount();
  const [submitted, setSubmitted] = useState(false);

  // Phase 1: simulate
  const { data: sim, error: simError, isPending: isSimulating } = useSimulateContract({
    address: pool,
    abi: poolAbi,
    functionName: "swap",
    args: [tokenIn, amountIn, minOut],
    account: address,
    query: { enabled: !!address && amountIn > 0n },
  });

  // Phase 2: send
  const { writeContract, data: hash, isPending: isSigning, error: sendError, reset } =
    useWriteContract();

  // Phase 3: wait
  const { isLoading: isMining, isSuccess, isError: isReverted } =
    useWaitForTransactionReceipt({ hash, confirmations: 3 });

  if (!address) return <button disabled>Connect wallet</button>;
  if (isSimulating) return <button disabled>Checking…</button>;
  if (simError) return <button disabled>{parseRevertReason(simError)}</button>;

  if (hash && isMining) {
    return (
      <button disabled>
        Swapping… <a href={explorerUrl(hash)} target="_blank">view tx</a>
      </button>
    );
  }
  if (isSuccess) {
    return <button onClick={reset}>Swapped ✓ — Swap again</button>;
  }
  if (isReverted) {
    return <button onClick={reset}>Reverted — try again</button>;
  }
  if (sendError) {
    return <button onClick={reset}>{sendError.message}</button>;
  }
  if (isSigning) {
    return <button disabled>Confirm in wallet…</button>;
  }

  return (
    <button
      onClick={() => {
        if (!sim) return;
        setSubmitted(true);
        writeContract(sim.request);
      }}
    >
      Swap
    </button>
  );
}

function parseRevertReason(error: Error): string {
  // viem includes a `shortMessage` for known revert types
  const msg = (error as any).shortMessage ?? error.message;
  return msg.length > 80 ? msg.slice(0, 77) + "…" : msg;
}

function explorerUrl(hash: `0x${string}`) {
  return `https://etherscan.io/tx/${hash}`;
}
```

Every state has a distinct UI. The user always knows what's happening. Sim catches reverts before the wallet popup. The "view tx" link gives them an out if they want to check the explorer themselves.

---

## Common Mistakes and Gotchas

**1. Treating "wallet popup open" and "transaction pending" as one state**
These are completely different latencies (seconds vs. minutes) and different failure modes (user rejection vs. network congestion). Show distinct UI for each.

**2. Not using simulation**
Simulating before sending eliminates the worst class of failures: "user signs, pays gas, sees revert." Worth it even for the simplest writes.

**3. Hardcoding confirmations to 1**
On Polygon and BNB, 1 confirmation is not safe. On Arbitrum and other L2s, "confirmation" means something different (sequencer inclusion vs. L1 finality). Pick a number per chain that matches the value you're handling.

**4. Forgetting to `reset()` after success**
After a transaction succeeds, the hooks are still holding the last hash and result. The button stays "Done ✓" forever. Call `reset()` (or unmount/remount) when you want to send another transaction.

**5. Showing "Done!" after 1 block then having it reorg out**
On chains with frequent reorgs (Polygon mainnet has reorgs of 1-3 blocks regularly), showing success too early lies to the user. Wait for `confirmations: 12` or more before showing finality.

**6. Hiding the tx hash from the user**
Always show a link to the explorer once you have a hash. If your button breaks, if your indexer lags, if the user closes their browser — the tx hash is the only thing they can use to check status. Make it clickable.

**7. Not handling the wallet "user rejected" error gracefully**
This isn't really an error in the system sense — the user just changed their mind. Map it to a friendly message ("Cancelled") and reset state, don't surface a stack trace.

---

## How This Connects to Production

Every protocol you've used that has good UX — Aave, Uniswap, Lido — has implemented this state machine, often with extra polish: a global "transactions" panel that lists all pending tx hashes for the session; toast notifications that update as state changes; "speed up" and "cancel" buttons surfaced from your UI rather than relying on the wallet's. Once you have the hooks pattern down, building those upgrades is straightforward.

The other production angle: write transactions are where users lose money. Bad UX here doesn't just hurt conversion — it can mean a user double-spends gas because they thought the first attempt failed when it was just slow. The simulation step alone has saved more failed user actions than almost any other UX improvement in 2024-2025.

---

## What to Learn Next

- **IPFS for dApps: Pinning, Gateways, and Reliable NFT Metadata** — the other half of writing dApps: the off-chain content layer.
- **Real-Time Data: WebSocket Subscriptions and Optimistic UI** — making your reads feel as instant as your writes.
- **Account Abstraction & Smart Wallets** (separate track) — how all of this changes when transactions are UserOps and gas can be sponsored.
