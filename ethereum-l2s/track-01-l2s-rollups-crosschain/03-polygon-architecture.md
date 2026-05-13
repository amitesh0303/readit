# Polygon Architecture: From PoS Chain to zkEVM

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

"Polygon" means different things depending on who you ask. There's Polygon PoS (the original sidechain), Polygon zkEVM (a ZK rollup), Polygon CDK (a toolkit for building ZK chains), and the broader "Polygon 2.0" vision. If you're evaluating Polygon for deployment, you need to understand which product you're actually looking at and what the tradeoffs are.

---

## Core Concepts

### Polygon PoS: The Original (and Still Dominant)

Polygon PoS is not a rollup — it's a sidechain. It has its own validator set (~100 validators), its own consensus (Heimdall + Bor), and its own security. It checkpoints state to Ethereum periodically, but Ethereum doesn't validate Polygon PoS transactions.

```
Polygon PoS:
- Own validators (not Ethereum validators)
- Own consensus (PoS with ~100 validators)
- Checkpoints to Ethereum every ~30 minutes
- Security: depends on Polygon's validator set, NOT Ethereum
- Fees: ~$0.001-0.01 per transaction
- Block time: ~2 seconds
```

This is fundamentally different from a rollup. Polygon PoS is faster and cheaper than Ethereum, but it doesn't inherit Ethereum's security. A 51% attack on Polygon PoS requires corrupting 2/3 of its validators — much easier than attacking Ethereum.

### Polygon zkEVM: The ZK Rollup

Polygon zkEVM is a genuine ZK rollup — it posts validity proofs to Ethereum and inherits Ethereum's security.

```
Polygon zkEVM:
- Executes transactions off-chain
- Generates ZK proofs (Plonky2-based)
- Posts proofs + data to Ethereum
- Security: inherits Ethereum's security
- Fees: ~$0.01-0.10 per transaction
- Finality: ~1 hour (proof generation time)
- EVM compatibility: Type 2 (near-equivalent)
```

### Polygon CDK: Build Your Own ZK Chain

Polygon CDK (Chain Development Kit) is a toolkit for building custom ZK chains that connect to Polygon's AggLayer — a shared liquidity and interoperability layer.

```
AggLayer vision:
Multiple ZK chains (built with CDK)
    ↓
AggLayer (shared bridge, unified liquidity)
    ↓
Ethereum (settlement)
```

This is Polygon's answer to the "fragmented L2 ecosystem" problem — instead of each L2 having its own isolated liquidity, they share liquidity via the AggLayer.

### The MATIC → POL Migration

Polygon's native token migrated from MATIC to POL in 2024. POL is designed to be a "hyperproductive" token — validators can stake POL to secure multiple chains simultaneously (Polygon PoS, Polygon zkEVM, CDK chains).

### Choosing Between Polygon PoS and zkEVM

**Use Polygon PoS when:**
- You need the lowest possible fees
- You need the largest existing ecosystem (most DeFi protocols are on PoS)
- You can accept the weaker security model
- You need fast finality (2 seconds vs 1 hour for zkEVM)

**Use Polygon zkEVM when:**
- You need Ethereum-level security
- You're building a protocol where security is paramount
- You can accept higher fees and slower finality than PoS
- You want to be on the "future" of Polygon's architecture

---

## Code Walkthrough

Deploying to both Polygon PoS and zkEVM with the same contract:

```typescript
// hardhat.config.ts — multi-network Polygon config
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Polygon PoS Mainnet
    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 137,
      gasPrice: 50_000_000_000, // 50 gwei (Polygon PoS uses higher gas prices)
    },
    // Polygon PoS Testnet (Amoy)
    polygonAmoy: {
      url: "https://rpc-amoy.polygon.technology",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 80002,
    },
    // Polygon zkEVM Mainnet
    polygonZkEVM: {
      url: "https://zkevm-rpc.com",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 1101,
    },
    // Polygon zkEVM Testnet (Cardona)
    polygonZkEVMTestnet: {
      url: "https://rpc.cardona.zkevm-rpc.com",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 2442,
    },
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY!,
      polygonAmoy: process.env.POLYGONSCAN_API_KEY!,
      polygonZkEVM: process.env.POLYGONSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "polygonZkEVM",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api",
          browserURL: "https://zkevm.polygonscan.com",
        },
      },
    ],
  },
};

export default config;
```

```typescript
// scripts/deploy-multichain.ts
import { ethers, run, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying to ${network.name} from ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ${getNetworkToken()}`);

  const MyContract = await ethers.getContractFactory("MyContract");
  const contract = await MyContract.deploy(/* constructor args */);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`Deployed to: ${address}`);
  console.log(`Explorer: ${getExplorerUrl(address)}`);

  // Wait for confirmations before verifying
  await contract.deploymentTransaction()?.wait(5);

  // Verify on Polygonscan
  await run("verify:verify", {
    address,
    constructorArguments: [],
  });
}

function getNetworkToken(): string {
  const tokens: Record<string, string> = {
    polygon: "MATIC/POL",
    polygonAmoy: "MATIC",
    polygonZkEVM: "ETH",
    polygonZkEVMTestnet: "ETH",
  };
  return tokens[network.name] ?? "ETH";
}

function getExplorerUrl(address: string): string {
  const explorers: Record<string, string> = {
    polygon: `https://polygonscan.com/address/${address}`,
    polygonAmoy: `https://amoy.polygonscan.com/address/${address}`,
    polygonZkEVM: `https://zkevm.polygonscan.com/address/${address}`,
  };
  return explorers[network.name] ?? address;
}

main().catch(console.error);
```

Polygon PoS-specific: handling MATIC/POL as gas token:

```typescript
import { ethers } from "ethers";

// Polygon PoS uses MATIC (now POL) as gas token, not ETH
// Gas prices are in gwei but denominated in MATIC
async function estimatePolygonGas(
  provider: ethers.Provider,
  tx: ethers.TransactionRequest
): Promise<{ gasUnits: bigint; gasPriceGwei: bigint; costMATIC: string }> {
  const gasUnits = await provider.estimateGas(tx);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? ethers.parseUnits("50", "gwei");

  const costWei = gasUnits * gasPrice;
  const costMATIC = ethers.formatEther(costWei);

  return {
    gasUnits,
    gasPriceGwei: gasPrice / BigInt(1e9),
    costMATIC,
  };
}

// Polygon PoS bridge: deposit ETH/ERC-20 from Ethereum to Polygon
// Uses the PoS bridge (not the Plasma bridge)
const POS_BRIDGE_ABI = [
  "function depositEtherFor(address user) payable",
  "function depositFor(address user, address rootToken, bytes calldata depositData)",
];

async function bridgeToPolygon(
  signer: ethers.Signer,
  amount: bigint
): Promise<string> {
  const POS_BRIDGE = "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77"; // Ethereum mainnet

  const bridge = new ethers.Contract(POS_BRIDGE, POS_BRIDGE_ABI, signer);
  const userAddress = await signer.getAddress();

  const tx = await bridge.depositEtherFor(userAddress, { value: amount });
  const receipt = await tx.wait();

  console.log("Bridge tx:", receipt.hash);
  console.log("Funds will arrive on Polygon in ~7-8 minutes");

  return receipt.hash;
}
```

---

## Common Mistakes and Gotchas

**1. Treating Polygon PoS as a rollup**  
Polygon PoS is a sidechain with its own security model. It does NOT inherit Ethereum's security. If you're building a protocol where security is critical (large TVL, financial primitives), understand that Polygon PoS security depends on its ~100 validators, not Ethereum's 500,000+ validators.

**2. Using the wrong bridge**  
Polygon has multiple bridges: the PoS bridge (recommended), the Plasma bridge (deprecated), and the zkEVM bridge (for zkEVM). Using the wrong bridge can result in long withdrawal times or lost funds. Always use the official Polygon bridge UI.

**3. Not accounting for Polygon PoS's higher gas prices**  
Polygon PoS gas prices are in gwei but denominated in MATIC. During network congestion, gas prices can spike to 500+ gwei. Always use dynamic gas pricing, not hardcoded values.

**4. Assuming zkEVM and PoS have the same contract addresses**  
They don't. Polygon PoS and Polygon zkEVM are separate chains with separate deployments. A contract deployed on PoS is not available on zkEVM and vice versa.

**5. Not handling the MATIC → POL migration**  
Polygon's native token migrated from MATIC to POL. If your contract or frontend references "MATIC" specifically, update it. The token address changed, the symbol changed, but the chain ID (137) stayed the same.

---

## How This Connects to Production

Aave V3 is deployed on Polygon PoS — it's one of the largest DeFi protocols on the chain. QuickSwap is Polygon PoS's native DEX. Uniswap V3 is on both Polygon PoS and Polygon zkEVM. The Polygon ecosystem has billions in TVL, mostly on PoS. The zkEVM is newer and growing. Polygon CDK is being used by several projects to build custom ZK chains — Immutable zkEVM (gaming) and OKX's X Layer are built with Polygon CDK.

---

## What to Learn Next

- **Deploying to Arbitrum: What's Different from Ethereum Mainnet** — compare with Arbitrum's deployment experience.
- **Cross-Chain Bridges: How They Work and Where They Break** — understand the bridge infrastructure.
- **What is Caldera? Customizable Rollups and the Modular Blockchain Stack** — understand the broader modular blockchain landscape.
