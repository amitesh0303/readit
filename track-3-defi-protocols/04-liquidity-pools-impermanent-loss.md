# Liquidity Pools, Impermanent Loss, and LP Token Mechanics

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You provide liquidity to a Uniswap ETH/USDC pool. ETH price doubles. You check your position and realize you have less ETH than you started with — and your total position is worth less than if you'd just held ETH. You earned 0.3% in trading fees, but you lost 5.7% to something called "impermanent loss."

This is the most misunderstood concept in DeFi. LPs often don't realize they're taking on this risk until they've already lost money. This blog explains exactly what impermanent loss is, how to calculate it, when it matters, and how protocols like Uniswap V3 and Curve try to mitigate it.

---

## Core Concepts

### What Impermanent Loss Is

When you provide liquidity to an AMM, you deposit two assets in a specific ratio. As prices change, the AMM automatically rebalances your position — selling the appreciating asset and buying the depreciating one. This rebalancing is what creates impermanent loss.

The "impermanent" part: if prices return to their original ratio, the loss disappears. The "loss" part: if prices don't return, you end up with less value than if you'd just held the assets.

### The Math

Let's trace through a concrete example:

```
Initial state:
- ETH price: $2,000
- You deposit: 1 ETH + 2,000 USDC = $4,000 total
- Pool reserves: 100 ETH + 200,000 USDC
- k = 100 * 200,000 = 20,000,000
- Your share: 1% of pool

ETH price doubles to $4,000:
- Arbitrageurs buy ETH from the pool until pool price = $4,000
- New reserves: x * y = k, and y/x = 4,000
  - x = sqrt(k / 4,000) = sqrt(20,000,000 / 4,000) = sqrt(5,000) ≈ 70.71 ETH
  - y = sqrt(k * 4,000) = sqrt(20,000,000 * 4,000) = sqrt(80,000,000,000) ≈ 282,843 USDC

Your 1% share is now worth:
- 0.7071 ETH + 2,828.43 USDC
- Value: 0.7071 * $4,000 + $2,828.43 = $2,828.43 + $2,828.43 = $5,656.85

If you had just held:
- 1 ETH + 2,000 USDC
- Value: 1 * $4,000 + $2,000 = $6,000

Impermanent loss: ($6,000 - $5,656.85) / $6,000 = 5.72%
```

You earned trading fees on top of this, but if fees < 5.72%, you were better off just holding.

### The IL Formula

For a 2x price change, IL is always 5.72%. The formula:

```
IL = 2 * sqrt(price_ratio) / (1 + price_ratio) - 1

Where price_ratio = new_price / initial_price

Price doubles (ratio = 2):
IL = 2 * sqrt(2) / (1 + 2) - 1 = 2 * 1.414 / 3 - 1 = -0.0572 = -5.72%

Price 5x (ratio = 5):
IL = 2 * sqrt(5) / (1 + 5) - 1 = 2 * 2.236 / 6 - 1 = -0.254 = -25.4%

Price 10x (ratio = 10):
IL = 2 * sqrt(10) / (1 + 10) - 1 = -0.423 = -42.3%
```

IL grows with price divergence. Volatile pairs (ETH/USDC) have much higher IL risk than stable pairs (USDC/USDT).

### LP Token Mechanics

When you add liquidity, you receive LP tokens representing your share of the pool. LP tokens are ERC-20 tokens that can be transferred, used as collateral, or staked for additional rewards.

```
LP token value = (pool total value) / (total LP supply)

If pool has $10M and 1,000 LP tokens:
Each LP token = $10,000

As fees accrue:
Pool grows to $10.1M (from fees)
Each LP token = $10,100 (0.1% increase)
```

LP tokens are redeemable for the underlying assets at any time. The redemption amount reflects both the current pool ratio (which changes with price) and accumulated fees.

### Concentrated Liquidity (Uniswap V3)

V3 lets LPs specify a price range. Liquidity is only active (earning fees) when the price is within that range.

```
V2: Liquidity active from $0 to ∞
V3: Liquidity active from $1,800 to $2,200

Benefits:
- 50x more capital efficient within the range
- Higher fee earnings per dollar of liquidity

Risks:
- If price moves outside range, position becomes 100% one asset
- Higher IL within the range (more concentrated = more rebalancing)
- Requires active management (rebalancing when price moves out of range)
```

V3 positions are represented as NFTs (not fungible LP tokens) because each position has unique parameters (price range, fee tier).

---

## Code Walkthrough

IL calculator and LP position tracker:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILCalculator
 * @notice On-chain impermanent loss calculation and LP position tracking.
 * Useful for protocols that need to account for IL in their logic.
 */
contract ILCalculator {
    /**
     * @notice Calculate impermanent loss for a constant product AMM.
     * @param initialPrice0 Initial price of token0 in terms of token1 (1e18 precision)
     * @param currentPrice0 Current price of token0 in terms of token1 (1e18 precision)
     * @return ilBps Impermanent loss in basis points (negative = loss)
     *         e.g., -572 means 5.72% loss
     */
    function calculateIL(
        uint256 initialPrice0,
        uint256 currentPrice0
    ) external pure returns (int256 ilBps) {
        // price_ratio = currentPrice / initialPrice (in 1e18)
        uint256 priceRatio = (currentPrice0 * 1e18) / initialPrice0;

        // IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
        // Using integer sqrt approximation
        uint256 sqrtRatio = _sqrt(priceRatio * 1e18); // sqrt in 1e9 precision

        // numerator = 2 * sqrtRatio (in 1e9)
        // denominator = 1e18 + priceRatio (in 1e18)
        // IL = numerator/denominator - 1

        uint256 numerator = 2 * sqrtRatio * 1e9; // scale to 1e18
        uint256 denominator = 1e18 + priceRatio;

        // IL in 1e18 precision
        int256 ilRaw = int256(numerator / denominator) - 1e18;

        // Convert to basis points (1e18 = 10000 bps)
        ilBps = (ilRaw * 10000) / 1e18;
    }

    /**
     * @notice Calculate LP position value accounting for IL.
     * @param initialValue Initial USD value of the LP position
     * @param priceRatio Current/initial price ratio (1e18 precision)
     * @return currentValue Current value of the LP position
     * @return holdValue Value if assets were just held (no LP)
     */
    function lpVsHold(
        uint256 initialValue,
        uint256 priceRatio
    ) external pure returns (uint256 currentValue, uint256 holdValue) {
        // LP value = initialValue * 2 * sqrt(priceRatio) / (1 + priceRatio)
        uint256 sqrtRatio = _sqrt(priceRatio * 1e18);
        currentValue = (initialValue * 2 * sqrtRatio) / (1e18 + priceRatio);

        // Hold value: 50% in each asset initially
        // holdValue = initialValue * (1 + priceRatio) / 2
        holdValue = (initialValue * (1e18 + priceRatio)) / (2 * 1e18);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) {
            z = 1;
        }
    }
}
```

TypeScript LP position tracker for a frontend:

```typescript
interface LPPosition {
  token0Amount: number;
  token1Amount: number;
  lpTokens: number;
  entryPrice: number; // token0 price in token1 at entry
  entryTimestamp: number;
}

interface PoolState {
  reserve0: number;
  reserve1: number;
  totalLpSupply: number;
  feesAccrued0: number;
  feesAccrued1: number;
}

function calculateLPReturns(position: LPPosition, pool: PoolState) {
  const currentPrice = pool.reserve1 / pool.reserve0;
  const priceRatio = currentPrice / position.entryPrice;

  // Current position value (LP share of pool)
  const lpShare = position.lpTokens / pool.totalLpSupply;
  const currentToken0 = pool.reserve0 * lpShare;
  const currentToken1 = pool.reserve1 * lpShare;
  const currentValue = currentToken0 * currentPrice + currentToken1;

  // Hold value (if assets were just held)
  const holdValue =
    position.token0Amount * currentPrice + position.token1Amount;

  // Impermanent loss
  const ilPercent = ((currentValue - holdValue) / holdValue) * 100;

  // Fee earnings (simplified — assumes fees are already in reserves)
  const feeEarnings0 = pool.feesAccrued0 * lpShare;
  const feeEarnings1 = pool.feesAccrued1 * lpShare;
  const feeValue = feeEarnings0 * currentPrice + feeEarnings1;

  // Net P&L
  const netPnL = currentValue - (position.token0Amount * position.entryPrice + position.token1Amount);
  const netPnLPercent = (netPnL / (position.token0Amount * position.entryPrice + position.token1Amount)) * 100;

  return {
    currentToken0,
    currentToken1,
    currentValue,
    holdValue,
    ilPercent,
    feeValue,
    netPnL,
    netPnLPercent,
    priceRatio,
  };
}

// Example
const position: LPPosition = {
  token0Amount: 1,      // 1 ETH
  token1Amount: 2000,   // 2000 USDC
  lpTokens: 100,
  entryPrice: 2000,     // ETH was $2000 at entry
  entryTimestamp: Date.now(),
};

const pool: PoolState = {
  reserve0: 100,        // 100 ETH
  reserve1: 400000,     // 400,000 USDC (ETH now $4000)
  totalLpSupply: 10000,
  feesAccrued0: 0.5,    // 0.5 ETH in fees
  feesAccrued1: 1000,   // 1000 USDC in fees
};

const returns = calculateLPReturns(position, pool);
console.log(`IL: ${returns.ilPercent.toFixed(2)}%`);        // -5.72%
console.log(`Fee earnings: $${returns.feeValue.toFixed(2)}`);
console.log(`Net P&L: ${returns.netPnLPercent.toFixed(2)}%`);
```

---

## Common Mistakes and Gotchas

**1. Thinking "impermanent" means it always goes away**  
IL is only impermanent if prices return to their original ratio. If ETH goes from $2,000 to $4,000 and stays there, your IL is permanent. The name is misleading — think of it as "divergence loss."

**2. Ignoring IL when calculating LP APY**  
Many yield dashboards show "APY" that only includes fee earnings, not IL. A pool showing 20% APY in fees might have -25% IL, giving you a net -5% return. Always calculate net returns including IL.

**3. Providing liquidity to low-volume pools**  
IL is a cost you pay regardless of volume. Fees are earned proportional to volume. A pool with high IL risk (volatile pair) and low volume is a bad deal for LPs. High volume + high IL risk can still be profitable if fees outweigh IL.

**4. Not understanding V3 range management**  
In Uniswap V3, if the price moves outside your range, your position stops earning fees and becomes 100% one asset. You need to actively monitor and rebalance. Many LPs set ranges and forget them, then wonder why they're not earning fees.

**5. Confusing LP token price with underlying asset price**  
LP token price increases as fees accrue, but it also changes as the pool ratio changes. An LP token in an ETH/USDC pool doesn't track ETH price — it tracks a combination of ETH and USDC. Don't use LP token price as a proxy for either underlying asset.

---

## How This Connects to Production

Uniswap V3's concentrated liquidity was specifically designed to improve LP capital efficiency while acknowledging the IL tradeoff. Gamma Strategies and Arrakis Finance are protocols that actively manage V3 positions to minimize IL and maximize fee earnings. Curve's StableSwap formula dramatically reduces IL for pegged assets — this is why Curve LPs earn lower fees (0.04% vs 0.3%) but still profit because IL is near zero. Tokemak was designed to solve the LP capital problem by providing "liquidity as a service" — protocols pay for liquidity instead of relying on mercenary LPs. Understanding IL is essential for any protocol that relies on DEX liquidity, because it determines whether LPs will actually provide that liquidity.

---

## What to Learn Next

- **How DeFi Lending Works: Collateral, Health Factor, and Liquidations** — the other major DeFi primitive.
- **Token Vesting and Staking Contracts: Architecture and Patterns** — build incentive systems that attract and retain liquidity.
- **Flash Loans: How They Work and How They're Exploited** — understand how flash loans interact with AMM liquidity.
