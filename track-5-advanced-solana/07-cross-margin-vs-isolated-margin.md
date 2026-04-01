# Cross-Margin vs Isolated Margin in On-Chain Perpetuals

**Track:** Expert  
**Read time:** 10 min

---

## The Problem

You're designing the margin system for a perpetual futures protocol. You need to decide: should users have one shared margin account for all positions (cross-margin), or a separate margin account per position (isolated margin)? The choice affects capital efficiency, liquidation risk, user experience, and protocol complexity. Get it wrong and either your users get liquidated too easily or your protocol accumulates bad debt.

---

## Core Concepts

### Cross-Margin: One Pool, All Positions

In cross-margin, all of a user's positions share a single margin pool. Profits from one position offset losses from another.

```
User's cross-margin account: $10,000 USDC

Position 1: Long ETH, $5,000 notional, 5x leverage
Position 2: Short BTC, $3,000 notional, 3x leverage

If ETH drops 10%: Position 1 loses $500
But BTC also drops 10%: Position 2 gains $300
Net loss: $200 (not $500)

Margin ratio = (equity) / (total notional)
             = ($10,000 - $200) / ($5,000 + $3,000)
             = $9,800 / $8,000 = 122.5%
```

**Advantages:**
- Capital efficient — one pool covers all positions
- Hedged positions benefit from netting
- Fewer transactions (one deposit covers everything)

**Disadvantages:**
- One bad position can liquidate everything
- More complex to implement (need to track all positions together)
- Harder for users to understand their risk

### Isolated Margin: One Pool Per Position

In isolated margin, each position has its own margin. A position can only lose what's in its isolated margin.

```
Position 1: Long ETH, $1,000 isolated margin, 5x leverage
Position 2: Short BTC, $500 isolated margin, 3x leverage

If ETH drops 20%: Position 1 is liquidated (loses $1,000)
Position 2 is unaffected — it has its own margin
```

**Advantages:**
- Risk is contained — one position can't blow up your whole account
- Easier to reason about risk per position
- Simpler to implement

**Disadvantages:**
- Less capital efficient
- Can't use profits from one position to save another
- More transactions (deposit per position)

### The Hybrid: Portfolio Margin

Some protocols (dYdX V4, Drift V2) implement portfolio margin — a sophisticated cross-margin system that accounts for correlations between positions:

```
Long ETH + Short BTC:
- These are correlated (both crypto)
- Portfolio margin gives a discount on margin requirements
- Less margin needed than two isolated positions

Long ETH + Short AAPL (if available):
- Less correlated
- Smaller discount
```

---

## Code Walkthrough

Cross-margin account implementation in Anchor:

```rust
use anchor_lang::prelude::*;

declare_id!("MarginProgram111111111111111111111111111111111");

#[program]
pub mod margin_system {
    use super::*;

    /// Deposit to cross-margin account
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        ctx.accounts.margin_account.equity += amount as i64;
        ctx.accounts.margin_account.free_collateral += amount as i64;
        Ok(())
    }

    /// Open a position using cross-margin
    pub fn open_position(
        ctx: Context<OpenPosition>,
        notional: u64,
        is_long: bool,
        leverage: u8,
    ) -> Result<()> {
        let account = &mut ctx.accounts.margin_account;

        // Calculate required initial margin
        let initial_margin = notional / leverage as u64;
        require!(
            account.free_collateral >= initial_margin as i64,
            MarginError::InsufficientMargin
        );

        // Reserve margin for this position
        account.free_collateral -= initial_margin as i64;
        account.used_margin += initial_margin as i64;

        // Add position to account
        let position = Position {
            notional,
            is_long,
            entry_price: ctx.accounts.oracle_price.price as u64,
            unrealized_pnl: 0,
            initial_margin,
        };

        account.positions.push(position);
        account.total_notional += notional;

        Ok(())
    }

    /// Check if account is liquidatable (cross-margin)
    pub fn check_liquidation(ctx: Context<CheckLiquidation>) -> Result<bool> {
        let account = &ctx.accounts.margin_account;
        let current_price = ctx.accounts.oracle_price.price as u64;

        // Recalculate all unrealized PnL
        let total_unrealized_pnl: i64 = account.positions.iter().map(|pos| {
            let price_change = current_price as i64 - pos.entry_price as i64;
            let pnl = if pos.is_long {
                (pos.notional as i64 * price_change) / pos.entry_price as i64
            } else {
                -(pos.notional as i64 * price_change) / pos.entry_price as i64
            };
            pnl
        }).sum();

        // Total equity = deposited equity + unrealized PnL
        let total_equity = account.equity + total_unrealized_pnl;

        // Maintenance margin = 5% of total notional
        let maintenance_margin = account.total_notional as i64 / 20;

        let is_liquidatable = total_equity < maintenance_margin;

        if is_liquidatable {
            msg!("Account liquidatable: equity={}, maintenance={}", total_equity, maintenance_margin);
        }

        Ok(is_liquidatable)
    }
}

#[account]
pub struct MarginAccount {
    pub owner: Pubkey,
    pub equity: i64,              // total deposited (in USDC, 6 decimals)
    pub free_collateral: i64,     // available for new positions
    pub used_margin: i64,         // reserved for open positions
    pub total_notional: u64,      // sum of all position notionals
    pub positions: Vec<Position>, // all open positions
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Position {
    pub notional: u64,
    pub is_long: bool,
    pub entry_price: u64,
    pub unrealized_pnl: i64,
    pub initial_margin: u64,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + 8 + 8 + 8 + 8 + 4 + (50 * 41) + 1, // space for 50 positions
        seeds = [b"margin", owner.key().as_ref()],
        bump
    )]
    pub margin_account: Account<'info, MarginAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut, has_one = owner, seeds = [b"margin", owner.key().as_ref()], bump)]
    pub margin_account: Account<'info, MarginAccount>,
    pub owner: Signer<'info>,
    /// CHECK: oracle price account
    pub oracle_price: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CheckLiquidation<'info> {
    pub margin_account: Account<'info, MarginAccount>,
    /// CHECK: oracle price account
    pub oracle_price: AccountInfo<'info>,
}

#[error_code]
pub enum MarginError {
    #[msg("Insufficient free collateral")]
    InsufficientMargin,
}
```

TypeScript: calculating margin requirements and health:

```typescript
interface Position {
  notional: number;
  isLong: boolean;
  entryPrice: number;
  initialMargin: number;
}

interface MarginAccount {
  equity: number;
  positions: Position[];
}

function calculateCrossMarginHealth(
  account: MarginAccount,
  currentPrices: Map<string, number>
): {
  totalEquity: number;
  maintenanceMargin: number;
  marginRatio: number;
  isLiquidatable: boolean;
} {
  const totalNotional = account.positions.reduce((sum, p) => sum + p.notional, 0);

  const unrealizedPnl = account.positions.reduce((sum, pos) => {
    const currentPrice = currentPrices.get("ETH") ?? pos.entryPrice;
    const priceChange = currentPrice - pos.entryPrice;
    const pnl = pos.isLong
      ? (pos.notional * priceChange) / pos.entryPrice
      : -(pos.notional * priceChange) / pos.entryPrice;
    return sum + pnl;
  }, 0);

  const totalEquity = account.equity + unrealizedPnl;
  const maintenanceMargin = totalNotional * 0.05; // 5% maintenance margin
  const marginRatio = totalEquity / totalNotional;

  return {
    totalEquity,
    maintenanceMargin,
    marginRatio,
    isLiquidatable: totalEquity < maintenanceMargin,
  };
}

// Compare: same positions in isolated vs cross margin
function compareMarginModes() {
  const positions: Position[] = [
    { notional: 10000, isLong: true, entryPrice: 2000, initialMargin: 1000 },  // Long ETH 10x
    { notional: 5000, isLong: false, entryPrice: 50000, initialMargin: 500 },  // Short BTC 10x
  ];

  // Scenario: ETH drops 15%, BTC drops 10%
  const prices = new Map([["ETH", 1700], ["BTC", 45000]]);

  // Cross-margin: positions net against each other
  const crossAccount: MarginAccount = {
    equity: 1500, // $1,500 total deposit
    positions,
  };
  const crossHealth = calculateCrossMarginHealth(crossAccount, prices);
  console.log("Cross-margin equity:", crossHealth.totalEquity.toFixed(2));
  console.log("Cross-margin liquidatable:", crossHealth.isLiquidatable);

  // Isolated margin: each position independent
  const ethPnl = (10000 * (1700 - 2000)) / 2000; // -$1,500
  const btcPnl = -(5000 * (45000 - 50000)) / 50000; // +$500

  console.log("Isolated ETH position equity:", (1000 + ethPnl).toFixed(2)); // -$500 → liquidated
  console.log("Isolated BTC position equity:", (500 + btcPnl).toFixed(2));  // $1,000 → safe
}
```

---

## Common Mistakes and Gotchas

**1. Not accounting for unrealized PnL in cross-margin health**  
Cross-margin health must include unrealized PnL from all positions. A common bug: only checking deposited equity without adding unrealized gains/losses. This leads to incorrect liquidation triggers.

**2. Allowing too many positions in cross-margin**  
If you store positions in a Vec inside the margin account, the account size grows with each position. Set a maximum (e.g., 20 positions) and enforce it. Alternatively, use separate position accounts and aggregate health off-chain.

**3. Not handling partial liquidations in cross-margin**  
When a cross-margin account is liquidatable, you typically close the riskiest position first (not all positions). Implement a priority system: close the position with the worst margin ratio first.

**4. Isolated margin with no way to add margin**  
Users should be able to add margin to an isolated position to avoid liquidation. If your isolated margin system doesn't support this, users will be liquidated unnecessarily during temporary price dips.

**5. Not considering funding payments in margin calculations**  
Funding payments reduce margin over time. A position that's healthy today might be liquidatable tomorrow after several funding periods. Include accrued funding in your margin health calculations.

---

## How This Connects to Production

dYdX V4 uses cross-margin with portfolio margining — positions in correlated assets require less margin. Drift Protocol V2 uses cross-margin with a sophisticated health calculation that accounts for all positions simultaneously. GMX uses isolated margin by default — each position has its own collateral. Binance and Bybit offer both modes and let users choose. The trend in DeFi is toward cross-margin with portfolio margining because it's more capital efficient, but it requires more complex implementation and more sophisticated liquidation logic.

---

## What to Learn Next

- **vAMM Architecture: How Perpetual DEXes Price Without an Orderbook** — the pricing mechanism that works with these margin systems.
- **Funding Rate Mechanics in Perpetual Futures** — the cash flows that affect margin over time.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build the bots that liquidate undercollateralized positions.
