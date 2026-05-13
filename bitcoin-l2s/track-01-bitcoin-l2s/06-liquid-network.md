# Liquid Network: Confidential Transactions and Issued Assets

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 6 of 8
**Level:** Intermediate → Advanced
**Read time:** 10 min

---

## The Problem

You need to move Bitcoin between parties with transaction privacy — hiding amounts and asset types from public observers. Or you need to issue tokenized assets (securities, stablecoins, collectibles) on a Bitcoin-adjacent network with faster block times. The Liquid Network is a federated sidechain built on Elements that provides confidential transactions, 2-minute blocks, and a framework for issuing assets pegged to Bitcoin.

## Core Concepts

### Liquid Architecture

Liquid is a federated sidechain operated by a group of functionaries (currently ~65 members including exchanges, trading desks, and infrastructure providers). It uses a 11-of-15 multisig federation for the Bitcoin peg and a separate set of block signers for consensus.

```
┌─────────────────────────────────────────────────────────┐
│              Liquid Network Architecture                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Bitcoin L1                                             │
│  └── Peg-in: Send BTC to federation multisig            │
│  └── Peg-out: Federation releases BTC (2-day delay)     │
│                                                         │
│  Federation (Functionaries)                             │
│  ├── Block Signers: Produce blocks every 2 minutes      │
│  └── Watchmen: Guard the BTC peg (11-of-15 multisig)    │
│                                                         │
│  Liquid Sidechain                                       │
│  ├── L-BTC: Pegged Bitcoin on Liquid                    │
│  ├── Issued Assets: Tokens, stablecoins, securities     │
│  ├── Confidential Transactions: Hidden amounts/types    │
│  └── Elements Script: Extended Bitcoin Script           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Setting Up Liquid Development

```shell
# Install Elements (Liquid's base layer) - elements@23.2.1
# Elements is a fork of Bitcoin Core with CT and asset issuance support

# Download Elements Core
wget https://github.com/ElementsProject/elements/releases/download/elements-23.2.1/elements-23.2.1-x86_64-linux-gnu.tar.gz
tar xzf elements-23.2.1-x86_64-linux-gnu.tar.gz
sudo cp elements-23.2.1/bin/* /usr/local/bin/

# Start Elements in regtest mode for development
elementsd -chain=elementsregtest -daemon \
  -validatepegin=0 \
  -con_blocksubsidy=5000000000 \
  -anyonecanspendaremine=1

# Generate initial blocks
elements-cli -chain=elementsregtest createwallet "dev"
elements-cli -chain=elementsregtest -generate 101
```

```
Expected output:
Elements Core starting
[
  "hash1...",
  "hash2...",
  ...
]
```

### Issuing Assets on Liquid

Liquid allows anyone to issue new assets (tokens) directly on the network:

```shell
# Issue a new asset on Liquid (elements-cli@23.2.1)
# This creates 1000 units of a new token with 2 reissuance tokens

elements-cli -chain=elementsregtest issueasset 1000 2

# Get the asset details
elements-cli -chain=elementsregtest listissuances
```

```
Expected output:
{
  "txid": "a1b2c3d4...",
  "vin": 0,
  "asset": "b6a1c7d8e9f0...",
  "token": "c7d8e9f0a1b2...",
  "entropy": "d8e9f0a1b2c3..."
}
```

```typescript
// Liquid asset issuance using liquidjs-lib@6.0.2
import * as liquid from "liquidjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";

const ECPair = ECPairFactory(ecc);

// Connect to Liquid testnet
const network = liquid.networks.testnet;

// Create a confidential address for receiving issued assets
const keyPair = ECPair.makeRandom({ network });
const blindingKeyPair = ECPair.makeRandom({ network });

const { address, confidentialAddress } = liquid.payments.p2wpkh({
  pubkey: Buffer.from(keyPair.publicKey),
  blindkey: Buffer.from(blindingKeyPair.publicKey),
  network,
});

console.log(`Liquid address: ${address}`);
console.log(`Confidential address: ${confidentialAddress}`);

// Note: Full asset issuance requires building a transaction
// with the issuance fields set. See Elements documentation:
// https://elementsproject.org/how-it-works
```

### Confidential Transactions

The key feature of Liquid is Confidential Transactions (CT) — amounts and asset types are cryptographically hidden from everyone except the transaction participants:

```shell
# Send a confidential transaction on Liquid
# Only sender and receiver can see the amount

# Get a new confidential address
elements-cli -chain=elementsregtest getnewaddress "" blech32

# Send L-BTC confidentially
elements-cli -chain=elementsregtest sendtoaddress \
  "el1qq..." \
  0.5 \
  "payment for services" \
  "" \
  true  # subtractfeefromamount

# Verify the transaction is confidential
elements-cli -chain=elementsregtest gettransaction <txid>
```

```
Expected output:
{
  "amount": {
    "bitcoin": -0.50000000
  },
  "confirmations": 0,
  "details": [{
    "address": "el1qq...",
    "category": "send",
    "amount": -0.50000000,
    "amountblinder": "a1b2c3...",
    "assetblinder": "d4e5f6..."
  }]
}
```

### Peg-In and Peg-Out

Moving BTC to Liquid (peg-in) and back (peg-out):

| Operation | Time | Trust Model |
|---|---|---|
| Peg-in (BTC → L-BTC) | ~102 Bitcoin confirmations (~17 hours) | Trustless verification |
| Peg-out (L-BTC → BTC) | ~2 days | Requires federation cooperation |

```shell
# Initiate a peg-in (on Liquid mainnet)
# Step 1: Get a peg-in address
elements-cli getpeginaddress

# Step 2: Send BTC to the peg-in address (on Bitcoin)
bitcoin-cli sendtoaddress <pegin_address> 0.1

# Step 3: Wait for 102 Bitcoin confirmations, then claim on Liquid
elements-cli claimpegin <raw_btc_tx> <txoutproof>
```

## Common Pitfalls

1. **Trusting the federation blindly** — Liquid's security depends on the federation members acting honestly. The 11-of-15 multisig means 5 colluding members could steal pegged funds. This is acceptable for trading use cases but not for long-term cold storage.

2. **Forgetting peg-out delays** — Getting BTC back from Liquid takes approximately 2 days due to the federation's processing schedule. Don't use Liquid if you need instant BTC liquidity.

3. **Not understanding confidential transaction sizes** — CT transactions are larger than regular Bitcoin transactions (~2.5 KB vs ~250 bytes) because they include range proofs. This affects fee calculations on Liquid.

4. **Assuming Liquid has smart contracts like Ethereum** — Liquid uses Elements Script, which extends Bitcoin Script with opcodes for CT and asset issuance. It's more capable than Bitcoin Script but far less expressive than Solidity or Clarity. For complex logic, use Stacks or Rootstock instead.

## What to Learn Next

- [Rootstock EVM Deployment](./07-rootstock-evm-deployment.md) — Deploy Solidity contracts on Bitcoin's merge-mined sidechain
- [Elements Project Documentation](https://elementsproject.org/) — Official Elements/Liquid technical docs
- [Blockstream Liquid GitHub](https://github.com/ElementsProject/elements) — Elements source code
