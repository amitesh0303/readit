# What is Caldera? Customizable Rollups and the Modular Blockchain Stack

**Track:** Intermediate → Expert  
**Read time:** 11 min

---

## The Problem

You're building a gaming protocol. You need 10,000 TPS, sub-second finality, custom gas tokens, and the ability to whitelist which contracts can be deployed. Ethereum mainnet can't do this. Arbitrum One is shared with everyone — you can't customize it. You need your own chain.

But running your own L1 is expensive and insecure. Running your own rollup from scratch requires months of engineering. Caldera solves this: it lets you deploy a customized rollup in minutes, using battle-tested rollup stacks (OP Stack, Arbitrum Orbit), with Ethereum as the settlement layer.

---

## Core Concepts

### The Modular Blockchain Stack

Traditional blockchains (Ethereum, Bitcoin) are monolithic — they handle execution, consensus, data availability, and settlement in one layer. The modular thesis separates these:

```
Monolithic:
Ethereum = Execution + Consensus + Data Availability + Settlement

Modular:
Execution Layer: your rollup (Caldera chain)
Data Availability: Ethereum, Celestia, EigenDA, or Avail
Consensus: inherited from settlement layer
Settlement: Ethereum (fraud proofs or validity proofs)
```

This separation enables customization at each layer. You can use Ethereum for settlement (maximum security) but Celestia for data availability (cheaper), or use EigenDA for even cheaper DA.

### What Caldera Is

Caldera is a Rollup-as-a-Service (RaaS) platform. It handles the infrastructure complexity of running a rollup so you can focus on your application.

```
You provide:
- Chain configuration (gas token, block time, whitelist, etc.)
- Your application contracts

Caldera provides:
- Sequencer infrastructure
- Node infrastructure
- Bridge UI
- Block explorer
- RPC endpoints
- Monitoring and alerting
```

Caldera supports multiple rollup stacks:
- **OP Stack** (Optimism's stack, used by Base, Zora, Mode)
- **Arbitrum Orbit** (Arbitrum's stack for L3s)
- **Polygon CDK** (ZK-based)

### App-Chains vs Shared Chains

**Shared chain (Arbitrum One, Optimism)**:
- Your protocol shares block space with everyone
- Gas prices fluctuate based on network demand
- Can't customize gas token, block time, or permissions
- Benefit from shared liquidity and ecosystem

**App-chain (Caldera rollup)**:
- Dedicated block space for your protocol
- Predictable, low gas prices
- Full customization
- Must bootstrap your own liquidity and ecosystem

### When to Use an App-Chain

App-chains make sense when:
- You need high throughput (gaming, trading, social)
- You need custom gas tokens (users pay in your protocol token)
- You need permissioned access (enterprise, regulated use cases)
- You need custom precompiles (specialized computation)
- Your protocol generates enough activity to justify dedicated infrastructure

App-chains don't make sense when:
- You need to compose with existing DeFi protocols (Uniswap, Aave)
- You have low transaction volume
- You need maximum decentralization
- You can't bootstrap liquidity

### Data Availability Options

The choice of DA layer significantly affects cost and security:

**Ethereum (calldata/blobs)**:
- Most secure (Ethereum's full security)
- Most expensive (even with blobs)
- Best for high-value applications

**Celestia**:
- Cheaper than Ethereum
- Separate security model (Celestia validators)
- Good for high-throughput, lower-value applications

**EigenDA**:
- Ethereum-restaked security (via EigenLayer)
- Cheaper than Ethereum blobs
- Growing ecosystem

**Avail**:
- Standalone DA chain
- Very cheap
- Less battle-tested

---

## Code Walkthrough

Interacting with a Caldera-deployed chain:

```typescript
import { ethers } from "ethers";
import { createPublicClient, createWalletClient, http, custom } from "viem";

// Caldera chains have standard EVM interfaces
// The only difference is the RPC URL and chain ID

// Example: Manta Pacific (built on Caldera + OP Stack)
const MANTA_PACIFIC = {
  id: 169,
  name: "Manta Pacific",
  network: "manta-pacific",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://pacific-rpc.manta.network/http"] },
    public: { http: ["https://pacific-rpc.manta.network/http"] },
  },
  blockExplorers: {
    default: { name: "Manta Explorer", url: "https://pacific-explorer.manta.network" },
  },
};

// Example: Zora Network (built on OP Stack, similar to Caldera)
const ZORA_NETWORK = {
  id: 7777777,
  name: "Zora",
  network: "zora",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.zora.energy"] },
  },
  blockExplorers: {
    default: { name: "Zora Explorer", url: "https://explorer.zora.energy" },
  },
};

// Standard ethers.js works with any EVM chain
async function interactWithCalderaChain(rpcUrl: string) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  console.log("Chain ID:", network.chainId.toString());
  console.log("Block number:", await provider.getBlockNumber());

  // All standard EVM operations work
  const balance = await provider.getBalance("0xYourAddress");
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  return provider;
}

// Deploying to a Caldera chain with Hardhat
// hardhat.config.ts addition:
const calderaChainConfig = {
  myAppChain: {
    url: "https://your-chain.calderachain.xyz/http",
    accounts: [process.env.PRIVATE_KEY!],
    chainId: 12345, // your chain's ID
  },
};
```

Configuring a Caldera chain (conceptual — done via Caldera's dashboard):

```typescript
// This represents the configuration you'd set in Caldera's dashboard
// Not actual code — just illustrating the options

interface CalderaChainConfig {
  // Basic settings
  chainName: string;
  chainId: number;

  // Rollup stack
  stack: "op-stack" | "arbitrum-orbit" | "polygon-cdk";

  // Settlement
  settlementLayer: "ethereum" | "arbitrum";

  // Data availability
  dataAvailability: "ethereum" | "celestia" | "eigenda" | "avail";

  // Gas token
  nativeToken: {
    type: "eth" | "custom-erc20";
    address?: string; // if custom ERC-20
    symbol: string;
  };

  // Block settings
  blockTime: number; // seconds

  // Permissions
  permissioned: boolean;
  whitelist?: string[]; // addresses allowed to deploy contracts

  // Custom precompiles
  precompiles?: {
    address: string;
    implementation: string;
  }[];
}

const exampleConfig: CalderaChainConfig = {
  chainName: "MyGameChain",
  chainId: 98765,
  stack: "op-stack",
  settlementLayer: "ethereum",
  dataAvailability: "eigenda",
  nativeToken: {
    type: "custom-erc20",
    address: "0xMyGameToken",
    symbol: "GAME",
  },
  blockTime: 1, // 1 second blocks
  permissioned: true,
  whitelist: ["0xMyGameContract", "0xMyNFTContract"],
};
```

Bridging to/from a Caldera chain:

```typescript
// Caldera provides a standard bridge for each chain
// The bridge is based on the underlying rollup stack's bridge

// For OP Stack chains (like Caldera OP chains):
const OP_BRIDGE_ABI = [
  "function depositETH(uint32 _minGasLimit, bytes calldata _extraData) payable",
  "function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes calldata _extraData)",
];

async function bridgeToCalderaChain(
  signer: ethers.Signer,
  l1BridgeAddress: string,
  amount: bigint
) {
  const bridge = new ethers.Contract(l1BridgeAddress, OP_BRIDGE_ABI, signer);

  const tx = await bridge.depositETH(
    200_000,  // min gas limit for L2 execution
    "0x",     // no extra data
    { value: amount }
  );

  const receipt = await tx.wait();
  console.log("Bridge initiated:", receipt.hash);
  console.log("Funds will arrive on L2 in ~1-3 minutes");

  return receipt;
}
```

---

## Common Mistakes and Gotchas

**1. Underestimating the liquidity bootstrapping challenge**  
An app-chain has no existing liquidity. Users need to bridge assets in. This is a significant UX friction point. Plan your liquidity strategy before launching — consider incentivizing LPs, partnering with bridges, or using a liquidity bootstrapping mechanism.

**2. Choosing the wrong DA layer for your security requirements**  
Using Celestia for DA is cheaper but means your chain's security depends on Celestia's validator set, not Ethereum's. For high-value applications (DeFi with large TVL), use Ethereum DA. For gaming or social applications, cheaper DA is acceptable.

**3. Not planning for sequencer decentralization**  
Caldera-deployed chains initially use a centralized sequencer. This is fine for early-stage protocols but becomes a trust issue as TVL grows. Plan your path to sequencer decentralization from the start.

**4. Ignoring the composability tradeoff**  
An app-chain can't natively compose with Uniswap or Aave on Ethereum or Arbitrum. Cross-chain calls are possible but add latency and complexity. If your protocol needs tight integration with existing DeFi, a shared chain is better.

**5. Not setting up proper monitoring**  
App-chains require more operational overhead than deploying to a shared chain. You're responsible for monitoring your sequencer, bridge, and node infrastructure. Set up comprehensive monitoring from day one.

---

## How This Connects to Production

Manta Pacific is a Caldera-deployed chain using OP Stack + Celestia DA. Zora Network (NFTs) uses OP Stack. Treasure (gaming) uses Arbitrum Orbit. Immutable zkEVM (gaming) uses Polygon CDK. The "app-chain thesis" is that every major application will eventually have its own chain — just as every major company has its own servers rather than sharing a mainframe. Caldera, Conduit, and AltLayer are the RaaS providers making this accessible. The modular blockchain stack is the infrastructure layer that makes it possible.

---

## What to Learn Next

- **Ethereum L2s Explained: Optimistic vs ZK Rollups** — understand the rollup stacks Caldera uses.
- **Cross-Chain Bridges: How They Work and Where They Break** — understand the bridge infrastructure for your app-chain.
- **Arbitrum Deep Dive: Architecture and What Developers Need to Know** — go deep on the Arbitrum Orbit stack.
