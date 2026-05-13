# Frontend Integration with xrpl.js and Xaman Wallet

**Track:** XRP Ledger Development
**Level:** Beginner → Intermediate
**Read time:** 12 min

---

## The Problem

You've deployed tokens and written hooks on the XRP Ledger. Now you need to build a frontend that lets users connect their wallet, send payments, interact with the DEX, and manage trust lines — all from a browser. The XRP Ledger ecosystem uses xrpl.js for direct node interaction and Xaman (formerly XUMM) for mobile wallet signing.

---

## Setup

```bash
npm install xrpl@^3.0.0
npm install xumm@^1.10.0  # Xaman SDK
```

---

## Connecting to the Network

```typescript
import { Client, Wallet } from "xrpl";

// Connect to testnet
const client = new Client("wss://s.altnet.rippletest.net:51233");
await client.connect();

// Or mainnet
// const client = new Client("wss://xrplcluster.com");

// Disconnect when done
// await client.disconnect();
```

---

## Wallet Integration with Xaman (Browser)

[Xaman](https://xaman.app) is the primary mobile wallet for XRP Ledger. Use the Xaman SDK to request transaction signing:

```typescript
import { Xumm } from "xumm";

// Initialize with your API key from https://apps.xumm.dev
const xumm = new Xumm("your-api-key-here");

// Authorize the user (get their XRPL address)
async function connectWallet(): Promise<string> {
  const { me } = await xumm.authorize();
  if (!me) throw new Error("Authorization failed");
  console.log("Connected:", me.account); // rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  return me.account;
}

// Sign and submit a payment
async function sendPayment(
  destination: string,
  amountDrops: string,
  memo?: string
) {
  const payload = await xumm.payload?.create({
    txjson: {
      TransactionType: "Payment",
      Destination: destination,
      Amount: amountDrops, // in drops (1 XRP = 1,000,000 drops)
      ...(memo && {
        Memos: [
          {
            Memo: {
              MemoData: Buffer.from(memo, "utf8").toString("hex").toUpperCase(),
            },
          },
        ],
      }),
    },
  });

  if (!payload) throw new Error("Failed to create payload");

  // Open the signing URL (redirects to Xaman app)
  window.open(payload.next.always, "_blank");

  // Wait for the user to sign
  const result = await xumm.payload?.get(payload.uuid);
  if (result?.meta.signed) {
    console.log("Transaction signed:", result.response.txid);
    return result.response.txid;
  } else {
    throw new Error("Transaction rejected");
  }
}
```

---

## Direct Wallet (Development / Server-Side)

For development or server-side use, you can use a local wallet:

```typescript
import { Client, Wallet, xrpToDrops, dropsToXrp } from "xrpl";

const client = new Client("wss://s.altnet.rippletest.net:51233");
await client.connect();

// Load wallet from seed (never expose in frontend)
const wallet = Wallet.fromSeed("sXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
console.log("Address:", wallet.address);

// Check balance
const accountInfo = await client.request({
  command: "account_info",
  account: wallet.address,
  ledger_index: "validated",
});
const balanceXRP = dropsToXrp(accountInfo.result.account_data.Balance);
console.log("Balance:", balanceXRP, "XRP");

// Send XRP payment
async function sendXRP(destination: string, amountXRP: string) {
  const prepared = await client.autofill({
    TransactionType: "Payment",
    Account: wallet.address,
    Amount: xrpToDrops(amountXRP),
    Destination: destination,
  });

  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta?.TransactionResult === "tesSUCCESS") {
    console.log("Payment sent:", result.result.hash);
    return result.result.hash;
  } else {
    throw new Error(`Payment failed: ${result.result.meta?.TransactionResult}`);
  }
}
```

---

## Managing Trust Lines

```typescript
// Create a trust line for a token
async function createTrustLine(
  wallet: Wallet,
  issuerAddress: string,
  currencyCode: string,
  limit: string
) {
  const trustSet = await client.autofill({
    TransactionType: "TrustSet",
    Account: wallet.address,
    LimitAmount: {
      currency: currencyCode, // 3-char ISO or 40-char hex
      issuer: issuerAddress,
      value: limit,
    },
  });

  const signed = wallet.sign(trustSet);
  const result = await client.submitAndWait(signed.tx_blob);
  console.log("Trust line created:", result.result.hash);
}

// Check existing trust lines
async function getTrustLines(address: string) {
  const response = await client.request({
    command: "account_lines",
    account: address,
    ledger_index: "validated",
  });

  return response.result.lines.map((line) => ({
    currency: line.currency,
    issuer: line.account,
    balance: line.balance,
    limit: line.limit,
  }));
}

// Send a token (requires trust line)
async function sendToken(
  wallet: Wallet,
  destination: string,
  issuer: string,
  currency: string,
  amount: string
) {
  const payment = await client.autofill({
    TransactionType: "Payment",
    Account: wallet.address,
    Amount: {
      currency,
      issuer,
      value: amount,
    },
    Destination: destination,
  });

  const signed = wallet.sign(payment);
  const result = await client.submitAndWait(signed.tx_blob);
  console.log("Token sent:", result.result.hash);
}
```

---

## DEX Integration

```typescript
// Place a buy order on the DEX
async function placeBuyOrder(
  wallet: Wallet,
  takerPays: { currency: string; issuer: string; value: string } | string,
  takerGets: { currency: string; issuer: string; value: string } | string
) {
  const offer = await client.autofill({
    TransactionType: "OfferCreate",
    Account: wallet.address,
    TakerPays: takerPays, // what you're offering to pay
    TakerGets: takerGets, // what you want to receive
  });

  const signed = wallet.sign(offer);
  const result = await client.submitAndWait(signed.tx_blob);
  console.log("Order placed:", result.result.hash);
}

// Get order book
async function getOrderBook(
  baseCurrency: string,
  baseIssuer: string,
  quoteCurrency: string,
  quoteIssuer: string
) {
  const response = await client.request({
    command: "book_offers",
    taker_pays: { currency: baseCurrency, issuer: baseIssuer },
    taker_gets: { currency: quoteCurrency, issuer: quoteIssuer },
    limit: 20,
  });

  return response.result.offers.map((offer) => ({
    price: offer.quality,
    amount: offer.TakerGets,
    total: offer.TakerPays,
  }));
}
```

---

## Subscribing to Account Events

```typescript
// Subscribe to account transactions in real-time
async function watchAccount(address: string) {
  await client.request({
    command: "subscribe",
    accounts: [address],
  });

  client.on("transaction", (tx) => {
    if (tx.transaction.Destination === address) {
      const amount = tx.transaction.Amount;
      if (typeof amount === "string") {
        console.log(`Received ${dropsToXrp(amount)} XRP`);
      } else {
        console.log(`Received ${amount.value} ${amount.currency}`);
      }
    }
  });
}
```

---

## Common Pitfalls

1. **Not handling reserve requirements** — Every XRPL account must maintain a base reserve (currently 10 XRP) plus 2 XRP per trust line and offer. Transactions that would drop the balance below reserve are rejected.

2. **Currency code encoding** — Standard currencies use 3-character ISO codes (e.g., `"USD"`). Non-standard currencies use 40-character hex strings. Always check which format the issuer uses.

3. **Drops vs XRP confusion** — The ledger uses drops (1 XRP = 1,000,000 drops) for XRP amounts. Use `xrpToDrops()` and `dropsToXrp()` from xrpl.js to convert. Never do the math manually.

4. **Not waiting for validation** — `client.submit()` submits but doesn't wait for ledger validation. Use `client.submitAndWait()` to wait for the transaction to be included in a validated ledger.

5. **Xaman payload expiry** — Xaman signing payloads expire after a set time (default 5 minutes). Handle the case where the user doesn't sign in time and create a new payload if needed.

---

## What to Learn Next

You've completed the XRP Ledger Development track. Next steps:
- Explore [XRPL EVM Sidechain](https://docs.xrplevm.org) for Solidity-based development on XRPL
- Read the [XRPL Developer Portal](https://xrpl.org/docs) for advanced features like AMM and multi-signing
- Join the [XRPL Discord](https://discord.gg/sfX3ERAMjH) for community support
