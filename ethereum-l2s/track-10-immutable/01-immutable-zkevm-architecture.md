# Immutable zkEVM Architecture: A Gaming-Focused ZK-Rollup

**Track:** Immutable zkEVM Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You're building a web3 game and need a chain that handles high-frequency NFT mints, trades, and in-game asset transfers without crushing your players with gas fees. Ethereum mainnet is too expensive — minting a single NFT costs $10-15, and your game needs to mint thousands per day. You've heard Immutable zkEVM is "built for gaming," but you don't understand what that means architecturally. How does it differ from a general-purpose zk-rollup like zkSync or Polygon zkEVM? What are the trust assumptions? How does gas-free minting actually work? Without understanding the architecture, you'll make wrong assumptions about finality, asset ownership, and what you can and can't do on-chain.

## Core Concepts

### What Immutable zkEVM Is

Immutable zkEVM is a zk-rollup built in partnership with Polygon, specifically designed for gaming and NFT use cases. It combines Polygon's zkEVM proving technology with Immutable's gaming infrastructure (orderbook, minting APIs, marketplace protocol). The chain launched in early 2024 and settles to Ethereum mainnet.

```
┌─────────────────────────────────────────────────────────┐
│              Immutable zkEVM Architecture                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Game clients / Players                                 │
│       ↓                                                 │
│  Immutable SDK + Passport (wallet abstraction)          │
│  └── Social login, session keys, gas sponsorship        │
│       ↓                                                 │
│  Immutable zkEVM (Polygon zkEVM-based)                  │
│  └── EVM-equivalent execution                           │
│  └── Sequencer orders transactions                      │
│  └── Prover generates ZK validity proofs                │
│       ↓                                                 │
│  Immutable Platform Services                            │
│  └── Orderbook (off-chain matching, on-chain settle)    │
│  └── Minting API (gas-free NFT creation)                │
│  └── Marketplace Protocol (royalty enforcement)         │
│       ↓                                                 │
│  Ethereum L1 (Settlement + Data Availability)           │
│  └── Validity proofs verified on-chain                  │
│  └── State roots committed periodically                 │
│  └── No challenge window — proofs are instant-final     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### ZK-Rollup vs Optimistic Rollup for Gaming

Immutable chose a zk-rollup over an optimistic rollup for a specific reason: finality speed. Games need fast, irreversible confirmations for trades and asset transfers.

| Property | Optimistic Rollup (Arbitrum) | ZK-Rollup (Immutable zkEVM) |
|----------|-----------------------------|-----------------------------|
| Finality to L1 | 7 days (challenge window) | Minutes (proof generation) |
| Withdrawal time | 7 days without bridge | ~30 min after proof posted |
| Trust model | 1-of-N honest validator | Math (validity proof) |
| EVM compatibility | EVM-equivalent | EVM-equivalent (Type 2) |
| Gas cost | Low | Low (slightly higher proof cost) |

For gaming, the key advantage is that once a ZK proof is posted to L1, the state is final. No 7-day wait for withdrawals. Players can bridge assets out in minutes, not days.

### The Polygon zkEVM Foundation

Immutable zkEVM is built on Polygon's zkEVM technology (Type 2 zkEVM — EVM-equivalent at the bytecode level). This means:

- **Standard Solidity works**: Deploy the same contracts you'd deploy on Ethereum mainnet
- **Same opcodes**: All EVM opcodes are supported (with minor gas cost differences)
- **Same tooling**: Hardhat, Foundry, ethers.js all work without modification

```typescript
// Connecting to Immutable zkEVM — same as any EVM chain
import { ethers } from "ethers"; // ethers@6.9.0

// Immutable zkEVM Mainnet
const mainnetProvider = new ethers.JsonRpcProvider(
  "https://rpc.immutable.com"
);

// Immutable zkEVM Testnet
const testnetProvider = new ethers.JsonRpcProvider(
  "https://rpc.testnet.immutable.com"
);

// Verify chain connection
const network = await testnetProvider.getNetwork();
console.log(`Chain ID: ${network.chainId}`); // 13473 (testnet)

// Mainnet Chain ID: 13371
const mainnet = await mainnetProvider.getNetwork();
console.log(`Mainnet Chain ID: ${mainnet.chainId}`); // 13371

// Block production is fast — sub-second for sequencer confirmations
const block = await testnetProvider.getBlock("latest");
console.log(`Latest block: ${block?.number}`);
console.log(`Timestamp: ${new Date((block?.timestamp ?? 0) * 1000).toISOString()}`);
```

### Immutable Passport: Wallet Abstraction for Gamers

The biggest architectural difference from general-purpose L2s is Immutable Passport — a non-custodial wallet system that abstracts away crypto complexity for gamers:

- **Social login**: Players sign in with Google, Apple, or email — no MetaMask required
- **Session keys**: Games can sign transactions on behalf of players for a limited time
- **Gas sponsorship**: Game studios can pay gas fees so players never see them
- **Cross-game identity**: One Passport works across all Immutable games

```typescript
// Immutable Passport integration (conceptual)
import { config, passport } from "@imtbl/sdk"; // @imtbl/sdk@1.45.0

// Initialize Passport
const passportInstance = new passport.Passport({
  baseConfig: {
    environment: config.Environment.SANDBOX, // or PRODUCTION
    publishableKey: "YOUR_PUBLISHABLE_KEY", // from Immutable Hub
  },
  clientId: "YOUR_CLIENT_ID",
  redirectUri: "http://localhost:3000/callback",
  logoutRedirectUri: "http://localhost:3000/logout",
  audience: "platform_api",
  scope: "openid offline_access email transact",
});

// Player logs in with social account — no seed phrase, no extension
const provider = passportInstance.connectEvm();
const accounts = await provider.request({ method: "eth_requestAccounts" });
console.log(`Player wallet: ${accounts[0]}`);
// This is a smart contract wallet on Immutable zkEVM
```

### Sequencer and Proof Generation

The transaction lifecycle on Immutable zkEVM:

1. **Submission**: User (or Passport) submits transaction to the sequencer
2. **Sequencing**: Sequencer orders transactions into batches (~2 seconds)
3. **Execution**: Transactions execute against the EVM state
4. **Proving**: ZK prover generates a validity proof for the batch
5. **Settlement**: Proof + state root posted to Ethereum L1
6. **Finality**: Once L1 confirms the proof transaction, state is final

```typescript
// Checking transaction finality on Immutable zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const provider = new ethers.JsonRpcProvider("https://rpc.testnet.immutable.com");

async function checkFinality(txHash: string): Promise<void> {
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    console.log("Transaction not found or pending");
    return;
  }

  console.log(`Block number: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 1 ? "Success" : "Reverted"}`);

  // On Immutable zkEVM, once included in a block, the transaction
  // has "soft finality" from the sequencer. Full L1 finality comes
  // after the ZK proof is verified on Ethereum (typically minutes).
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`Effective gas price: ${ethers.formatUnits(receipt.gasPrice ?? 0n, "gwei")} gwei`);
}

await checkFinality("0xYOUR_TX_HASH");
```

### Network Details

| Parameter | Mainnet | Testnet |
|-----------|---------|---------|
| Chain ID | 13371 | 13473 |
| RPC URL | https://rpc.immutable.com | https://rpc.testnet.immutable.com |
| Explorer | https://explorer.immutable.com | https://explorer.testnet.immutable.com |
| Native token | IMX (for gas) | tIMX (testnet) |
| Block time | ~2 seconds | ~2 seconds |
| Settlement | Ethereum mainnet | Ethereum Sepolia |

## Common Pitfalls

1. **Confusing Immutable X (StarkEx) with Immutable zkEVM** — Immutable has two chains. Immutable X is the older StarkEx-based validium (limited smart contract support, API-driven). Immutable zkEVM is the newer EVM-compatible zk-rollup. New projects should build on zkEVM unless they specifically need Immutable X's existing liquidity.

2. **Assuming gas is always free** — Gas sponsorship through Passport is opt-in and requires game studios to fund a relayer. If you deploy a contract and interact directly (without Passport), you pay gas in IMX. "Gas-free" only applies to sponsored transactions through the Immutable platform.

3. **Ignoring the IMX token requirement** — Even though the chain is EVM-compatible, the native gas token is IMX, not ETH. You need IMX on Immutable zkEVM to pay for transactions. This is different from most L2s that use ETH for gas.

4. **Treating it as a general-purpose L2** — While technically any EVM contract works, Immutable's infrastructure (orderbook, marketplace, minting API) is optimized for gaming and NFTs. DeFi protocols can deploy but won't benefit from the gaming-specific tooling that makes Immutable attractive.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Gas model, IMX token, and EVM quirks specific to Immutable zkEVM
- [Immutable Documentation](https://docs.immutable.com/) — Official developer documentation
- [Immutable Hub](https://hub.immutable.com/) — Developer dashboard for API keys and project management
- [Polygon zkEVM Architecture](https://docs.polygon.technology/zkEVM/) — The underlying proving technology
