---
title: "I Got My First Audit. Here's What I Actually Learned."
date: 2024-07-11
tags: [security, audit, solidity, defi, production]
---

I paid for my first professional smart contract audit last month. It was for a protocol I've been building for about six months — a yield aggregator that moves funds between lending protocols to maximize returns.

The audit cost $18,000 and took two weeks. I want to write honestly about what the process was like, what they found, and what I'd do differently.

## What I submitted

Before the audit, I thought my code was in pretty good shape. I had:
- 94% test coverage (Foundry)
- Slither passing with no high-severity findings
- Echidna invariant tests for the core math
- A threat model document
- NatSpec comments on all public functions

I felt prepared. I was not as prepared as I thought.

## What they found

The audit firm (a mid-tier firm, not Trail of Bits — I couldn't afford Trail of Bits) found 2 medium findings, 4 low findings, and 8 informational findings.

No criticals or highs. That was a relief. But the mediums were things I genuinely hadn't thought of.

**Medium 1: Donation attack on the share price**

My yield aggregator used a share-based accounting model (like Compound's cTokens). The share price is calculated as `totalAssets / totalShares`. 

The auditor pointed out that if someone donates tokens directly to the contract (not through the deposit function), they inflate `totalAssets` without minting shares. This inflates the share price, which means existing depositors get a windfall at the expense of new depositors who get fewer shares for their deposit.

This is a known attack vector — ERC-4626 vaults have the same issue. The fix is to track `totalAssets` internally rather than reading the contract's token balance directly.

```solidity
// VULNERABLE: reads actual token balance
function totalAssets() public view returns (uint256) {
    return token.balanceOf(address(this));
}

// FIXED: tracks internally
uint256 private _totalAssets;

function totalAssets() public view returns (uint256) {
    return _totalAssets;
}

function deposit(uint256 amount) external {
    // ...
    _totalAssets += amount; // track explicitly
}
```

I had read about donation attacks. I thought I'd protected against them. I hadn't.

**Medium 2: Slippage on strategy rebalancing**

When my aggregator moves funds between protocols (e.g., from Aave to Compound because Compound's rate is higher), it withdraws from one and deposits to another. The auditor pointed out that between the withdrawal and the deposit, the rates could change — and there was no slippage protection.

In a worst case, a sandwich attack could manipulate the rates to make the rebalancing unprofitable, effectively stealing value from depositors.

The fix: add a minimum expected yield improvement parameter to the rebalance function, and revert if the actual improvement is below the threshold.

## What I learned about the audit process

**The auditors found things Slither didn't.** Slither is great for pattern-based vulnerabilities — reentrancy, integer overflow, access control. It's not good at finding economic vulnerabilities that require understanding your specific protocol's logic. The donation attack and slippage issues required a human who understood what the protocol was trying to do.

**The informational findings were actually valuable.** I almost dismissed them as "just style issues." But several of them pointed to code that was technically correct but confusing — the kind of thing that would make a future auditor (or me, six months from now) misread the intent. I fixed most of them.

**The back-and-forth was the most valuable part.** The audit firm had a Telegram group where I could ask questions and they could ask me questions. Several of the findings were resolved through discussion — I explained my intent, they explained their concern, we found a better solution together. That dialogue was worth a significant portion of the cost.

**I should have submitted earlier.** I spent two months polishing the code before submitting for audit. In retrospect, I should have submitted earlier and used the audit findings to guide the final polish. The auditors found issues that my polishing didn't address.

## What I'd do differently

**Run Echidna specifically for economic invariants.** I had Echidna tests for mathematical invariants (total shares never exceed total assets, etc.) but not for economic invariants (share price can only increase, rebalancing always improves yield). The donation attack would have been caught by an Echidna property like:

```solidity
function echidna_share_price_only_increases() public returns (bool) {
    uint256 sharePriceBefore = totalAssets() * 1e18 / totalShares();
    // ... simulate a donation
    uint256 sharePriceAfter = totalAssets() * 1e18 / totalShares();
    return sharePriceAfter >= sharePriceBefore;
}
```

**Read more audit reports before writing code.** I read audit reports after the fact to learn from them. I should read them before writing similar code to learn what to avoid.

**Budget for a re-audit.** After fixing the findings, I wanted a re-audit to verify the fixes were correct. I hadn't budgeted for this. The firm offered a re-audit of the changed code for $3,000, which I paid. It was worth it — they found one issue with my fix for the donation attack (I'd introduced a rounding error).

## The broader lesson

Getting audited is humbling. You think you've thought of everything. You haven't. That's not a failure — it's the point of the audit.

The $18,000 was the best money I've spent on this project. Not because the findings were catastrophic (they weren't), but because I now have significantly more confidence in the code. And I learned things that will make every contract I write in the future better.

If you're building anything with real value and you haven't been audited, you should be. The cost of an audit is a fraction of the cost of an exploit.

---

*The protocol is live on Arbitrum. I'll share the audit report publicly once I've had a chance to write a proper summary of the findings and fixes. Transparency matters.*
