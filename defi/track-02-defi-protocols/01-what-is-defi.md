# What is DeFi? Lending, Borrowing, and Yield Explained

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

"DeFi" gets used to describe everything from a simple token swap to a 10-layer yield strategy involving 6 protocols and 3 bridges. If you're building in this space, you need a clear mental model of what DeFi actually is, how the core primitives work, and how they compose into the complex systems you see on-chain today.

This blog is the foundation for the entire DeFi track. We'll cover the core primitives — lending, borrowing, and yield — with enough depth to understand how protocols like Aave, Compound, and Yearn actually work under the hood.

---

## Core Concepts

### What DeFi Actually Is

DeFi (Decentralized Finance) is financial services implemented as smart contracts. The key properties that distinguish it from traditional finance:

- **Non-custodial** — you hold your own assets. The protocol never takes custody.
- **Permissionless** — anyone with a wallet can use it. No KYC, no credit check, no geography restriction.
- **Transparent** — all rules are in the contract code, publicly readable.
- **Composable** — protocols can call each other. Your collateral in Aave can be used as collateral in another protocol simultaneously.
- **Trustless** — you don't trust the protocol operator. You trust the code (and the auditors who reviewed it).

### The Core DeFi Primitives

**1. Decentralized Exchange (DEX)**  
Trade tokens without a centralized order book. Uniswap, Curve, Balancer. We'll cover AMM math in depth in the next blog.

**2. Lending/Borrowing**  
Deposit assets to earn interest. Borrow against collateral. Aave, Compound, Euler. Covered in depth in this track.

**3. Yield Aggregation**  
Automatically move funds between protocols to maximize yield. Yearn Finance, Convex. Covered later.

**4. Derivatives**  
Perpetual futures, options, prediction markets. dYdX, GMX, Synthetix, Polymarket.

**5. Stablecoins**  
Algorithmic or collateral-backed stable assets. DAI (MakerDAO), FRAX, crvUSD.

### How DeFi Lending Works

The core lending model (Compound/Aave style):

```
Lenders deposit ETH → Protocol holds ETH → Earns interest from borrowers
Borrowers deposit WBTC as collateral → Borrow USDC → Pay interest
```

The interest rate is algorithmic — it adjusts based on utilization:

```
Utilization Rate = Total Borrowed / Total Deposited

Low utilization (20%) → Low borrow rate (2%) → Low supply rate (0.4%)
High utilization (90%) → High borrow rate (20%) → High supply rate (18%)
```

This creates a self-balancing system: high rates attract more lenders (increasing supply) and discourage borrowers (decreasing demand), pushing utilization back toward equilibrium.

### Collateralization and Health Factor

DeFi lending is overcollateralized — you must deposit more than you borrow. This is because there's no credit system, no identity, no legal recourse.

```
You deposit: $10,000 WBTC (collateral)
Collateral factor: 70% (you can borrow up to 70% of collateral value)
Max borrow: $7,000 USDC

Health Factor = (Collateral Value × Liquidation Threshold) / Total Debt
             = ($10,000 × 0.80) / $7,000
             = 1.14

Health Factor < 1.0 → Position is liquidatable
```

If WBTC price drops and your health factor falls below 1.0, liquidators can repay your debt and claim your collateral at a discount (the liquidation bonus).

### Interest Rate Models

```
Simple linear model:
Rate = BaseRate + (Utilization × Slope)

Kinked model (Compound/Aave):
If utilization < optimal:
    Rate = BaseRate + (Utilization / Optimal) × Slope1
If utilization >= optimal:
    Rate = BaseRate + Slope1 + ((Utilization - Optimal) / (1 - Optimal)) × Slope2
```

The "kink" creates a sharp rate increase above the optimal utilization point. This discourages borrowing when the pool is nearly empty (protecting lenders from illiquidity).

### Yield: Where Does It Come From?

A common question from newcomers: "Where does the yield actually come from?" In DeFi, yield comes from real economic activity:

- **Lending yield** — borrowers pay interest. Lenders receive it.
- **Trading fees** — DEX LPs earn a percentage of every swap.
- **Protocol incentives** — protocols emit governance tokens to bootstrap liquidity (this is "mercenary capital" and often unsustainable).
- **Real-world assets (RWA)** — some protocols (MakerDAO, Centrifuge) back stablecoins with real-world debt instruments.

Yield that comes only from token emissions is not sustainable. Yield that comes from real borrowing demand or trading fees is.

---

## Code Walkthrough

A minimal lending pool demonstrating the core mechanics:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MinimalLendingPool
 * @notice Demonstrates core DeFi lending mechanics:
 *   - Deposit/withdraw
 *   - Borrow/repay
 *   - Interest accrual
 *   - Health factor calculation
 * @dev Simplified — not production ready. Missing: oracle integration,
 *      liquidation, multi-asset support, proper interest math.
 */
contract MinimalLendingPool {
    // ─── State ─────────────────────────────────────────────────────────────

    // Deposit tracking — using interest-bearing token model
    // depositShares[user] / totalShares * totalDeposits = user's actual balance
    mapping(address => uint256) public depositShares;
    uint256 public totalShares;
    uint256 public totalDeposits; // includes accrued interest

    // Borrow tracking
    mapping(address => uint256) public borrowBalance;
    uint256 public totalBorrows;

    // Collateral (simplified: ETH as collateral, USDC as borrow asset)
    mapping(address => uint256) public collateral; // ETH deposited as collateral

    // Interest rate parameters
    uint256 public constant BASE_RATE = 2e16;      // 2% base rate (per year, in 1e18)
    uint256 public constant SLOPE = 18e16;          // 18% slope
    uint256 public constant OPTIMAL_UTIL = 8e17;    // 80% optimal utilization
    uint256 public constant COLLATERAL_FACTOR = 7e17; // 70% LTV
    uint256 public constant LIQUIDATION_THRESHOLD = 8e17; // 80%

    uint256 public lastAccrualTime;

    // ─── Events ────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event CollateralDeposited(address indexed user, uint256 amount);

    constructor() {
        lastAccrualTime = block.timestamp;
    }

    // ─── Core Functions ────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC to earn interest.
     * @dev Uses share-based accounting to handle interest accrual correctly.
     *      Shares represent proportional ownership of the pool.
     */
    function deposit(uint256 amount) external {
        _accrueInterest();

        // Calculate shares to mint
        // If pool is empty: 1 share = 1 token
        // If pool has interest: shares are worth more than 1 token each
        uint256 shares;
        if (totalShares == 0 || totalDeposits == 0) {
            shares = amount;
        } else {
            // shares = amount * totalShares / totalDeposits
            // This preserves the share price (totalDeposits/totalShares)
            shares = (amount * totalShares) / totalDeposits;
        }

        depositShares[msg.sender] += shares;
        totalShares += shares;
        totalDeposits += amount;

        // Transfer USDC from user (simplified — assume token transfer happens)
        emit Deposited(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw deposited USDC + accrued interest.
     */
    function withdraw(uint256 shares) external {
        _accrueInterest();
        require(depositShares[msg.sender] >= shares, "Insufficient shares");

        // Calculate token amount for these shares
        uint256 amount = (shares * totalDeposits) / totalShares;

        depositShares[msg.sender] -= shares;
        totalShares -= shares;
        totalDeposits -= amount;

        // Transfer USDC to user
        emit Withdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Deposit ETH as collateral.
     */
    function depositCollateral() external payable {
        collateral[msg.sender] += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Borrow USDC against ETH collateral.
     * @param amount USDC amount to borrow
     * @param ethPrice Current ETH price in USDC (simplified — use oracle in production)
     */
    function borrow(uint256 amount, uint256 ethPrice) external {
        _accrueInterest();

        uint256 collateralValue = (collateral[msg.sender] * ethPrice) / 1e18;
        uint256 maxBorrow = (collateralValue * COLLATERAL_FACTOR) / 1e18;
        uint256 currentDebt = borrowBalance[msg.sender];

        require(currentDebt + amount <= maxBorrow, "Insufficient collateral");
        require(amount <= availableLiquidity(), "Insufficient liquidity");

        borrowBalance[msg.sender] += amount;
        totalBorrows += amount;

        emit Borrowed(msg.sender, amount);
    }

    /**
     * @notice Repay borrowed USDC.
     */
    function repay(uint256 amount) external {
        _accrueInterest();
        require(borrowBalance[msg.sender] >= amount, "Overpayment");

        borrowBalance[msg.sender] -= amount;
        totalBorrows -= amount;
        totalDeposits += amount; // interest goes to depositors

        emit Repaid(msg.sender, amount);
    }

    // ─── View Functions ────────────────────────────────────────────────────

    /**
     * @notice Current borrow APR based on utilization.
     */
    function borrowRate() public view returns (uint256) {
        uint256 util = utilizationRate();
        if (util <= OPTIMAL_UTIL) {
            return BASE_RATE + (util * SLOPE) / OPTIMAL_UTIL;
        } else {
            // Sharp increase above optimal
            uint256 excessUtil = util - OPTIMAL_UTIL;
            return BASE_RATE + SLOPE + (excessUtil * SLOPE * 5) / (1e18 - OPTIMAL_UTIL);
        }
    }

    function utilizationRate() public view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (totalBorrows * 1e18) / totalDeposits;
    }

    function availableLiquidity() public view returns (uint256) {
        return totalDeposits - totalBorrows;
    }

    function healthFactor(address user, uint256 ethPrice) external view returns (uint256) {
        if (borrowBalance[user] == 0) return type(uint256).max;
        uint256 collateralValue = (collateral[user] * ethPrice) / 1e18;
        uint256 liquidationValue = (collateralValue * LIQUIDATION_THRESHOLD) / 1e18;
        return (liquidationValue * 1e18) / borrowBalance[user];
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    /**
     * @dev Accrue interest since last accrual.
     *      In production: use compound interest formula, not simple interest.
     */
    function _accrueInterest() internal {
        uint256 elapsed = block.timestamp - lastAccrualTime;
        if (elapsed == 0 || totalBorrows == 0) return;

        // Simple interest for demo: interest = principal * rate * time
        // Production: use (1 + rate/secondsPerYear)^elapsed - 1
        uint256 annualRate = borrowRate();
        uint256 interest = (totalBorrows * annualRate * elapsed) / (365 days * 1e18);

        totalBorrows += interest;
        totalDeposits += interest; // interest flows to depositors
        lastAccrualTime = block.timestamp;
    }
}
```

---

## Common Mistakes and Gotchas

**1. Confusing APR and APY**  
APR (Annual Percentage Rate) is the simple interest rate. APY (Annual Percentage Yield) compounds it. A 10% APR compounded daily is ~10.52% APY. DeFi protocols often display APY because it looks higher. When comparing yields, make sure you're comparing the same metric.

**2. Ignoring smart contract risk in yield calculations**  
A 20% APY sounds great until the protocol gets hacked and you lose 100% of principal. Risk-adjusted yield is what matters. Protocols with higher TVL, more audits, and longer track records command lower risk premiums.

**3. Not accounting for gas costs in yield strategies**  
A 5% APY on $1,000 is $50/year. If you're paying $20 in gas to deposit and $20 to withdraw, your net yield is $10. Gas costs are a fixed cost that disproportionately hurt small positions.

**4. Assuming liquidity is always available**  
In a lending protocol, if utilization is 99%, you can't withdraw your deposits until borrowers repay. This is "liquidity risk." Aave's interest rate model is specifically designed to prevent this by making borrowing extremely expensive at high utilization.

**5. Treating governance token yields as real yield**  
Many protocols offer high APYs by emitting governance tokens. These tokens often have no fundamental value and depreciate rapidly. "Real yield" — yield from actual protocol revenue — is what matters for sustainable returns.

---

## How This Connects to Production

Aave V3 manages over $10B in TVL using the exact mechanics described here — overcollateralized lending with algorithmic interest rates and health factor-based liquidations. Compound pioneered the share-based accounting model (cTokens) that's now standard across DeFi. Yearn Finance builds on top of lending protocols — it automatically moves deposits between Aave, Compound, and other protocols to maximize yield. MakerDAO uses a lending model to back DAI — users deposit ETH, borrow DAI, and the system maintains DAI's peg through interest rate adjustments. Understanding these primitives is the prerequisite for building anything in DeFi.

---

## What to Learn Next

- **How AMMs Work: The Math Behind Uniswap's x*y=k** — the other core DeFi primitive: decentralized trading.
- **How DeFi Lending Works: Collateral, Health Factor, and Liquidations** — go deeper on the lending mechanics introduced here.
- **Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)** — understand the oracle layer that makes lending protocols possible.
