# Deploying to Optimism: Complete Walkthrough with Gas Comparison

**Track:** Optimism & OP Stack Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

You have a contract ready to deploy and you want to put it on Optimism. You need the exact steps: getting testnet ETH, configuring your tooling, deploying, verifying, and understanding what you're actually paying in gas. Most importantly, you want to see real numbers — how much does deployment cost on Optimism vs Ethereum mainnet? Without this comparison, you can't justify the L2 choice to your team or estimate production costs.

## Core Concepts

### Gas Cost Comparison: Optimism vs Ethereum Mainnet

Here's a real-world cost comparison for common operations (prices as of January 2025, ETH at ~$3,300):

| Operation | Ethereum Mainnet | Optimism L2 | Savings |
|-----------|-----------------|-------------|---------|
| ERC-20 Transfer | ~65,000 gas × 30 gwei = ~$6.40 | ~65,000 L2 gas × 0.001 gwei + L1 data fee ≈ **$0.01-0.05** | **99%** |
| Contract Deployment (simple) | ~800,000 gas × 30 gwei = ~$79 | ~800,000 L2 gas × 0.001 gwei + L1 data fee ≈ **$0.10-0.50** | **99%** |
| Contract Deployment (complex) | ~3,000,000 gas × 30 gwei = ~$297 | ~3,000,000 L2 gas × 0.001 gwei + L1 data fee ≈ **$0.30-1.50** | **99%** |
| Uniswap V3 Swap | ~185,000 gas × 30 gwei = ~$18 | ~185,000 L2 gas × 0.001 gwei + L1 data fee ≈ **$0.02-0.08** | **99%** |
| NFT Mint (ERC-721) | ~150,000 gas × 30 gwei = ~$15 | ~150,000 L2 gas × 0.001 gwei + L1 data fee ≈ **$0.02-0.06** | **99%** |

> **Note:** L1 data fees vary with Ethereum's blob base fee. Post-EIP-4844 (Ecotone upgrade), Optimism uses blobs which reduced L1 data costs by ~10x. The numbers above reflect post-Ecotone pricing. Last verified: 2025-01-15.

### Step-by-Step Deployment

#### Prerequisites

```bash
# Install Node.js 18+ and create project
# Last verified: 2025-01-15
node --version  # v18.0.0 or higher required

mkdir op-deployment-demo && cd op-deployment-demo
npm init -y

# Install Hardhat and dependencies
npm install --save-dev hardhat@2.22.0 \
  @nomicfoundation/hardhat-toolbox@5.0.0 \
  @openzeppelin/contracts@5.0.2 \
  dotenv@16.4.5

# Initialize Hardhat project
npx hardhat init
# Select: "Create a TypeScript project"
```

Expected output:
```
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /path/to/op-deployment-demo
✔ Do you want to add a .gitignore? (Y/n) · y
✨ Project created
```

#### The Contract

```solidity
// contracts/GasComparisonToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GasComparisonToken
 * @notice A simple ERC-20 token for demonstrating deployment costs.
 * @dev Deploys identically on Ethereum mainnet and Optimism.
 *      The deployment cost difference demonstrates L2 savings.
 */
contract GasComparisonToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;

    error MintExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();

    event TokensMinted(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
}
```

#### Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    // Optimism Sepolia (testnet)
    optimismSepolia: {
      url: `https://opt-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 11155420,
    },
    // Optimism Mainnet
    optimismMainnet: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 10,
    },
    // Ethereum Sepolia (for cost comparison)
    ethereumSepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      optimismSepolia: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "optimismSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io",
        },
      },
    ],
  },
};

export default config;
```

#### Environment Setup

```bash
# .env file (never commit this!)
PRIVATE_KEY=your_private_key_here
ALCHEMY_KEY=your_alchemy_api_key
OPTIMISTIC_ETHERSCAN_API_KEY=your_etherscan_api_key
```

#### Getting Testnet ETH

```bash
# OP Sepolia Faucet (requires GitHub account or Alchemy account)
# Last verified: 2025-01-15
# Option 1: Superchain Faucet (official)
# Visit: https://app.optimism.io/faucet
# Drips 0.05 ETH on OP Sepolia per day

# Option 2: Alchemy Faucet
# Visit: https://www.alchemy.com/faucets/optimism-sepolia
# Requires Alchemy account, drips testnet ETH

# Option 3: Bridge from Ethereum Sepolia
# Get Sepolia ETH from https://sepoliafaucet.com/
# Bridge to OP Sepolia via https://app.optimism.io/bridge
```

#### Deployment Script

```typescript
// scripts/deploy.ts
import { ethers, network, run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log("=== Deployment to", networkName, "(Chain ID:", chainId.toString(), ") ===");
  console.log("Deployer:", deployer.address);

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.005")) {
    throw new Error("Insufficient balance. Need at least 0.005 ETH for deployment.");
  }

  // Get pre-deployment gas info
  const feeData = await ethers.provider.getFeeData();
  console.log("\nGas Info:");
  console.log("  Gas price:", ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"), "gwei");
  console.log("  Max fee:", ethers.formatUnits(feeData.maxFeePerGas ?? 0n, "gwei"), "gwei");
  console.log("  Priority fee:", ethers.formatUnits(feeData.maxPriorityFeePerGas ?? 0n, "gwei"), "gwei");

  // Deploy the contract
  console.log("\nDeploying GasComparisonToken...");
  const Token = await ethers.getContractFactory("GasComparisonToken");

  const initialSupply = ethers.parseEther("100000"); // 100k tokens
  const token = await Token.deploy(
    "Gas Comparison Token",
    "GCT",
    initialSupply
  );

  const deployTx = token.deploymentTransaction();
  if (!deployTx) throw new Error("No deployment transaction");

  console.log("Tx hash:", deployTx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await deployTx.wait();
  if (!receipt) throw new Error("Deployment failed");

  const contractAddress = await token.getAddress();

  // Calculate actual costs
  const gasUsed = receipt.gasUsed;
  const effectiveGasPrice = receipt.gasPrice;
  const totalCost = gasUsed * effectiveGasPrice;

  console.log("\n=== Deployment Results ===");
  console.log("Contract address:", contractAddress);
  console.log("Block number:", receipt.blockNumber);
  console.log("Gas used:", gasUsed.toString());
  console.log("Effective gas price:", ethers.formatUnits(effectiveGasPrice, "gwei"), "gwei");
  console.log("Total cost:", ethers.formatEther(totalCost), "ETH");
  console.log("Total cost (USD, ETH=$3300):", (Number(ethers.formatEther(totalCost)) * 3300).toFixed(4), "USD");

  // If on Optimism, also show L1 data fee
  if (chainId === 10n || chainId === 11155420n) {
    try {
      const gasPriceOracle = await ethers.getContractAt(
        ["function getL1Fee(bytes) view returns (uint256)"],
        "0x420000000000000000000000000000000000000F"
      );
      // Estimate L1 fee for the deployment transaction data
      const l1Fee = await gasPriceOracle.getL1Fee(deployTx.data);
      console.log("L1 data fee:", ethers.formatEther(l1Fee), "ETH");
      console.log("L1 data fee (USD):", (Number(ethers.formatEther(l1Fee)) * 3300).toFixed(4), "USD");
    } catch (error) {
      console.log("(Could not read L1 fee from oracle)");
    }
  }

  // Explorer link
  const explorerUrls: Record<string, string> = {
    optimismMainnet: "https://optimistic.etherscan.io",
    optimismSepolia: "https://sepolia-optimism.etherscan.io",
    ethereumSepolia: "https://sepolia.etherscan.io",
  };
  const explorerBase = explorerUrls[networkName] || "";
  if (explorerBase) {
    console.log(`\nExplorer: ${explorerBase}/address/${contractAddress}`);
  }

  // Verify contract
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nWaiting 30s for explorer indexing...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    try {
      await run("verify:verify", {
        address: contractAddress,
        constructorArguments: [
          "Gas Comparison Token",
          "GCT",
          initialSupply,
        ],
      });
      console.log("✓ Contract verified!");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✓ Already verified");
      } else {
        console.error("Verification failed:", error.message);
        console.log("You can verify manually at:", `${explorerBase}/verifyContract`);
      }
    }
  }

  // Post-deployment test: call a read function
  const name = await token.name();
  const symbol = await token.symbol();
  const supply = await token.totalSupply();
  console.log("\n=== Post-Deployment Verification ===");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Total supply:", ethers.formatEther(supply));
  console.log("Owner:", await token.owner());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

#### Running the Deployment

```bash
# Compile the contract
npx hardhat compile
```

Expected output:
```
Compiled 6 Solidity files successfully (evm target: cancun).
```

```bash
# Deploy to OP Sepolia
npx hardhat run scripts/deploy.ts --network optimismSepolia
```

Expected output:
```
=== Deployment to optimismSepolia (Chain ID: 11155420) ===
Deployer: 0xYourAddress...
Balance: 0.05 ETH

Gas Info:
  Gas price: 0.001000025 gwei
  Max fee: 0.001000050 gwei
  Priority fee: 0.001000000 gwei

Deploying GasComparisonToken...
Tx hash: 0xabc123...
Waiting for confirmation...

=== Deployment Results ===
Contract address: 0xdef456...
Block number: 12345678
Gas used: 847293
Effective gas price: 0.001000025 gwei
Total cost: 0.000000847293 ETH
Total cost (USD, ETH=$3300): 0.0028 USD
L1 data fee: 0.000045 ETH
L1 data fee (USD): 0.1485 USD

Explorer: https://sepolia-optimism.etherscan.io/address/0xdef456...
```

Compare with Ethereum Sepolia:
```bash
# Deploy same contract to Ethereum Sepolia for comparison
npx hardhat run scripts/deploy.ts --network ethereumSepolia
```

Expected output:
```
=== Deployment to ethereumSepolia (Chain ID: 11155111) ===
Deployer: 0xYourAddress...
Balance: 0.5 ETH

Gas Info:
  Gas price: 25.0 gwei
  Max fee: 50.0 gwei
  Priority fee: 2.0 gwei

Deploying GasComparisonToken...
Tx hash: 0x789abc...
Waiting for confirmation...

=== Deployment Results ===
Contract address: 0xghi789...
Block number: 5432100
Gas used: 847293
Effective gas price: 27.0 gwei
Total cost: 0.022877 ETH
Total cost (USD, ETH=$3300): 75.49 USD

Explorer: https://sepolia.etherscan.io/address/0xghi789...
```

#### Cost Comparison Summary

```
┌─────────────────────────────────────────────────────────────┐
│           GasComparisonToken Deployment Cost                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Ethereum Mainnet (estimated at 30 gwei):                   │
│  └── Gas used: 847,293                                      │
│  └── Cost: 0.0254 ETH ≈ $83.82                             │
│                                                              │
│  Optimism L2 (actual):                                      │
│  └── L2 execution: 847,293 × 0.001 gwei ≈ $0.003           │
│  └── L1 data fee: ~$0.05-0.15                               │
│  └── Total: ≈ $0.05-0.15                                    │
│                                                              │
│  Savings: ~99.8% ($83.67 saved per deployment)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Foundry Deployment Alternative

```solidity
// script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GasComparisonToken.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        GasComparisonToken token = new GasComparisonToken(
            "Gas Comparison Token",
            "GCT",
            100_000 * 10**18
        );

        console.log("Token deployed to:", address(token));
        console.log("Name:", token.name());
        console.log("Symbol:", token.symbol());

        vm.stopBroadcast();
    }
}
```

```bash
# Deploy with Foundry to OP Sepolia
# Last verified: 2025-01-15
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://sepolia.optimism.io \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $OPTIMISTIC_ETHERSCAN_API_KEY \
  -vvvv
```

Expected output:
```
[⠊] Compiling...
[⠊] Compiling 1 files with Solc 0.8.24
[⠒] Solc 0.8.24 finished in 1.23s
Script ran successfully.

== Logs ==
  Token deployed to: 0x...
  Name: Gas Comparison Token
  Symbol: GCT

## Setting up 1 EVM.
==========================
Chain 11155420
Estimated gas price: 0.001000025 gwei
Estimated total gas used for script: 1102481
Estimated amount required: 0.000001102 ETH
==========================

ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
```

### Post-Deployment: ERC-20 Transfer Gas Comparison

```typescript
// scripts/transfer-comparison.ts
import { ethers } from "hardhat";

async function compareTransferCosts() {
  // This script should be run on both networks to compare
  const [sender, recipient] = await ethers.getSigners();
  const tokenAddress = process.env.TOKEN_ADDRESS!;

  const token = await ethers.getContractAt("GasComparisonToken", tokenAddress);

  const amount = ethers.parseEther("100");

  console.log("Transferring", ethers.formatEther(amount), "tokens...");

  const tx = await token.transfer(recipient.address, amount);
  const receipt = await tx.wait();

  if (!receipt) throw new Error("Transfer failed");

  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice;
  const cost = gasUsed * gasPrice;

  console.log("Gas used:", gasUsed.toString());
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Cost:", ethers.formatEther(cost), "ETH");
  console.log("Cost (USD):", (Number(ethers.formatEther(cost)) * 3300).toFixed(6), "USD");

  // On Optimism: ~65,000 gas × 0.001 gwei = ~$0.0002 (L2) + ~$0.01-0.03 (L1 data)
  // On Ethereum: ~65,000 gas × 30 gwei = ~$6.40
}

compareTransferCosts().catch(console.error);
```

## Common Pitfalls

1. **Deploying to mainnet without testing on OP Sepolia first** — Always deploy to OP Sepolia first. The testnet behavior is identical to mainnet. Get testnet ETH from the Superchain Faucet at [https://app.optimism.io/faucet](https://app.optimism.io/faucet) (last verified: 2025-01-15).

2. **Underestimating L1 data fees for large contracts** — While L2 execution is nearly free, the L1 data fee scales with transaction data size. A large contract deployment (50KB+ bytecode) will have a higher L1 data fee. Optimize contract size with the Solidity optimizer and consider splitting into multiple contracts.

3. **Not verifying contracts immediately after deployment** — Etherscan verification can fail if you wait too long (the compilation metadata may not match). Verify within the deployment script or immediately after. Use `--verify` flag with Foundry or `hardhat-verify` plugin.

4. **Forgetting that gas prices fluctuate with L1 blob fees** — The L1 data component of Optimism gas fees tracks Ethereum's blob base fee. During high L1 activity, your Optimism costs increase too. Monitor the GasPriceOracle predeploy for current rates before large deployments.

5. **Not setting up proper .env management** — Never commit private keys or API keys. Use `.env` files with `dotenv`, add `.env` to `.gitignore`, and use a secrets manager for production deployments. Consider using hardware wallets via Frame or Ledger for mainnet deployments.

## What to Learn Next

- [OP Stack Architecture](./01-op-stack-architecture.md) — revisit the architecture to understand how your deployed contract fits into the system
- [Optimism Governance and RetroPGF](https://community.optimism.io/) — learn about the Optimism Collective and how to get funded for public goods
- [Building on the Superchain](https://docs.optimism.io/builders/chain-operators/tutorials/create-l2-rollup) — deploy your own OP Stack chain
- [Optimism Mainnet Deployment Checklist](https://docs.optimism.io/builders/app-developers/overview) — official guide for production deployments
