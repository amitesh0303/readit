# Flash Loans: How They Work and How They're Exploited

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

Flash loans are one of the most misunderstood primitives in DeFi. Mainstream coverage frames them purely as attack tools — "hacker uses flash loan to steal $100M." But that framing misses the point. Flash loans are a legitimate financial primitive that enables arbitrage, collateral swaps, and self-liquidation. They're also the most powerful tool in an attacker's arsenal.

Understanding flash loans from both sides — the legitimate use cases and the attack patterns — is essential for any DeFi developer. If your protocol can be exploited via flash loan, you need to know why before you deploy.

---

## Core Concepts

### What a Flash Loan Is

A flash loan is an uncollateralized loan that must be borrowed and repaid within the same transaction. If the repayment doesn't happen, the entire transaction reverts — as if the loan never occurred.

This is only possible on blockchains because of atomicity: a transaction either fully succeeds or fully reverts. There's no partial execution. The lender has zero risk because if you don't repay, nothing happened.

```
Transaction execution:
1. Borrow 1,000,000 USDC from Aave (no collateral needed)
2. Do something with 1,000,000 USDC
3. Repay 1,000,000 USDC + 0.09% fee (900 USDC)

If step 3 fails → entire transaction reverts → Aave never lost anything
If step 3 succeeds → Aave earned 900 USDC in one block
```

### Legitimate Use Cases

**Arbitrage** — buy cheap on one DEX, sell expensive on another, repay loan, keep profit:

```
1. Flash loan 1,000,000 USDC
2. Buy ETH on Uniswap at $2,000 (get 500 ETH)
3. Sell ETH on Sushiswap at $2,010 (get 1,005,000 USDC)
4. Repay 1,000,000 USDC + 900 USDC fee
5. Keep 4,100 USDC profit
```

**Collateral swap** — change your collateral without closing your position:

```
1. Flash loan USDC equal to your ETH debt
2. Repay your ETH debt on Aave (free up ETH collateral)
3. Deposit WBTC as new collateral
4. Borrow USDC against WBTC
5. Repay flash loan
Result: position now collateralized by WBTC instead of ETH
```

**Self-liquidation** — liquidate your own position to avoid the liquidation penalty:

```
1. Your position is near liquidation (HF = 1.05)
2. Flash loan the debt amount
3. Repay your own debt (get collateral back)
4. Sell enough collateral to repay flash loan
5. Keep remaining collateral (avoid 5-10% liquidation penalty)
```

### How Flash Loan Attacks Work

Flash loans amplify the capital available to attackers. An attacker with $1,000 can effectively control $100M for one transaction. This enables:

**Oracle manipulation:**
```
1. Flash loan $50M USDC
2. Buy TOKEN on a DEX (price pumps 10x)
3. Use inflated TOKEN price as collateral in a lending protocol
4. Borrow $40M against inflated collateral
5. Repay flash loan ($50M + fee)
6. Walk away with $40M - $50M cost = profit (if protocol used DEX spot price)
```

**Governance attacks:**
```
1. Flash loan governance tokens
2. Vote on a malicious proposal (if same-block voting is allowed)
3. Repay tokens
4. Proposal passes with borrowed voting power
```

**Reentrancy amplification:**
```
1. Flash loan large amount
2. Exploit a reentrancy vulnerability with amplified capital
3. Drain protocol
4. Repay flash loan from stolen funds
```

### The Aave Flash Loan Interface

```solidity
interface IFlashLoanReceiver {
    /**
     * @notice Called by Aave after sending the flash loan.
     * @dev Must repay assets + premium before this function returns.
     * @param assets Addresses of borrowed assets
     * @param amounts Amounts borrowed
     * @param premiums Fees to pay (0.09% of each amount)
     * @param initiator Address that initiated the flash loan
     * @param params Arbitrary data passed through
     * @return true if successful
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}
```

---

## Code Walkthrough

A complete flash loan arbitrage contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes, // 0 = no debt (flash loan)
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/**
 * @title FlashLoanArbitrage
 * @notice Executes arbitrage between two DEXes using Aave flash loans.
 * @dev Deploy this contract, then call executeArbitrage() when opportunity exists.
 */
contract FlashLoanArbitrage {
    // Aave V3 Pool on mainnet
    address public constant AAVE_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    address public immutable owner;

    struct ArbitrageParams {
        address tokenIn;      // token to borrow and sell on DEX A
        address tokenOut;     // token to buy on DEX A, sell on DEX B
        address dexA;         // buy tokenOut here (cheaper)
        address dexB;         // sell tokenOut here (more expensive)
        uint256 minProfit;    // minimum profit in tokenIn to proceed
    }

    event ArbitrageExecuted(
        address indexed tokenIn,
        uint256 borrowed,
        uint256 profit
    );

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Initiate a flash loan arbitrage.
     * @param params Encoded ArbitrageParams
     * @param amount Amount of tokenIn to borrow
     */
    function executeArbitrage(bytes calldata params, uint256 amount) external {
        require(msg.sender == owner, "Not owner");

        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));

        address[] memory assets = new address[](1);
        assets[0] = arbParams.tokenIn;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 = flash loan (no debt)

        // Aave calls executeOperation() on this contract after sending funds
        IPool(AAVE_POOL).flashLoan(
            address(this),  // receiver
            assets,
            amounts,
            modes,
            address(this),  // onBehalfOf
            params,         // passed through to executeOperation
            0               // referral code
        );
    }

    /**
     * @notice Called by Aave after sending flash loan funds.
     * @dev Must approve Aave to pull back (amount + premium) before returning.
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // Security: only Aave pool can call this
        require(msg.sender == AAVE_POOL, "Not Aave");
        require(initiator == address(this), "Not self-initiated");

        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));
        address tokenIn = assets[0];
        uint256 borrowed = amounts[0];
        uint256 fee = premiums[0]; // 0.09% of borrowed amount

        // ── Execute Arbitrage ──────────────────────────────────────────────

        // Step 1: Approve DEX A to spend tokenIn
        IERC20(tokenIn).approve(arbParams.dexA, borrowed);

        // Step 2: Swap tokenIn → tokenOut on DEX A (buy cheap)
        address[] memory pathA = new address[](2);
        pathA[0] = tokenIn;
        pathA[1] = arbParams.tokenOut;

        uint256[] memory amountsA = IUniswapV2Router(arbParams.dexA)
            .swapExactTokensForTokens(
                borrowed,
                0, // accept any amount (we check profit at the end)
                pathA,
                address(this),
                block.timestamp
            );
        uint256 tokenOutReceived = amountsA[amountsA.length - 1];

        // Step 3: Approve DEX B to spend tokenOut
        IERC20(arbParams.tokenOut).approve(arbParams.dexB, tokenOutReceived);

        // Step 4: Swap tokenOut → tokenIn on DEX B (sell expensive)
        address[] memory pathB = new address[](2);
        pathB[0] = arbParams.tokenOut;
        pathB[1] = tokenIn;

        uint256[] memory amountsB = IUniswapV2Router(arbParams.dexB)
            .swapExactTokensForTokens(
                tokenOutReceived,
                0,
                pathB,
                address(this),
                block.timestamp
            );
        uint256 tokenInReceived = amountsB[amountsB.length - 1];

        // ── Verify Profitability ───────────────────────────────────────────

        uint256 totalRepayment = borrowed + fee;
        require(tokenInReceived > totalRepayment, "Not profitable");

        uint256 profit = tokenInReceived - totalRepayment;
        require(profit >= arbParams.minProfit, "Profit below minimum");

        // ── Repay Flash Loan ───────────────────────────────────────────────

        // Approve Aave to pull back the loan + fee
        IERC20(tokenIn).approve(AAVE_POOL, totalRepayment);

        // Transfer profit to owner
        IERC20(tokenIn).transfer(owner, profit);

        emit ArbitrageExecuted(tokenIn, borrowed, profit);

        return true; // must return true to signal success
    }

    /**
     * @notice Withdraw any tokens stuck in this contract.
     */
    function withdraw(address token) external {
        require(msg.sender == owner, "Not owner");
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, balance);
    }
}
```

Off-chain bot to detect and execute arbitrage opportunities:

```typescript
import { ethers } from "ethers";

const UNISWAP_PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

async function findArbitrageOpportunity(
  pairA: string,
  pairB: string,
  provider: ethers.Provider
): Promise<{ profitable: boolean; profit: bigint; optimalAmount: bigint }> {
  const [pairAContract, pairBContract] = [
    new ethers.Contract(pairA, UNISWAP_PAIR_ABI, provider),
    new ethers.Contract(pairB, UNISWAP_PAIR_ABI, provider),
  ];

  const [reservesA, reservesB] = await Promise.all([
    pairAContract.getReserves(),
    pairBContract.getReserves(),
  ]);

  // Price on DEX A: reserve1/reserve0
  const priceA = Number(reservesA.reserve1) / Number(reservesA.reserve0);
  // Price on DEX B: reserve1/reserve0
  const priceB = Number(reservesB.reserve1) / Number(reservesB.reserve0);

  const priceDiff = Math.abs(priceA - priceB) / Math.min(priceA, priceB);

  // Need >0.6% price difference to cover 2x 0.3% fees
  if (priceDiff < 0.006) {
    return { profitable: false, profit: 0n, optimalAmount: 0n };
  }

  // Simplified optimal amount calculation
  // In production: use calcOptimalAmount() with full AMM math
  const optimalAmount = ethers.parseUnits("10000", 6); // 10,000 USDC

  // Estimate profit (simplified)
  const estimatedProfit = BigInt(Math.floor(priceDiff * 10000)) * optimalAmount / 10000n;
  const flashLoanFee = optimalAmount * 9n / 10000n; // 0.09%

  const netProfit = estimatedProfit - flashLoanFee;

  return {
    profitable: netProfit > 0n,
    profit: netProfit,
    optimalAmount,
  };
}
```

---

## Common Mistakes and Gotchas

**1. Using DEX spot prices as oracles**  
This is the root cause of most flash loan attacks. If your protocol reads price from `pair.getReserves()` and uses it for financial calculations, it can be manipulated in a single transaction. Always use Chainlink or a TWAP with a sufficient window.

**2. Same-block governance voting**  
If your governance allows voting with tokens in the same block they were acquired, flash loans can be used to borrow governance tokens, vote, and return them — all in one transaction. Require tokens to be held for at least one block (or use a snapshot mechanism) before they can vote.

**3. Not checking `initiator` in `executeOperation`**  
Anyone can call `flashLoan` with your contract as the receiver. If you don't verify that `initiator == address(this)`, a malicious actor can trigger your `executeOperation` with arbitrary params. Always validate the initiator.

**4. Reentrancy during flash loan execution**  
Your `executeOperation` function calls external contracts (DEXes, lending protocols). Any of these can re-enter your contract. Apply the nonReentrant modifier and follow CEI pattern even inside flash loan callbacks.

**5. Assuming flash loans are always the attack vector**  
Flash loans amplify capital but aren't always necessary. The Euler Finance hack ($197M) didn't use flash loans — it exploited a logic error in the donation mechanism. Flash loans are a tool; the vulnerability is always in the protocol logic.

---

## How This Connects to Production

Aave V3 is the largest flash loan provider, offering uncollateralized loans in any asset in its pools. dYdX also offers flash loans. Uniswap V3 has a flash swap mechanism (borrow tokens, use them, repay in the same callback). The bZx attacks in 2020 were the first high-profile flash loan exploits, demonstrating that flash loans could be used to manipulate oracle prices. Since then, every serious DeFi protocol has been designed with flash loan resistance in mind — using TWAPs, Chainlink feeds, and avoiding same-block price reads. MEV bots use flash loans constantly for arbitrage — it's estimated that hundreds of millions in arbitrage profit is extracted from DeFi every month using flash loan-powered strategies.

---

## What to Learn Next

- **Token Vesting and Staking Contracts: Architecture and Patterns** — build the incentive layer on top of DeFi primitives.
- **Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)** — understand the oracle layer that flash loan attacks target.
- **Smart Contract Audit Process: What Auditors Actually Look For** — learn how auditors specifically test for flash loan vulnerabilities.
