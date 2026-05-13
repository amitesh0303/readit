# Bitcoin Programmability: Beyond Simple Transfers

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 1 of 8
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You know Bitcoin as a store of value and payment network, but you've heard about smart contracts, DeFi, and NFTs being built "on Bitcoin." The base layer uses Script — a deliberately limited, non-Turing-complete language. So how are developers building complex applications? You need to understand the landscape of Bitcoin programmability solutions before choosing where to build.

## Core Concepts

### Bitcoin Script: The Base Layer

Bitcoin's native scripting language is intentionally constrained. It's stack-based, has no loops, and supports roughly 100 opcodes. This is a feature, not a bug — it minimizes the attack surface on a $1T+ network.

```
┌─────────────────────────────────────────────────────────┐
│           Bitcoin Programmability Stack                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Application Layer                                      │
│  └── DeFi, NFTs, DAOs, Gaming                          │
│                                                         │
│  Smart Contract Layers                                  │
│  ├── Stacks (Clarity language, PoX consensus)           │
│  ├── Rootstock (EVM-compatible sidechain)               │
│  └── Merlin Chain (ZK-rollup on Bitcoin)                │
│                                                         │
│  Payment/Transfer Layers                                │
│  ├── Lightning Network (payment channels)               │
│  └── Liquid Network (federated sidechain)               │
│                                                         │
│  Base Layer                                             │
│  └── Bitcoin L1 (Script, Taproot, OP_RETURN)            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Taproot and the Programmability Upgrade

The Taproot upgrade (November 2021) introduced Schnorr signatures and MAST (Merkelized Abstract Syntax Trees), enabling more complex spending conditions while maintaining privacy:

```typescript
// bitcoinjs-lib@6.1.5
import * as bitcoin from "bitcoinjs-lib";
import { toXOnly } from "bitcoinjs-lib/src/psbt/bip371";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc);

// Create a simple Taproot key-path spend address
const internalKey = Buffer.from(
  "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  "hex"
);

const { address } = bitcoin.payments.p2tr({
  internalPubkey: toXOnly(internalKey),
  network: bitcoin.networks.testnet,
});

console.log(`Taproot address: ${address}`);
// Expected output:
// Taproot address: tb1p...
```

### The L2 Landscape

Each Bitcoin L2 makes different tradeoffs:

| Solution | Type | Consensus | Smart Contracts | BTC Security |
|---|---|---|---|---|
| Lightning | Payment channels | Bilateral | No (HTLCs only) | Direct (on-chain settlement) |
| Stacks | Sidechain | Proof of Transfer | Yes (Clarity) | Anchored to BTC blocks |
| Liquid | Federated sidechain | Federation (11-of-15) | Limited (Elements Script) | Federated peg |
| Rootstock | Sidechain | Merge-mined | Yes (EVM/Solidity) | Merge-mining with BTC |
| Merlin | ZK-rollup | ZK proofs | Yes (EVM-compatible) | Data on BTC via Taproot |

### Choosing Your Layer

- **Need instant payments?** → Lightning Network
- **Need Bitcoin-native smart contracts?** → Stacks (Clarity)
- **Need EVM compatibility with BTC security?** → Rootstock
- **Need confidential transactions?** → Liquid Network
- **Need scalable EVM with ZK proofs?** → Merlin Chain

## Common Pitfalls

1. **Assuming all Bitcoin L2s inherit full L1 security** — Each solution has different trust assumptions. Lightning requires channel partners to be online, Liquid relies on a federation, and Rootstock depends on merge-mining hashrate. Only solutions that post proofs or data directly to Bitcoin L1 can claim strong security inheritance.

2. **Confusing "on Bitcoin" with "anchored to Bitcoin"** — Stacks transactions are anchored to Bitcoin blocks but execute on a separate chain. Lightning channels settle on Bitcoin but operate off-chain. The marketing term "Bitcoin L2" covers very different architectures.

3. **Ignoring the BTC bridging problem** — Moving BTC to any L2 requires trust in some mechanism: Lightning uses payment channels (trustless but requires liveness), Liquid uses a federation, Rootstock uses a federation (Powpeg), and Stacks uses PoX miners. There's no trustless two-way peg to Bitcoin today.

4. **Thinking Bitcoin Script can't do anything** — With Taproot, you can encode complex spending conditions (timelocks, multisig, hash locks) that enable sophisticated protocols. DLCs (Discreet Log Contracts) and atomic swaps work entirely on L1.

## What to Learn Next

- [Lightning Network Channels](./02-lightning-network-channels.md) — Learn how payment channels enable instant Bitcoin transfers
- [Bitcoin Optech Topics](https://bitcoinops.org/en/topics/) — Technical reference for Bitcoin protocol features
- [Bitcoin Developer Guide](https://developer.bitcoin.org/devguide/) — Official documentation for Bitcoin development
