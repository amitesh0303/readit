# Lightning Network: Payment Channels from Scratch

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 2 of 8
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

Bitcoin's base layer processes ~7 transactions per second with 10-minute block times. You need to build an application that handles thousands of instant payments — a point-of-sale system, a streaming payment service, or a gaming micropayment backend. The Lightning Network solves this with bidirectional payment channels, but you need to understand how channels work at the protocol level to build reliable integrations.

## Core Concepts

### How Payment Channels Work

A Lightning channel is a 2-of-2 multisig UTXO on Bitcoin L1. Two parties lock funds into this multisig, then exchange signed transactions off-chain to update the balance distribution. Only the final state needs to be broadcast to the blockchain.

```
┌─────────────────────────────────────────────────────────┐
│              Lightning Channel Lifecycle                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Channel Open (on-chain)                             │
│     Alice funds 2-of-2 multisig with 0.1 BTC           │
│     State: Alice=0.1, Bob=0.0                           │
│                                                         │
│  2. Off-chain Updates (instant, free)                   │
│     Alice pays Bob 0.02 → State: Alice=0.08, Bob=0.02  │
│     Alice pays Bob 0.01 → State: Alice=0.07, Bob=0.03  │
│     Bob pays Alice 0.005 → State: Alice=0.075, Bob=0.025│
│                                                         │
│  3. Channel Close (on-chain)                            │
│     Either party broadcasts latest state                │
│     Funds distributed: Alice=0.075, Bob=0.025           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Opening a Channel with LND

LND (Lightning Network Daemon) is the most widely deployed Lightning implementation. Here's how to open a channel programmatically:

```typescript
// @lightninglabs/lnc-web@0.3.1-alpha
// LND REST API channel management
import https from "https";

const LND_REST_HOST = "localhost:8080";
const MACAROON = process.env.LND_MACAROON_HEX; // admin macaroon in hex

interface OpenChannelRequest {
  node_pubkey_string: string;
  local_funding_amount: string;
  push_sat?: string;
  sat_per_vbyte?: string;
}

async function openChannel(
  peerPubkey: string,
  amountSats: number,
  pushSats: number = 0
): Promise<{ funding_txid: string }> {
  const requestBody: OpenChannelRequest = {
    node_pubkey_string: peerPubkey,
    local_funding_amount: amountSats.toString(),
    push_sat: pushSats.toString(),
    sat_per_vbyte: "10",
  };

  const options = {
    hostname: LND_REST_HOST.split(":")[0],
    port: parseInt(LND_REST_HOST.split(":")[1]),
    path: "/v1/channels",
    method: "POST",
    headers: {
      "Grpc-Metadata-macaroon": MACAROON,
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
          reject(new Error(`Channel open failed: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

// Open a 100,000 sat channel to a peer
const result = await openChannel(
  "03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad",
  100000,
  0
);
console.log(`Channel funding tx: ${result.funding_txid}`);
```

```
Expected output:
Channel funding tx: a1b2c3d4e5f6...
```

### Monitoring Channel State

Once a channel is open, you need to monitor its capacity and balance:

```typescript
// lnd REST API - list channels
// Requires: LND node running with REST enabled

interface Channel {
  active: boolean;
  remote_pubkey: string;
  channel_point: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
  commit_fee: string;
  num_updates: string;
}

async function listChannels(): Promise<Channel[]> {
  const options = {
    hostname: "localhost",
    port: 8080,
    path: "/v1/channels",
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
      res.on("end", () => {
        const parsed = JSON.parse(data);
        resolve(parsed.channels || []);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const channels = await listChannels();
for (const ch of channels) {
  console.log(`Peer: ${ch.remote_pubkey.slice(0, 16)}...`);
  console.log(`  Capacity: ${ch.capacity} sats`);
  console.log(`  Local: ${ch.local_balance} sats`);
  console.log(`  Remote: ${ch.remote_balance} sats`);
  console.log(`  Updates: ${ch.num_updates}`);
}
```

```
Expected output:
Peer: 03e7156ae33b0a20...
  Capacity: 100000 sats
  Local: 97000 sats
  Remote: 0 sats
  Updates: 0
```

### Cooperative vs Force Close

Channels can be closed two ways:

- **Cooperative close**: Both parties agree, sign a closing transaction, funds are available immediately
- **Force close**: One party broadcasts unilaterally, triggers a timelock (typically 144-2016 blocks) before funds are spendable

```shell
# Close a channel cooperatively using lncli (lnd@0.18.0)
lncli closechannel --funding_txid=a1b2c3d4e5f6 --output_index=0

# Force close (use only if peer is unresponsive)
lncli closechannel --force --funding_txid=a1b2c3d4e5f6 --output_index=0
```

```
Expected output:
{
  "closing_txid": "f6e5d4c3b2a1..."
}
```

## Common Pitfalls

1. **Not maintaining channel liquidity** — A channel with all funds on one side can't route payments in both directions. Use circular rebalancing or services like Lightning Loop to maintain balanced channels.

2. **Ignoring watchtower requirements** — If your node goes offline and your channel partner broadcasts an old state, you lose funds. Run a watchtower service (or use a third-party watchtower) to monitor for cheating attempts.

3. **Opening channels with too-small capacity** — Channel opening costs an on-chain transaction fee. Opening a 10,000 sat channel when fees are 5,000 sats is wasteful. Minimum recommended channel size is 100,000 sats for routing nodes.

4. **Assuming channels are free to maintain** — Channels require on-chain fees to open and close, reserve balances for commitment transactions, and routing fees for forwarded payments. Budget for these costs.

## What to Learn Next

- [Lightning Invoicing and Routing](./03-lightning-invoicing-routing.md) — Create invoices, send payments, and understand multi-hop routing
- [LND Developer Documentation](https://docs.lightning.engineering/) — Official LND API reference
- [LND GitHub Repository](https://github.com/lightningnetwork/lnd) — Source code for the Lightning Network Daemon
