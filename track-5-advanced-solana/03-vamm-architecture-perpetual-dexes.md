# vAMM Architecture: How Perpetual DEXes Price Without an Orderbook

**Track:** Expert  
**Read time:** 13 min

---

## The Problem

You're building a perpetual futures DEX on Solana. You need a pricing mechanism that works 24/7, handles any trade size, and doesn't require a counterparty to be online. Traditional order books need market makers. Real AMMs (like Uniswap) require actual liquidity to be deposited. You need something different.

Virtual AMMs (vAMMs) solve this. They use the constant product formula to determine prices without holding real assets in the pool. This is how Perpetual Protocol, Drift Protocol (v1), and others price perpetual futures. This blog explains the architecture from first principles.

---

## Core Concepts

### What a vAMM Is

A vAMM uses the constant product formula `x * y = k` to calculate prices, but the `x` and `y` values are virtual — they don't represent real token reserves. Instead, they represent the protocol's internal accounting of long and short positions.

```
Real AMM (Uniswap):
- Pool holds 1,000 ETH + 2,000,000 USDC (real assets)
- x * y = k = 2,000,000,000
- Traders swap real tokens

vAMM (Perpetual Protocol):
- Virtual reserves: x = 1,000 ETH, y = 2,000,000 USDC (no real assets)
- x * y = k = 2,000,000,000
- Traders open positions, protocol tracks their entry price
- Real USDC collateral is held separately in a vault
```

The vAMM is purely a price discovery mechanism. Real collateral is managed separately.

### How Positions Work

When a trader opens a long position:
1. They deposit USDC as collateral (real)
2. The vAMM calculates how much virtual ETH they "buy" at the current price
3. The virtual reserves update (more virtual USDC in, less virtual ETH out)
4. The trader's position is recorded: entry price, size, collateral

When they close:
1. The vAMM calculates the current price
2. PnL = (exit price - entry price) × position size
3. Trader receives collateral ± PnL from the vault

```
Open long 1 ETH at $2,000:
- Virtual reserves before: 1,000 ETH / 2,000,000 USDC
- Trader "buys" 1 ETH: pays 2,002 virtual USDC (price impact)
- Virtual reserves after: 999 ETH / 2,002,000 USDC
- Position recorded: size=1 ETH, entry=2,002 USDC, collateral=200 USDC (10x leverage)

Close long when price is $2,100:
- Virtual reserves: 999 ETH / 2,100,000 USDC (price moved due to other trades)
- Trader "sells" 1 ETH: receives 2,098 virtual USDC
- PnL = 2,098 - 2,002 = 96 USDC
- Trader receives: 200 (collateral) + 96 (PnL) = 296 USDC
```

### The Funding Rate

Without a funding rate, the vAMM price can diverge significantly from the spot price. The funding rate is a periodic payment between longs and shorts that keeps the perpetual price anchored to the index price.

```
If vAMM price > index price:
  Longs pay shorts (discourages longs, encourages shorts → price falls)

If vAMM price < index price:
  Shorts pay longs (discourages shorts, encourages longs → price rises)

Funding rate = (vAMM price - index price) / index price × funding period factor
```

Funding is typically settled every 8 hours (like centralized exchanges) or continuously (like Drift Protocol).

### The Insurance Fund

When a position is liquidated, the liquidation might not cover the full debt (especially in fast-moving markets). The insurance fund covers this shortfall. It's funded by a portion of trading fees.

---

## Code Walkthrough

A simplified vAMM implementation:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VirtualAMM
 * @notice Simplified vAMM for perpetual futures.
 * Demonstrates: virtual reserves, position tracking, PnL calculation, funding.
 */
contract VirtualAMM {
    // ─── vAMM State ────────────────────────────────────────────────────────

    uint256 public virtualBaseReserve;   // virtual ETH (base asset)
    uint256 public virtualQuoteReserve;  // virtual USDC (quote asset)
    uint256 public k;                    // invariant = base * quote

    // ─── Position State ────────────────────────────────────────────────────

    struct Position {
        int256 size;           // positive = long, negative = short (in base asset)
        uint256 openNotional;  // quote value when position was opened
        uint256 margin;        // collateral deposited
        uint256 lastFundingIndex; // for funding payment calculation
    }

    mapping(address => Position) public positions;
    uint256 public totalLongSize;   // total long open interest
    uint256 public totalShortSize;  // total short open interest

    // ─── Funding State ─────────────────────────────────────────────────────

    uint256 public cumulativeFundingIndex; // accumulated funding per unit of position
    uint256 public lastFundingTime;
    uint256 public constant FUNDING_PERIOD = 8 hours;

    // ─── Vault ─────────────────────────────────────────────────────────────

    mapping(address => uint256) public collateral; // real USDC held
    uint256 public insuranceFund;

    // ─── Oracle ────────────────────────────────────────────────────────────

    address public oracle; // Chainlink or Pyth price feed

    // ─── Events ────────────────────────────────────────────────────────────

    event PositionOpened(address indexed trader, int256 size, uint256 price, uint256 margin);
    event PositionClosed(address indexed trader, int256 pnl);
    event FundingSettled(uint256 fundingRate, uint256 timestamp);
    event Liquidated(address indexed trader, address indexed liquidator, uint256 penalty);

    constructor(
        uint256 _initialBaseReserve,
        uint256 _initialQuoteReserve,
        address _oracle
    ) {
        virtualBaseReserve = _initialBaseReserve;
        virtualQuoteReserve = _initialQuoteReserve;
        k = _initialBaseReserve * _initialQuoteReserve;
        oracle = _oracle;
        lastFundingTime = block.timestamp;
    }

    // ─── Core Trading Functions ────────────────────────────────────────────

    /**
     * @notice Open a leveraged position.
     * @param isLong True for long, false for short
     * @param margin Collateral amount in USDC
     * @param leverage Leverage multiplier (e.g., 10 = 10x)
     */
    function openPosition(
        bool isLong,
        uint256 margin,
        uint256 leverage
    ) external {
        require(positions[msg.sender].size == 0, "Position already open");
        require(margin > 0 && leverage >= 1 && leverage <= 20, "Invalid params");

        _settleFunding();

        uint256 notional = margin * leverage; // position size in USDC

        uint256 baseAmount;
        if (isLong) {
            // Long: buy virtual base with virtual quote
            // baseAmount = baseReserve * notional / (quoteReserve + notional)
            baseAmount = (virtualBaseReserve * notional) /
                (virtualQuoteReserve + notional);
            virtualQuoteReserve += notional;
            virtualBaseReserve -= baseAmount;
            totalLongSize += baseAmount;
        } else {
            // Short: sell virtual base for virtual quote
            // quoteAmount = quoteReserve * baseAmount / (baseReserve + baseAmount)
            // Solve for baseAmount given notional
            baseAmount = (virtualBaseReserve * notional) /
                (virtualQuoteReserve - notional);
            virtualBaseReserve += baseAmount;
            virtualQuoteReserve -= notional;
            totalShortSize += baseAmount;
        }

        uint256 entryPrice = (notional * 1e18) / baseAmount;

        positions[msg.sender] = Position({
            size: isLong ? int256(baseAmount) : -int256(baseAmount),
            openNotional: notional,
            margin: margin,
            lastFundingIndex: cumulativeFundingIndex
        });

        collateral[msg.sender] += margin;

        emit PositionOpened(msg.sender, isLong ? int256(baseAmount) : -int256(baseAmount), entryPrice, margin);
    }

    /**
     * @notice Close an open position and realize PnL.
     */
    function closePosition() external {
        Position storage pos = positions[msg.sender];
        require(pos.size != 0, "No position");

        _settleFunding();

        bool isLong = pos.size > 0;
        uint256 absSize = uint256(isLong ? pos.size : -pos.size);

        uint256 exitNotional;
        if (isLong) {
            // Sell virtual base back
            exitNotional = (virtualQuoteReserve * absSize) /
                (virtualBaseReserve + absSize);
            virtualBaseReserve += absSize;
            virtualQuoteReserve -= exitNotional;
            totalLongSize -= absSize;
        } else {
            // Buy virtual base back
            exitNotional = (virtualQuoteReserve * absSize) /
                (virtualBaseReserve - absSize);
            virtualBaseReserve -= absSize;
            virtualQuoteReserve += exitNotional;
            totalShortSize -= absSize;
        }

        // Calculate PnL
        int256 pnl = isLong
            ? int256(exitNotional) - int256(pos.openNotional)
            : int256(pos.openNotional) - int256(exitNotional);

        // Apply funding payments
        int256 fundingPayment = _calculateFundingPayment(pos);
        pnl -= fundingPayment;

        uint256 margin = pos.margin;
        delete positions[msg.sender];

        // Settle: return margin ± PnL
        int256 settlement = int256(margin) + pnl;
        if (settlement > 0) {
            collateral[msg.sender] = uint256(settlement);
        } else {
            // Loss exceeds margin — insurance fund covers shortfall
            collateral[msg.sender] = 0;
            if (insuranceFund >= uint256(-settlement)) {
                insuranceFund -= uint256(-settlement);
            }
        }

        emit PositionClosed(msg.sender, pnl);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     */
    function liquidate(address trader) external {
        require(_getMarginRatio(trader) < 625, "Not liquidatable"); // < 6.25%

        Position storage pos = positions[trader];
        uint256 penalty = pos.margin / 20; // 5% liquidation penalty

        // Close position at current price
        // (simplified — production would use a more careful close)
        uint256 margin = pos.margin;
        delete positions[trader];

        // Liquidator gets penalty, insurance fund gets remainder
        collateral[msg.sender] += penalty;
        insuranceFund += margin - penalty;

        emit Liquidated(trader, msg.sender, penalty);
    }

    // ─── Funding ───────────────────────────────────────────────────────────

    function _settleFunding() internal {
        uint256 elapsed = block.timestamp - lastFundingTime;
        if (elapsed < FUNDING_PERIOD) return;

        uint256 markPrice = getMarkPrice();
        uint256 indexPrice = _getIndexPrice();

        // Funding rate = (mark - index) / index / 24 (hourly rate)
        int256 fundingRate;
        if (markPrice > indexPrice) {
            fundingRate = int256((markPrice - indexPrice) * 1e18 / indexPrice / 24);
        } else {
            fundingRate = -int256((indexPrice - markPrice) * 1e18 / indexPrice / 24);
        }

        cumulativeFundingIndex = uint256(int256(cumulativeFundingIndex) + fundingRate);
        lastFundingTime = block.timestamp;

        emit FundingSettled(uint256(fundingRate > 0 ? fundingRate : -fundingRate), block.timestamp);
    }

    function _calculateFundingPayment(Position memory pos) internal view returns (int256) {
        int256 fundingDelta = int256(cumulativeFundingIndex) - int256(pos.lastFundingIndex);
        return (pos.size * fundingDelta) / 1e18;
    }

    // ─── View Functions ────────────────────────────────────────────────────

    function getMarkPrice() public view returns (uint256) {
        return (virtualQuoteReserve * 1e18) / virtualBaseReserve;
    }

    function _getIndexPrice() internal view returns (uint256) {
        // In production: read from Chainlink/Pyth oracle
        return 2000 * 1e18; // placeholder
    }

    function _getMarginRatio(address trader) internal view returns (uint256) {
        Position memory pos = positions[trader];
        if (pos.size == 0) return type(uint256).max;

        uint256 markPrice = getMarkPrice();
        uint256 absSize = uint256(pos.size > 0 ? pos.size : -pos.size);
        uint256 positionValue = (absSize * markPrice) / 1e18;

        int256 pnl = pos.size > 0
            ? int256(positionValue) - int256(pos.openNotional)
            : int256(pos.openNotional) - int256(positionValue);

        int256 equity = int256(pos.margin) + pnl;
        if (equity <= 0) return 0;

        return (uint256(equity) * 10000) / positionValue; // in bps
    }
}
```

---

## Common Mistakes and Gotchas

**1. Not bounding the vAMM price**  
Without bounds, a large trade can move the vAMM price to an extreme value. This creates bad entry prices for traders and can be exploited. Production vAMMs use price impact limits and circuit breakers.

**2. Funding rate manipulation**  
If the funding rate is calculated from the vAMM price alone, a large trader can manipulate it by moving the vAMM price temporarily. Use a TWAP of the vAMM price for funding calculations.

**3. Socialized losses**  
When a position is liquidated and the insurance fund is empty, losses are "socialized" — spread across all profitable positions. This is a known risk in vAMM designs. Protocols handle it differently: some have backstop liquidity providers, others have governance-controlled insurance fund replenishment.

**4. k adjustment**  
The invariant `k` must be adjusted when the protocol adds or removes virtual liquidity (to change the price impact curve). This is a governance action that must be done carefully — changing `k` changes the effective leverage for all open positions.

**5. Oracle dependency**  
The funding rate depends on the index price from an oracle. If the oracle is manipulated or goes stale, the funding rate becomes incorrect, potentially causing the vAMM price to diverge significantly from the real price.

---

## How This Connects to Production

Perpetual Protocol V1 pioneered the vAMM model on Ethereum. Drift Protocol V1 used a vAMM on Solana. Both have since moved to more sophisticated models (Perpetual Protocol V2 uses Uniswap V3 as its AMM; Drift V2 uses a hybrid DLOB + AMM). GMX uses a different model entirely — a multi-asset pool where LPs are the counterparty to all trades. dYdX V4 uses a full order book on its own Cosmos chain. The vAMM model is a stepping stone — it works but has limitations (price impact, funding rate manipulation) that more sophisticated designs address.

---

## What to Learn Next

- **Funding Rate Mechanics in Perpetual Futures: The Math and Implementation** — go deep on the funding rate calculation.
- **Cross-Margin vs Isolated Margin in On-Chain Perps** — understand the margin models used in production.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build the bots that keep the protocol solvent.
