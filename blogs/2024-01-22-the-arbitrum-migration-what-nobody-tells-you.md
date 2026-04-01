---
title: "The Arbitrum Migration: What Nobody Tells You"
date: 2024-01-22
tags: [arbitrum, l2, ethereum, deployment, gas]
---

I spent the last two months migrating my lending protocol from Ethereum mainnet to Arbitrum. The migration itself was straightforward — Arbitrum is EVM-compatible, so the contracts deployed without changes. But "EVM-compatible" hides a lot of nuance that bit me in production.

Here's what I actually ran into.

## block.number is not what you think

This one got me immediately.

My vesting contract used `block.number` to calculate how much had vested. On Ethereum, blocks are ~12 seconds apart. On Arbitrum, blocks are ~250 milliseconds apart. So `block.number + 1000` means "about 4 minutes from now" on Ethereum and "about 4 minutes from now" on Arbitrum — wait, no. It means "about 4 minutes" on Ethereum and "about 4 minutes" on Arbitrum too, but only because the block times are different.

Actually the problem is the opposite: if you're using block numbers as a proxy for time, the same number of blocks represents much less time on Arbitrum. A vesting schedule that releases tokens over "100,000 blocks" would release in about 14 days on Ethereum and about 7 hours on Arbitrum.

The fix is simple: use `block.timestamp` instead of `block.number` for anything time-related. Timestamps work the same way on both chains.

```solidity
// WRONG for cross-chain use
uint256 vestingEnd = startBlock + 100_000;

// RIGHT — works on any EVM chain
uint256 vestingEnd = startTime + 30 days;
```

I caught this before it caused problems, but only because I was specifically looking for it after reading the Arbitrum docs. If I'd just deployed and assumed "EVM-compatible means identical," I would have had a broken vesting schedule.

## Gas estimation is different

On Ethereum, `provider.estimateGas()` gives you a pretty accurate estimate of what a transaction will cost. On Arbitrum, it gives you the L2 execution gas — but there's also an L1 data fee that gets added on top.

The L1 data fee depends on the size of your transaction data and the current Ethereum base fee. For a simple transfer it's small. For a complex DeFi transaction with lots of calldata, it can be the dominant cost.

```typescript
// On Ethereum: this is the full cost
const gasEstimate = await provider.estimateGas(tx);

// On Arbitrum: this is only the L2 execution cost
// You also need to account for L1 data fee
const gasEstimate = await provider.estimateGas(tx);

// To get the full picture on Arbitrum:
const nodeInterface = new ethers.Contract(
  "0x00000000000000000000000000000000000000C8",
  ["function gasEstimateL1Component(address to, bool contractCreation, bytes calldata data) view returns (uint64, uint256, uint256)"],
  provider
);
const [l1Gas] = await nodeInterface.gasEstimateL1Component(to, false, data);
// total cost = (gasEstimate + l1Gas) * gasPrice
```

For my frontend, I ended up just adding a 30% buffer to the gas estimate and letting users see the actual cost in their wallet. Not elegant, but it works.

## The sequencer is a single point of failure

Arbitrum's sequencer is currently centralized — run by Offchain Labs. It's been reliable in my experience, but it has had downtime. When the sequencer is down, transactions don't go through.

For my lending protocol, this means liquidations can't happen during sequencer downtime. That's a real risk. If the market moves sharply during a sequencer outage, positions that should be liquidated won't be, and the protocol could accumulate bad debt.

The mitigation: Arbitrum has a "force inclusion" mechanism where you can submit transactions directly to L1 if the sequencer is unresponsive for more than 24 hours. But that's a long time in a volatile market.

I added a circuit breaker to my protocol that pauses new borrows if the last successful transaction was more than 30 minutes ago. It's a blunt instrument but it reduces the risk of bad debt accumulating during an outage.

## The 7-day withdrawal delay is real and users hate it

When users want to withdraw from Arbitrum to Ethereum mainnet using the native bridge, it takes 7 days. This is the challenge period for the optimistic rollup — anyone can submit a fraud proof during this window.

Users don't understand this. They see "withdraw to Ethereum" and expect it to take a few minutes. When they find out it takes a week, they're frustrated.

The solution most protocols use: integrate a third-party bridge (Hop Protocol, Across, Stargate) that provides instant liquidity for a small fee. I added a "Fast Withdraw" option that routes through Hop and a "Native Withdraw" option that uses the Arbitrum bridge.

```typescript
// Show users the tradeoff clearly
const withdrawOptions = [
  {
    label: "Fast Withdraw (Hop Protocol)",
    time: "~5 minutes",
    fee: "0.1% + gas",
    recommended: true,
  },
  {
    label: "Native Bridge",
    time: "7 days",
    fee: "Gas only",
    recommended: false,
  },
];
```

## What actually went well

The gas costs are dramatically lower. A deposit that cost $8 on Ethereum mainnet costs $0.15 on Arbitrum. That's a 50x reduction. Users notice this immediately and it changes how they interact with the protocol — they're willing to make smaller, more frequent transactions.

The EVM compatibility is genuinely good. My contracts deployed without any changes. The Hardhat and Foundry tooling works identically. Etherscan (Arbiscan) works the same way. The developer experience is essentially identical to Ethereum mainnet.

The ecosystem is mature. Uniswap, Aave, Chainlink — they're all on Arbitrum. I can compose with them the same way I would on mainnet.

## Would I do it again?

Yes, without hesitation. The gas cost reduction alone makes it worth it for any protocol where users make frequent transactions. The tradeoffs (sequencer centralization, withdrawal delay) are real but manageable.

The main thing I'd do differently: read the Arbitrum developer docs more carefully before deploying, specifically the sections on `block.number` behavior and gas estimation. Those two things would have saved me a few hours of debugging.

---

*I'm planning to write a more detailed post about the Arbitrum-specific Solidity patterns I've adopted. The `block.number` issue is just one of several subtle differences that matter in production.*
