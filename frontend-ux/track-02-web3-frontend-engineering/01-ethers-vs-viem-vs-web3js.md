# Ethers vs Viem vs Web3.js: Picking a Library in 2026

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Every Web3 frontend tutorial you read picks a different library and acts like the choice is obvious. ethers.js was the default for years. web3.js was the original. Then viem appeared in 2022, started getting recommended by the wagmi team, and quietly took over a huge chunk of the ecosystem. By 2026, the question is no longer "should I use viem" — it's "do I have a good reason not to."

But "use viem" is not a real answer. You probably have an existing codebase with ethers v5 hooks all over it. You're maintaining a contract written years ago with web3.js examples in the README. You're picking the path of least resistance for a one-off script. You need a real comparison — what each library is good at, what they cost you, and where the tradeoffs actually bite.

---

## Core Concepts

### What these libraries actually do

All three libraries solve the same core problem: turn a contract ABI and an RPC endpoint into typed function calls, encode/decode calldata, manage signers, and abstract over JSON-RPC transport. The differences are in *how* they do it.

**web3.js** (the original, originally from the Ethereum Foundation, now maintained by ChainSafe) — class-based, callback-leaning legacy, lots of historical baggage. Still works. Still occasionally referenced in old tutorials. Mostly being phased out of new codebases.

**ethers.js** (created by Ricky Moore) — the dominant library from roughly 2019 to 2023. Clean API, well-documented, two major versions (v5 and v6) that are not API-compatible with each other. Most existing dApps still run on ethers v5 or v6.

**viem** (from the wagmi team, by paradigm and friends) — designed from scratch with TypeScript-first ergonomics, tree-shakeable, much smaller bundle size, and a fundamentally different mental model: instead of one big provider object, you compose `clients` (publicClient, walletClient) with `actions`.

### Bundle size matters more than people admit

This is where viem started winning. Pulling all of `ethers` v6 into a Next.js bundle is around 110-130 kB gzipped depending on tree-shaking. viem's core, when only the actions you use are imported, frequently lands under 35 kB gzipped for a typical dApp. That difference is real on mobile networks, especially if your dApp is trying to onboard non-crypto users.

### Type safety: the actual differentiator

The real reason viem won mindshare wasn't bundle size. It was that viem reads your ABI at the type level. If your contract has a function `function balanceOf(address owner) returns (uint256)`, viem knows — at compile time — that calling that function returns `bigint` and takes one address argument. Pass the wrong argument and TypeScript errors before you even run the code.

ethers v6 has some type inference but it relies on you generating types separately (typechain). viem makes the ABI itself the source of truth and uses TypeScript's template literal types and recursive type inference to derive everything from it. In practice this catches a class of bugs — wrong argument count, wrong types, calling a non-existent function — that would otherwise blow up at runtime.

### The mental model shift

In ethers, you have a `Provider` (read) or a `Signer` (write), and you attach contract instances to them:

```typescript
const provider = new ethers.JsonRpcProvider(url);
const contract = new ethers.Contract(address, abi, provider);
const balance = await contract.balanceOf(user);
```

In viem, you have clients and actions. Reads go through `publicClient`, writes through `walletClient`:

```typescript
const balance = await publicClient.readContract({
  address,
  abi,
  functionName: "balanceOf",
  args: [user],
});
```

It looks more verbose at first glance, and it is. The payoff is that the verbose form is fully typed, tree-shakeable (you only import the actions you use), and consistent across every operation. You don't have one API for `contract.balanceOf()` and another for `provider.getBlock()` — it's all `client.action({ ... })`.

---

## Code Walkthrough

Same task, three libraries: read the USDC balance of an address on Ethereum mainnet.

**web3.js (v4):**

```typescript
import { Web3 } from "web3";

const web3 = new Web3("https://mainnet.infura.io/v3/KEY");
const usdc = new web3.eth.Contract(ABI, "0xA0b8...eb48");

const balance: string = await usdc.methods
  .balanceOf("0x...")
  .call(); // returns string, not bigint
console.log(balance);
```

**ethers v6:**

```typescript
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/KEY");
const usdc = new ethers.Contract("0xA0b8...eb48", ABI, provider);

const balance: bigint = await usdc.balanceOf("0x...");
console.log(balance);
```

**viem:**

```typescript
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://mainnet.infura.io/v3/KEY"),
});

const balance = await client.readContract({
  address: "0xA0b8869691596F89bbB0c9D62A1Cc11C9eb48",
  abi: usdcAbi, // imported as `as const` — viem reads its types
  functionName: "balanceOf",
  args: ["0x..."],
});
// `balance` is inferred as bigint from the ABI
```

If you mistype `balanceOf` as `balanceOff` in the viem version, TypeScript fails immediately. In ethers, the type of `usdc.balanceOff(...)` is `any` and the error happens at runtime.

The key trick to make the type inference work in viem: import your ABI as `as const`:

```typescript
export const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // ...
] as const;
```

Without `as const`, TypeScript treats the ABI as `Array<object>` and the magic falls apart.

---

## Common Mistakes and Gotchas

**1. Migrating from ethers v5 to ethers v6 thinking it's a minor bump**
v5 used `ethers.utils.parseEther`, v6 moved it to `ethers.parseEther`. v5 returned `BigNumber` everywhere, v6 returns native `bigint`. v5 had `provider.getSigner()`, v6 made it async. The migration is a real refactor, not a version bump. If you're already going to do that work, evaluate viem at the same time.

**2. Forgetting `as const` on viem ABIs**
You'll know you forgot because every `readContract` call returns `unknown` and TypeScript stops being helpful. The fix is mechanical: import the ABI from a file that exports it `as const`, or use viem's `parseAbi` helper which returns the right type automatically.

**3. Mixing libraries in the same app**
You'd be surprised how often this happens. A team uses ethers for the main app, then a developer copies a snippet from a viem tutorial and adds it to a different page. Now your bundle ships both libraries. Pick one and write a thin wrapper if you need to ease migration.

**4. Treating providers as cheap**
Every library lets you create a new provider/client per call. Don't. Provider objects do connection pooling, caching, and chain detection. Create them once at app startup, not per-component. In React, put them in context or a top-level singleton.

**5. Assuming web3.js is "fine for legacy"**
web3.js v4 has had multiple breaking changes and the typing is inconsistent. If you're touching a web3.js codebase in 2026, the right move is usually a planned migration, not "leave it alone." It's the library most likely to surprise you with deprecations.

---

## How This Connects to Production

Library choice cascades through your stack. wagmi v2 (the React hooks library) was rewritten on top of viem and dropped ethers as a dependency. RainbowKit, ConnectKit, and most modern wallet UI libraries assume viem now. The Foundry team builds tools that emit ABIs viem can consume directly. If you're starting a new dApp, picking ethers means you're swimming against the current of where new tooling is going.

For existing apps, the calculation is different. A working ethers v6 codebase isn't a problem to be solved — it's a stable foundation. Migration makes sense when you're already touching the file (rewrites, major features) or when bundle size is hurting your conversion metrics. A pure "we should be on viem" rewrite is rarely worth the engineering time on its own.

---

## What to Learn Next

- **wagmi v2 + Viem: Hooks, Connectors, and Type Safety** — once you've picked viem, the React hook layer (wagmi) is what you'll actually build dApps with day-to-day.
- **Reading Contract State: Multicall, Caching, and Subscriptions** — picking the library is step one; using it efficiently when you have 20 contract reads on one page is step two.
- **Sending Transactions: UX Patterns for Pending, Mined, and Reverted States** — write paths have a completely different set of problems than reads.
