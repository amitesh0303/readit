# Pyth Network Oracle Integration: Real-Time Price Feeds on Solana

**Track:** Expert  
**Read time:** 11 min

---

## The Problem

Your Solana protocol needs real-time price data. Chainlink is the standard on Ethereum, but on Solana, Pyth Network is the dominant oracle. Pyth works differently — it's a "pull oracle" where prices are published by first-party data providers (exchanges, market makers) and updated every 400ms. Getting the integration right means understanding confidence intervals, staleness checks, and the difference between Pyth's on-chain and off-chain price feeds.

---

## Core Concepts

### Pyth vs Chainlink

| | Chainlink | Pyth |
|--|-----------|------|
| Update model | Push (nodes push on-chain) | Pull (consumers pull from off-chain) |
| Update frequency | Every heartbeat or deviation | Every 400ms (off-chain), on-demand (on-chain) |
| Data providers | Node operators | First-party (exchanges, market makers) |
| Confidence interval | No | Yes (price uncertainty range) |
| Chains | EVM-native | Multi-chain (Solana, EVM, Cosmos) |

### The Confidence Interval

Pyth's killer feature: every price comes with a confidence interval. Instead of just "ETH = $2,000", Pyth gives you "ETH = $2,000 ± $5". This tells you how certain the oracle is about the price.

```
Price: $2,000
Confidence: $5
Meaning: the true price is likely between $1,995 and $2,005

During normal markets: confidence is small (< 0.1% of price)
During volatile markets: confidence widens (can be 1-5% of price)
During oracle issues: confidence can be very large
```

Protocols use the confidence interval to protect against oracle manipulation:

```
// Conservative: use price - confidence (worst case for longs)
uint256 safePrice = price - confidence;

// Aggressive: use price + confidence (worst case for shorts)
uint256 safePrice = price + confidence;

// Reject if confidence is too wide (oracle uncertainty too high)
require(confidence < price / 100, "Oracle confidence too low"); // reject if > 1%
```

### Pull Oracle Model

Pyth's on-chain price accounts are updated by users, not by Pyth nodes. When you need a price:

1. Fetch the latest price data from Pyth's off-chain API (Hermes)
2. Include the price update in your transaction
3. Your program calls `pyth_solana_receiver::update_price_feeds` to update the on-chain account
4. Your program reads the updated price

This "pull" model means prices are always fresh when you need them, without paying for continuous on-chain updates.

---

## Code Walkthrough

**Anchor program with Pyth integration:**

```rust
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

declare_id!("YourProtocol111111111111111111111111111111111");

// Pyth price feed IDs (hex strings from pyth.network/developers/price-feed-ids)
const ETH_USD_FEED_ID: &str = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const BTC_USD_FEED_ID: &str = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

const MAX_PRICE_AGE_SECONDS: u64 = 60; // reject prices older than 60 seconds

#[program]
pub mod protocol {
    use super::*;

    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        // Get validated ETH price from Pyth
        let eth_price = get_validated_price(
            &ctx.accounts.eth_price_update,
            ETH_USD_FEED_ID,
            MAX_PRICE_AGE_SECONDS,
        )?;

        msg!("ETH price: ${} (confidence: ${})",
            eth_price.price as f64 / 10f64.powi(eth_price.exponent.abs() as i32),
            eth_price.conf as f64 / 10f64.powi(eth_price.exponent.abs() as i32)
        );

        // Use price for collateral valuation
        let collateral_value_usd = calculate_collateral_value(amount, &eth_price)?;

        // ... rest of deposit logic
        Ok(())
    }
}

/// Validate and extract price from Pyth price update account
fn get_validated_price(
    price_update: &Account<PriceUpdateV2>,
    feed_id_hex: &str,
    max_age_seconds: u64,
) -> Result<pyth_solana_receiver_sdk::price_update::Price> {
    let feed_id = get_feed_id_from_hex(feed_id_hex)
        .map_err(|_| error!(OracleError::InvalidFeedId))?;

    // get_price_no_older_than validates:
    // 1. Feed ID matches
    // 2. Price is not older than max_age_seconds
    // 3. Price is positive
    let price = price_update
        .get_price_no_older_than(
            &Clock::get()?,
            max_age_seconds,
            &feed_id,
        )
        .map_err(|_| error!(OracleError::StalePrice))?;

    // Validate confidence interval
    // Reject if confidence > 1% of price (oracle uncertainty too high)
    let max_confidence = price.price as u64 / 100;
    require!(price.conf <= max_confidence, OracleError::LowConfidence);

    Ok(price)
}

fn calculate_collateral_value(
    amount: u64,
    price: &pyth_solana_receiver_sdk::price_update::Price,
) -> Result<u64> {
    // price.price is i64, price.exponent is i32 (usually negative, e.g., -8)
    // actual_price = price.price * 10^exponent
    // For ETH/USD: price = 200000000000, exponent = -8 → $2,000.00

    require!(price.price > 0, OracleError::NegativePrice);

    let price_u64 = price.price as u64;
    let exponent = price.exponent; // e.g., -8

    // Normalize to 6 decimal places for USDC comparison
    // value = amount * price / 10^(token_decimals + |exponent| - 6)
    let value = if exponent < 0 {
        let scale = 10u64.pow((-exponent) as u32);
        amount * price_u64 / scale
    } else {
        amount * price_u64 * 10u64.pow(exponent as u32)
    };

    Ok(value)
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Pyth price update account — passed in by the user with fresh price data
    /// The user fetches this from Hermes and includes it in the transaction
    pub eth_price_update: Account<'info, PriceUpdateV2>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum OracleError {
    #[msg("Invalid Pyth feed ID")]
    InvalidFeedId,
    #[msg("Price is too old")]
    StalePrice,
    #[msg("Oracle confidence interval too wide")]
    LowConfidence,
    #[msg("Negative price")]
    NegativePrice,
}
```

**TypeScript: fetching Pyth prices and including them in transactions:**

```typescript
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { HermesClient } from "@pythnetwork/hermes-client";

const ETH_USD_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function depositWithPythPrice(
  connection: Connection,
  program: anchor.Program<any>,
  userKeypair: anchor.web3.Keypair,
  amount: bigint
) {
  // 1. Fetch latest price from Hermes (Pyth's off-chain price service)
  const hermesClient = new HermesClient("https://hermes.pyth.network");
  const priceUpdates = await hermesClient.getLatestPriceUpdates([ETH_USD_FEED_ID]);

  console.log("ETH price:", priceUpdates.parsed?.[0]?.price.price);
  console.log("Confidence:", priceUpdates.parsed?.[0]?.price.conf);

  // 2. Create Pyth receiver client
  const pythReceiver = new PythSolanaReceiver({ connection, wallet: new anchor.Wallet(userKeypair) });

  // 3. Build transaction with price update + your instruction
  const transactionBuilder = pythReceiver.newTransactionBuilder({
    closeUpdateAccounts: true, // close temp price accounts after use (reclaim rent)
  });

  // Add price update instruction (updates on-chain price account)
  await transactionBuilder.addUpdatePriceFeed(
    [priceUpdates.binary.data[0]],
    0 // shard ID
  );

  // Get the price update account address (created by the update instruction)
  const priceUpdateAccount = transactionBuilder.getPriceUpdateAccount(ETH_USD_FEED_ID);

  // Add your program's instruction
  const depositIx = await program.methods
    .depositCollateral(new anchor.BN(amount.toString()))
    .accounts({
      user: userKeypair.publicKey,
      ethPriceUpdate: priceUpdateAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction();

  transactionBuilder.addInstruction(depositIx);

  // 4. Send the transaction (price update + deposit in one atomic tx)
  const transactions = await transactionBuilder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 50_000,
  });

  for (const tx of transactions) {
    tx.sign([userKeypair]);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    console.log("Transaction confirmed:", sig);
  }
}

// Monitor Pyth prices in real-time (for keeper bots)
async function monitorPythPrices(feedIds: string[], callback: (prices: Map<string, number>) => void) {
  const hermesClient = new HermesClient("https://hermes.pyth.network");

  // Subscribe to streaming price updates
  const eventSource = await hermesClient.getPriceUpdatesStream(feedIds, {
    parsed: true,
    encoding: "base64",
  });

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const prices = new Map<string, number>();

    for (const priceData of data.parsed ?? []) {
      const feedId = "0x" + priceData.id;
      const price = Number(priceData.price.price) * Math.pow(10, priceData.price.expo);
      prices.set(feedId, price);
    }

    callback(prices);
  };

  return eventSource;
}
```

---

## Common Mistakes and Gotchas

**1. Not checking the confidence interval**  
Using `price.price` directly without checking `price.conf` is dangerous. During market stress, the confidence interval can be 5-10% of the price. A protocol that ignores this can be exploited by submitting stale or uncertain prices.

**2. Forgetting to close price update accounts**  
Pyth's pull model creates temporary on-chain accounts to hold price updates. These accounts cost rent (~0.002 SOL). Always set `closeUpdateAccounts: true` to reclaim rent after use.

**3. Using the wrong exponent**  
Pyth prices have an exponent (e.g., -8 for USD feeds). `price.price = 200000000000` with `exponent = -8` means $2,000.00. Forgetting to apply the exponent gives you a price that's off by 10^8.

**4. Not handling the case where price update is too old**  
`get_price_no_older_than` will error if the price is stale. Your program must handle this gracefully — either by reverting with a clear error message or by using a fallback oracle.

**5. Hardcoding feed IDs**  
Pyth feed IDs are stable but can change (e.g., when a feed is deprecated and replaced). Store feed IDs in a configurable location rather than hardcoding them in your program.

---

## How This Connects to Production

Drift Protocol uses Pyth as its primary oracle for all perpetual markets. Mango Markets uses Pyth for position mark-to-market. Kamino Finance (Solana lending) uses Pyth for collateral valuation. The pull oracle model is increasingly popular because it's more gas-efficient than push oracles — you only pay for price updates when you actually need them. Pyth's confidence interval is a unique feature that no other major oracle provides, and protocols that use it properly are significantly more resistant to oracle manipulation attacks.

---

## What to Learn Next

- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — use Pyth prices in your liquidation bot.
- **Funding Rate Mechanics in Perpetual Futures** — Pyth is the index price source for funding calculations.
- **Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)** — compare with Ethereum's dominant oracle.
