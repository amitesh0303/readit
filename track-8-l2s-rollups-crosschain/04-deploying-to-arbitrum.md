# Deploying to Arbitrum: What's Different from Ethereum Mainnet

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

You have a working Ethereum contract. You want to deploy it to Arbitrum. You've heard "it's EVM-compatible, just change the RPC" — but that's not the whole story. There are subtle differences in gas behavior, block numbers, precompiles, and deployment patterns that can bite you if you're not prepared.

This blog is a practical deployment checklist: what to check, what to change, and what to watch out for.

---

## Core Concepts

### What's the Same

The good news: most things work identically.

- Solidity syntax and semantics
- EVM opcodes (with minor exceptions)
- Contract ABI encoding
- ethers.js / wagmi / viem APIs
- OpenZeppelin contracts
- Hardhat and Foundry tooling
- ERC-20, ERC-721, ERC-1155 standards

### What's Different

**1. `block.number`** — returns L2 block number (~250ms blocks), not L1 block number. Use `block.timestamp` for time-based logic.

**2. Gas pricing** — two-component fees (L2 execution + L1 data). Gas estimation must account for both.

**3. `block.basefee`** — returns Arbitrum's L2 base fee, not Ethereum's. Much lower (typically 0.01-0.1 gwei).

**4. `PUSH0` opcode** — supported on Arbitrum Nitro (unlike some older L2s).

**5. `SELFDESTRUCT`** — deprecated everywhere (EIP-6049), but especially avoid on L2s.

**6. Precompiles** — Arbitrum has additional precompiles (ArbSys, ArbGasInfo) not present on Ethereum.

**7. Contract size limit** — same 24KB limit as Ethereum.

**8. Sequencer dependency** — transactions go through Arbitrum's sequencer before L1. The sequencer can be down (rare but possible).

---

## Code Walkthrough

Complete deployment workflow for Arbitrum:

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // viaIR can help with stack too deep errors on complex contracts
      viaIR: false,
    },
  },
  networks: {
    arbitrumOne: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 42161,
    },
    arbitrumSepolia: {
      url: `https://arb-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 421614,
    },
  },
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY!,
      arbitrumSepolia: process.env.ARBISCAN_API_KEY!,
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
};

export default config;
```

```typescript
// scripts/deploy-arbitrum.ts
import { ethers, run, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Check we have enough ETH for deployment
  // Arbitrum deployments are cheap but not free
  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Insufficient ETH for deployment. Need at least 0.01 ETH.");
  }

  // Deploy with explicit gas settings for Arbitrum
  const MyContract = await ethers.getContractFactory("MyContract");

  // Get current fee data
  const feeData = await ethers.provider.getFeeData();
  console.log("L2 base fee:", ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"), "gwei");

  const contract = await MyContract.deploy(
    /* constructor args */,
    {
      // For Arbitrum, use legacy gas pricing (type 0) or EIP-1559 (type 2)
      // EIP-1559 is supported on Arbitrum
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    }
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("Deployed to:", address);
  console.log("Arbiscan:", `https://arbiscan.io/address/${address}`);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    address,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash,
  };

  console.log("Deployment info:", deploymentInfo);

  // Wait for Arbiscan to index the contract
  console.log("Waiting for Arbiscan indexing...");
  await contract.deploymentTransaction()?.wait(5);

  // Verify on Arbiscan
  if (network.name !== "hardhat") {
    console.log("Verifying on Arbiscan...");
    try {
      await run("verify:verify", {
        address,
        constructorArguments: [/* same args as deploy */],
      });
      console.log("Verified!");
    } catch (err: any) {
      if (err.message.includes("Already Verified")) {
        console.log("Already verified");
      } else {
        console.error("Verification failed:", err.message);
      }
    }
  }
}

main().catch(console.error);
```

Pre-deployment checklist script:

```typescript
// scripts/pre-deploy-check.ts
import { ethers } from "hardhat";

async function preDeployCheck() {
  const provider = ethers.provider;
  const network = await provider.getNetwork();

  console.log("=== Pre-Deployment Check ===");
  console.log("Chain ID:", network.chainId.toString());

  // 1. Verify we're on Arbitrum
  const isArbitrum = [42161n, 421614n].includes(network.chainId);
  console.log("Is Arbitrum:", isArbitrum ? "✓" : "✗ (not Arbitrum)");

  // 2. Check block.number behavior
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  console.log("Current L2 block:", blockNumber);
  console.log("Block timestamp:", new Date((block?.timestamp ?? 0) * 1000).toISOString());

  // 3. Check gas prices
  const feeData = await provider.getFeeData();
  console.log("L2 base fee:", ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"), "gwei");

  // 4. Check ArbSys precompile (confirms we're on Arbitrum)
  if (isArbitrum) {
    const arbSys = new ethers.Contract(
      "0x0000000000000000000000000000000000000064",
      ["function arbBlockNumber() view returns (uint256)", "function arbChainID() view returns (uint256)"],
      provider
    );
    const l1BlockNumber = await arbSys.arbBlockNumber();
    const chainId = await arbSys.arbChainID();
    console.log("L1 block number (via ArbSys):", l1BlockNumber.toString());
    console.log("Chain ID (via ArbSys):", chainId.toString());
  }

  // 5. Estimate deployment cost
  const [deployer] = await ethers.getSigners();
  const balance = await provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

  console.log("=== Check Complete ===");
}

preDeployCheck().catch(console.error);
```

Foundry deployment:

```bash
# Deploy to Arbitrum Sepolia with Foundry
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  -vvvv

# Deploy to Arbitrum One
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  -vvvv
```

---

## Common Mistakes and Gotchas

**1. Not testing on Arbitrum Sepolia first**  
Always test on Arbitrum Sepolia before mainnet. Get testnet ETH from the Arbitrum faucet or bridge from Ethereum Sepolia. The behavior is identical to mainnet.

**2. Hardcoding Ethereum mainnet contract addresses**  
Uniswap, Aave, Chainlink — they all have different addresses on Arbitrum. Use a config file that maps chain ID to contract addresses. Never hardcode mainnet addresses in contracts that will be deployed to multiple chains.

**3. Not updating your frontend's chain config**  
After deploying, update your frontend to include Arbitrum in the supported chains list, with the correct contract addresses and RPC endpoints. A common mistake: deploying the contract but forgetting to update the frontend config.

**4. Ignoring the sequencer downtime risk**  
Arbitrum's sequencer has had occasional downtime. If your protocol requires continuous operation (like a liquidation system), have a fallback plan for sequencer downtime. Arbitrum provides a sequencer feed that you can monitor.

**5. Not setting up monitoring after deployment**  
Deploy monitoring alongside your contract. Set up Tenderly alerts for failed transactions, unusual gas usage, or specific events. Arbitrum's fast block times mean issues can compound quickly.

---

## How This Connects to Production

Every major DeFi protocol has an Arbitrum deployment. The deployment process is nearly identical to Ethereum mainnet — the main differences are the RPC URL, chain ID, and contract addresses for dependencies. Arbitrum's EVM equivalence means you can use the same Hardhat/Foundry setup, the same OpenZeppelin contracts, and the same testing patterns. The main operational difference is monitoring: Arbitrum's fast blocks mean you need more frequent monitoring and faster incident response.

---

## What to Learn Next

- **Cross-Chain Bridges: How They Work and Where They Break** — understand how to move assets between Arbitrum and other chains.
- **What is Caldera? Customizable Rollups and the Modular Blockchain Stack** — understand the next evolution of rollup infrastructure.
- **Tenderly: Debugging and Simulating Transactions Like a Pro** — set up monitoring for your Arbitrum deployment.
