---
title: "I Rewrote My dApp Frontend from Ethers to Viem. Here's What I Actually Learned."
date: 2025-09-22
tags: [viem, ethers, wagmi, frontend, typescript, refactor]
---

I want to talk about a refactor that took me three weekends, deleted around 800 lines of code, dropped my bundle size by 70 kB gzipped, and surfaced two latent bugs I'd been carrying for over a year. This is the ethers-to-viem migration that everyone has been telling me to do for two years and that I kept putting off because "ethers works fine."

Ethers does work fine. That's not the point. The point is the gap between "works fine" and what's actually possible.

## Why I finally did it

The trigger was specific: a user reported that calling `vault.deposit()` on our app was throwing an unhelpful error in the console, and every retry made the exact same call with the exact same args, but the second one would land. I dug in. The bug was a stale `provider` object holding onto an old chain ID after the user had switched networks mid-flow. ethers v6 has chain detection but my code wasn't quite using it right. The fix was a 6-line change. The investigation was 4 hours.

That same week I was reading the wagmi v2 docs and saw what `useReadContract` looks like: typed return value, automatic batching with multicall, refetching that just works. I'd been writing my own `useEffect` + manual cache + manual debounce for every contract read. Looking at my codebase: every page had its own variation of the same pattern, none of them quite the same.

The stale-provider bug and the mounting pile of "we wrote our own version of this" were what tipped me. I scheduled a refactor for the next weekend.

## The mechanical part

Replacing `import { ethers } from 'ethers'` with viem isn't just a find-and-replace. The mental model shifts.

In ethers, you have a `Provider` (or a `Signer`) and you attach `Contract` instances to it. Most of my code looked like:

```typescript
const provider = new ethers.JsonRpcProvider(rpcUrl);
const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
const balance = await vault.balanceOf(user);
```

In viem, you have `clients` and `actions`. Reads go through `publicClient`, writes through `walletClient`. Each call is explicit:

```typescript
const balance = await publicClient.readContract({
  address: vaultAddress,
  abi: vaultAbi,
  functionName: 'balanceOf',
  args: [user],
});
```

It's more verbose. I'll be honest, I missed `vault.balanceOf(user)` for about two days. Then I noticed the type inference: `balance` is typed as `bigint` because viem read the ABI at the type level. With ethers I'd had to manually annotate or accept `any`.

The verbosity stops being annoying when you realize every operation has the same shape. Reading state? `client.readContract({...})`. Sending a tx? `client.writeContract({...})`. Getting a block? `client.getBlock({...})`. There's no "oh, the syntax for this one is different because it's a static call vs an event" — every action looks the same.

## The wagmi-v2 cleanup

The bigger win was on the React side. Here's an actual diff from one of my pages.

Before, with my hand-rolled hooks on top of ethers:

```typescript
function useVaultBalance(vault: string, user: string) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      try {
        setLoading(true);
        const provider = getProvider();
        const contract = new ethers.Contract(vault, vaultAbi, provider);
        const result = await contract.balanceOf(user);
        if (!cancelled) {
          setBalance(BigInt(result));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e as Error);
          setLoading(false);
        }
      }
    }
    if (user) fetch();
    return () => { cancelled = true; };
  }, [vault, user]);

  return { balance, loading, error };
}
```

After:

```typescript
function useVaultBalance(vault: `0x${string}`, user: `0x${string}` | undefined) {
  return useReadContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: user ? [user] : undefined,
    query: { enabled: !!user },
  });
}
```

The new version handles caching automatically (TanStack Query underneath). It deduplicates: if three components call `useVaultBalance(sameVault, sameUser)` they share one query. It refetches in the background. It returns proper loading/error states without me writing them.

I deleted 12 hand-rolled hooks like this across the app. About 600 lines of code, gone, replaced by direct calls to wagmi hooks.

## The bugs that fell out of the refactor

Two genuinely surprising things turned up.

**Bug 1: I had been silently swallowing errors for a year.** My old `useVaultBalance` had `catch (e)` blocks that set an error state. But the components consuming the hook didn't always render the error — some of them just showed `--` if `balance` was null. So when an RPC call failed, the user saw a dash. I assumed dashes meant "loading." Users assumed they meant "zero." Customer support had been dealing with this for months.

The wagmi version surfaces errors as a structured `error` object that I now actually render in the UI. The day after I shipped the refactor, two users emailed me about errors they'd been hitting silently for ages. One was my fault (a misconfigured RPC). One was a chain-specific viem issue I patched. Both would have been visible months earlier if I'd been showing errors instead of dashes.

**Bug 2: The stale provider bug I started this for.** Not actually a bug after the migration. wagmi's `useReadContract` is chain-aware — when the user switches networks, the hook re-runs against the new chain automatically. The whole class of "stale provider" bugs I'd been working around just stops existing.

## The bundle-size thing

Numbers from before/after, on the actual production build:

```
before (ethers v6 + custom hooks):  427 kB main bundle (gzipped: ~134 kB)
after (viem + wagmi v2):            321 kB main bundle (gzipped:  ~62 kB)
```

The 70 kB gzip win is material. On a 4G connection, that's roughly 200ms shaved off the first contentful paint. We had been actively losing some users on mobile because of slow loads — the bundle size cut probably brought back a noticeable chunk of them.

About half the win is viem itself being smaller than ethers. The other half is that I deleted my custom hooks, my custom event listener wrapper, and my retry/backoff utility. Viem and wagmi do all of those things, tree-shaken to the parts I actually use.

## What I would not recommend

Doing this on a production codebase with no tests. I had test coverage on the contract interactions — fakes for the wagmi hooks, mocked viem clients. The refactor was straightforward because the tests caught regressions. If you're doing this without tests, you'll discover the regressions in production and you'll be miserable.

Also: don't try to migrate over weeks of half-attention. I tried that initially and ended up with a codebase where some pages used wagmi and some still used my old hooks, and the two systems didn't share cache, and components were re-fetching the same data. It was worse than either pure version. I ended up doing it as a focused weekend sprint — branch, full migration, reviewed, merged. Better.

## The part nobody talks about

The migration didn't change what my app does. Users got nothing new. From the outside, the only difference was that the bundle got smaller and the page loaded a bit faster. From the inside, I deleted hundreds of lines, fixed two real bugs, and made every future feature easier to write.

That's the value, and it's the part that makes this kind of work hard to justify on a roadmap. Nobody is asking for "rewrite the contract layer." But the codebase is a library you're going to keep reading for as long as the project lives. Reducing the surface area of weird custom code is leverage on every future thing.

Three weekends. -800 lines. -70 kB. Two bugs found. One stale-provider class of bug eliminated by construction. I'd do it again. I won't put it off this long next time.
