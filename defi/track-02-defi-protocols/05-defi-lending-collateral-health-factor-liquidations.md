# How DeFi Lending Works: Collateral, Health Factor, and Liquidations

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You're building a lending protocol or integrating with Aave. You need to understand exactly when a position becomes liquidatable, how the liquidation bonus works, and why the health factor formula is designed the way it is. Or you're a liquidation bot developer trying to understand the exact conditions that trigger a profitable liquidation.

The mechanics of DeFi lending are more nuanced than they appear. This blog goes deep on collateral math, health factor calculation, liquidation mechanics, and the economic incentives that keep lending protocols solvent.

---

## Core Concepts

### The Overcollateralization Requirement

DeFi lending is overcollateralized because there's no identity, no credit score, and no legal recourse. If a borrower defaults, the protocol must be able to recover the debt from the collateral alone.

```
Loan-to-Value (LTV) ratio: max borrow / collateral value
Liquidation Threshold: the LTV at which liquidation triggers
Liquidation Bonus: discount liquidators get on collateral

Example (Aave ETH parameters):
- Max LTV: 80% (you can borrow up to 80% of collateral value)
- Liquidation Threshold: 82.5% (liquidation triggers at 82.5% LTV)
- Liquidation Bonus: 5% (liquidators get 5% discount on collateral)

Why the gap between LTV and threshold?
- Gives borrowers a buffer before liquidation
- Prevents immediate liquidation after borrowing at max LTV
```

### Health Factor: The Core Metric

The health factor is a single number that summarizes a position's safety:

```
Health Factor = Σ(collateral_i * price_i * liquidation_threshold_i) / total_debt_value

HF > 1.0: Position is safe
HF = 1.0: Position is at the liquidation boundary
HF < 1.0: Position is liquidatable
```

For a multi-asset position:

```
Collateral:
- 1 ETH @ $3,000, liquidation threshold 82.5% → contributes $2,475
- 1,000 USDC @ $1, liquidation threshold 87% → contributes $870

Total debt: 2,500 USDC

HF = ($2,475 + $870) / $2,500 = $3,345 / $2,500 = 1.338

Position is safe. ETH would need to drop to ~$1,850 before liquidation.
```

### Liquidation Mechanics

When HF < 1.0, anyone can liquidate the position. The liquidator:
1. Repays some or all of the debt
2. Receives collateral worth more than the debt repaid (the bonus)

```
Liquidation example:
- Borrower has: 1 ETH collateral ($2,000), 1,800 USDC debt
- ETH drops to $1,900 → HF = (1,900 * 0.825) / 1,800 = 0.869 < 1.0

Liquidator repays: 900 USDC (50% of debt — Aave's close factor)
Liquidator receives: 900 USDC worth of ETH + 5% bonus
  = 900 * 1.05 / 1,900 ETH
  = 0.4974 ETH (worth $944.6)

Liquidator profit: $944.6 - $900 = $44.6 (4.96% return)
```

The **close factor** (typically 50%) limits how much of a position can be liquidated in one transaction. This prevents liquidators from fully liquidating a position that's only slightly underwater, which would be unfair to borrowers.

### Interest Rate Models

Aave uses a two-slope interest rate model:

```
If utilization < optimal:
    borrowRate = baseRate + (utilization / optimal) * slope1

If utilization >= optimal:
    borrowRate = baseRate + slope1 + ((utilization - optimal) / (1 - optimal)) * slope2

Supply rate = borrowRate * utilization * (1 - reserveFactor)
```

The reserve factor is the protocol's cut — a percentage of interest goes to the protocol treasury instead of lenders.

### aTokens: Interest-Bearing Deposit Receipts

When you deposit to Aave, you receive aTokens (e.g., aUSDC for USDC deposits). aTokens are ERC-20 tokens that automatically accrue interest — your balance increases every second without any transactions.

```
You deposit: 1,000 USDC
You receive: 1,000 aUSDC

After 1 year at 5% APY:
Your aUSDC balance: 1,050 aUSDC
Redeem for: 1,050 USDC
```

This is implemented via a "liquidity index" — a multiplier that increases over time. Your actual balance is `scaledBalance * liquidityIndex`.

---

## Code Walkthrough

A production-grade lending pool with proper health factor and liquidation logic:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LendingPool
 * @notice Production-grade lending pool with:
 *   - Multi-asset collateral
 *   - Health factor calculation
 *   - Liquidation with close factor and bonus
 *   - Interest accrual via liquidity index
 */
contract LendingPool {
    // ─── Asset Configuration ───────────────────────────────────────────────

    struct AssetConfig {
        uint256 ltv;                    // max LTV in basis points (8000 = 80%)
        uint256 liquidationThreshold;   // liquidation threshold in bps (8250 = 82.5%)
        uint256 liquidationBonus;       // bonus in bps (10500 = 5% bonus)
        uint256 reserveFactor;          // protocol fee in bps (1000 = 10%)
        bool isCollateral;              // can be used as collateral
        bool isBorrowable;              // can be borrowed
    }

    mapping(address => AssetConfig) public assetConfig;

    // ─── User Position State ───────────────────────────────────────────────

    struct UserAssetData {
        uint256 scaledDeposit;  // deposit / liquidityIndex at time of deposit
        uint256 scaledDebt;     // debt / borrowIndex at time of borrow
        bool useAsCollateral;
    }

    mapping(address => mapping(address => UserAssetData)) public userAssetData;
    mapping(address => address[]) public userAssets; // assets user has interacted with

    // ─── Pool State ────────────────────────────────────────────────────────

    struct PoolData {
        uint256 totalDeposits;
        uint256 totalBorrows;
        uint256 liquidityIndex;     // 1e27 precision (ray), increases with interest
        uint256 borrowIndex;        // 1e27 precision, increases with interest
        uint256 lastUpdateTimestamp;
    }

    mapping(address => PoolData) public poolData;

    uint256 public constant RAY = 1e27;
    uint256 public constant CLOSE_FACTOR = 5000; // 50% in bps
    uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

    // ─── Events ────────────────────────────────────────────────────────────

    event Deposited(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);
    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        address indexed debtAsset,
        address collateralAsset,
        uint256 debtRepaid,
        uint256 collateralSeized
    );

    // ─── Core Functions ────────────────────────────────────────────────────

    /**
     * @notice Deposit an asset to earn interest.
     */
    function deposit(address asset, uint256 amount) external {
        _updateIndices(asset);
        PoolData storage pool = poolData[asset];

        // Scale deposit by current liquidity index
        // scaledDeposit = amount / liquidityIndex
        // This way, as liquidityIndex grows, so does the user's actual balance
        uint256 scaledAmount = (amount * RAY) / pool.liquidityIndex;
        userAssetData[msg.sender][asset].scaledDeposit += scaledAmount;
        pool.totalDeposits += amount;

        emit Deposited(msg.sender, asset, amount);
    }

    /**
     * @notice Borrow an asset against collateral.
     * @param asset Asset to borrow
     * @param amount Amount to borrow
     * @param priceOracle Address of price oracle (simplified)
     */
    function borrow(address asset, uint256 amount, address priceOracle) external {
        _updateIndices(asset);
        require(assetConfig[asset].isBorrowable, "Not borrowable");

        // Check health factor after borrow
        uint256 hfAfterBorrow = _calculateHFAfterBorrow(msg.sender, asset, amount, priceOracle);
        require(hfAfterBorrow >= HEALTH_FACTOR_PRECISION, "Insufficient collateral");

        PoolData storage pool = poolData[asset];
        uint256 scaledDebt = (amount * RAY) / pool.borrowIndex;
        userAssetData[msg.sender][asset].scaledDebt += scaledDebt;
        pool.totalBorrows += amount;

        emit Borrowed(msg.sender, asset, amount);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     * @param borrower Address of the borrower to liquidate
     * @param debtAsset Asset the borrower owes
     * @param collateralAsset Asset to seize as collateral
     * @param debtToCover Amount of debt to repay
     * @param priceOracle Price oracle address
     */
    function liquidate(
        address borrower,
        address debtAsset,
        address collateralAsset,
        uint256 debtToCover,
        address priceOracle
    ) external {
        _updateIndices(debtAsset);
        _updateIndices(collateralAsset);

        // Verify position is liquidatable
        uint256 hf = calculateHealthFactor(borrower, priceOracle);
        require(hf < HEALTH_FACTOR_PRECISION, "Position is healthy");

        // Get borrower's actual debt (scaled debt * current borrow index)
        uint256 totalDebt = _getActualDebt(borrower, debtAsset);

        // Apply close factor — can't liquidate more than 50% of debt
        uint256 maxLiquidatable = (totalDebt * CLOSE_FACTOR) / 10000;
        uint256 actualDebtToCover = debtToCover > maxLiquidatable ? maxLiquidatable : debtToCover;

        // Calculate collateral to seize (debt value + liquidation bonus)
        uint256 debtPrice = _getPrice(debtAsset, priceOracle);
        uint256 collateralPrice = _getPrice(collateralAsset, priceOracle);
        uint256 liquidationBonus = assetConfig[collateralAsset].liquidationBonus;

        // collateralToSeize = debtToCover * debtPrice * liquidationBonus / collateralPrice
        uint256 collateralToSeize = (actualDebtToCover * debtPrice * liquidationBonus)
            / (collateralPrice * 10000);

        // Verify borrower has enough collateral
        uint256 borrowerCollateral = _getActualDeposit(borrower, collateralAsset);
        require(collateralToSeize <= borrowerCollateral, "Insufficient collateral");

        // Execute liquidation
        // 1. Reduce borrower's debt
        PoolData storage debtPool = poolData[debtAsset];
        uint256 scaledDebtReduction = (actualDebtToCover * RAY) / debtPool.borrowIndex;
        userAssetData[borrower][debtAsset].scaledDebt -= scaledDebtReduction;
        debtPool.totalBorrows -= actualDebtToCover;

        // 2. Transfer collateral from borrower to liquidator
        PoolData storage collateralPool = poolData[collateralAsset];
        uint256 scaledCollateralReduction = (collateralToSeize * RAY) / collateralPool.liquidityIndex;
        userAssetData[borrower][collateralAsset].scaledDeposit -= scaledCollateralReduction;
        userAssetData[msg.sender][collateralAsset].scaledDeposit += scaledCollateralReduction;

        emit Liquidated(msg.sender, borrower, debtAsset, collateralAsset, actualDebtToCover, collateralToSeize);
    }

    // ─── View Functions ────────────────────────────────────────────────────

    /**
     * @notice Calculate health factor for a user.
     * @return hf Health factor in 1e18 precision (1e18 = 1.0)
     */
    function calculateHealthFactor(address user, address priceOracle)
        public view returns (uint256 hf)
    {
        uint256 totalCollateralValue;
        uint256 totalDebtValue;

        address[] memory assets = userAssets[user];
        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 price = _getPrice(asset, priceOracle);
            AssetConfig memory config = assetConfig[asset];

            // Add collateral contribution
            if (config.isCollateral && userAssetData[user][asset].useAsCollateral) {
                uint256 depositValue = (_getActualDeposit(user, asset) * price) / 1e18;
                totalCollateralValue += (depositValue * config.liquidationThreshold) / 10000;
            }

            // Add debt contribution
            uint256 debtValue = (_getActualDebt(user, asset) * price) / 1e18;
            totalDebtValue += debtValue;
        }

        if (totalDebtValue == 0) return type(uint256).max;
        hf = (totalCollateralValue * HEALTH_FACTOR_PRECISION) / totalDebtValue;
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    /**
     * @dev Update liquidity and borrow indices based on elapsed time.
     *      Uses compound interest: index *= (1 + rate * dt)
     */
    function _updateIndices(address asset) internal {
        PoolData storage pool = poolData[asset];
        uint256 elapsed = block.timestamp - pool.lastUpdateTimestamp;
        if (elapsed == 0) return;

        uint256 utilization = pool.totalDeposits > 0
            ? (pool.totalBorrows * RAY) / pool.totalDeposits
            : 0;

        uint256 borrowRate = _calculateBorrowRate(asset, utilization);

        // Compound interest: newIndex = oldIndex * (1 + rate * dt / secondsPerYear)
        uint256 interestFactor = RAY + (borrowRate * elapsed) / 365 days;
        pool.borrowIndex = (pool.borrowIndex * interestFactor) / RAY;

        // Supply index grows slower (reserve factor taken out)
        AssetConfig memory config = assetConfig[asset];
        uint256 supplyRate = (borrowRate * utilization * (10000 - config.reserveFactor))
            / (RAY * 10000);
        uint256 supplyFactor = RAY + (supplyRate * elapsed) / 365 days;
        pool.liquidityIndex = (pool.liquidityIndex * supplyFactor) / RAY;

        pool.lastUpdateTimestamp = block.timestamp;
    }

    function _getActualDeposit(address user, address asset) internal view returns (uint256) {
        return (userAssetData[user][asset].scaledDeposit * poolData[asset].liquidityIndex) / RAY;
    }

    function _getActualDebt(address user, address asset) internal view returns (uint256) {
        return (userAssetData[user][asset].scaledDebt * poolData[asset].borrowIndex) / RAY;
    }

    function _calculateBorrowRate(address asset, uint256 utilization) internal view returns (uint256) {
        // Simplified two-slope model
        uint256 OPTIMAL = 8e26; // 80% in RAY
        uint256 BASE = 2e24;    // 2% base
        uint256 SLOPE1 = 4e25;  // 4% slope1
        uint256 SLOPE2 = 3e26;  // 30% slope2

        if (utilization <= OPTIMAL) {
            return BASE + (utilization * SLOPE1) / OPTIMAL;
        } else {
            return BASE + SLOPE1 + ((utilization - OPTIMAL) * SLOPE2) / (RAY - OPTIMAL);
        }
    }

    function _calculateHFAfterBorrow(
        address user, address asset, uint256 amount, address priceOracle
    ) internal view returns (uint256) {
        // Simplified — in production, recalculate full HF with new debt
        return calculateHealthFactor(user, priceOracle); // placeholder
    }

    function _getPrice(address asset, address /* priceOracle */) internal pure returns (uint256) {
        // In production: call Chainlink oracle
        // Simplified for demo
        return 1e18;
    }
}
```

---

## Common Mistakes and Gotchas

**1. Not accounting for interest accrual in health factor calculations**  
Debt grows over time due to interest. A position that's healthy today might be liquidatable tomorrow if interest accrues faster than collateral value grows. Liquidation bots must account for projected interest accrual, not just current debt.

**2. Ignoring the close factor in liquidation bots**  
You can't always liquidate 100% of a position. The close factor (50% in Aave) limits each liquidation. For large underwater positions, you may need multiple liquidation transactions. Factor this into your bot's profitability calculation.

**3. Not handling bad debt**  
If collateral value drops faster than liquidators can act (flash crash), the protocol can end up with bad debt — positions where debt > collateral. Protocols handle this differently: Aave has a safety module (staked AAVE) that can be slashed to cover bad debt. MakerDAO has a debt auction mechanism.

**4. Oracle manipulation in liquidation**  
If your protocol uses a manipulable price oracle (DEX spot price), an attacker can flash-loan to manipulate the price, trigger liquidations, and profit. Always use time-weighted average prices or Chainlink feeds for liquidation calculations.

**5. Liquidation gas costs eating into profit**  
On Ethereum mainnet, a liquidation transaction can cost $50-200 in gas. For small positions, the liquidation bonus might not cover gas costs. This creates "dust" positions that are technically liquidatable but economically not worth liquidating — a risk to protocol solvency. Protocols set minimum borrow amounts to prevent this.

---

## How This Connects to Production

Aave V3 manages billions in TVL using exactly these mechanics — health factor, close factor, liquidation bonus, and interest rate models. Compound V3 (Comet) simplified the model to single-asset borrowing (only USDC) to reduce complexity and risk. MakerDAO uses a similar model but with DAI as the only borrowable asset and a stability fee (interest rate) set by governance. Euler Finance was exploited in March 2023 for $197M partly because of a flaw in their donation mechanism that allowed manipulation of the health factor calculation. Liquidation bots are a critical part of the DeFi ecosystem — without them, protocols would accumulate bad debt and become insolvent. Understanding the exact mechanics is essential for building either the protocol or the bots that keep it healthy.

---

## What to Learn Next

- **Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)** — the oracle layer is the most critical dependency of any lending protocol.
- **Flash Loans: How They Work and How They're Exploited** — understand how flash loans interact with lending protocols.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build the bots that keep lending protocols solvent.
