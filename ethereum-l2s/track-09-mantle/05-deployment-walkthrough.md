# Deploying to Mantle: Step-by-Step Walkthrough with Gas Comparison

**Track:** Mantle Network Development
**Lesson:** 5 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You've read about Mantle's architecture and tooling, but you haven't actually deployed anything yet. You need a concrete, end-to-end walkthrough: get testnet MNT, configure your project, deploy a contract, verify it on Mantlescan, and understand exactly how much you save compared to Ethereum mainnet. Since Mantle uses MNT for gas instead of ETH, the cost comparison requires converting to a common denomination. Without doing this hands-on, you won't internalize the deployment flow or the real-world cost savings.

## Core Concepts

### Prerequisites and Setup

Install the required tools and configure your environment:

```shell
# Install Foundry (recommended for Mantle development)
# Last verified: 2025-01-15
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

```
Expected output:
foundryup: installing foundry (from https://github.com/foundry-rs/foundry)
foundryup: installed - forge 0.2.0 (abcdef1 2025-01-10)
```

```shell
# Verify installation
forge --version
cast --version
```

```
Expected output:
forge 0.2.0 (abcdef1 2025-01-10T00:00:00.000000000Z)
cast 0.2.0 (abcdef1 2025-01-10T00:00:00.000000000Z)
```

```shell
# Initialize a new Foundry project
forge init mantle-deploy-demo
cd mantle-deploy-demo
```

### Get Testnet MNT on Mantle Sepolia

You need MNT on Mantle Sepolia (chain ID 5003) to pay for gas:

**Option A: Mantle Sepolia Faucet (direct)**
- URL: https://faucet.sepolia.mantle.xyz
- Provides: Testnet MNT on Mantle Sepolia
- Requirement: Connect wallet, may require social verification
- Last verified: 2025-01-15

**Option B: Bridge from Ethereum Sepolia**
1. Get Sepolia ETH from https://sepoliafaucet.com
2. Bridge to Mantle Sepolia via https://bridge.sepolia.mantle.xyz
3. Wait ~10-20 minutes for the deposit to arrive

```shell
# Verify your MNT balance on Mantle Sepolia
cast balance $YOUR_ADDRESS --rpc-url https://rpc.sepolia.mantle.xyz
```

```
Expected output:
1000000000000000000  # 1 MNT in wei
```

### The Contract: ERC-20 Token

We'll deploy a simple ERC-20 token to compare costs between Ethereum and Mantle:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/// @title MantleToken
/// @notice Simple ERC-20 for deployment cost comparison
/// @dev Deploys identically on Ethereum and Mantle — same bytecode, different cost
contract MantleToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;

    error MintExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }
}
```

### Install Dependencies

```shell
# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.1 --no-commit
```

```
Expected output:
Installing openzeppelin-contracts in "lib/openzeppelin-contracts"
    Installed openzeppelin-contracts v5.0.1
```

```shell
# Configure remappings
echo '@openzeppelin/contracts@5.0.1/=lib/openzeppelin-contracts/contracts/' > remappings.txt
```

### Deploy to Mantle Sepolia

```shell
# Set environment variables
export PRIVATE_KEY="your_private_key_here"
export MANTLE_EXPLORER_API_KEY="your_mantlescan_api_key_here"

# Deploy with constructor arguments
forge create src/MantleToken.sol:MantleToken \
  --rpc-url https://rpc.sepolia.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --constructor-args "Mantle Demo Token" "MDT" 100000000000000000000000 \
  --verify \
  --verifier-url https://api-sepolia.mantlescan.xyz/api \
  --etherscan-api-key $MANTLE_EXPLORER_API_KEY
```

```
Expected output:
[⠊] Compiling...
[⠊] Compiling 6 files with 0.8.20
Compiler run successful!
Deployer: 0xYourAddress
Deployed to: 0xDeployedContractAddress
Transaction hash: 0xDeployTxHash
Starting contract verification...
Submitted contract for verification:
  Response: OK
  GUID: abc123
  URL: https://sepolia.mantlescan.xyz/address/0xDeployedContractAddress
Contract successfully verified!
```

### Verify Deployment

```shell
# Check the deployed contract
cast call 0xDeployedContractAddress "name()" --rpc-url https://rpc.sepolia.mantle.xyz
```

```
Expected output:
0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000104d616e746c652044656d6f20546f6b656e...
# Decodes to: "Mantle Demo Token"
```

```shell
# Check total supply
cast call 0xDeployedContractAddress "totalSupply()" --rpc-url https://rpc.sepolia.mantle.xyz
```

```
Expected output:
0x00000000000000000000000000000000000000000000152d02c7e14af6800000
# Decodes to: 100000000000000000000000 (100,000 tokens with 18 decimals)
```

### Execute a Transfer (for Gas Comparison)

```shell
# Transfer 1000 tokens to another address
cast send 0xDeployedContractAddress \
  "transfer(address,uint256)" \
  0xRecipientAddress \
  1000000000000000000000 \
  --rpc-url https://rpc.sepolia.mantle.xyz \
  --private-key $PRIVATE_KEY
```

```
Expected output:
blockHash            0x...
blockNumber          12345678
gasUsed              52000
status               1 (success)
transactionHash      0x...
```

## Gas Comparison: Mantle vs Ethereum Mainnet

Mantle's modular DA architecture results in significantly lower fees. Since gas is paid in MNT (not ETH), we compare in USD terms for a fair comparison (prices as of January 2025, ETH ~$2,500, MNT ~$0.80, Ethereum base fee ~30 gwei, Mantle gas price ~0.05 gwei):

### Contract Deployment (ERC-20 Token)

| Chain | Gas Used | Gas Price | Token | Total Cost (Token) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~1,200,000 | 30 gwei | ETH | 0.036 ETH | ~$90.00 |
| **Mantle** | ~1,200,000 | 0.05 gwei | MNT | 0.00006 MNT | ~$0.00005 |
| **Savings** | — | — | — | — | **~99.99% cheaper** |

### ERC-20 Transfer

| Chain | Gas Used | Gas Price | Token | Total Cost (Token) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~52,000 | 30 gwei | ETH | 0.00156 ETH | ~$3.90 |
| **Mantle** | ~52,000 | 0.05 gwei | MNT | 0.0000026 MNT | ~$0.000002 |
| **Savings** | — | — | — | — | **~99.99% cheaper** |

### Why Is Mantle So Cheap?

Mantle's extreme cost savings come from two factors:
1. **No L1 data posting per-transaction** — Unlike Arbitrum/Optimism that pay Ethereum for data availability, Mantle uses its own DA layer
2. **MNT gas pricing** — The L2 gas price in MNT is extremely low because there's no L1 data fee component passed to users

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

interface CostComparison {
  operation: string;
  ethereumCostUSD: number;
  mantleCostUSD: number;
  savingsPercent: number;
}

async function compareCosts(
  l1Provider: ethers.JsonRpcProvider,
  mantleProvider: ethers.JsonRpcProvider,
  ethPriceUSD: number,
  mntPriceUSD: number
): Promise<CostComparison> {
  // Get current gas prices
  const l1FeeData = await l1Provider.getFeeData();
  const mantleFeeData = await mantleProvider.getFeeData();

  const l1GasPrice = l1FeeData.gasPrice ?? 30_000_000_000n; // ~30 gwei
  const mantleGasPrice = mantleFeeData.gasPrice ?? 50_000_000n; // ~0.05 gwei

  // ERC-20 transfer: ~52,000 gas on both chains
  const gasUsed = 52_000n;

  // Ethereum cost in USD
  const ethCostWei = gasUsed * l1GasPrice;
  const ethCostETH = Number(ethers.formatEther(ethCostWei));
  const ethCostUSD = ethCostETH * ethPriceUSD;

  // Mantle cost in USD
  const mantleCostWei = gasUsed * mantleGasPrice;
  const mantleCostMNT = Number(ethers.formatEther(mantleCostWei));
  const mantleCostUSD = mantleCostMNT * mntPriceUSD;

  const savingsPercent = ((ethCostUSD - mantleCostUSD) / ethCostUSD) * 100;

  return {
    operation: "ERC-20 Transfer",
    ethereumCostUSD: ethCostUSD,
    mantleCostUSD: mantleCostUSD,
    savingsPercent
  };
}

// Usage
const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");
const mantleProvider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");

const comparison = await compareCosts(l1Provider, mantleProvider, 2500, 0.80);
console.log(`Operation: ${comparison.operation}`);
console.log(`Ethereum cost: $${comparison.ethereumCostUSD.toFixed(4)}`);
console.log(`Mantle cost: $${comparison.mantleCostUSD.toFixed(6)}`);
console.log(`Savings: ${comparison.savingsPercent.toFixed(2)}%`);
```

### Network Configuration Reference

| Property | Mantle Mainnet | Mantle Sepolia (Testnet) |
|---|---|---|
| Chain ID | 5000 | 5003 |
| RPC URL | https://rpc.mantle.xyz | https://rpc.sepolia.mantle.xyz |
| Block Explorer | https://mantlescan.xyz | https://sepolia.mantlescan.xyz |
| Bridge | https://bridge.mantle.xyz | https://bridge.sepolia.mantle.xyz |
| Native Token | MNT | MNT (testnet) |
| Faucet | N/A | https://faucet.sepolia.mantle.xyz |

### Alternative: Deploy with Hardhat

```typescript
// scripts/deploy.ts (Hardhat)
import { ethers } from "hardhat"; // hardhat@2.19.4

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} MNT`);

  const MantleToken = await ethers.getContractFactory("MantleToken");
  const token = await MantleToken.deploy(
    "Mantle Demo Token",
    "MDT",
    ethers.parseEther("100000") // 100,000 tokens
  );

  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`MantleToken deployed to: ${address}`);

  // Log gas used for comparison
  const deployTx = token.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (receipt) {
      console.log(`Gas used: ${receipt.gasUsed}`);
      console.log(`Effective gas price: ${ethers.formatUnits(receipt.gasPrice ?? 0n, "gwei")} gwei`);
      console.log(`Total cost: ${ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? 0n))} MNT`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Deploy with Hardhat
npx hardhat run scripts/deploy.ts --network mantleSepolia
```

```
Expected output:
Deploying with account: 0xYourAddress
Account balance: 1.0 MNT
MantleToken deployed to: 0xDeployedAddress
Gas used: 1189543
Effective gas price: 0.05 gwei
Total cost: 0.0000594 MNT
```

### Verify on Mantlescan

```shell
# Verify with Hardhat
npx hardhat verify --network mantleSepolia \
  0xDeployedAddress \
  "Mantle Demo Token" "MDT" 100000000000000000000000
```

```
Expected output:
Successfully submitted source code for contract
src/MantleToken.sol:MantleToken at 0xDeployedAddress
for verification on the block explorer. Waiting for verification result...

Successfully verified contract MantleToken on the block explorer.
https://sepolia.mantlescan.xyz/address/0xDeployedAddress#code
```

## Common Pitfalls

1. **Not having MNT for gas** — Unlike other L2s where you bridge ETH for gas, Mantle requires MNT. If you only have ETH on Mantle (as WETH), you can't transact. Get MNT from the faucet or swap WETH→MNT on a Mantle DEX like Agni Finance.

2. **Using the wrong verifier URL** — For Mantle Sepolia, use `https://api-sepolia.mantlescan.xyz/api`. For mainnet, use `https://api.mantlescan.xyz/api`. Using the wrong URL causes silent verification failures.

3. **Comparing gas costs without USD conversion** — Raw gas numbers between Mantle and Ethereum are meaningless without converting to a common denomination. Mantle gas is priced in MNT (worth ~$0.80), not ETH (worth ~$2,500). Always compare in USD terms.

4. **Assuming Mantle Sepolia faucet gives ETH** — The Mantle Sepolia faucet provides testnet MNT, not ETH. If you need testnet WETH on Mantle Sepolia, bridge Sepolia ETH through the testnet bridge.

5. **Forgetting to set `evmVersion` to `shanghai`** — Mantle supports the Shanghai EVM upgrade including PUSH0. If you compile with an older EVM version, you'll miss gas optimizations. Set `evmVersion = "shanghai"` in your compiler config.

## What to Learn Next

- [Mantle Docs: Quickstart](https://docs.mantle.xyz/network/for-devs/quickstart) — Official deployment quickstart guide
- [Mantle Bridge](https://bridge.mantle.xyz) — Bridge assets between Ethereum and Mantle
- [Mantle Ecosystem](https://www.mantle.xyz/ecosystem) — Explore DeFi protocols and dApps on Mantle
- [Cross-Chain Bridges: How They Work](../track-01-l2s-rollups-crosschain/05-cross-chain-bridges.md) — Understand bridge infrastructure connecting L1 and L2
