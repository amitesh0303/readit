# How AMMs Work: The Math Behind Uniswap's x*y=k

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You've used Uniswap. You've seen the "price impact" warning when you try to swap a large amount. You know there's "liquidity" involved. But if someone asks you to explain how the price is actually calculated, or why large trades have worse prices, you're not sure where to start.

Understanding AMM math isn't just academic — it's essential for building DeFi protocols. If you're integrating with Uniswap, building a DEX aggregator, writing a liquidation bot, or designing a new AMM, you need to understand the constant product formula at a deep level. This blog takes you from the basic equation to the full swap calculation with code.

---

## Core Concepts

### The Problem AMMs Solve

Traditional exchanges use order books: buyers post bids, sellers post asks, trades happen when they match. This works well with many active market makers. But on-chain, market making is expensive (every order update costs gas) and slow (block times are 12 seconds).

AMMs replace the order book with a mathematical formula. Instead of matching buyers and sellers, you trade against a liquidity pool. The formula determines the price automatically based on the ratio of assets in the pool.

### The Constant Product Formula: x * y = k

Uniswap V2's formula is elegantly simple:

```
x = reserve of token A
y = reserve of token B
k = constant (invariant)

x * y = k must hold after every trade
```

When you swap token A for token B:
- You add `Δx` of token A to the pool
- The pool gives you `Δy` of token B
- The new reserves must satisfy: `(x + Δx) * (y - Δy) = k`

Solving for `Δy`:
```
(x + Δx) * (y - Δy) = x * y
y - Δy = (x * y) / (x + Δx)
Δy = y - (x * y) / (x + Δx)
Δy = (y * Δx) / (x + Δx)
```

This is the core swap formula. Let's trace through an example:

```
Pool: 1,000 ETH / 2,000,000 USDC
k = 1,000 * 2,000,000 = 2,000,000,000

Current price: 2,000,000 / 1,000 = $2,000 per ETH

You want to buy ETH with 10,000 USDC:
Δx = 10,000 USDC (you're adding USDC)
Δy = (1,000 * 10,000) / (2,000,000 + 10,000)
   = 10,000,000 / 2,010,000
   = 4.975 ETH

Effective price: 10,000 / 4.975 = $2,010 per ETH
Price impact: ($2,010 - $2,000) / $2,000 = 0.5%

New pool: 995.025 ETH / 2,010,000 USDC
New price: 2,010,000 / 995.025 = $2,020 per ETH
```

The price moved from $2,000 to $2,020 after your trade. This is price impact — larger trades move the price more.

### Why Price Impact Scales Non-Linearly

The constant product curve is a hyperbola. As you buy more of one asset, the price increases at an accelerating rate:

```
Buying 1% of pool reserves: ~1% price impact
Buying 10% of pool reserves: ~11% price impact
Buying 50% of pool reserves: ~100% price impact (price doubles)
```

This is why large trades are expensive on low-liquidity pools, and why deep liquidity matters for a good trading experience.

### The Fee Mechanism

Uniswap V2 charges a 0.3% fee on every swap. The fee stays in the pool, increasing `k` slightly with each trade. This is how LPs earn yield.

With fee:
```
Effective input = Δx * (1 - fee) = Δx * 0.997

Δy = (y * Δx * 0.997) / (x + Δx * 0.997)
```

The fee is taken from the input token before the swap calculation. This means:
- You pay 0.3% on every swap
- The fee increases the pool's reserves
- LPs' share of the pool grows over time

### Uniswap V3: Concentrated Liquidity

V2 spreads liquidity across all prices from 0 to ∞. Most of that liquidity is never used (ETH/USDC liquidity at $1 or $1,000,000 is useless when ETH trades at $2,000).

V3 lets LPs concentrate liquidity in a specific price range. This makes capital much more efficient:

```
V2: $1M liquidity spread from $0 to ∞
    → Effective liquidity at $2,000: ~$1,000

V3: $1M liquidity concentrated from $1,800 to $2,200
    → Effective liquidity at $2,000: ~$50,000
    → 50x more capital efficient
```

The math becomes more complex — V3 uses virtual reserves and tick-based liquidity tracking. But the core constant product formula still applies within each price range.

---

## Code Walkthrough

A complete Uniswap V2-style AMM implementation:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ConstantProductAMM
 * @notice Uniswap V2-style AMM with constant product formula.
 * Demonstrates: swap math, fee mechanism, LP token minting, price calculation.
 */
contract ConstantProductAMM {
    // ─── State ─────────────────────────────────────────────────────────────

    address public immutable token0;
    address public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    // LP token tracking (simplified — in production, use ERC-20)
    mapping(address => uint256) public lpBalance;
    uint256 public totalLpSupply;

    uint256 public constant FEE_NUMERATOR = 997;   // 0.3% fee
    uint256 public constant FEE_DENOMINATOR = 1000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000; // prevent price manipulation on first deposit

    // ─── Events ────────────────────────────────────────────────────────────

    event Swap(
        address indexed trader,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 lpBurned);

    constructor(address _token0, address _token1) {
        require(_token0 < _token1, "Token order"); // canonical ordering
        token0 = _token0;
        token1 = _token1;
    }

    // ─── Core AMM Functions ────────────────────────────────────────────────

    /**
     * @notice Swap tokenIn for tokenOut.
     * @param tokenIn Address of input token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum acceptable output (slippage protection)
     * @return amountOut Actual output amount
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");
        require(amountIn > 0, "Zero input");

        bool isToken0In = tokenIn == token0;
        (uint256 reserveIn, uint256 reserveOut) = isToken0In
            ? (reserve0, reserve1)
            : (reserve1, reserve0);

        // Apply fee to input: effectiveInput = amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;

        // Constant product formula: amountOut = reserveOut * amountInWithFee / (reserveIn * 1000 + amountInWithFee)
        // Note: multiply by 1000 to account for the fee denominator
        amountOut = (reserveOut * amountInWithFee) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);

        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut < reserveOut, "Insufficient liquidity");

        // Update reserves
        if (isToken0In) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }

        // Transfer tokens (simplified — assume ERC-20 transfers happen)
        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    /**
     * @notice Add liquidity to the pool.
     * @dev Must add tokens in the current ratio to avoid price manipulation.
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum token0 (slippage protection)
     * @param amount1Min Minimum token1 (slippage protection)
     */
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 amount0, uint256 amount1, uint256 lpMinted) {
        if (reserve0 == 0 && reserve1 == 0) {
            // First liquidity provision — set initial price
            amount0 = amount0Desired;
            amount1 = amount1Desired;
        } else {
            // Calculate optimal amounts to maintain current price ratio
            uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "Insufficient token1");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
                require(amount0Optimal >= amount0Min, "Insufficient token0");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
        }

        // Calculate LP tokens to mint
        if (totalLpSupply == 0) {
            // Geometric mean of initial deposits, minus minimum liquidity (locked forever)
            lpMinted = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            lpBalance[address(0)] = MINIMUM_LIQUIDITY; // lock minimum liquidity
        } else {
            // Proportional to existing pool
            lpMinted = _min(
                (amount0 * totalLpSupply) / reserve0,
                (amount1 * totalLpSupply) / reserve1
            );
        }

        require(lpMinted > 0, "Insufficient liquidity minted");

        lpBalance[msg.sender] += lpMinted;
        totalLpSupply += lpMinted;
        reserve0 += amount0;
        reserve1 += amount1;

        emit LiquidityAdded(msg.sender, amount0, amount1, lpMinted);
    }

    /**
     * @notice Remove liquidity from the pool.
     * @param lpAmount LP tokens to burn
     * @param amount0Min Minimum token0 to receive
     * @param amount1Min Minimum token1 to receive
     */
    function removeLiquidity(
        uint256 lpAmount,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 amount0, uint256 amount1) {
        require(lpBalance[msg.sender] >= lpAmount, "Insufficient LP");

        // Proportional share of reserves
        amount0 = (lpAmount * reserve0) / totalLpSupply;
        amount1 = (lpAmount * reserve1) / totalLpSupply;

        require(amount0 >= amount0Min, "Insufficient token0");
        require(amount1 >= amount1Min, "Insufficient token1");

        lpBalance[msg.sender] -= lpAmount;
        totalLpSupply -= lpAmount;
        reserve0 -= amount0;
        reserve1 -= amount1;

        emit LiquidityRemoved(msg.sender, amount0, amount1, lpAmount);
    }

    // ─── View Functions ────────────────────────────────────────────────────

    /**
     * @notice Get the current spot price of token0 in terms of token1.
     * @dev This is the marginal price — the price for an infinitesimally small trade.
     *      Actual trade price will be worse due to price impact.
     */
    function getSpotPrice() external view returns (uint256) {
        require(reserve0 > 0, "No liquidity");
        return (reserve1 * 1e18) / reserve0; // price in 1e18 precision
    }

    /**
     * @notice Calculate output for a given input (includes fee).
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        require(amountIn > 0, "Zero input");
        require(reserveIn > 0 && reserveOut > 0, "No liquidity");
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        return (reserveOut * amountInWithFee) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    /**
     * @notice Calculate price impact for a given trade size.
     * @return impact Price impact in basis points (100 = 1%)
     */
    function getPriceImpact(uint256 amountIn, bool isToken0In)
        external view returns (uint256 impact)
    {
        (uint256 reserveIn, uint256 reserveOut) = isToken0In
            ? (reserve0, reserve1)
            : (reserve1, reserve0);

        uint256 spotPrice = (reserveOut * 1e18) / reserveIn;
        uint256 amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        uint256 executionPrice = (amountOut * 1e18) / amountIn;

        // Impact = (spotPrice - executionPrice) / spotPrice
        if (spotPrice > executionPrice) {
            impact = ((spotPrice - executionPrice) * 10000) / spotPrice;
        }
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
```

TypeScript helper for calculating swap amounts off-chain (useful for frontends):

```typescript
// Replicate the AMM math off-chain for price quotes
function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint = 30n // 0.3% = 30 basis points
): bigint {
  const FEE_DENOMINATOR = 10000n;
  const amountInWithFee = amountIn * (FEE_DENOMINATOR - feeBps);
  return (reserveOut * amountInWithFee) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
}

function getPriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  const executionPrice = Number(amountOut) / Number(amountIn);
  return ((spotPrice - executionPrice) / spotPrice) * 100;
}

// Example
const reserve0 = 1000n * 10n**18n; // 1000 ETH
const reserve1 = 2000000n * 10n**6n; // 2M USDC (6 decimals)
const amountIn = 10n * 10n**6n; // 10,000 USDC

const amountOut = getAmountOut(amountIn, reserve1, reserve0);
console.log("ETH out:", Number(amountOut) / 1e18); // ~4.975 ETH
console.log("Price impact:", getPriceImpact(amountIn, reserve1, reserve0).toFixed(2) + "%");
```

---

## Common Mistakes and Gotchas

**1. Using spot price for trade execution**  
The spot price (`reserve1/reserve0`) is the marginal price for an infinitesimally small trade. Any real trade will execute at a worse price due to price impact. Never use spot price to calculate expected output — always use `getAmountOut`.

**2. Not setting slippage tolerance**  
Between when you calculate the expected output and when your transaction is included, the pool state can change (other trades, sandwich attacks). Always set `minAmountOut` to protect against excessive slippage. Uniswap's default is 0.5%, but you can set it higher or lower.

**3. Forgetting that LP tokens represent a share, not a fixed amount**  
When you add liquidity, you get LP tokens representing your share of the pool. If the pool earns fees, your LP tokens are worth more. If the pool suffers impermanent loss, they're worth less. LP tokens are not equivalent to the underlying assets.

**4. Ignoring the minimum liquidity lock**  
Uniswap V2 permanently locks `MINIMUM_LIQUIDITY` (1000) LP tokens to `address(0)` on the first deposit. This prevents the pool from being completely drained and the price being set to an arbitrary value. If you're implementing your own AMM, don't skip this.

**5. Precision loss in integer arithmetic**  
AMM math involves division, which truncates in integer arithmetic. The order of operations matters: `(a * b) / c` is more precise than `a * (b / c)`. Always multiply before dividing to minimize precision loss.

---

## How This Connects to Production

Uniswap V2's constant product formula is the foundation of most DeFi. Sushiswap is a fork of V2. PancakeSwap on BSC is a fork of V2. Curve uses a different formula (constant sum + constant product hybrid) optimized for stablecoin swaps. Balancer generalizes the formula to support pools with more than 2 assets and custom weights. Uniswap V3 uses concentrated liquidity but the same constant product formula within each tick range. 1inch and Paraswap are aggregators that route trades across multiple AMMs to minimize price impact. Understanding the constant product formula is the prerequisite for understanding all of them.

---

## What to Learn Next

- **Constant Product vs Constant Sum Market Makers: Tradeoffs** — understand why Curve uses a different formula for stablecoins.
- **Liquidity Pools, Impermanent Loss, and LP Token Mechanics** — understand the risk/reward of providing liquidity.
- **Flash Loans: How They Work and How They're Exploited** — see how AMM price manipulation via flash loans works.
