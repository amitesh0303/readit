# Lightning Invoicing and Payment Routing

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 3 of 8
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

You have Lightning channels open, but you need to actually send and receive payments. Lightning uses BOLT11 invoices (not addresses like on-chain Bitcoin), payments route through multiple hops, and failed routes need automatic retries. You need to understand how to create invoices, decode them, send payments, and handle the routing mechanics that make the network function.

## Core Concepts

### BOLT11 Invoices

Lightning payments are pull-based: the receiver creates an invoice containing a payment hash, amount, expiry, and routing hints. The sender then pays that specific invoice.

```typescript
// LND REST API - Invoice creation and payment
// Requires: LND@0.18.0 running with REST API enabled

interface Invoice {
  r_hash: string;
  payment_request: string;
  add_index: string;
  payment_addr: string;
}

interface InvoiceRequest {
  memo: string;
  value: string; // amount in satoshis
  expiry: string; // seconds until invoice expires
}

async function createInvoice(
  memo: string,
  amountSats: number,
  expirySecs: number = 3600
): Promise<Invoice> {
  const body: InvoiceRequest = {
    memo,
    value: amountSats.toString(),
    expiry: expirySecs.toString(),
  };

  const options = {
    hostname: "localhost",
    port: 8080,
    path: "/v1/invoices",
    method: "POST",
    headers: {
      "Grpc-Metadata-macaroon": process.env.LND_MACAROON_HEX,
      "Content-Type": "application/json",
    },
    rejectUnauthorized: false,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Invoice creation failed: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Create a 1000 sat invoice for a coffee payment
const invoice = await createInvoice("Coffee payment", 1000, 3600);
console.log(`Invoice: ${invoice.payment_request}`);
console.log(`Payment hash: ${invoice.r_hash}`);
```

```
Expected output:
Invoice: lnbc10u1pj...
Payment hash: a4f2e8c1d3b5...
```

### Decoding and Paying Invoices

Before paying an invoice, decode it to verify the amount and destination:

```typescript
// LND REST API - Decode and pay a BOLT11 invoice

interface DecodedInvoice {
  destination: string;
  payment_hash: string;
  num_satoshis: string;
  timestamp: string;
  expiry: string;
  description: string;
  cltv_expiry: string;
  route_hints: RouteHint[];
}

interface RouteHint {
  hop_hints: HopHint[];
}

interface HopHint {
  node_id: string;
  chan_id: string;
  fee_base_msat: number;
  fee_proportional_millionths: number;
  cltv_expiry_delta: number;
}

interface PaymentResult {
  payment_hash: string;
  payment_preimage: string;
  payment_route: { total_fees_msat: string; total_amt_msat: string };
  status: "SUCCEEDED" | "FAILED" | "IN_FLIGHT";
}

async function decodeInvoice(payReq: string): Promise<DecodedInvoice> {
  const options = {
    hostname: "localhost",
    port: 8080,
    path: `/v1/payreq/${payReq}`,
    method: "GET",
    headers: {
      "Grpc-Metadata-macaroon": process.env.LND_MACAROON_HEX,
    },
    rejectUnauthorized: false,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.end();
  });
}

async function payInvoice(payReq: string): Promise<PaymentResult> {
  const body = {
    payment_request: payReq,
    timeout_seconds: 60,
    fee_limit_sat: "100", // max routing fee in sats
  };

  const options = {
    hostname: "localhost",
    port: 8080,
    path: "/v2/router/send",
    method: "POST",
    headers: {
      "Grpc-Metadata-macaroon": process.env.LND_MACAROON_HEX,
      "Content-Type": "application/json",
    },
    rejectUnauthorized: false,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const result = JSON.parse(data);
        if (result.status === "SUCCEEDED") {
          resolve(result);
        } else {
          reject(new Error(`Payment failed: ${result.failure_reason}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Decode an invoice before paying
const payReq = "lnbc10u1pj..."; // invoice from receiver
const decoded = await decodeInvoice(payReq);
console.log(`Destination: ${decoded.destination.slice(0, 16)}...`);
console.log(`Amount: ${decoded.num_satoshis} sats`);
console.log(`Description: ${decoded.description}`);
console.log(`Expires in: ${decoded.expiry} seconds`);

// Pay the invoice
try {
  const payment = await payInvoice(payReq);
  console.log(`Payment succeeded!`);
  console.log(`Preimage: ${payment.payment_preimage}`);
  console.log(`Routing fee: ${payment.payment_route.total_fees_msat} msat`);
} catch (error) {
  console.error(`Payment failed: ${error.message}`);
}
```

```
Expected output:
Destination: 03e7156ae33b0a20...
Amount: 1000 sats
Description: Coffee payment
Expires in: 3600 seconds
Payment succeeded!
Preimage: b5c4d3e2f1a0...
Routing fee: 1050 msat
```

### Multi-Hop Routing

Lightning payments don't require a direct channel between sender and receiver. Payments route through intermediate nodes using HTLCs (Hash Time-Locked Contracts):

```
Alice ──channel──> Bob ──channel──> Carol ──channel──> Dave

Alice wants to pay Dave 1000 sats:
1. Dave creates invoice with payment_hash = H(preimage)
2. Alice finds route: Alice → Bob → Carol → Dave
3. Alice sends HTLC to Bob: "1002 sats if you reveal preimage of H"
4. Bob sends HTLC to Carol: "1001 sats if you reveal preimage of H"
5. Carol sends HTLC to Dave: "1000 sats if you reveal preimage of H"
6. Dave reveals preimage to Carol (claims 1000 sats)
7. Carol reveals preimage to Bob (claims 1001 sats)
8. Bob reveals preimage to Alice (claims 1002 sats)

Net result: Alice paid 1002, Dave received 1000, Bob earned 1 sat, Carol earned 1 sat
```

### Keysend (Spontaneous Payments)

Not all payments require an invoice. Keysend allows sending payments without the receiver generating an invoice first:

```shell
# Send a spontaneous keysend payment using lncli (lnd@0.18.0)
lncli sendpayment \
  --dest=03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad \
  --amt=500 \
  --keysend \
  --fee_limit=50

# Check payment status
lncli listpayments --max_payments=1 --reversed
```

```
Expected output:
{
  "payment_hash": "c3d4e5f6...",
  "status": "SUCCEEDED",
  "fee_msat": "1000",
  "value_sat": "500"
}
```

## Common Pitfalls

1. **Not setting fee limits on payments** — Without a fee limit, the routing algorithm might choose expensive paths. Always set `fee_limit_sat` or `fee_limit_percent` to cap routing costs.

2. **Ignoring invoice expiry** — BOLT11 invoices expire (default 1 hour in most implementations). Attempting to pay an expired invoice will fail. Always check `expiry` before paying and regenerate invoices for long-lived payment flows.

3. **Assuming payments always succeed on first try** — Route finding can fail due to insufficient liquidity, offline nodes, or channel capacity limits. Implement retry logic with different routes. LND's `sendpayment` v2 API handles retries automatically.

4. **Not handling partial route failures** — In multi-hop payments, if an intermediate node fails, the HTLC times out and funds return to the sender. But this can take hours if CLTV deltas are large. Monitor in-flight payments and handle timeouts gracefully.

## What to Learn Next

- [Stacks and Clarity Contracts](./04-stacks-clarity-contracts.md) — Write smart contracts on Bitcoin using the Clarity language
- [Lightning BOLTs Specification](https://github.com/lightning/bolts) — The protocol specification for Lightning Network
- [LND Developer Site](https://docs.lightning.engineering/) — Official API documentation and guides
