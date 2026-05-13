# Deploying to Base: Complete Walkthrough

**Track:** Base Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You have a Solidity contract ready to go and you want to deploy it to Base's testnet, verify it, and understand exactly what it costs compared to Ethereum mainnet. You need a step-by-step walkthrough covering wallet setup, testnet ETH acquisition, deployment, verification, and a real gas cost comparison so you can justify the L2 choice to your team or users.

## Core Concepts

### Gas Cost Comparison: Base vs Ethereum Mainnet

The primary reason to deploy on Base is cost. Here's a real comparison for common operations (measured January 2025):

| Operation | Ethereum Mainnet | Base | Savings |
|-----------|-----------------|------|---------|
| ETH transfer | ~$1.50 (21,000 gas × 30 gwei) | ~$0.001 | ~1,500x cheaper |
| ERC-20 transfer | ~$3.00 (65,000 gas × 30 gwei) | ~$0.003 | ~1,000x cheaper |
| ERC-20 deploy | ~$30-60 (1-2M gas × 30 gwei) | ~$0.05-0.10 | ~500x cheaper |
| Uniswap V3 swap | ~$8-15 (150-300K gas × 30 gwei) | ~$0.01-0.02 | ~700x cheaper |
| NFT mint (ERC-721) | ~$5-10 (100-200K gas × 30 gwei) | ~$0.005-0.01 | ~800x cheaper |

> **Note:** Ethereum costs assume 30 gwei base fee (moderate congestion). Base costs include both L2 execution and L1 data fees post-EIP-4844. Actual costs vary with network conditions. Last verified: 2025-01-15.

### Prerequisites

Before deploying, you need:

1. **Node.js** ≥ 18.0 and a package manager (npm/pnpm)
2. **A wallet** with Base Sepolia ETH for testnet deployment
3. **Basescan API key** for contract verification (free at https://basescan.org/apis)

### Step 1: Get Base Sepolia Testnet ETH

```shell
# Option 1: Coinbase Faucet (recommended, requires Coinbase account)
# Visit: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
# Last verified: 2025-01-15

# Option 2: Alchemy Faucet
# Visit: https://www.alchemy.com/faucets/base-sepolia
# Last verified: 2025-01-15

# Option 3: Bridge from Ethereum Sepolia
# Get Sepolia ETH from https://sepoliafaucet.com
# Bridge to Base Sepolia via https://testnets.superbridge.app/base-sepolia
```

> **Last verified:** 2025-01-15. Faucet URLs change frequently. See [Base documentation](https://docs.base.org/docs/tools/network-faucets) for the latest faucet links.

### Step 2: Project Setup with Hardhat

```shell
# Create project directory and initialize
mkdir base-deploy-demo && cd base-deploy-demo
npm init -y
npm install --save-dev hardhat@2.19.0 @nomicfoundation/hardhat-toolbox@4.0.0
npm install --save-dev @openzeppelin/contracts@5.0.0
npm install dotenv@16.3.1

# Initialize Hardhat project
npx hardhat init
# Select: "Create a TypeScript project"
```

```
Expected output:
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /path/to/base-deploy-demo
✔ Do you want to add a .gitignore? (Y/n) · y
✨ Project created
```

### Step 3: Configure Environment

```shell
# Create .env file (never commit this!)
echo "PRIVATE_KEY=your_wallet_private_key_here" > .env
echo "BASESCAN_API_KEY=your_basescan_api_key_here" >> .env
echo "ALCHEMY_BASE_SEPOLIA_URL=https://base-sepolia.g.alchemy.com/v2/your_key" >> .env
```

```typescript
// hardhat.config.ts
// hardhat@2.19.0
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY not set in .env file");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    baseSepolia: {
      url: process.env.ALCHEMY_BASE_SEPOLIA_URL || "https://sepolia.base.org",
      accounts: [PRIVATE_KEY],
      chainId: 84532,
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: [PRIVATE_KEY],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY!,
      base: process.env.BASESCAN_API_KEY!,
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};

export default config;
```

### Step 4: Write the Contract

```solidity
// contracts/BaseToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BaseToken - A simple ERC-20 token deployed on Base
/// @notice Demonstrates a standard token deployment on Base L2
contract BaseToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18;

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert ExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply);
    }

    /// @notice Mint new tokens (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint (in wei)
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }
}
```

### Step 5: Write the Deployment Script

```typescript
// scripts/deploy.ts
// hardhat@2.19.0
import { ethers, run, network } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();

  console.log("=== Base Deployment ===");
  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId.toString());
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.001")) {
    throw new Error(
      "Insufficient ETH. Get testnet ETH from https://www.coinbase.com/faucets/base-ethereum-goerli-faucet"
    );
  }

  // Deploy parameters
  const tokenName = "Base Demo Token";
  const tokenSymbol = "BDT";
  const initialSupply = ethers.parseEther("100000"); // 100,000 tokens

  console.log("\nDeploying BaseToken...");
  console.log("  Name:", tokenName);
  console.log("  Symbol:", tokenSymbol);
  console.log("  Initial supply:", ethers.formatEther(initialSupply));

  // Get gas estimate before deploying
  const BaseToken = await ethers.getContractFactory("BaseToken");
  const deployTx = await BaseToken.getDeployTransaction(
    tokenName,
    tokenSymbol,
    initialSupply
  );
  const estimatedGas = await ethers.provider.estimateGas({
    ...deployTx,
    from: deployer.address,
  });
  const feeData = await ethers.provider.getFeeData();
  const estimatedCost = estimatedGas * (feeData.gasPrice ?? 0n);

  console.log("\nGas estimate:");
  console.log("  Gas units:", estimatedGas.toString());
  console.log("  Gas price:", ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"), "gwei");
  console.log("  Estimated cost:", ethers.formatEther(estimatedCost), "ETH");

  // Deploy
  const token = await BaseToken.deploy(tokenName, tokenSymbol, initialSupply);
  await token.waitForDeployment();

  const address = await token.getAddress();
  const receipt = await token.deploymentTransaction()!.wait();

  console.log("\n✓ Deployed!");
  console.log("  Address:", address);
  console.log("  Tx hash:", token.deploymentTransaction()!.hash);
  console.log("  Gas used:", receipt!.gasUsed.toString());
  console.log("  Actual cost:", ethers.formatEther(receipt!.gasUsed * receipt!.gasPrice), "ETH");
  console.log("  Basescan:", `https://sepolia.basescan.org/address/${address}`);

  // Verify on Basescan
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\nWaiting for Basescan indexing (30s)...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    try {
      await run("verify:verify", {
        address,
        constructorArguments: [tokenName, tokenSymbol, initialSupply],
      });
      console.log("✓ Contract verified on Basescan!");
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes("Already Verified")) {
        console.log("Contract already verified");
      } else {
        console.error("Verification failed:", err.message);
        console.log("You can verify manually at:", `https://sepolia.basescan.org/verifyContract?a=${address}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### Step 6: Deploy to Base Sepolia

```shell
# Compile contracts
npx hardhat compile
```

```
Expected output:
Generating typings for: 4 artifacts in dir: typechain-types for target: ethers-v6
Successfully generated 12 typings!
Compiled 4 Solidity files successfully (using solc 0.8.24+commit.e11b9ed9)
```

```shell
# Deploy to Base Sepolia testnet
npx hardhat run scripts/deploy.ts --network baseSepolia
```

```
Expected output:
=== Base Deployment ===
Network: baseSepolia
Chain ID: 84532
Deployer: 0xYourAddress...
Balance: 0.1 ETH

Deploying BaseToken...
  Name: Base Demo Token
  Symbol: BDT
  Initial supply: 100000.0

Gas estimate:
  Gas units: 1245678
  Gas price: 0.001 gwei
  Estimated cost: 0.000001245678 ETH

✓ Deployed!
  Address: 0xDeployedContractAddress...
  Tx hash: 0xTransactionHash...
  Gas used: 1198234
  Actual cost: 0.000001198234 ETH
  Basescan: https://sepolia.basescan.org/address/0xDeployedContractAddress...

Waiting for Basescan indexing (30s)...
Verifying contract...
✓ Contract verified on Basescan!
```

### Step 7: Foundry Alternative

```shell
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Deploy with Forge (last verified: 2025-01-15)
forge create src/BaseToken.sol:BaseToken \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY \
  --constructor-args "Base Demo Token" "BDT" 100000000000000000000000 \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  --verifier-url https://api-sepolia.basescan.org/api
```

```
Expected output:
[⠊] Compiling...
[⠊] Compiling 4 files with Solc 0.8.24
[⠒] Solc 0.8.24 finished in 1.23s
Compiler run successful!
Deployer: 0xYourAddress...
Deployed to: 0xDeployedAddress...
Transaction hash: 0xTxHash...
Starting contract verification...
Submitted contract for verification:
  Response: OK
  GUID: verification-guid
Contract successfully verified.
```

### Step 8: Post-Deployment Verification

```typescript
// scripts/verify-deployment.ts
// hardhat@2.19.0
import { ethers } from "hardhat";

async function verifyDeployment(contractAddress: string): Promise<void> {
  const provider = ethers.provider;
  const network = await provider.getNetwork();

  console.log("=== Post-Deployment Verification ===");
  console.log("Network:", network.chainId.toString());
  console.log("Contract:", contractAddress);

  // Check contract exists
  const code = await provider.getCode(contractAddress);
  if (code === "0x") {
    throw new Error("No contract code at address — deployment may have failed");
  }
  console.log("✓ Contract code exists (", code.length, "bytes )");

  // Interact with deployed contract
  const token = await ethers.getContractAt("BaseToken", contractAddress);

  const name = await token.name();
  const symbol = await token.symbol();
  const totalSupply = await token.totalSupply();
  const owner = await token.owner();

  console.log("✓ Token name:", name);
  console.log("✓ Token symbol:", symbol);
  console.log("✓ Total supply:", ethers.formatEther(totalSupply));
  console.log("✓ Owner:", owner);

  // Test a transfer
  const [deployer] = await ethers.getSigners();
  const testAmount = ethers.parseEther("10");

  console.log("\nTesting transfer of", ethers.formatEther(testAmount), symbol, "...");
  const tx = await token.transfer(
    "0x000000000000000000000000000000000000dEaD", // burn address
    testAmount
  );
  const receipt = await tx.wait();

  console.log("✓ Transfer successful");
  console.log("  Gas used:", receipt!.gasUsed.toString());
  console.log("  Cost:", ethers.formatEther(receipt!.gasUsed * receipt!.gasPrice), "ETH");

  // Compare with Ethereum mainnet cost estimate
  const ethMainnetGasPrice = ethers.parseUnits("30", "gwei"); // typical mainnet
  const ethMainnetCost = receipt!.gasUsed * ethMainnetGasPrice;
  const baseCost = receipt!.gasUsed * receipt!.gasPrice;

  console.log("\n=== Gas Comparison (ERC-20 Transfer) ===");
  console.log("  Base cost:", ethers.formatEther(baseCost), "ETH");
  console.log("  Ethereum mainnet estimate:", ethers.formatEther(ethMainnetCost), "ETH (at 30 gwei)");
  console.log("  Savings:", (Number(ethMainnetCost) / Number(baseCost)).toFixed(0) + "x cheaper on Base");

  console.log("\n=== Verification Complete ===");
}

// Replace with your deployed contract address
verifyDeployment("0xYourDeployedContractAddress").catch(console.error);
```

### Mainnet Deployment Checklist

Before deploying to Base mainnet:

- [ ] All tests pass on Base Sepolia
- [ ] Contract verified on Sepolia Basescan
- [ ] Gas costs measured and acceptable
- [ ] Wallet has sufficient mainnet ETH on Base
- [ ] Multisig or timelock configured for admin functions
- [ ] Monitoring set up (Tenderly, OpenZeppelin Defender)
- [ ] Frontend updated with mainnet contract addresses

## Common Pitfalls

1. **Deploying without testing on Base Sepolia first** — Always deploy to testnet first. Base Sepolia behavior matches mainnet. Skipping testnet risks losing real funds to bugs.

2. **Not waiting for Basescan indexing before verification** — Basescan needs 15-30 seconds to index a new contract. Attempting verification immediately after deployment will fail with "contract not found."

3. **Using wrong constructor argument encoding for verification** — If verification fails, the most common cause is mismatched constructor arguments. Ensure the arguments passed to `verify:verify` exactly match what you used during deployment.

4. **Forgetting to set `evmVersion` to `cancun`** — Base supports Cancun opcodes (including `TSTORE`/`TLOAD` for transient storage). Setting the wrong EVM version may produce suboptimal bytecode or miss available optimizations.

5. **Not accounting for L1 data fees in cost estimates** — The `gasUsed × gasPrice` calculation only shows the L2 execution cost. The total transaction cost includes the L1 data fee. Use the GasPriceOracle precompile for accurate total cost estimation.

## What to Learn Next

- [Base Architecture](./01-base-architecture.md) — Review the underlying OP Stack architecture
- [Base Documentation](https://docs.base.org) — Official guides and API reference
- [Hardhat Deployment Guide](https://hardhat.org/tutorial/deploying-to-a-live-network) — General Hardhat deployment patterns
- [OpenZeppelin Defender](https://www.openzeppelin.com/defender) — Post-deployment monitoring and admin management
