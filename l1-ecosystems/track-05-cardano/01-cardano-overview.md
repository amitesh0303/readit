# Cardano Overview: UTXO Model, Ouroboros Consensus, and Eras

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You want to build on Cardano but the architecture is fundamentally different from Ethereum. Cardano uses an extended UTXO model instead of accounts, a Haskell-based smart contract language instead of Solidity, and a phased rollout through "eras" that each unlock different capabilities. If you approach Cardano with an Ethereum mental model, you'll misunderstand how state works, how transactions are constructed, and why certain patterns that are trivial on EVM chains require completely different thinking here.

---

## Core Concepts

### The Extended UTXO Model (eUTXO)

Cardano doesn't use accounts with balances. Instead, it uses Unspent Transaction Outputs (UTXOs) — similar to Bitcoin, but extended with datum (arbitrary data) and validator scripts.

In the account model (Ethereum), you have:
- Account A has 10 ETH
- Account A sends 3 ETH to Account B
- Account A now has 7 ETH, Account B has 3 ETH

In the UTXO model (Cardano), you have:
- UTXO #1: 10 ADA locked at Address A
- Transaction consumes UTXO #1, produces UTXO #2 (3 ADA at Address B) and UTXO #3 (7 ADA at Address A)
- UTXO #1 no longer exists

The "extended" part means UTXOs can carry:
- **Datum**: Arbitrary data attached to the UTXO (the contract's state)
- **Validator script**: Code that decides whether the UTXO can be consumed
- **Redeemer**: Data provided by the transaction that tries to consume the UTXO

```haskell
-- A simplified view of an eUTXO
data TxOut = TxOut
  { txOutAddress   :: Address        -- where the value is locked
  , txOutValue     :: Value          -- ADA + native tokens
  , txOutDatum     :: Maybe Datum    -- optional on-chain data
  , txOutRefScript :: Maybe Script   -- optional reference script
  }

-- A transaction input references a UTXO and provides a redeemer
data TxIn = TxIn
  { txInRef      :: TxOutRef         -- which UTXO to consume
  , txInRedeemer :: Maybe Redeemer   -- proof/action for the validator
  }
```

### Ouroboros Consensus

Cardano uses Ouroboros Praos, a provably secure proof-of-stake consensus protocol. Key properties:

- **Epochs and slots**: Time is divided into epochs (~5 days), each containing 432,000 slots (1 slot = 1 second). Not every slot produces a block — a slot leader is elected probabilistically based on stake.
- **Slot leaders**: Stake pool operators are randomly selected to produce blocks proportional to their delegated stake.
- **No slashing**: Unlike Ethereum, Cardano doesn't slash validators for misbehavior. Security comes from the VRF (Verifiable Random Function) lottery making it unprofitable to attack.
- **Determinism**: Transaction validation is deterministic — you can predict whether a transaction will succeed before submitting it. This eliminates failed transactions that still cost gas (a common Ethereum pain point).

```
Epoch 400 (5 days)
├── Slot 0: Block produced by Pool ABC
├── Slot 1: Empty (no leader elected)
├── Slot 2: Empty
├── Slot 3: Block produced by Pool XYZ
├── ...
└── Slot 431,999: Block produced by Pool DEF

Block time: ~20 seconds average (not every slot has a block)
Finality: ~2 minutes (after k=2160 blocks for settlement parameter)
```

### Cardano Eras

Cardano's development follows a phased roadmap, each era adding capabilities:

| Era | Feature | Status |
|-----|---------|--------|
| Byron | Basic transactions, delegation | Complete |
| Shelley | Decentralized PoS, staking | Complete |
| Allegra | Token locking, time locks | Complete |
| Mary | Native tokens (no smart contracts needed) | Complete |
| Alonzo | Plutus smart contracts (V1) | Complete |
| Babbage | Plutus V2, reference scripts, inline datums | Complete |
| Conway | On-chain governance (CIP-1694) | Active |

This matters for developers because the era determines which Plutus version and features are available. Babbage introduced reference scripts (deploy once, reference many times) which dramatically reduced transaction costs.

### Transaction Fees

Cardano fees are deterministic and calculated before submission:

```
fee = a * tx_size_bytes + b
```

Where `a` and `b` are protocol parameters (currently a ≈ 44 lovelace/byte, b ≈ 155,381 lovelace). A typical transaction costs 0.17–0.50 ADA. Script execution adds to this based on CPU and memory units consumed.

---

## Common Pitfalls

1. **Thinking in accounts instead of UTXOs** — There's no "contract balance" you can read. State lives in individual UTXOs with datums. If two users try to interact with the same UTXO simultaneously, one transaction will fail (the concurrency problem). You need to design around this with patterns like UTXO splitting or batchers.

2. **Ignoring the determinism guarantee** — Unlike Ethereum where a transaction can fail on-chain and still cost gas, Cardano transactions either succeed exactly as simulated or are rejected entirely (no fees charged). This means you should always simulate locally before submitting.

3. **Assuming smart contracts work like Ethereum** — Plutus validators don't "execute" in the same way. They validate whether a UTXO can be consumed given the datum, redeemer, and script context. They return True or False. There's no persistent storage, no msg.sender, no global state.

4. **Underestimating the UTXO concurrency challenge** — If your dApp has a single UTXO that everyone interacts with (like a shared pool), only one transaction per block can consume it. You need architectural patterns like order batching or multiple UTXOs to handle concurrent users.

5. **Not accounting for minimum UTXO value** — Every UTXO must contain a minimum amount of ADA (currently ~1-2 ADA depending on datum size). This is Cardano's equivalent of "rent" — it prevents UTXO set bloat.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install cardano-cli, cardano-node, and set up the Plutus development environment
- [Plutus Language Fundamentals](./03-plutus-language-fundamentals.md) — Learn the Haskell basics needed to write Plutus validators
