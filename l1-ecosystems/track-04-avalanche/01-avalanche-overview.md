# Avalanche Architecture: C-Chain, X-Chain, P-Chain, and Subnets

**Track:** Avalanche Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You've heard Avalanche is "fast" and "EVM-compatible," but when you look at the docs you find three different chains (C-Chain, X-Chain, P-Chain), something called Subnets, and a consensus protocol that isn't Proof of Work or traditional BFT. Most tutorials skip the architecture and jump straight to deploying a Solidity contract — which works, but leaves you unable to answer basic questions like "why does Avalanche have three chains?" or "what's the difference between a Subnet and an L2?"

Understanding the multi-chain architecture is essential before you write a single line of code, because it determines where your contract lives, how assets move, and what scaling options you have.

---

## Core Concepts

### The Primary Network

Avalanche's Primary Network consists of three built-in blockchains, each optimized for a different purpose:

| Chain | Purpose | VM | Consensus |
|-------|---------|-----|-----------|
| **C-Chain** | Smart contracts (EVM) | Coreth (Geth fork) | Snowman (linear) |
| **X-Chain** | Asset creation & transfer | AVM | Avalanche (DAG) |
| **P-Chain** | Validator coordination & Subnets | Platform VM | Snowman (linear) |

Every Avalanche validator must validate all three chains in the Primary Network.

### C-Chain (Contract Chain)

The C-Chain is where you'll spend most of your time as a smart contract developer. It runs a modified version of go-ethereum (Geth), which means:

- Full EVM compatibility — deploy any Solidity/Vyper contract
- Same tooling: Hardhat, Foundry, Remix, ethers.js all work
- Same RPC methods: `eth_sendTransaction`, `eth_call`, etc.
- Sub-second finality (~2 seconds) vs Ethereum's ~12 minutes

```javascript
// Connecting to Avalanche C-Chain via ethers.js@6.9.0
import { JsonRpcProvider } from "ethers";

// Mainnet C-Chain
const mainnet = new JsonRpcProvider("https://api.avax.network/ext/bc/C/rpc");

// Fuji Testnet C-Chain
const fuji = new JsonRpcProvider("https://api.avax-test.network/ext/bc/C/rpc");

async function getBlockInfo() {
  const block = await fuji.getBlock("latest");
  console.log("Block number:", block.number);
  console.log("Timestamp:", new Date(block.timestamp * 1000).toISOString());
  console.log("Gas limit:", block.gasLimit.toString());
  // Avalanche C-Chain block time: ~2 seconds
}

getBlockInfo().catch(console.error);
```

**Key difference from Ethereum:** C-Chain uses the Snowman consensus protocol, which provides deterministic finality in ~2 seconds. Once a transaction is confirmed, it cannot be reverted — no need to wait for multiple block confirmations.

### X-Chain (Exchange Chain)

The X-Chain handles asset creation and peer-to-peer transfers using a DAG-based consensus (Avalanche consensus). It's optimized for high-throughput simple transfers but does not support smart contracts.

```javascript
// X-Chain is used for creating native assets and fast transfers
// You interact with it via the Avalanche.js SDK or AvalancheGo API

// Example: X-Chain asset creation (conceptual)
// POST to /ext/bc/X
const createAssetTx = {
  jsonrpc: "2.0",
  method: "avm.createFixedCapAsset",
  params: {
    name: "MyAsset",
    symbol: "MAST",
    denomination: 2,
    initialHolders: [
      { address: "X-fuji1...", amount: 1000000 }
    ],
    from: ["X-fuji1..."],
    username: "myuser",
    password: "mypass"
  },
  id: 1
};
```

### P-Chain (Platform Chain)

The P-Chain coordinates validators and manages Subnets. When you stake AVAX, create a Subnet, or add validators, you interact with the P-Chain.

### Subnet Architecture

A Subnet is a sovereign network of validators that agree to validate one or more blockchains. Key properties:

- **Custom VMs**: Run any virtual machine (EVM, WASM, custom)
- **Custom rules**: Set your own gas token, fee structure, access control
- **Dedicated throughput**: Your Subnet's performance isn't affected by C-Chain congestion
- **Validator flexibility**: Choose who validates (permissioned or permissionless)

```text
┌─────────────────────────────────────────────────────┐
│                  Primary Network                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ C-Chain  │  │ X-Chain  │  │ P-Chain  │          │
│  │  (EVM)   │  │  (DAG)   │  │(Platform)│          │
│  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│    Subnet A         │  │    Subnet B         │
│  ┌──────────────┐   │  │  ┌──────────────┐   │
│  │ Gaming Chain │   │  │  │ DeFi Chain   │   │
│  │ (Custom VM)  │   │  │  │ (Subnet-EVM) │   │
│  └──────────────┘   │  │  └──────────────┘   │
│  Validators: 5      │  │  Validators: 20     │
│  Gas token: GAME    │  │  Gas token: AVAX    │
└─────────────────────┘  └─────────────────────┘
```

### Avalanche Consensus

Avalanche uses a family of consensus protocols based on repeated random sub-sampling:

1. A validator receives a transaction
2. It queries a random subset of validators: "Do you prefer this transaction?"
3. If a supermajority (α threshold) responds "yes," the validator adopts that preference
4. Repeat for multiple rounds until confidence reaches the decision threshold (β)

This achieves:
- **Sub-second finality** for simple transactions
- **~2 second finality** for C-Chain blocks
- **Probabilistic safety** that increases exponentially with rounds
- **No leader** — no single point of failure or MEV extraction at the consensus level

```javascript
// Avalanche consensus parameters (Primary Network defaults)
const consensusParams = {
  k: 20,          // sample size — query 20 validators per round
  alpha: 15,      // quorum threshold — need 15/20 agreement
  betaVirtuous: 15, // decision threshold for non-conflicting txs
  betaRogue: 20,    // decision threshold for conflicting txs
  maxOutstandingItems: 256,
  maxItemProcessingTime: "2m"
};
```

### AVAX Token

AVAX is the native token used for:
- **Gas fees** on C-Chain (like ETH on Ethereum)
- **Staking** on P-Chain (minimum 2,000 AVAX for validators, 25 AVAX for delegators)
- **Subnet security** (validators must also validate the Primary Network)
- **Transaction fees** on X-Chain

Unlike Ethereum, Avalanche **burns** all transaction fees — they're not paid to validators. Validators earn rewards from staking inflation instead.

---

## Common Pitfalls

1. **Confusing C-Chain addresses with X-Chain/P-Chain addresses** — C-Chain uses `0x`-prefixed Ethereum-style addresses. X-Chain uses `X-avax1...` Bech32 format. P-Chain uses `P-avax1...`. The same private key derives different address formats for each chain. If you send AVAX to the wrong chain format, you'll need to use cross-chain transfer to recover it.

2. **Assuming Subnets inherit Primary Network security automatically** — Subnets have their own validator sets. A Subnet with 5 validators is far less secure than the Primary Network with 1,700+ validators. Subnet validators must also validate the Primary Network (staking 2,000 AVAX), but the Subnet's security depends on its own validator count and stake.

3. **Treating Avalanche finality like Ethereum finality** — On Ethereum, you wait for multiple confirmations because reorgs are possible. On Avalanche C-Chain, once a block is accepted, it's final. Waiting for extra confirmations is unnecessary and adds latency to your dApp.

4. **Ignoring the X-Chain for asset operations** — If you only need to create and transfer a simple fungible asset without smart contract logic, the X-Chain is faster and cheaper than deploying an ERC-20 on C-Chain. Many developers default to C-Chain for everything when X-Chain would be more appropriate.

5. **Not understanding Subnet gas token implications** — When you create a Subnet with a custom gas token, users need that token to pay for transactions. This creates a bootstrapping problem: how do users get the gas token if they need it to transact? Plan your token distribution strategy before launching.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install Avalanche CLI, configure Core wallet, and connect to Fuji testnet
- [Deploy Your First Smart Contract](./03-first-smart-contract.md) — Write and deploy a Solidity contract to Fuji C-Chain using Hardhat
- [Avalanche Subnets documentation](https://docs.avax.network/subnets) — Official deep-dive into Subnet creation and management
