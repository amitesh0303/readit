# TON: Actor-Model Architecture and Infinite Sharding

**Track:** TON Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You've heard TON (The Open Network) is the blockchain behind Telegram's 900M+ user ecosystem, but you don't understand what makes it architecturally different from Ethereum or Solana. Terms like "actor model," "infinite sharding," "workchains," and "TVM" get thrown around without explaining how they affect the contracts you write. This lesson breaks down TON's architecture so you understand the execution model before writing your first FunC contract.

---

## Core Concepts

### The Actor Model: Everything Is a Contract

TON uses an actor-model architecture where every account (including user wallets) is a smart contract. Unlike Ethereum where EOAs (externally owned accounts) are separate from contracts, in TON:

```
Ethereum model:
  EOA (no code) → calls → Contract (has code)

TON model:
  Contract A (wallet) → sends message → Contract B (application)
  Contract B → sends message → Contract C (token)
  
Every account has code. Wallets are contracts too.
```

Key implications:
- All interactions happen via asynchronous messages between contracts
- There are no synchronous cross-contract calls (no `CALL` opcode like EVM)
- Each contract processes messages independently in its own "thread"
- Contracts cannot read another contract's state directly — they must send a message and wait for a response

### Infinite Sharding Paradigm

TON's sharding model is fundamentally different from other chains:

```
Traditional sharding (Ethereum 2.0 concept):
  Shard 0: accounts 0x0... - 0x3...
  Shard 1: accounts 0x4... - 0x7...
  (Fixed number of shards)

TON infinite sharding:
  Each account is its own "accountchain"
  Shardchains group nearby accounts dynamically
  Shards split/merge based on load automatically

  Low load:  [Shard 0: all accounts]
  High load: [Shard 0: accounts A-M] [Shard 1: accounts N-Z]
  Higher:    [Shard 0: A-F] [Shard 1: G-M] [Shard 2: N-S] [Shard 3: T-Z]
```

The architecture consists of:
- **Masterchain** — single chain that stores validator sets, shard configurations, and cross-shard routing
- **Workchains** — up to 2^32 independent blockchains with custom rules (currently only workchain 0 is active)
- **Shardchains** — dynamic subdivisions of workchains that split/merge based on load

### TVM: TON Virtual Machine

TON runs the TVM (TON Virtual Machine), a stack-based machine designed for the actor model:

```
TVM characteristics:
- Stack-based (like Bitcoin Script, unlike EVM's stack+memory+storage)
- Operates on 257-bit integers (not 256-bit like EVM)
- Native support for cells (tree of cells data structure)
- Continuations as first-class values (for control flow)
- No global state access — only local contract storage
```

The TVM processes messages one at a time per contract:

```
Message arrives at Contract A:
1. TVM loads Contract A's code and data (from its "cell" storage)
2. TVM executes the code with the message as input
3. Code may produce outgoing messages to other contracts
4. TVM saves updated contract data
5. Outgoing messages are routed to destination contracts

This happens independently for every contract — true parallelism.
```

### Cells: TON's Data Structure

All data in TON is stored as a tree of cells. A cell contains:
- Up to 1023 bits of data
- Up to 4 references to other cells

```
Cell structure:
┌─────────────────────────────┐
│ Data: up to 1023 bits       │
│ Refs: [Cell₁, Cell₂, ...]  │  (max 4 references)
└─────────────────────────────┘

Example: storing a user profile
┌─────────────────────────────┐
│ name_length: 5              │
│ name: "Alice"               │
│ balance: 1000000000         │
│ Refs: [settings_cell]       │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ notifications: true         │
│ language: "en"              │
└─────────────────────────────┘
```

This tree-of-cells model means:
- Storage costs are proportional to the number of cells used
- Contracts pay rent for storage (unlike Ethereum's one-time cost)
- Efficient Merkle proofs for any piece of data
- Serialization/deserialization is explicit in contract code

### Addresses in TON

TON addresses encode both the workchain and the account ID:

```
Raw address format:
  workchain_id:account_id
  0:abc123...def  (workchain 0, 256-bit account hash)

User-friendly format (base64url with checksum):
  EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG
  
  Prefix byte encodes:
  - Bounceable (0x11) vs Non-bounceable (0x51)
  - Testnet flag
  
  "Bounceable" means: if the destination contract doesn't exist or
  rejects the message, funds bounce back to sender.
```

### Consensus: Catchain BFT

TON uses a BFT consensus protocol called Catchain:
- Validators are elected via a governance mechanism
- Block time: ~5 seconds on masterchain, ~2-3 seconds on shardchains
- Validators stake TON tokens (minimum ~300,000 TON)
- Slashing for misbehavior (double-signing, downtime)

---

## Common Pitfalls

1. **Thinking synchronously like Ethereum** — In TON, you cannot call another contract and get a result in the same transaction. All cross-contract communication is asynchronous via messages. If Contract A needs data from Contract B, it sends a message to B, and B sends a response message back. This means multi-contract operations span multiple blocks and you must handle partial failures.

2. **Ignoring storage fees** — TON contracts pay ongoing rent for storage. If a contract runs out of balance, it gets frozen (code and data preserved but cannot process messages) and eventually deleted. Always ensure contracts maintain sufficient balance for storage rent. A typical simple contract needs ~0.05 TON per year for storage.

3. **Confusing bounceable and non-bounceable addresses** — Sending TON to a bounceable address that doesn't exist will bounce the funds back (minus fees). Sending to a non-bounceable address that doesn't exist will lose the funds permanently. Use bounceable addresses for contract interactions and non-bounceable only for initial wallet funding.

4. **Not handling bounced messages** — When a message to another contract fails, a "bounced" message returns to the sender. If your contract doesn't handle bounced messages, it may end up in an inconsistent state (e.g., it deducted a balance but the transfer failed). Always implement bounce handlers.

5. **Assuming sequential message delivery** — Messages between contracts are not guaranteed to arrive in the order they were sent (especially across shards). Design your contracts to handle messages arriving in any order, or use sequence numbers to enforce ordering.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install TON CLI tools, set up a testnet wallet, and configure Blueprint for contract development
- [TON Documentation](https://docs.ton.org/) — Official developer documentation
- [TON GitHub](https://github.com/ton-blockchain/ton) — Core protocol source code
