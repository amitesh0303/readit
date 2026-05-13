# Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

Your lending protocol needs to know the price of ETH to calculate health factors. Your perpetuals protocol needs real-time prices to mark positions to market. Your options protocol needs implied volatility. None of this data exists on-chain — it all comes from the real world.

This is the oracle problem: how do you get trustworthy off-chain data onto a blockchain in a way that can't be manipulated? Get it wrong and your entire protocol is vulnerable. The Mango Markets exploit ($114M) was an oracle manipulation attack. The Euler Finance hack involved oracle manipulation. This blog explains how Chainlink solves the oracle problem, how to use it correctly, and how attacks still happen.

---

## Core Concepts

### The Oracle Problem

Smart contracts are deterministic and isolated. They can't make HTTP requests or access external data. But DeFi protocols need real-world data constantly:

- Lending: "What's the current ETH price?" (for health factor)
- Perpetuals: "What's the current BTC price?" (for mark price)
- Options: "What's the current volatility?" (for pricing)
- Stablecoins: "Is USDC still $1?" (for peg maintenance)

The naive solution — have one trusted party post prices — creates a single point of failure and trust. Chainlink's solution: a decentralized network of independent node operators that aggregate data from multiple sources.

### How Chainlink Price Feeds Work

```
Off-chain data sources (Binance, Coinbase, Kraken, etc.)
    ↓
Chainlink node operators (independent, staked)
    ↓  Each node fetches price, signs it
Aggregator contract (on-chain)
    ↓  Collects responses, takes median
Price feed contract (on-chain)
    ↓
Your protocol reads the price
```

Key properties:
- **Decentralized**: multiple independent nodes, no single point of failure
- **Aggregated**: median of multiple sources, resistant to outliers
- **Staked**: nodes stake LINK as collateral, slashed for bad data
- **Heartbeat**: prices update at minimum every X hours (e.g., 1 hour for ETH/USD)
- **Deviation threshold**: prices update immediately if they move more than Y% (e.g., 0.5%)

### The AggregatorV3Interface

```solidity
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external view returns (
            uint80 roundId,
            int256 answer,        // the price (can be negative for some feeds)
            uint256 startedAt,    // when this round started
            uint256 updatedAt,    // when this round was answered
            uint80 answeredInRound // round in which answer was computed
        );

    function latestRoundData()
        external view returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
```

### Staleness and Validity Checks

This is where most developers make mistakes. You can't just call `latestRoundData()` and use the answer. You must validate it:

```solidity
// WRONG — no validation
function getPrice(address feed) external view returns (uint256) {
    (, int256 price, , , ) = AggregatorV3Interface(feed).latestRoundData();
    return uint256(price);
}

// RIGHT — full validation
function getPrice(address feed) external view returns (uint256) {
    (
        uint80 roundId,
        int256 price,
        ,
        uint256 updatedAt,
        uint80 answeredInRound
    ) = AggregatorV3Interface(feed).latestRoundData();

    require(price > 0, "Invalid price");
    require(updatedAt > 0, "Round not complete");
    require(answeredInRound >= roundId, "Stale price");
    require(block.timestamp - updatedAt <= MAX_STALENESS, "Price too old");

    return uint256(price);
}
```

### Oracle Attack Vectors

**1. Price manipulation via flash loans (DEX oracle attacks)**  
If your protocol uses a DEX spot price as an oracle, an attacker can:
1. Flash loan a large amount
2. Manipulate the DEX price
3. Exploit your protocol (trigger liquidations, borrow at wrong price)
4. Repay the flash loan

This is why you should never use DEX spot prices as oracles for financial calculations.

**2. Chainlink oracle staleness**  
If Chainlink nodes go offline or the network is congested, prices can become stale. Your protocol must handle this gracefully — either pausing operations or using a fallback oracle.

**3. Chainlink oracle manipulation (theoretical)**  
Chainlink's decentralized model makes manipulation expensive but not impossible. An attacker who controls enough node operators could submit false prices. This is why Chainlink uses multiple independent nodes and the median aggregation.

**4. The Mango Markets attack (oracle manipulation)**  
Avraham Eisenberg manipulated the MNGO token price on Mango Markets by buying MNGO futures to pump the price, then using the inflated MNGO as collateral to borrow $114M from the protocol. The oracle used a TWAP that could be manipulated over a short window.

---

## Code Walkthrough

Production-grade oracle integration with fallback and circuit breaker:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt,
        uint256 updatedAt, uint80 answeredInRound
    );
}

/**
 * @title OracleManager
 * @notice Production oracle integration with:
 *   - Staleness checks
 *   - Price bounds validation
 *   - Fallback oracle support
 *   - Circuit breaker for extreme price moves
 */
contract OracleManager {
    struct OracleConfig {
        address primaryFeed;      // Chainlink primary feed
        address fallbackFeed;     // backup oracle (e.g., Uniswap TWAP)
        uint256 maxStaleness;     // max age of price in seconds
        uint256 maxPriceDeviation; // max % deviation between primary and fallback (bps)
        uint256 minPrice;         // sanity check: price can't be below this
        uint256 maxPrice;         // sanity check: price can't be above this
        uint8 decimals;           // feed decimals (usually 8 for USD feeds)
    }

    mapping(address => OracleConfig) public oracleConfigs;
    address public owner;

    // Circuit breaker: pause oracle if price moves too fast
    mapping(address => uint256) public lastPrice;
    mapping(address => uint256) public lastPriceTimestamp;
    uint256 public constant MAX_PRICE_CHANGE_PER_HOUR = 3000; // 30% in bps

    event PriceRead(address indexed asset, uint256 price, address feed);
    event FallbackUsed(address indexed asset, string reason);
    event CircuitBreakerTriggered(address indexed asset, uint256 oldPrice, uint256 newPrice);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() { owner = msg.sender; }

    /**
     * @notice Get validated price for an asset.
     * @param asset Token address
     * @return price Price in USD with 18 decimal precision
     */
    function getPrice(address asset) external returns (uint256 price) {
        OracleConfig memory config = oracleConfigs[asset];
        require(config.primaryFeed != address(0), "No oracle configured");

        bool primaryValid;
        uint256 primaryPrice;
        (primaryValid, primaryPrice) = _tryGetPrice(config.primaryFeed, config);

        if (!primaryValid) {
            emit FallbackUsed(asset, "Primary oracle invalid");
            require(config.fallbackFeed != address(0), "No fallback oracle");

            bool fallbackValid;
            (fallbackValid, price) = _tryGetPrice(config.fallbackFeed, config);
            require(fallbackValid, "Both oracles invalid");
        } else {
            price = primaryPrice;

            // Cross-check with fallback if available
            if (config.fallbackFeed != address(0)) {
                bool fallbackValid;
                uint256 fallbackPrice;
                (fallbackValid, fallbackPrice) = _tryGetPrice(config.fallbackFeed, config);

                if (fallbackValid) {
                    // Check deviation between primary and fallback
                    uint256 deviation = _percentDeviation(primaryPrice, fallbackPrice);
                    if (deviation > config.maxPriceDeviation) {
                        emit FallbackUsed(asset, "High deviation between oracles");
                        // Use the lower price (conservative for lending protocols)
                        price = primaryPrice < fallbackPrice ? primaryPrice : fallbackPrice;
                    }
                }
            }
        }

        // Circuit breaker: check for extreme price moves
        _checkCircuitBreaker(asset, price);

        // Normalize to 18 decimals
        price = _normalizeDecimals(price, config.decimals);

        emit PriceRead(asset, price, config.primaryFeed);
    }

    /**
     * @dev Try to get a valid price from a Chainlink feed.
     * @return valid Whether the price is valid
     * @return price The price (raw, not normalized)
     */
    function _tryGetPrice(address feed, OracleConfig memory config)
        internal view returns (bool valid, uint256 price)
    {
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate all conditions
            if (answer <= 0) return (false, 0);
            if (updatedAt == 0) return (false, 0);
            if (answeredInRound < roundId) return (false, 0); // stale round
            if (block.timestamp - updatedAt > config.maxStaleness) return (false, 0);

            price = uint256(answer);

            // Sanity bounds check
            if (price < config.minPrice || price > config.maxPrice) return (false, 0);

            return (true, price);
        } catch {
            return (false, 0);
        }
    }

    /**
     * @dev Circuit breaker: revert if price moved too fast.
     */
    function _checkCircuitBreaker(address asset, uint256 newPrice) internal {
        uint256 last = lastPrice[asset];
        uint256 lastTime = lastPriceTimestamp[asset];

        if (last > 0 && lastTime > 0) {
            uint256 elapsed = block.timestamp - lastTime;
            if (elapsed < 1 hours) {
                uint256 deviation = _percentDeviation(last, newPrice);
                uint256 maxAllowed = (MAX_PRICE_CHANGE_PER_HOUR * elapsed) / 1 hours;

                if (deviation > maxAllowed) {
                    emit CircuitBreakerTriggered(asset, last, newPrice);
                    revert("Circuit breaker: price moved too fast");
                }
            }
        }

        lastPrice[asset] = newPrice;
        lastPriceTimestamp[asset] = block.timestamp;
    }

    function _percentDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 10000; // 100% deviation
        uint256 diff = a > b ? a - b : b - a;
        return (diff * 10000) / ((a + b) / 2);
    }

    function _normalizeDecimals(uint256 price, uint8 feedDecimals) internal pure returns (uint256) {
        if (feedDecimals == 18) return price;
        if (feedDecimals < 18) return price * 10**(18 - feedDecimals);
        return price / 10**(feedDecimals - 18);
    }

    function configureOracle(address asset, OracleConfig calldata config) external onlyOwner {
        oracleConfigs[asset] = config;
    }
}
```

TypeScript helper for monitoring oracle health:

```typescript
import { ethers } from "ethers";

const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

async function monitorOracleHealth(
  feedAddress: string,
  provider: ethers.Provider,
  maxStalenessSeconds: number = 3600
) {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);

  const [roundId, answer, , updatedAt, answeredInRound] =
    await feed.latestRoundData();
  const decimals = await feed.decimals();

  const now = Math.floor(Date.now() / 1000);
  const staleness = now - Number(updatedAt);
  const price = Number(answer) / 10 ** decimals;

  const issues: string[] = [];
  if (Number(answer) <= 0) issues.push("INVALID: negative or zero price");
  if (Number(answeredInRound) < Number(roundId)) issues.push("STALE: answeredInRound < roundId");
  if (staleness > maxStalenessSeconds) issues.push(`STALE: ${staleness}s old (max: ${maxStalenessSeconds}s)`);

  return {
    price,
    staleness,
    roundId: Number(roundId),
    answeredInRound: Number(answeredInRound),
    isHealthy: issues.length === 0,
    issues,
  };
}
```

---

## Common Mistakes and Gotchas

**1. Not checking `answeredInRound >= roundId`**  
This check catches a specific Chainlink edge case where a round starts but isn't answered in the same round (can happen during network issues). If `answeredInRound < roundId`, the price is from a previous round and may be stale.

**2. Using `block.timestamp` comparison without a reasonable staleness window**  
Different assets have different heartbeat intervals. ETH/USD updates every hour or on 0.5% deviation. Some exotic feeds update every 24 hours. Set your `maxStaleness` based on the specific feed's heartbeat, not a one-size-fits-all value.

**3. Not handling the case where `latestRoundData` reverts**  
Chainlink feeds can revert in edge cases (feed deprecated, network issues). Always wrap oracle calls in try/catch and have a fallback strategy.

**4. Using Chainlink for assets with no Chainlink feed**  
Not every token has a Chainlink price feed. For long-tail assets, you might need to use a DEX TWAP — but then you need to understand the manipulation risks of TWAPs and set appropriate parameters.

**5. Ignoring decimal normalization**  
Chainlink USD feeds use 8 decimals. ETH/BTC feeds use 18 decimals. If you mix them without normalizing, your math will be off by 10^10. Always check `decimals()` and normalize to a consistent precision.

---

## How This Connects to Production

Aave uses Chainlink as its primary oracle for all asset prices, with fallback mechanisms for edge cases. Synthetix uses Chainlink for all synth pricing. GMX uses Chainlink for mark prices in its perpetuals protocol. Pyth Network (covered in the Solana track) is Chainlink's main competitor, offering higher-frequency updates (sub-second) for DeFi protocols that need real-time prices. The oracle layer is the most critical external dependency of any DeFi protocol — a compromised or manipulated oracle can drain an entire protocol regardless of how well the rest of the code is written.

---

## What to Learn Next

- **Flash Loans: How They Work and How They're Exploited** — understand how flash loans are used to manipulate oracles.
- **Pyth Network Oracle Integration: Real-Time Price Feeds on Solana** — the Solana equivalent of Chainlink with different tradeoffs.
- **How DeFi Lending Works: Collateral, Health Factor, and Liquidations** — see how oracles feed into lending protocol mechanics.
