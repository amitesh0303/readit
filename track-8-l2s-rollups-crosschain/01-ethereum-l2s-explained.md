# Ethereum L2s Explained: Optimistic vs ZK Rollups

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

Ethereum mainnet is expensive. A simple swap costs $5-50. A complex DeFi interaction can cost $100+. You've heard that L2s are the solution, but you're not sure which one to use, how they actually work, or what the tradeoffs are. "Optimistic rollup" and "ZK rollup" sound like marketing terms.

This blog explains the actual mechanics of both rollup types — not the marketing, but the technical tradeoffs that matter for developers choosing where to deploy.

---

## Core Concepts

### What a Rollup Is

A rollup is a blockchain that executes transactions off Ethereum mainnet but posts transaction data (or proofs) to Ethereum for security. The key insight: Ethereum's security comes from its data availability and consensus, not from executing every transaction itself.

```
Without rollup:
Every transaction → executed by every Ethereum node → expensive

With rollup:
Transactions → executed by rollup nodes (cheap)
              → compressed data posted to Ethereum (inherits security)
              → Ethereum verifies the rollup's work
```

The rollup inherits Ethereum's security because:
1. Transaction data is on Ethereum (anyone can reconstruct state)
2. Fraud proofs or validity proofs ensure the rollup can't cheat

### Optimistic Rollups: Assume Valid, Challenge if Wrong

Optimistic rollups assume all transactions are valid by default. They post transaction data to Ethereum but don't prove correctness immediately. Instead, there's a challenge window (7 days) during which anyone can submit a fraud proof if they detect invalid state transitions.

```
Rollup posts: "Here are 1000 transactions. New state root: 0xABC"
Ethereum: "OK, I'll accept this. Anyone can challenge within 7 days."

If no challenge: state is finalized after 7 days
If challenge: fraud proof submitted, invalid state rejected, challenger rewarded
```

**The 7-day withdrawal delay**: because of the challenge window, withdrawing from an optimistic rollup to Ethereum mainnet takes 7 days. Liquidity bridges (like Hop Protocol) solve this by providing instant liquidity for a fee.

**Examples**: Arbitrum One, Optimism, Base, Blast

### ZK Rollups: Prove Validity Immediately

ZK rollups generate a cryptographic proof (validity proof) for every batch of transactions. The proof mathematically guarantees that all transactions were executed correctly. No challenge window needed.

```
Rollup executes 1000 transactions
Rollup generates ZK proof: "These 1000 transactions are valid"
Rollup posts: proof + compressed data to Ethereum
Ethereum verifies proof: takes ~200,000 gas, ~1 second
State is immediately final
```

**Instant finality**: withdrawals from ZK rollups to Ethereum are fast (minutes to hours, depending on proof generation time).

**Examples**: zkSync Era, Polygon zkEVM, Scroll, StarkNet

### The Tradeoff Table

| Property | Optimistic Rollup | ZK Rollup |
|----------|------------------|-----------|
| Withdrawal time | 7 days (or bridge) | Minutes-hours |
| EVM compatibility | High (Arbitrum, OP) | Varies (zkEVM = high) |
| Proof cost | None (fraud proofs only if challenged) | Proof generation + verification |
| Maturity | More mature | Rapidly maturing |
| Security model | Economic (fraud proofs) | Cryptographic (validity proofs) |
| Prover hardware | Not needed | Specialized hardware |

### EVM Equivalence: The Developer Experience Question

Not all ZK rollups are equal for developers. The key question: how compatible is the ZK rollup with Ethereum's EVM?

**Type 1 (EVM-equivalent)**: identical to Ethereum at the bytecode level. Any Ethereum contract deploys unchanged. Hardest to build, slowest proofs. (Scroll aims for this)

**Type 2 (EVM-equivalent, minor differences)**: nearly identical, minor differences in gas costs or edge cases. (Polygon zkEVM)

**Type 3 (EVM-compatible)**: most EVM opcodes work, some don't. Requires minor contract changes. (zkSync Era)

**Type 4 (high-level language compatible)**: compiles Solidity/Vyper to a different VM. Significant differences. (StarkNet with Cairo)

Optimistic rollups (Arbitrum, Optimism) are Type 1 or Type 2 — they run the actual EVM, so compatibility is near-perfect.

### Data Availability: The Cost Driver

The main cost of a rollup is posting data to Ethereum. EIP-4844 (Dencun upgrade, March 2024) introduced "blobs" — a new data type specifically for rollup data that's much cheaper than calldata.

```
Before EIP-4844:
Rollup posts data as calldata: ~16 gas/byte
1000 transactions (~100KB): ~1.6M gas = ~$50 at 30 gwei

After EIP-4844:
Rollup posts data as blobs: ~1 gas/byte (target)
1000 transactions (~100KB): ~100K gas = ~$3 at 30 gwei
```

This is why L2 fees dropped 10-100x in March 2024.

---

## Code Walkthrough

Detecting which L2 you're on and adapting behavior:

```typescript
import { ethers } from "ethers";

// Chain IDs for major L2s
const CHAIN_IDS = {
  ETHEREUM: 1,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  BASE: 8453,
  POLYGON: 137,
  ZKSYNC: 324,
  SCROLL: 534352,
  STARKNET: undefined, // different architecture
} as const;

interface ChainConfig {
  name: string;
  type: "optimistic" | "zk" | "sidechain";
  withdrawalDelay: string;
  blockExplorer: string;
  bridgeUrl: string;
  nativeBridgeDelay?: string;
}

const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [CHAIN_IDS.ARBITRUM]: {
    name: "Arbitrum One",
    type: "optimistic",
    withdrawalDelay: "7 days (native bridge)",
    blockExplorer: "https://arbiscan.io",
    bridgeUrl: "https://bridge.arbitrum.io",
    nativeBridgeDelay: "7 days",
  },
  [CHAIN_IDS.OPTIMISM]: {
    name: "Optimism",
    type: "optimistic",
    withdrawalDelay: "7 days (native bridge)",
    blockExplorer: "https://optimistic.etherscan.io",
    bridgeUrl: "https://app.optimism.io/bridge",
    nativeBridgeDelay: "7 days",
  },
  [CHAIN_IDS.BASE]: {
    name: "Base",
    type: "optimistic",
    withdrawalDelay: "7 days (native bridge)",
    blockExplorer: "https://basescan.org",
    bridgeUrl: "https://bridge.base.org",
    nativeBridgeDelay: "7 days",
  },
  [CHAIN_IDS.ZKSYNC]: {
    name: "zkSync Era",
    type: "zk",
    withdrawalDelay: "~24 hours",
    blockExplorer: "https://explorer.zksync.io",
    bridgeUrl: "https://bridge.zksync.io",
  },
  [CHAIN_IDS.SCROLL]: {
    name: "Scroll",
    type: "zk",
    withdrawalDelay: "~1 hour",
    blockExplorer: "https://scrollscan.com",
    bridgeUrl: "https://scroll.io/bridge",
  },
};

async function getChainInfo(provider: ethers.Provider): Promise<ChainConfig | null> {
  const network = await provider.getNetwork();
  return CHAIN_CONFIGS[Number(network.chainId)] ?? null;
}

// Arbitrum-specific: get L1 data fee component
async function getArbitrumL1Fee(
  provider: ethers.Provider,
  txData: string
): Promise<bigint> {
  // Arbitrum's NodeInterface precompile
  const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
  const nodeInterface = new ethers.Contract(
    NODE_INTERFACE,
    ["function gasEstimateL1Component(address to, bool contractCreation, bytes calldata data) view returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"],
    provider
  );

  try {
    const [gasForL1] = await nodeInterface.gasEstimateL1Component(
      ethers.ZeroAddress,
      false,
      txData
    );
    return gasForL1;
  } catch {
    return 0n;
  }
}

// Show withdrawal warning for optimistic rollups
function WithdrawalWarning({ chainId }: { chainId: number }) {
  const config = CHAIN_CONFIGS[chainId];
  if (!config || config.type !== "optimistic") return null;

  return (
    <div className="withdrawal-warning">
      <p>
        ⚠️ Withdrawing to Ethereum mainnet takes {config.nativeBridgeDelay}.
        Use a bridge like{" "}
        <a href="https://hop.exchange" target="_blank" rel="noopener noreferrer">
          Hop Protocol
        </a>{" "}
        for faster withdrawals (with a small fee).
      </p>
    </div>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Assuming `block.number` is the L1 block number**  
On Arbitrum, `block.number` returns the L2 block number, not the Ethereum block number. L2 blocks are produced much faster. If your contract uses `block.number` for timing (e.g., vesting), it will behave differently on L2. Use `block.timestamp` instead, or use Arbitrum's `ArbSys.arbBlockNumber()` for L2 block number and `ArbSys.arbBlockHash()` for L1 block info.

**2. Not accounting for L1 data fees on Arbitrum**  
Arbitrum transactions have two fee components: L2 execution fee and L1 data fee. The L1 data fee depends on the size of your transaction data. Large transactions (many parameters, large arrays) have higher L1 fees. This is why gas estimation on Arbitrum can be surprising.

**3. Treating optimistic rollup withdrawals as instant**  
The 7-day withdrawal delay is real and affects your protocol design. If you're building a bridge or a protocol that needs to move funds between L1 and L2, you must account for this delay. Use liquidity bridges (Hop, Across, Stargate) for user-facing withdrawals.

**4. Assuming all EVM opcodes work the same on ZK rollups**  
Some ZK rollups don't support all EVM opcodes. `SELFDESTRUCT` is deprecated everywhere. `PUSH0` (EIP-3855) isn't supported on all ZK rollups. Always check the specific rollup's EVM compatibility notes before deploying.

**5. Not testing on the actual L2 testnet**  
Behavior on Arbitrum Sepolia or Optimism Sepolia can differ from Ethereum Sepolia. Always test on the target L2's testnet before mainnet deployment.

---

## How This Connects to Production

Uniswap V3 is deployed on Arbitrum, Optimism, Polygon, and Base — each deployment is independent but uses the same contract code. Aave V3 is on Arbitrum, Optimism, and Polygon. GMX is Arbitrum-native — it was built specifically for Arbitrum's low fees and fast finality. Synthetix moved its core protocol to Optimism. The L2 ecosystem has matured to the point where most new DeFi protocols launch on L2 first (or L2-only) rather than Ethereum mainnet.

---

## What to Learn Next

- **Arbitrum Deep Dive: Architecture and What Developers Need to Know** — go deep on the most popular optimistic rollup.
- **Deploying to Arbitrum: What's Different from Ethereum Mainnet** — practical deployment guide.
- **Cross-Chain Bridges: How They Work and Where They Break** — understand the infrastructure connecting L1 and L2.
