---
title: "Building a Liquidation Bot: The Parts Nobody Writes About"
date: 2024-05-20
tags: [solana, keeper-bot, liquidation, infrastructure, production]
---

I've been running a liquidation bot on a Solana lending protocol for about two months. The technical parts — detecting undercollateralized positions, building the transaction, submitting it — took about a week to build. The operational parts — keeping it running reliably, handling failures, not losing money on bad liquidations — took the other seven weeks.

This post is about the operational parts, because that's where the real work is.

## The happy path is easy

The basic liquidation loop is straightforward:

1. Subscribe to position account updates via Geyser
2. Decode each update, calculate health factor
3. If health factor < 1.0, build a liquidation transaction
4. Simulate the transaction to verify profitability
5. Submit via Jito for guaranteed inclusion
6. Confirm and log

I had this working in a week. The problem is that the happy path is maybe 60% of what actually happens.

## The race condition problem

Multiple bots are watching the same positions. When a position becomes liquidatable, every bot sees it at roughly the same time and tries to liquidate it. Only one wins.

The naive approach — just submit your transaction and hope — wastes fees on failed transactions. At $0.00025 per transaction, this sounds trivial. But if you're submitting 100 failed transactions per hour, it adds up. More importantly, failed transactions mean you're not liquidating positions you should be.

The solution I landed on: Jito bundles. Jito is Solana's MEV infrastructure. You submit a bundle — a set of transactions that execute atomically — with a tip to the Jito validator. If your bundle is included, it executes atomically. If another bot's bundle is included first, yours fails cleanly without wasting fees.

```typescript
// Submit via Jito instead of directly
const bundle = new Bundle([liquidationTx, tipTx], 5);
const bundleId = await searcherClient.sendBundle(bundle);
```

The tip is the competitive element. You're essentially bidding for the right to execute the liquidation. The profit from the liquidation has to exceed the tip plus gas costs.

## Simulation is not optional

Before submitting any liquidation, I simulate it. This catches:

- Positions that were already liquidated by another bot (between when I detected them and when I submit)
- Positions where the price moved enough that the liquidation is no longer profitable
- Transactions that would fail for other reasons (wrong accounts, insufficient liquidity)

```typescript
const simulation = await connection.simulateTransaction(tx, {
  sigVerify: false,
  replaceRecentBlockhash: true,
});

if (simulation.value.err) {
  // Don't submit — save the fee
  console.log("Simulation failed:", simulation.value.err);
  return;
}

const cuUsed = simulation.value.unitsConsumed ?? 200_000;
// Only submit if profitable after accounting for actual gas cost
```

The simulation adds ~50ms of latency. That's a real cost in a competitive environment. But the alternative — submitting transactions that fail — is worse.

## The profitability calculation is harder than it looks

A liquidation is profitable if:

```
profit = collateral_received - debt_repaid - gas_cost - jito_tip
```

The collateral received depends on the current price of the collateral asset. The debt repaid is fixed. The gas cost is predictable. The Jito tip is variable — you set it based on how competitive you want to be.

The tricky part: prices move between when you calculate profitability and when the transaction executes. If the collateral price drops 2% in the 200ms between your calculation and execution, a profitable liquidation becomes unprofitable.

I handle this by:
1. Using a conservative price estimate (current price minus 1%)
2. Setting a minimum profit threshold ($5 after all costs)
3. Accepting that some liquidations I could have done profitably, I'll pass on

The alternative — being aggressive on price estimates — means occasionally executing unprofitable liquidations. That's worse than missing some profitable ones.

## The infrastructure problem

The bot needs to run 24/7. It needs to restart automatically if it crashes. It needs to alert me if it stops working. It needs to handle Geyser disconnections gracefully.

I'm running it on a $20/month VPS (2 vCPU, 4GB RAM). That's enough for the compute. The important parts:

**Systemd for process management:**
```ini
[Unit]
Description=Liquidation Bot
After=network.target

[Service]
Type=simple
User=bot
WorkingDirectory=/home/bot/liquidation-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Geyser reconnection with exponential backoff:**
```typescript
async function connectWithRetry(attempt = 0): Promise<void> {
  try {
    await startGeyserStream();
  } catch (err) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
    console.error(`Geyser disconnected, retrying in ${delay}ms`);
    setTimeout(() => connectWithRetry(attempt + 1), delay);
  }
}
```

**Heartbeat monitoring:**
I send a ping to a monitoring service (I use Uptime Robot's free tier) every 60 seconds. If the ping stops, I get a text message. This has caught two situations where the bot was running but not actually processing updates.

## The wallet management problem

The bot wallet needs enough SOL to pay for transactions. If it runs out, the bot stops working silently — transactions just fail.

I set up automatic refilling: if the bot wallet balance drops below 0.1 SOL, it sends an alert and I manually top it up. I keep about 1 SOL in the bot wallet at all times, which is enough for several thousand transactions.

I also keep the bot wallet separate from any significant funds. It's a hot wallet — the private key is on the server. I only keep what's needed for operations.

## What I've learned about running production bots

The code is the easy part. The hard parts are:

1. **Handling every failure mode gracefully.** RPC errors, Geyser disconnections, failed simulations, insufficient balance — each one needs explicit handling.

2. **Monitoring everything.** If you don't know the bot is broken, you can't fix it. Log everything, alert on anomalies.

3. **Being conservative on profitability.** Missing a profitable liquidation is fine. Executing an unprofitable one is not.

4. **Keeping the wallet funded.** Obvious in retrospect, embarrassing when you forget.

5. **Testing failure scenarios.** I deliberately killed the Geyser connection, drained the wallet, and submitted transactions during high congestion to see how the bot handled each case. Most of the bugs I found were in the failure paths, not the happy path.

## Is it profitable?

Yes, but not dramatically. The liquidation bot market on Solana is competitive. The margins are thin. I'm making enough to cover the server costs and a bit more.

The real value for me isn't the profit — it's the learning. Running a production bot has taught me more about Solana's internals than any tutorial. I understand Geyser, Jito, transaction anatomy, and the economics of MEV in a way I couldn't have learned any other way.

---

*I'll write a follow-up about the specific Jito integration — the bundle format, the tip calculation, and how to handle bundle failures. It's more nuanced than the docs suggest.*
