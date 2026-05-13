# Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic

**Track:** Expert  
**Read time:** 13 min

---

## The Problem

Your lending protocol is live. Positions are getting undercollateralized. But nobody is liquidating them because you haven't built the keeper bot yet. The protocol is accumulating bad debt. Users are losing money.

Keeper bots are the off-chain infrastructure that keeps DeFi protocols solvent. They monitor on-chain state, detect when action is needed (liquidation, funding settlement, order execution), and submit transactions. Building a reliable keeper bot is harder than it looks — you need to handle RPC failures, transaction failures, race conditions with other bots, and 24/7 uptime.

---

## Core Concepts

### What Keeper Bots Do

Keeper bots perform time-sensitive on-chain actions that can't be automated purely on-chain:

- **Liquidation bots**: monitor health factors, liquidate undercollateralized positions
- **Funding bots**: settle funding rates periodically
- **Order execution bots**: execute limit orders when price conditions are met
- **Rebalancing bots**: rebalance protocol parameters (e.g., interest rates)
- **Oracle update bots**: push price updates on-chain (for protocols using push oracles)

### The Keeper Bot Architecture

```
Data Layer (Geyser/RPC)
    ↓ account updates, transactions
State Manager (in-memory cache)
    ↓ decoded positions, prices
Opportunity Detector
    ↓ "position X is liquidatable"
Transaction Builder
    ↓ build + simulate transaction
Transaction Sender
    ↓ send with priority fee
Confirmation Monitor
    ↓ confirm or retry
Metrics/Alerting
```

### The Race Condition Problem

Multiple bots compete to liquidate the same position. Only one wins. The others waste gas (on EVM) or transaction fees (on Solana). Strategies to win:

1. **Priority fees**: pay more per compute unit to get included first
2. **Speed**: detect opportunities faster (Geyser vs polling)
3. **Jito bundles**: on Solana, use Jito's block engine to guarantee inclusion
4. **Atomic execution**: bundle detection + execution in one atomic operation

### Jito MEV on Solana

Jito is Solana's MEV infrastructure. It allows bots to submit "bundles" — ordered sets of transactions that are guaranteed to execute atomically or not at all. This is critical for liquidation bots:

```
Without Jito:
- Bot detects liquidation opportunity
- Bot sends transaction
- Another bot sends transaction with higher priority fee
- Other bot wins, your transaction fails (wasted fee)

With Jito:
- Bot detects opportunity
- Bot sends bundle with tip to Jito validator
- Bundle executes atomically — no race condition
```

---

## Code Walkthrough

Production liquidation bot for a Solana lending protocol:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SearcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { BN } from "bn.js";

// ── Configuration ──────────────────────────────────────────────────────────

const config = {
  rpcEndpoint: process.env.RPC_ENDPOINT!,
  geyserEndpoint: process.env.GEYSER_ENDPOINT!,
  geyserToken: process.env.GEYSER_TOKEN!,
  jitoEndpoint: process.env.JITO_ENDPOINT!,
  programId: new PublicKey(process.env.PROGRAM_ID!),
  keeperKeypair: Keypair.fromSecretKey(
    Buffer.from(JSON.parse(process.env.KEEPER_PRIVATE_KEY!))
  ),
  minProfitUsd: 5,        // minimum profit to attempt liquidation
  maxPositionsToCheck: 1000,
  jitoTipLamports: 100_000, // 0.0001 SOL tip to Jito
};

// ── State Management ───────────────────────────────────────────────────────

interface Position {
  pubkey: string;
  owner: string;
  collateralAmount: bigint;
  debtAmount: bigint;
  collateralMint: string;
  debtMint: string;
  healthFactor: number;
  lastUpdateSlot: bigint;
}

const positionCache = new Map<string, Position>();
const priceCache = new Map<string, number>(); // mint → USD price
let isProcessingLiquidations = false;

// ── Geyser Stream ──────────────────────────────────────────────────────────

async function startGeyserStream() {
  const client = new Client(config.geyserEndpoint, config.geyserToken, {});
  const stream = await client.subscribe();

  stream.write({
    accounts: {
      positions: {
        account: [],
        owner: [config.programId.toBase58()],
        filters: [
          {
            memcmp: {
              offset: "0",
              data: Buffer.from([/* position discriminator */]).toString("base64"),
              encoding: "base64",
            },
          },
        ],
      },
    },
    transactions: {},
    slots: { slots: {} },
    commitment: CommitmentLevel.CONFIRMED,
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
  });

  stream.on("data", async (update: any) => {
    if (update.account) {
      handleAccountUpdate(update.account);
    }
  });

  stream.on("error", (err: Error) => {
    console.error("Geyser error:", err.message);
    setTimeout(startGeyserStream, 3000);
  });

  console.log("Geyser stream started");
}

function handleAccountUpdate(accountUpdate: any) {
  const pubkey = new PublicKey(accountUpdate.pubkey).toBase58();
  const data = Buffer.from(accountUpdate.data);

  const position = decodePosition(pubkey, data);
  if (!position) return;

  const oldPosition = positionCache.get(pubkey);
  positionCache.set(pubkey, position);

  // Check if this position just became liquidatable
  if (position.healthFactor < 1.0) {
    if (!oldPosition || oldPosition.healthFactor >= 1.0) {
      console.log(`🚨 New liquidation opportunity: ${pubkey.slice(0, 8)}... HF=${position.healthFactor.toFixed(3)}`);
    }
    // Queue for liquidation
    setImmediate(() => attemptLiquidation(position));
  }
}

function decodePosition(pubkey: string, data: Buffer): Position | null {
  try {
    // Skip 8-byte discriminator
    let offset = 8;
    const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58(); offset += 32;
    const collateralMint = new PublicKey(data.slice(offset, offset + 32)).toBase58(); offset += 32;
    const debtMint = new PublicKey(data.slice(offset, offset + 32)).toBase58(); offset += 32;
    const collateralAmount = data.readBigUInt64LE(offset); offset += 8;
    const debtAmount = data.readBigUInt64LE(offset); offset += 8;
    const lastUpdateSlot = data.readBigUInt64LE(offset);

    const collateralPrice = priceCache.get(collateralMint) ?? 0;
    const debtPrice = priceCache.get(debtMint) ?? 0;

    const collateralValue = Number(collateralAmount) * collateralPrice / 1e9;
    const debtValue = Number(debtAmount) * debtPrice / 1e6;

    const LIQUIDATION_THRESHOLD = 0.825;
    const healthFactor = debtValue > 0
      ? (collateralValue * LIQUIDATION_THRESHOLD) / debtValue
      : Infinity;

    return {
      pubkey, owner, collateralAmount, debtAmount,
      collateralMint, debtMint, healthFactor, lastUpdateSlot,
    };
  } catch {
    return null;
  }
}

// ── Liquidation Logic ──────────────────────────────────────────────────────

async function attemptLiquidation(position: Position) {
  if (isProcessingLiquidations) return;
  isProcessingLiquidations = true;

  try {
    // Re-fetch position to get latest state (Geyser update might be slightly stale)
    const connection = new Connection(config.rpcEndpoint, "confirmed");
    const accountInfo = await connection.getAccountInfo(new PublicKey(position.pubkey));
    if (!accountInfo) return;

    const freshPosition = decodePosition(position.pubkey, accountInfo.data);
    if (!freshPosition || freshPosition.healthFactor >= 1.0) {
      console.log("Position no longer liquidatable (already liquidated or price recovered)");
      return;
    }

    // Calculate expected profit
    const profit = calculateLiquidationProfit(freshPosition);
    if (profit < config.minProfitUsd) {
      console.log(`Profit too low: $${profit.toFixed(2)}, skipping`);
      return;
    }

    console.log(`Attempting liquidation: ${position.pubkey.slice(0, 8)}... Expected profit: $${profit.toFixed(2)}`);

    // Build liquidation transaction
    const tx = await buildLiquidationTransaction(freshPosition, connection);

    // Simulate first to check it will succeed
    const simulation = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });

    if (simulation.value.err) {
      console.error("Simulation failed:", simulation.value.err);
      console.error("Logs:", simulation.value.logs?.slice(-5));
      return;
    }

    const cuUsed = simulation.value.unitsConsumed ?? 200_000;
    console.log(`Simulation passed. CUs: ${cuUsed}`);

    // Send via Jito for guaranteed inclusion
    await sendViaJito(tx, connection);

  } catch (err) {
    console.error("Liquidation failed:", err);
  } finally {
    isProcessingLiquidations = false;
  }
}

function calculateLiquidationProfit(position: Position): number {
  const collateralPrice = priceCache.get(position.collateralMint) ?? 0;
  const debtPrice = priceCache.get(position.debtMint) ?? 0;

  const debtToRepay = Number(position.debtAmount) * 0.5 * debtPrice / 1e6; // 50% close factor
  const collateralReceived = debtToRepay * 1.05 / collateralPrice * 1e9; // 5% bonus

  const collateralValue = collateralReceived * collateralPrice / 1e9;
  const gasCost = 0.001 * 150; // ~0.001 SOL at $150/SOL

  return collateralValue - debtToRepay - gasCost;
}

async function buildLiquidationTransaction(
  position: Position,
  connection: Connection
): Promise<anchor.web3.Transaction> {
  const program = new anchor.Program(
    /* IDL */ {} as any,
    config.programId,
    new anchor.AnchorProvider(connection, new anchor.Wallet(config.keeperKeypair), {})
  );

  const { blockhash } = await connection.getLatestBlockhash();

  const tx = new anchor.web3.Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = config.keeperKeypair.publicKey;

  // Set compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

  // Add liquidation instruction
  const liquidateIx = await program.methods
    .liquidate(new BN(position.debtAmount.toString()).divn(2)) // 50% close factor
    .accounts({
      liquidator: config.keeperKeypair.publicKey,
      borrower: new PublicKey(position.owner),
      position: new PublicKey(position.pubkey),
      // ... other required accounts
    })
    .instruction();

  tx.add(liquidateIx);
  tx.sign(config.keeperKeypair);

  return tx;
}

// ── Jito Bundle Submission ─────────────────────────────────────────────────

async function sendViaJito(
  tx: anchor.web3.Transaction,
  connection: Connection
) {
  const searcherClient = SearcherClient.mainnet();

  // Add Jito tip transaction
  const tipAccount = await searcherClient.getTipAccounts();
  const tipIx = anchor.web3.SystemProgram.transfer({
    fromPubkey: config.keeperKeypair.publicKey,
    toPubkey: new PublicKey(tipAccount[0]),
    lamports: config.jitoTipLamports,
  });

  const tipTx = new anchor.web3.Transaction();
  const { blockhash } = await connection.getLatestBlockhash();
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = config.keeperKeypair.publicKey;
  tipTx.add(tipIx);
  tipTx.sign(config.keeperKeypair);

  const bundle = new Bundle([tx, tipTx], 5);

  try {
    const bundleId = await searcherClient.sendBundle(bundle);
    console.log("Bundle sent:", bundleId);

    // Wait for confirmation
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await searcherClient.getBundleStatuses([bundleId]);
    console.log("Bundle status:", result);
  } catch (err) {
    console.error("Jito bundle failed:", err);
    // Fallback: send directly
    const sig = await connection.sendRawTransaction(tx.serialize());
    console.log("Fallback tx sent:", sig);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting keeper bot...");
  console.log("Keeper wallet:", config.keeperKeypair.publicKey.toBase58());

  // Start Geyser stream for real-time updates
  await startGeyserStream();

  // Periodic scan for any missed positions (belt and suspenders)
  setInterval(async () => {
    const liquidatable = Array.from(positionCache.values())
      .filter((p) => p.healthFactor < 1.0);

    if (liquidatable.length > 0) {
      console.log(`Periodic scan: ${liquidatable.length} liquidatable positions`);
      for (const pos of liquidatable.slice(0, 5)) {
        await attemptLiquidation(pos);
      }
    }
  }, 30_000); // every 30 seconds
}

main().catch(console.error);
```

---

## Common Mistakes and Gotchas

**1. Not simulating before sending**  
Always simulate the liquidation transaction before sending. If the position was already liquidated by another bot, your simulation will fail and you save the transaction fee. Sending without simulation wastes fees on failed transactions.

**2. Not handling the "already liquidated" race condition**  
Between detecting a liquidation opportunity and sending your transaction, another bot may have already liquidated the position. Your transaction will fail. Handle this gracefully — it's not an error, it's expected competition.

**3. Using a single RPC endpoint**  
If your RPC endpoint goes down, your bot stops working. Use multiple endpoints with automatic failover. For critical bots, run your own validator or use a dedicated RPC node.

**4. Not monitoring bot health**  
Bots fail silently. Set up monitoring: track successful liquidations, failed transactions, RPC errors, and wallet balance. Alert when the bot hasn't liquidated anything in an unusually long time (might indicate it's stuck).

**5. Keeping too much SOL in the keeper wallet**  
The keeper wallet is a hot wallet — it's online and its private key is in your server's environment. Keep only enough SOL for a few days of operations. Replenish regularly from a cold wallet.

---

## How This Connects to Production

Drift Protocol's liquidation bots use Geyser for real-time position monitoring and Jito for guaranteed liquidation execution. Mango Markets had a sophisticated keeper network that maintained protocol solvency. The Euler Finance hack was partly enabled by the absence of effective liquidation bots — positions that should have been liquidated weren't, allowing the attacker to exploit the protocol. Chainlink's Automation (formerly Keepers) is a decentralized keeper network for EVM chains. On Solana, most protocols run their own keeper bots rather than relying on a decentralized network.

---

## What to Learn Next

- **Pyth Network Oracle Integration: Real-Time Price Feeds on Solana** — the price feed your keeper bot depends on.
- **Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data** — the data source for your keeper bot.
- **Cross-Margin vs Isolated Margin in On-Chain Perps** — understand the margin models your liquidation bot must handle.
