# What is a Blockchain? Blocks, Nodes, Consensus Explained Simply

**Track:** Beginner  
**Read time:** 10 min

---

## The Problem

You've heard the word "blockchain" thrown around in every tech conversation for the past few years. But if you actually try to build something on it — deploy a contract, write a dApp, integrate a wallet — you quickly realize that most explanations are either too abstract ("it's a distributed ledger!") or too shallow ("it's like a Google Sheet no one can edit!").

Neither of those helps you when you're staring at a failed transaction, wondering why your write didn't go through, or why you need to wait for "confirmations." Before you write a single line of Solidity or Rust, you need a mental model of what's actually happening underneath. This blog gives you that — no fluff, no hype, just the mechanics.

---

## Core Concepts

### What a Block Actually Is

A block is just a data structure. It contains:

- A list of transactions (the actual state changes people requested)
- A reference to the previous block (its hash)
- A timestamp
- Some metadata depending on the chain (nonce, difficulty, etc.)

That reference to the previous block is the key insight. Each block cryptographically points to the one before it. If you tamper with block #500, its hash changes — which breaks block #501's reference, which breaks #502, and so on. The chain becomes invalid. This is where the "immutability" property actually comes from — not magic, just cryptographic linking.

```
Block #499          Block #500          Block #501
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ prev: #498  │◄───│ prev: #499  │◄───│ prev: #500  │
│ txns: [...]  │    │ txns: [...]  │    │ txns: [...]  │
│ hash: 0xA1  │    │ hash: 0xB2  │    │ hash: 0xC3  │
└─────────────┘    └─────────────┘    └─────────────┘
```

Change anything in block #500 and `0xB2` becomes `0xB9` (or whatever) — and block #501's `prev` field no longer matches. The chain is broken.

### What a Node Is

A node is just a computer running the blockchain software. It holds a full copy of the chain and participates in validating and propagating transactions.

There are different types:

- **Full nodes** — download and verify every block and transaction from genesis. They enforce the rules.
- **Light nodes** — only download block headers, trust full nodes for transaction data. Used in mobile wallets.
- **Archive nodes** — full nodes that also store every historical state (expensive, needed for things like querying old balances).
- **Validator/miner nodes** — full nodes that also participate in producing new blocks.

When you send a transaction from MetaMask, you're not talking to "the blockchain" directly. You're sending your transaction to a node (usually via an RPC provider like Alchemy or Infura), which then broadcasts it to the peer-to-peer network of other nodes.

### What Consensus Actually Means

Here's the real question: if thousands of nodes each hold a copy of the chain, and multiple nodes are trying to add the next block at the same time — who wins? And how does everyone agree on the same version of history?

That's the consensus problem. Different chains solve it differently.

**Proof of Work (PoW) — Bitcoin's approach:**  
Nodes (miners) compete to solve a computationally expensive puzzle. The first one to solve it gets to add the next block and earn the block reward. The puzzle is hard to solve but easy to verify. This makes cheating expensive — you'd need more compute than the rest of the network combined (the "51% attack").

**Proof of Stake (PoS) — Ethereum post-Merge:**  
Instead of burning electricity, validators lock up ("stake") ETH as collateral. The protocol pseudo-randomly selects a validator to propose the next block. Other validators attest to it. If a validator tries to cheat, their stake gets "slashed" (partially destroyed). The economic cost of cheating replaces the computational cost.

**Delegated PoS, PoH, and others:**  
Solana uses Proof of History (PoH) — a cryptographic clock that lets validators agree on the ordering of events without constant communication. This is part of why Solana can hit 50,000+ TPS compared to Ethereum's ~15 TPS pre-L2.

### Finality: When Is a Transaction Actually Done?

This trips up a lot of developers. "Confirmed" doesn't always mean "final."

- On Bitcoin, you typically wait for 6 confirmations (~60 minutes) before treating a transaction as irreversible.
- On Ethereum PoS, "finality" happens after two epochs (~12.8 minutes), but transactions are practically safe after a few blocks.
- On Solana, finality is much faster — optimistic confirmation in ~400ms, full finality in a few seconds.

Why does this matter for developers? If you're building an exchange or a payment system, you need to decide how many confirmations you require before crediting a user. Too few and you're vulnerable to reorgs. Too many and your UX suffers.

---

## Code Walkthrough

Here's a minimal TypeScript snippet showing how you'd check block confirmations using ethers.js — the kind of thing you'd write in a real dApp backend:

```typescript
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/YOUR_KEY");

async function waitForConfirmations(txHash: string, requiredConfirmations: number) {
  console.log(`Waiting for tx: ${txHash}`);

  // Get the transaction receipt — null if not yet mined
  let receipt = await provider.getTransactionReceipt(txHash);

  while (!receipt) {
    console.log("Not yet mined, polling...");
    await new Promise((r) => setTimeout(r, 3000)); // wait 3s
    receipt = await provider.getTransactionReceipt(txHash);
  }

  // receipt.blockNumber is the block this tx was included in
  const txBlock = receipt.blockNumber;

  while (true) {
    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - txBlock;

    console.log(`Confirmations: ${confirmations}/${requiredConfirmations}`);

    if (confirmations >= requiredConfirmations) {
      console.log("Transaction finalized.");
      return receipt;
    }

    await new Promise((r) => setTimeout(r, 5000)); // poll every 5s
  }
}

waitForConfirmations("0xYOUR_TX_HASH", 12);
```

A few things worth noting here:
- `getTransactionReceipt` returns `null` until the tx is mined — always handle that.
- We're computing confirmations manually as `currentBlock - txBlock`. ethers v6 also has a `receipt.confirmations()` method but it makes an extra RPC call.
- For production, you'd use WebSocket subscriptions (`provider.on("block", ...)`) instead of polling.

---

## Common Mistakes and Gotchas

**1. Confusing "pending" with "failed"**  
A transaction stuck in the mempool is not failed — it's waiting. This usually happens because the gas price was too low. Developers often assume a missing receipt means an error, when really the tx just hasn't been picked up yet. Always distinguish between `null` receipt (pending/dropped) and a receipt with `status: 0` (reverted on-chain).

**2. Treating 1 confirmation as final**  
On chains with fast block times (Polygon: 2s, BSC: 3s), reorgs happen more frequently than on Ethereum mainnet. A transaction with 1 confirmation on Polygon can still be reorganized out. For anything involving real value, wait for more confirmations than you think you need.

**3. Assuming all nodes have the same state**  
Nodes sync at different speeds. If you write a transaction and immediately query a different RPC endpoint, you might get stale data. This is especially painful with load-balanced RPC providers. The fix: always read from the same node you wrote to, or use `eth_getTransactionReceipt` with the tx hash to confirm inclusion before reading state.

**4. Misunderstanding "immutability"**  
Immutability means the history can't be rewritten cheaply — not that it's physically impossible. A 51% attack on a small PoW chain is not theoretical; it has happened to Ethereum Classic, Bitcoin Gold, and others. Immutability is an economic guarantee, not a mathematical one.

**5. Ignoring chain reorganizations in event listeners**  
If you're listening to `Transfer` events and a reorg happens, you might process the same event twice or miss it entirely. Production indexers handle this by tracking block hashes, not just block numbers, and rolling back state when a reorg is detected.

---

## How This Connects to Production

Every major protocol you interact with is built on top of these primitives. Uniswap's swap router relies on transaction finality to settle trades. Aave's liquidation bots monitor on-chain state by running full nodes or using archive node queries. Chainlink's oracle network is itself a set of nodes reaching consensus on off-chain data before writing it on-chain. Even something as simple as an NFT mint depends on the block producer including your transaction before someone else's in the same block — which is why NFT launches get front-run. Understanding blocks, nodes, and consensus isn't academic background — it's the foundation every production decision sits on.

---

## What to Learn Next

- **Public/Private Keys, Wallets, and How Transactions Actually Work** — now that you know what a block is, learn what's actually inside a transaction and how cryptographic signing makes it trustless.
- **RPC Nodes Explained: How Your dApp Talks to the Blockchain** — go deeper on the node layer: what RPC calls look like, how providers like Alchemy work, and when you need your own node.
- **Gas Fees Explained: Why Does Ethereum Cost So Much?** — understand the economic layer that determines which transactions get included and in what order.
