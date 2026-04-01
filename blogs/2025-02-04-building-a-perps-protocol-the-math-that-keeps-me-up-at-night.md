---
title: "Building a Perps Protocol: The Math That Keeps Me Up at Night"
date: 2025-02-04
tags: [solana, perpetuals, vamm, funding-rate, defi, math]
---

I've been building a perpetual futures protocol on Solana for four months. It's the most technically demanding thing I've worked on. I want to write about the specific mathematical problems that have been hardest to get right, because I haven't seen them written about clearly anywhere.

## The vAMM pricing problem

My protocol uses a virtual AMM for price discovery. The constant product formula `x * y = k` determines the mark price. When traders open long positions, they "buy" virtual base tokens, pushing the price up. When they open shorts, they "sell" virtual base tokens, pushing the price down.

The problem: the vAMM price can diverge significantly from the index price (the real-world price from an oracle). If ETH is trading at $3,000 on Binance but my vAMM shows $3,200, there's a 6.7% divergence. That's bad for traders and bad for the protocol.

The funding rate is supposed to fix this. When mark > index, longs pay shorts, which discourages longs and encourages shorts, which pushes the mark price down toward index. In theory.

In practice, the funding rate has to be calibrated carefully. Too aggressive and you're liquidating traders who are right about the direction but wrong about the timing. Too weak and the divergence persists.

I spent three weeks on the funding rate formula. Here's what I landed on:

```rust
pub fn calculate_funding_rate(
    mark_twap: u128,
    index_price: u128,
    elapsed: u64,
    funding_period: u64,
) -> i128 {
    // Use TWAP to prevent manipulation
    // Funding rate = (mark_twap - index) / index * (elapsed / period)
    let premium = if mark_twap > index_price {
        (mark_twap - index_price) as i128
    } else {
        -((index_price - mark_twap) as i128)
    };

    let rate = premium
        .checked_mul(elapsed as i128).unwrap()
        .checked_div(index_price as i128).unwrap()
        .checked_div(funding_period as i128).unwrap();

    // Cap at 1% per period to prevent extreme payments
    rate.max(-10_000_000).min(10_000_000) // 1% in 1e9 precision
}
```

The TWAP is critical. If I used the instantaneous mark price, a large trader could temporarily move the price to collect favorable funding, then close their position. The TWAP makes this much more expensive.

## The liquidation math

A position is liquidatable when the health factor drops below 1.0:

```
health_factor = (collateral * liquidation_threshold) / total_debt
```

Simple enough. The hard part is what happens when you liquidate.

In a cross-margin system, you don't liquidate the entire account — you close the riskiest position first. But "riskiest" is ambiguous. Is it the position with the lowest health factor? The largest notional? The one that's most underwater?

I went with "largest unrealized loss" as the primary sort key, with "largest notional" as a tiebreaker. The intuition: the position that's losing the most money is the one most likely to cause bad debt if not closed quickly.

```rust
pub fn find_position_to_liquidate(
    positions: &[Position],
    mark_prices: &HashMap<Pubkey, u128>,
) -> Option<usize> {
    positions
        .iter()
        .enumerate()
        .filter_map(|(i, pos)| {
            let mark_price = mark_prices.get(&pos.market)?;
            let unrealized_pnl = calculate_unrealized_pnl(pos, *mark_price);
            if unrealized_pnl < 0 {
                Some((i, unrealized_pnl.abs()))
            } else {
                None
            }
        })
        .max_by_key(|(_, loss)| *loss)
        .map(|(i, _)| i)
}
```

## The bad debt problem

When a position is liquidated, the liquidator repays the debt and receives the collateral at a discount (the liquidation bonus). But what if the collateral value has dropped so much that it's worth less than the debt?

```
debt = $1,000
collateral value = $800
shortfall = $200
```

This $200 is "bad debt" — the protocol owes it to someone but has no way to recover it. If bad debt accumulates, the protocol becomes insolvent.

My solution: an insurance fund. A portion of trading fees goes into the insurance fund. When bad debt occurs, it's covered by the insurance fund. If the insurance fund is depleted, losses are socialized across all profitable positions (the "socialized loss" mechanism).

The insurance fund math:

```rust
pub fn handle_bad_debt(
    bad_debt: u64,
    insurance_fund: &mut u64,
    profitable_positions: &mut [Position],
) {
    if *insurance_fund >= bad_debt {
        *insurance_fund -= bad_debt;
        return;
    }

    // Insurance fund insufficient — socialize remaining loss
    let remaining = bad_debt - *insurance_fund;
    *insurance_fund = 0;

    let total_profit: u64 = profitable_positions
        .iter()
        .filter_map(|p| p.unrealized_pnl.checked_abs().map(|v| v as u64))
        .sum();

    if total_profit == 0 {
        return; // nothing to socialize against
    }

    for pos in profitable_positions.iter_mut() {
        if pos.unrealized_pnl > 0 {
            let share = (pos.unrealized_pnl as u64 * remaining) / total_profit;
            pos.unrealized_pnl -= share as i64;
        }
    }
}
```

I hate this code. Socializing losses is unfair to profitable traders. But the alternative — letting bad debt accumulate — is worse. This is a known tradeoff in perpetuals protocol design.

## The precision problem

Everything in Solana programs is integer arithmetic. No floating point. This means you have to be very careful about precision.

The funding rate is calculated in 1e9 precision (1,000,000,000 = 100%). The mark price is in 1e9 precision. Position sizes are in lamports (1e9 per SOL) or token base units.

When you multiply two 1e9-precision numbers, you get a 1e18-precision result. If you don't scale back down, you overflow u64 (max ~1.8e19). If you scale down too aggressively, you lose precision.

I've had three precision bugs in this protocol. All of them were in the funding payment calculation. The pattern:

```rust
// WRONG: overflows for large positions
let payment = position_size * funding_rate / 1_000_000_000;

// WRONG: loses precision for small positions
let payment = (position_size / 1_000_000_000) * funding_rate;

// RIGHT: use u128 for intermediate calculations
let payment = (position_size as u128 * funding_rate.unsigned_abs() as u128)
    / 1_000_000_000u128;
let payment = payment as u64;
```

Using u128 for intermediate calculations gives you enough headroom to avoid overflow while maintaining precision. I now use u128 for any multiplication that could overflow u64.

## What I'm still not sure about

The k adjustment. The vAMM's invariant `k = x * y` determines the price impact of trades. A larger k means less price impact per trade (more "liquidity"). But k is a parameter I set, not something that emerges from real liquidity.

If I set k too small, large trades have huge price impact and the protocol is unusable. If I set k too large, the mark price barely moves and the funding rate can't anchor it to the index.

I've been adjusting k based on open interest — as more positions are opened, k increases to reduce price impact. But I'm not confident this is the right approach. The relationship between k and protocol health is complex and I don't have a good theoretical framework for it.

This is the thing that keeps me up at night. Everything else I can reason about clearly. The k adjustment feels like I'm tuning a parameter I don't fully understand.

## When it ships

I'm targeting a devnet deployment in March and mainnet in Q2. The core mechanics are working. The remaining work is mostly edge cases, monitoring, and the keeper bot infrastructure.

I'll write a post-mortem after the mainnet launch — what worked, what didn't, what I'd do differently. That's usually where the most interesting learning happens.

---

*If you're building something similar and want to compare notes on the vAMM math, reach out. I've found very few people who've worked through these specific problems and I'd genuinely value the conversation.*
