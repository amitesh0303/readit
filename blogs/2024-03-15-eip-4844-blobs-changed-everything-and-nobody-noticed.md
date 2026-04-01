---
title: "EIP-4844 Dropped and L2 Fees Fell Off a Cliff. Here's What Actually Happened."
date: 2024-03-15
tags: [ethereum, eip-4844, blobs, l2, arbitrum, optimism]
---

The Dencun upgrade went live on March 13th. I've been watching L2 fees for the past two days and the numbers are wild.

Before Dencun: a swap on Arbitrum cost ~$0.15-0.50.
After Dencun: the same swap costs ~$0.01-0.05.

That's a 10-20x reduction. In two days.

I want to explain what actually happened here, because most of the coverage I've seen either oversimplifies it or gets the technical details wrong.

## What EIP-4844 actually did

Before Dencun, L2s posted their transaction data to Ethereum as "calldata" — the same data field used for regular contract calls. Calldata costs 16 gas per non-zero byte and 4 gas per zero byte. For a rollup posting hundreds of kilobytes of compressed transaction data, this was the dominant cost.

EIP-4844 introduced a new transaction type with "blobs" — a separate data field specifically for rollup data. Blobs have their own fee market, separate from the regular gas market. The target is 3 blobs per block, each blob is 128KB.

The key difference: blob data is not accessible to the EVM. Contracts can't read blob data. It's only available for a short window (~18 days) before being pruned. This is fine for rollups — they only need the data to be available long enough for fraud proofs or validity proofs to be submitted.

Because blob data is separate from the regular gas market and has its own pricing, it's dramatically cheaper. The blob base fee started near zero after the upgrade and has stayed low because demand hasn't caught up with supply yet.

## Why this matters for developers

If you're building on an L2, your users just got a massive fee reduction without you doing anything. That's the good news.

The nuance: the fee reduction is on the L1 data posting cost, not the L2 execution cost. If your contract is computationally expensive (lots of storage reads/writes, complex math), the L2 execution cost is still the same. The savings are most dramatic for simple transactions with lots of calldata.

For my lending protocol on Arbitrum:
- Deposit (simple, small calldata): ~$0.08 → ~$0.01
- Complex liquidation (lots of calldata): ~$0.40 → ~$0.05

Both improved significantly. The complex transaction improved more in absolute terms.

## The blob fee market is new and will change

Right now, blob fees are essentially zero because there's very little demand. As more rollups adopt blobs and as L2 usage grows, blob fees will increase. The EIP-4844 design has a target of 3 blobs per block — if demand consistently exceeds that, the blob base fee will rise.

We're in an early period where the supply of blob space far exceeds demand. That won't last forever. But even when blob fees normalize, they should remain significantly cheaper than calldata because of the separate fee market and the pruning mechanism.

## What I changed in my code

Honestly, nothing. The fee reduction happened automatically because Arbitrum updated their sequencer to use blobs for L1 data posting. I didn't have to change any contracts or frontend code.

But it made me think about how I'm estimating fees for users. My fee estimation code was using historical gas costs as a baseline. Those baselines are now wrong — they're 10x too high. I updated my fee display to use real-time estimates rather than historical averages.

```typescript
// Before: using historical average as baseline
const estimatedFee = HISTORICAL_AVERAGE_FEE_USD;

// After: real-time estimate from the network
const feeData = await provider.getFeeData();
const gasEstimate = await contract.myFunction.estimateGas(...args);
const feeInEth = gasEstimate * (feeData.maxFeePerGas ?? 0n);
const feeInUsd = Number(ethers.formatEther(feeInEth)) * ethPrice;
```

## The broader picture

EIP-4844 is a stepping stone to "full danksharding" — the long-term Ethereum scaling roadmap where the number of blobs per block increases dramatically. The current 3 blobs per block is just the beginning.

The roadmap:
- EIP-4844 (now): 3 blobs/block, ~0.375 MB/block of rollup data
- Full danksharding (future): 64+ blobs/block, ~8 MB/block of rollup data

If full danksharding ships, L2 fees could drop another 10-20x from current levels. We're talking about transactions that cost fractions of a cent.

That changes what's possible to build. Protocols that were economically unviable on Ethereum mainnet (high-frequency trading, micropayments, gaming) become viable on L2s. The design space expands.

## My honest reaction

I've been in this space for about a year. I've seen a lot of "this changes everything" announcements that turned out to be incremental improvements.

This one actually changed something. The fee reduction is real, it happened immediately, and it's not going away. Users who were priced out of DeFi by gas costs can now participate.

That's not nothing. That's the whole point.

---

*I'm going to write a more technical post about how blob transactions work under the hood — the KZG commitments, the data availability sampling, the pruning mechanism. It's genuinely interesting cryptography and I want to understand it properly before writing about it.*
