# BNB Chain Overview and Architecture

**Track:** BNB Chain Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to build a dApp that handles high throughput at low cost, but Ethereum mainnet gas fees eat into your users' wallets. You've heard BNB Chain processes millions of transactions daily with sub-dollar fees, but you're not sure how it differs from Ethereum, what BEP-2 vs BEP-20 means, or where opBNB fits in. Without understanding the architecture, you'll make wrong assumptions about finality, validator trust, and cross-chain compatibility.

## Core Concepts

### BNB Chain Ecosystem Structure

BNB Chain is not a single chain — it's a multi-chain ecosystem with distinct layers:

```
┌─────────────────────────────────────────────────┐
│                 BNB Chain Ecosystem              │
├─────────────────────────────────────────────────┤
│                                                 │
│  BNB Beacon Chain (BEP-2)                       │
│  └── Governance, staking, BEP-2 tokens          │
│                                                 │
│  BNB Smart Chain / BSC (BEP-20)                 │
│  └── EVM-compatible, smart contracts, DeFi      │
│  └── 3-second block time, 30M gas limit         │
│                                                 │
│  opBNB (Layer 2)                                │
│  └── OP Stack-based optimistic rollup           │
│  └── 1-second block time, 100M gas limit        │
│  └── Posts data to BSC for security             │
│                                                 │
│  BNB Greenfield                                 │
│  └── Decentralized storage layer                │
│                                                 │
└─────────────────────────────────────────────────┘
```

### BNB Smart Chain (BSC) — Where You'll Build

BSC is the EVM-compatible execution layer. It runs the same Solidity contracts you'd deploy on Ethereum, but with key differences:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// This contract deploys identically on Ethereum and BSC.
// The difference is cost: ~$0.05 on BSC vs ~$5-50 on Ethereum.
contract SimpleStorage {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    function setValue(uint256 _value) external {
        value = _value;
        emit ValueChanged(_value);
    }

    function getValue() external view returns (uint256) {
        return value;
    }
}
```

### Consensus: Proof of Staked Authority (PoSA)

BSC uses a hybrid consensus combining Delegated Proof of Stake (DPoS) and Proof of Authority (PoA):

- **21 active validators** elected every 24 hours based on staked BNB
- **3-second block time** with instant finality after ~15 blocks (~45 seconds)
- Validators take turns producing blocks in a round-robin fashion
- Slashing for double-signing and downtime

This is a deliberate tradeoff: fewer validators means faster blocks and lower fees, but more centralization than Ethereum's ~900,000 validators.

### BEP-2 vs BEP-20: Token Standards

| Standard | Chain | Purpose | Analogy |
|----------|-------|---------|---------|
| BEP-2 | Beacon Chain | Native tokens, transfers | Like Bitcoin UTXO tokens |
| BEP-20 | BSC | Smart contract tokens | Identical to ERC-20 |
| BEP-721 | BSC | NFTs | Identical to ERC-721 |
| BEP-1155 | BSC | Multi-tokens | Identical to ERC-1155 |

BEP-20 is the standard you'll use most. It's a 1:1 mapping of ERC-20 — same interface, same events, same tooling.

### opBNB: The Layer 2

opBNB is BSC's optimistic rollup built on the OP Stack (same foundation as Optimism and Base):

- Executes transactions off-chain, posts compressed data to BSC
- 100M gas limit per block (vs BSC's 30M)
- Sub-cent transaction fees ($0.001 typical)
- 7-day challenge window for withdrawals (same as Optimism)

For high-frequency use cases (gaming, social, micropayments), opBNB is where you deploy.

### Network Details

| Property | BSC Mainnet | BSC Testnet | opBNB Mainnet |
|----------|-------------|-------------|---------------|
| Chain ID | 56 | 97 | 204 |
| RPC URL | https://bsc-dataseed.binance.org | https://data-seed-prebsc-1-s1.binance.org:8545 | https://opbnb-mainnet-rpc.bnbchain.org |
| Block Explorer | https://bscscan.com | https://testnet.bscscan.com | https://opbnbscan.com |
| Native Token | BNB | tBNB | BNB |

## Common Pitfalls

1. **Assuming BSC is fully decentralized** — With only 21 validators, BSC prioritizes performance over decentralization. Validators can theoretically censor transactions. For censorship-resistant applications, consider whether this tradeoff is acceptable.

2. **Confusing BEP-2 and BEP-20** — BEP-2 tokens live on Beacon Chain and cannot interact with smart contracts. If you're building DeFi or any contract-based application, you need BEP-20 on BSC.

3. **Using Ethereum mainnet gas estimates** — BSC gas prices are typically 3-5 gwei vs Ethereum's 20-100+ gwei. Hardcoding Ethereum-level gas prices wastes user funds. Always query the network's current gas price.

4. **Ignoring opBNB for high-throughput apps** — If your dApp needs >100 TPS or sub-cent fees, deploying only on BSC leaves performance on the table. opBNB handles gaming and social use cases better.

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Configure Hardhat and Foundry for BSC testnet deployment
- [BNB Chain Official Docs](https://docs.bnbchain.org/) — Complete reference for BSC and opBNB development
