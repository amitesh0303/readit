---
title: "I Deployed to Mainnet and Immediately Found a Bug (Here's What I Did)"
date: 2023-08-29
tags: [solidity, mainnet, debugging, gas, production]
---

I deployed my lending protocol to Ethereum mainnet on August 15th. By August 16th I had found a bug.

Not a critical bug — no funds were at risk. But a bug that made one of my functions cost 40% more gas than it should have. In a lending protocol where users interact with the contract dozens of times, that adds up.

Here's what happened, how I found it, and what I did about it.

## The bug

My `accrueInterest` function was being called at the start of every deposit, withdrawal, and borrow. That's correct — you need to update the interest index before any balance changes. The bug was in how I was reading the interest rate.

```solidity
function accrueInterest() internal {
    uint256 elapsed = block.timestamp - lastAccrualTime;
    if (elapsed == 0) return;

    // BUG: reading totalDeposits and totalBorrows from storage twice each
    // in this function AND in borrowRate() which also reads them
    uint256 rate = borrowRate(); // reads totalDeposits, totalBorrows from storage
    uint256 interest = (totalBorrows * rate * elapsed) / (365 days * 1e18);

    totalBorrows += interest;   // SSTORE
    totalDeposits += interest;  // SSTORE
    lastAccrualTime = block.timestamp; // SSTORE
}

function borrowRate() public view returns (uint256) {
    if (totalDeposits == 0) return BASE_RATE; // SLOAD
    uint256 util = (totalBorrows * 1e18) / totalDeposits; // SLOAD, SLOAD
    // ... rate calculation
}
```

`totalDeposits` and `totalBorrows` were being read from storage in `borrowRate()`, and then read again in `accrueInterest()` for the interest calculation. Four cold SLOADs at 2,100 gas each = 8,400 gas wasted per call.

The fix was straightforward — cache the values in memory:

```solidity
function accrueInterest() internal {
    uint256 elapsed = block.timestamp - lastAccrualTime;
    if (elapsed == 0) return;

    // Cache storage reads in memory — one SLOAD each
    uint256 _totalDeposits = totalDeposits;
    uint256 _totalBorrows = totalBorrows;

    uint256 rate = _borrowRate(_totalDeposits, _totalBorrows);
    uint256 interest = (_totalBorrows * rate * elapsed) / (365 days * 1e18);

    // Now write back — these are warm slots so cheaper
    totalBorrows = _totalBorrows + interest;
    totalDeposits = _totalDeposits + interest;
    lastAccrualTime = block.timestamp;
}

function _borrowRate(uint256 _totalDeposits, uint256 _totalBorrows) internal pure returns (uint256) {
    if (_totalDeposits == 0) return BASE_RATE;
    uint256 util = (_totalBorrows * 1e18) / _totalDeposits;
    // ... rate calculation
}
```

Gas per deposit went from ~95,000 to ~57,000. That's a real difference.

## How I found it

I was using Tenderly to monitor transactions after deployment. I noticed the gas usage on deposits was higher than my local tests had shown. That was the first signal.

I pulled up a transaction in Tenderly's debugger and stepped through the execution. The storage reads were visible in the trace — I could see `SLOAD` operations happening multiple times for the same slots.

If you're not using Tenderly for production monitoring, start. The free tier is enough to catch this kind of thing.

## The upgrade problem

Here's where it got interesting. My contract was deployed without a proxy pattern. It's immutable. I can't push a fix.

I had thought about this before deploying. I made a deliberate decision not to use a proxy because:
1. Proxies add complexity and their own attack surface
2. The protocol was small enough that I could redeploy if needed
3. I wanted users to be able to trust that the code wouldn't change

That decision was right for the security model. But it meant that fixing this gas bug required deploying a new contract and migrating users.

I ended up deploying v2 with the fix and writing a migration script. The TVL was small enough (this was a personal project, not a funded protocol) that I could reach out to the handful of users directly.

For a production protocol with significant TVL, this would have been a much bigger deal. The lesson: even "non-critical" bugs are expensive to fix in immutable contracts.

## What I'd do differently

**Run Foundry's gas snapshot before every deployment.** I had gas tests but I wasn't tracking them systematically. If I'd been running `forge snapshot` and comparing against a baseline, I would have caught the regression before deployment.

```bash
# Run this before every deployment
forge snapshot

# Compare against previous snapshot
forge snapshot --diff .gas-snapshot
```

**Use Slither's gas optimization detectors.** Slither has a `--detect` flag for gas-related issues. I was running it for security but not specifically for gas.

```bash
slither . --detect costly-loop,cache-array-length,storage-array
```

**Test with mainnet fork, not just local.** My local tests used a clean state. On mainnet, the storage slots were "cold" (first access in a transaction), which costs more than "warm" slots. The gas difference between cold and warm reads is significant and my local tests didn't capture it accurately.

## The broader point

Deploying to mainnet is different from deploying to testnet in ways that aren't obvious until you do it. Real users, real gas costs, real consequences for bugs. The pressure is different.

I'm glad my first mainnet bug was a gas issue and not a security issue. It was a good reminder that the work doesn't end at deployment — it starts there.

---

*The v2 contract is deployed and the migration is complete. Gas costs are where they should be. I'll write about the proxy vs immutable decision in more depth soon — it's a more nuanced tradeoff than most tutorials suggest.*
