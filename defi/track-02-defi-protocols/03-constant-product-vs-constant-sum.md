# Constant Product vs Constant Sum Market Makers: Tradeoffs

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You're building a stablecoin DEX. You implement Uniswap's x*y=k formula and deploy it. Users try to swap 1 USDC for 1 USDT and get 0.9985 USDT back — a 0.15% price impact on a trade between two assets that should be worth exactly the same. Your users are furious.

The constant product formula is not the right tool for every job. Curve Finance solved this problem and now processes billions in stablecoin volume daily with near-zero price impact. Understanding why requires understanding the geometry of different AMM invariants. This blog explains the tradeoffs between constant product, constant sum, and hybrid formulas.

---

## Core Concepts

### The Geometry of AMM Invariants

Every AMM is defined by an invariant — a mathematical relationship between reserves that must hold after every trade. The shape of this curve determines the AMM's behavior.

**Constant Sum: x + y = k**

```
y
│
│\
│  \
│    \
│      \
│        \
└──────────── x
```

A straight line. The price is always 1:1 regardless of trade size. Perfect for pegged assets... until one side runs out. If you have a USDC/USDT pool with constant sum and someone buys all the USDT, the pool is empty. No more USDT to sell. The pool breaks.

**Constant Product: x * y = k**

```
y
│
│\
│ \
│  \
│   \
│    ──────
└──────────── x
```

A hyperbola. Price adjusts with every trade. Never runs out of either asset (asymptotically approaches zero). But price impact is high for large trades relative to pool size.

**Curve's StableSwap: Hybrid**

```
y
│
│\
│ \___________
│             \
│              \
└──────────────── x
```

Flat in the middle (like constant sum), curved at the edges (like constant product). Near-zero price impact for trades near the peg, but still has reserves at extreme prices.

### The StableSwap Invariant

Curve's formula combines both:

```
A * n^n * Σxi + D = A * D * n^n + D^(n+1) / (n^n * Πxi)

Where:
- A = amplification coefficient (controls how "flat" the curve is)
- n = number of assets in the pool
- xi = reserve of asset i
- D = total value of all assets when they're equal
```

For a 2-asset pool (n=2), this simplifies to:

```
4A(x + y) + D = 4AD + D³/(4xy)
```

The amplification coefficient `A` is the key parameter:
- `A = 0`: pure constant product (Uniswap)
- `A = ∞`: pure constant sum (infinite liquidity, breaks when depleted)
- `A = 100` (Curve's typical value): mostly flat near peg, curves at extremes

### When to Use Each Formula

| Formula | Best For | Worst For |
|---------|----------|-----------|
| Constant Product (x*y=k) | Volatile asset pairs (ETH/USDC) | Pegged assets (USDC/USDT) |
| Constant Sum (x+y=k) | Theoretical only | Any real use (breaks when depleted) |
| StableSwap (Curve) | Pegged assets (stablecoins, LSTs) | Volatile pairs (too much IL) |
| Weighted (Balancer) | Index-like portfolios | High-frequency trading |

### Balancer's Weighted AMM

Balancer generalizes the constant product formula to support arbitrary weights and multiple assets:

```
Constant product (equal weights):
x * y = k  (50/50 pool)

Balancer weighted:
x^w0 * y^w1 = k  (any weights, e.g., 80/20)

Multi-asset:
x^w0 * y^w1 * z^w2 = k  (e.g., 33/33/33 three-asset pool)
```

An 80/20 ETH/USDC Balancer pool means 80% of the pool value is ETH and 20% is USDC. This reduces impermanent loss for the ETH holder (less rebalancing needed) but provides less liquidity depth than a 50/50 pool.

---

## Code Walkthrough

A simplified StableSwap implementation showing the core math:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StableSwap
 * @notice Simplified Curve-style StableSwap for 2 assets.
 * Demonstrates the hybrid invariant and how A affects price impact.
 */
contract StableSwap {
    uint256 public constant N = 2;          // number of assets
    uint256 public constant A = 100;        // amplification coefficient
    uint256 public constant FEE = 4;        // 0.04% fee (Curve's typical stablecoin fee)
    uint256 public constant FEE_DENOM = 10000;
    uint256 public constant PRECISION = 1e18;

    uint256[2] public balances; // pool balances (normalized to 18 decimals)
    address[2] public tokens;

    uint256 public totalLp;
    mapping(address => uint256) public lpBalance;

    event Swap(address indexed trader, uint256 tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address token0, address token1) {
        tokens[0] = token0;
        tokens[1] = token1;
    }

    /**
     * @notice Calculate D — the total value when all assets are equal.
     * @dev D is the key invariant. It represents the "size" of the pool.
     *      Solved iteratively using Newton's method.
     */
    function getD(uint256[2] memory xp) public pure returns (uint256 D) {
        uint256 S = xp[0] + xp[1]; // sum of balances
        if (S == 0) return 0;

        uint256 Dprev;
        D = S;
        uint256 Ann = A * N * N; // A * n^n

        // Newton's method iteration — converges in ~5 iterations
        for (uint256 i = 0; i < 255; i++) {
            uint256 D_P = D;
            // D_P = D^(n+1) / (n^n * prod(xi))
            for (uint256 j = 0; j < N; j++) {
                D_P = (D_P * D) / (xp[j] * N);
            }

            Dprev = D;
            // Newton's update step
            D = ((Ann * S + D_P * N) * D) / ((Ann - 1) * D + (N + 1) * D_P);

            // Check convergence
            if (D > Dprev && D - Dprev <= 1) break;
            if (D <= Dprev && Dprev - D <= 1) break;
        }
    }

    /**
     * @notice Calculate output amount for a swap.
     * @param i Index of input token (0 or 1)
     * @param j Index of output token (0 or 1)
     * @param dx Input amount
     * @return dy Output amount (before fee)
     */
    function getY(uint256 i, uint256 j, uint256 dx) public view returns (uint256 dy) {
        uint256[2] memory xp = balances;
        uint256 D = getD(xp);

        // New balance of input token after adding dx
        xp[i] += dx;

        // Calculate new balance of output token that maintains invariant
        // Solve: A*n^n*Σxi + D = A*D*n^n + D^(n+1)/(n^n*Πxi) for xp[j]
        uint256 Ann = A * N * N;
        uint256 c = D;
        uint256 S_ = 0;

        for (uint256 k = 0; k < N; k++) {
            if (k == j) continue;
            S_ += xp[k];
            c = (c * D) / (xp[k] * N);
        }
        c = (c * D) / (Ann * N);

        uint256 b = S_ + D / Ann;
        uint256 y = D;

        // Newton's method to find y
        for (uint256 iter = 0; iter < 255; iter++) {
            uint256 yPrev = y;
            y = (y * y + c) / (2 * y + b - D);
            if (y > yPrev && y - yPrev <= 1) break;
            if (y <= yPrev && yPrev - y <= 1) break;
        }

        dy = xp[j] - y - 1; // -1 for rounding safety
    }

    /**
     * @notice Swap token i for token j.
     */
    function swap(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 minDy
    ) external returns (uint256 dy) {
        require(i != j && i < N && j < N, "Invalid tokens");
        require(dx > 0, "Zero input");

        // Calculate output before fee
        uint256 dyBeforeFee = getY(i, j, dx);

        // Apply fee
        uint256 fee = (dyBeforeFee * FEE) / FEE_DENOM;
        dy = dyBeforeFee - fee;

        require(dy >= minDy, "Slippage exceeded");

        balances[i] += dx;
        balances[j] -= dy;
        // fee stays in pool (increases D slightly, benefiting LPs)

        emit Swap(msg.sender, i, dx, dy);
    }

    /**
     * @notice Compare price impact: StableSwap vs constant product.
     * @dev Shows why StableSwap is better for pegged assets.
     */
    function comparePriceImpact(uint256 amountIn)
        external view returns (uint256 stableSwapOut, uint256 constantProductOut)
    {
        // StableSwap output
        uint256 dyBeforeFee = getY(0, 1, amountIn);
        stableSwapOut = dyBeforeFee - (dyBeforeFee * FEE) / FEE_DENOM;

        // Constant product output (x*y=k, same reserves)
        uint256 x = balances[0];
        uint256 y = balances[1];
        uint256 amountInWithFee = amountIn * 997; // 0.3% fee
        constantProductOut = (y * amountInWithFee) / (x * 1000 + amountInWithFee);
    }
}
```

TypeScript comparison showing the difference in price impact:

```typescript
// Compare StableSwap vs constant product for stablecoin swaps
function constantProductOut(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  feeBps: number = 30
): number {
  const amountInWithFee = amountIn * (10000 - feeBps);
  return (reserveOut * amountInWithFee) / (reserveIn * 10000 + amountInWithFee);
}

// Simplified StableSwap approximation for illustration
function stableSwapOut(
  amountIn: number,
  reserve: number, // assuming equal reserves
  A: number = 100
): number {
  // Near the peg, StableSwap approximates constant sum
  // Price impact ≈ amountIn / (2 * A * reserve)
  const priceImpact = amountIn / (2 * A * reserve);
  return amountIn * (1 - priceImpact) * (1 - 0.0004); // 0.04% fee
}

const reserve = 10_000_000; // $10M per side

// Swap $100,000 USDC for USDT
const amountIn = 100_000;

const cpOut = constantProductOut(amountIn, reserve, reserve);
const ssOut = stableSwapOut(amountIn, reserve);

console.log(`Constant Product: ${cpOut.toFixed(2)} USDT`);
// Output: ~99,700 USDT (0.3% price impact + 0.3% fee)

console.log(`StableSwap: ${ssOut.toFixed(2)} USDT`);
// Output: ~99,954 USDT (0.05% price impact + 0.04% fee)

console.log(`StableSwap saves: $${(ssOut - cpOut).toFixed(2)}`);
// Output: ~$254 saved on a $100k trade
```

---

## Common Mistakes and Gotchas

**1. Using StableSwap for volatile asset pairs**  
The flat curve that makes StableSwap great for stablecoins makes it terrible for volatile pairs. If ETH/USDC is in a StableSwap pool and ETH price moves 10%, the pool barely rebalances — LPs suffer massive impermanent loss. StableSwap assumes assets maintain their peg.

**2. Setting A too high**  
Higher A means flatter curve means less price impact near the peg. But it also means the pool is more vulnerable to depeg events — if one stablecoin loses its peg, the pool can be drained before the price adjusts enough to stop arbitrageurs. Curve carefully calibrates A for each pool.

**3. Not normalizing decimals**  
USDC has 6 decimals, DAI has 18. If you put them in a pool without normalizing, the math breaks. Always normalize all assets to the same precision (18 decimals) before applying the invariant formula.

**4. Ignoring the admin fee**  
Curve charges an admin fee (a portion of the trading fee goes to the DAO). If you're forking Curve, don't forget this. It affects LP yield calculations.

**5. Assuming the invariant is always maintained exactly**  
Due to integer arithmetic and rounding, the invariant is maintained approximately, not exactly. The `- 1` in the output calculation is a rounding safety margin. Don't assume exact equality when checking invariants in tests.

---

## How This Connects to Production

Curve Finance is the dominant stablecoin DEX with billions in TVL, specifically because of the StableSwap formula. 3pool (USDC/USDT/DAI) is one of the most liquid pools in DeFi. Curve's formula is also used for liquid staking token pairs (stETH/ETH, rETH/ETH) where the assets are near-pegged but not identical. Convex Finance is built on top of Curve — it aggregates Curve LP positions to maximize CRV rewards. Frax Finance uses Curve pools as a core part of its stablecoin mechanism. The "Curve Wars" — protocols competing to control CRV emissions to attract liquidity to their pools — is one of the most complex DeFi meta-games, all built on top of this formula.

---

## What to Learn Next

- **Liquidity Pools, Impermanent Loss, and LP Token Mechanics** — understand the risk of providing liquidity to any AMM.
- **How DeFi Lending Works: Collateral, Health Factor, and Liquidations** — the other core DeFi primitive.
- **Flash Loans: How They Work and How They're Exploited** — see how AMM price manipulation attacks work.
