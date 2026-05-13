# Deploying to Arbitrum: Step-by-Step Walkthrough with Gas Comparison

**Track:** Arbitrum Development
**Lesson:** 5 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You've read about Arbitrum's architecture and tooling, but you haven't actually deployed anything yet. You need a concrete, end-to-end walkthrough: get testnet ETH, configure your project, deploy a contract, verify it on Arbiscan, and understand exactly how much you saved compared to Ethereum mainnet. Without doing this hands-on, you won't internalize the differences in gas costs, deployment flow, and verification process.

## Core Concepts

### Prerequisites and Setup

Install the required tools and configure your environment:

```shell
# Install Foundry (recommended for Arbitrum development)
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
forge init arbitrum-deploy-demo
cd arbitrum-deploy-demo
```

### Get Testnet ETH on Arbitrum Sepolia

You need Sepolia ETH bridged to Arbitrum Sepolia. Two options:

**Option A: Arbitrum Sepolia Faucet (direct)**
- URL: https://faucet.quicknode.com/arbitrum/sepolia
- Provides: 0.001 ETH on Arbitrum Sepolia
- Requirement: QuickNode account (free)
- Last verified: 2025-01-15

**Option B: Bridge from Ethereum Sepolia**
1. Get Sepolia ETH from https://sepoliafaucet.com (requires Alchemy account)
2. Bridge to Arbitrum Sepolia via https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia
3. Wait ~10 minutes for the deposit to arrive

```shell
# Verify your balance on Arbitrum Sepolia
cast balance $YOUR_ADDRESS --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

```
Expected output:
1000000000000000  # 0.001 ETH in wei
```

### The Contract: ERC-20 Token

We'll deploy a simple ERC-20 token to compare costs between Ethereum and Arbitrum:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/// @title ArbitrumToken
/// @notice Simple ERC-20 for deployment cost comparison
/// @dev Deploys identically on Ethereum and Arbitrum — same bytecode, different cost
contract ArbitrumToken is ERC20, Ownable {
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

### Deploy to Arbitrum Sepolia

```shell
# Set environment variables
export PRIVATE_KEY="your_private_key_here"
export ARBISCAN_API_KEY="your_arbiscan_api_key_here"

# Deploy with constructor arguments
forge create src/ArbitrumToken.sol:ArbitrumToken \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $PRIVATE_KEY \
  --constructor-args "Arbitrum Demo Token" "ADT" 100000000000000000000000 \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  --verifier-url https://api-sepolia.arbiscan.io/api
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
  URL: https://sepolia.arbiscan.io/address/0xDeployedContractAddress
Contract successfully verified!
```

### Verify Deployment

```shell
# Check the deployed contract
cast call 0xDeployedContractAddress "name()" --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

```
Expected output:
0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000124172626974...
# Decodes to: "Arbitrum Demo Token"
```

```shell
# Check total supply
cast call 0xDeployedContractAddress "totalSupply()" --rpc-url https://sepolia-rollup.arbitrum.io/rpc
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
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
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

## Gas Comparison: Arbitrum vs Ethereum Mainnet

This is the key value proposition. Here's a real cost comparison for common operations (prices as of January 2025, Ethereum base fee ~30 gwei, Arbitrum L2 base fee ~0.01 gwei):

### Contract Deployment (ERC-20 Token)

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~1,200,000 | 30 gwei | N/A | 0.036 ETH | ~$90.00 |
| **Arbitrum One** | ~1,200,000 | 0.01 gwei | ~0.0003 ETH | 0.000312 ETH | ~$0.78 |
| **Savings** | — | — | — | — | **~99% cheaper** |

### ERC-20 Transfer

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~52,000 | 30 gwei | N/A | 0.00156 ETH | ~$3.90 |
| **Arbitrum One** | ~52,000 | 0.01 gwei | ~0.00005 ETH | 0.0000505 ETH | ~$0.13 |
| **Savings** | — | — | — | — | **~97% cheaper** |

### Uniswap-Style Swap

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~150,000 | 30 gwei | N/A | 0.0045 ETH | ~$11.25 |
| **Arbitrum One** | ~150,000 | 0.01 gwei | ~0.00008 ETH | 0.0000815 ETH | ~$0.20 |
| **Savings** | — | — | — | — | **~98% cheaper** |

### Programmatic Gas Comparison

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

interface GasComparison {
  operation: string;
  ethereumCostWei: bigint;
  arbitrumCostWei: bigint;
  savingsPercent: number;
}

async function compareGasCosts(
  l1Provider: ethers.JsonRpcProvider,
  l2Provider: ethers.JsonRpcProvider,
  contractAddress: string
): Promise<GasComparison> {
  // ERC-20 transfer calldata
  const transferData = new ethers.Interface([
    "function transfer(address to, uint256 amount)"
  ]).encodeFunctionData("transfer", [
    "0x1234567890123456789012345678901234567890",
    ethers.parseEther("100")
  ]);

  // Ethereum mainnet cost
  const l1FeeData = await l1Provider.getFeeData();
  const l1GasEstimate = await l1Provider.estimateGas({
    to: contractAddress,
    data: transferData
  });
  const l1Cost = l1GasEstimate * (l1FeeData.gasPrice ?? 30_000_000_000n);

  // Arbitrum cost (L2 execution + L1 data fee)
  const l2FeeData = await l2Provider.getFeeData();
  const l2GasEstimate = await l2Provider.estimateGas({
    to: contractAddress,
    data: transferData
  });
  const l2ExecutionCost = l2GasEstimate * (l2FeeData.gasPrice ?? 100_000_000n);

  // L1 data fee via NodeInterface
  const nodeInterface = new ethers.Contract(
    "0x00000000000000000000000000000000000000C8",
    ["function gasEstimateL1Component(address,bool,bytes) view returns (uint64,uint256,uint256)"],
    l2Provider
  );
  const [l1GasComponent, , l1BaseFee] = await nodeInterface.gasEstimateL1Component(
    contractAddress,
    false,
    transferData
  );
  const l1DataCost = BigInt(l1GasComponent) * l1BaseFee;

  const arbitrumTotal = l2ExecutionCost + l1DataCost;
  const savingsPercent = Number((l1Cost - arbitrumTotal) * 10000n / l1Cost) / 100;

  return {
    operation: "ERC-20 Transfer",
    ethereumCostWei: l1Cost,
    arbitrumCostWei: arbitrumTotal,
    savingsPercent
  };
}

// Usage
const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");
const l2Provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");

const comparison = await compareGasCosts(l1Provider, l2Provider, "0xTokenAddress");
console.log(`Operation: ${comparison.operation}`);
console.log(`Ethereum cost: ${ethers.formatEther(comparison.ethereumCostWei)} ETH`);
console.log(`Arbitrum cost: ${ethers.formatEther(comparison.arbitrumCostWei)} ETH`);
console.log(`Savings: ${comparison.savingsPercent}%`);
```

### Network Configuration Reference

| Property | Arbitrum One (Mainnet) | Arbitrum Sepolia (Testnet) |
|---|---|---|
| Chain ID | 42161 | 421614 |
| RPC URL | https://arb1.arbitrum.io/rpc | https://sepolia-rollup.arbitrum.io/rpc |
| Block Explorer | https://arbiscan.io | https://sepolia.arbiscan.io |
| Bridge | https://bridge.arbitrum.io | https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia |
| Native Token | ETH | ETH (Sepolia) |
| Faucet | N/A | https://faucet.quicknode.com/arbitrum/sepolia |

### Alternative: Deploy with Hardhat

```typescript
// scripts/deploy.ts (Hardhat)
import { ethers } from "hardhat"; // hardhat@2.19.4

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  const ArbitrumToken = await ethers.getContractFactory("ArbitrumToken");
  const token = await ArbitrumToken.deploy(
    "Arbitrum Demo Token",
    "ADT",
    ethers.parseEther("100000") // 100,000 tokens
  );

  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`ArbitrumToken deployed to: ${address}`);

  // Log gas used for comparison
  const deployTx = token.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (receipt) {
      console.log(`Gas used: ${receipt.gasUsed}`);
      console.log(`Effective gas price: ${ethers.formatUnits(receipt.gasPrice ?? 0n, "gwei")} gwei`);
      console.log(`Total cost: ${ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? 0n))} ETH`);
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
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

```
Expected output:
Deploying with account: 0xYourAddress
Account balance: 0.001 ETH
ArbitrumToken deployed to: 0xDeployedAddress
Gas used: 1189543
Effective gas price: 0.01 gwei
Total cost: 0.000011895 ETH
```

## Common Pitfalls

1. **Not having enough ETH for L1 data fees** — Even though L2 gas is cheap, the L1 data fee can spike during Ethereum congestion. Always keep a buffer. A deployment that costs $0.50 normally might cost $2-3 during L1 fee spikes.

2. **Using the wrong Arbiscan verifier URL** — For Arbitrum Sepolia, the verifier URL is `https://api-sepolia.arbiscan.io/api`, not `https://api.arbiscan.io/api`. Using the mainnet URL for testnet verification silently fails.

3. **Forgetting `--verifier-url` in Foundry** — Foundry doesn't auto-detect Arbitrum Sepolia's verification endpoint. You must explicitly pass `--verifier-url https://api-sepolia.arbiscan.io/api` or verification will fail with a misleading error.

4. **Comparing gas costs without accounting for L1 data fees** — If you only compare `gasUsed × gasPrice`, Arbitrum looks 1000x cheaper. The real comparison must include the L1 data fee component. The actual savings are ~95-99% (still excellent, but not 1000x).

5. **Deploying to Arbitrum Nova instead of Arbitrum One** — Nova (chain ID 42170) uses a Data Availability Committee instead of posting to Ethereum. It's cheaper but has weaker security guarantees. For DeFi and high-value contracts, always deploy to Arbitrum One (chain ID 42161).

## What to Learn Next

- [Arbitrum Docs: Quickstart](https://docs.arbitrum.io/build-decentralized-apps/quickstart-solidity-hardhat) — Official deployment quickstart
- [Arbitrum Bridge](https://bridge.arbitrum.io) — Bridge assets between Ethereum and Arbitrum
- [Arbitrum Orbit](https://docs.arbitrum.io/launch-orbit-chain/orbit-gentle-introduction) — Launch your own L3 chain on top of Arbitrum
- [Cross-Chain Bridges: How They Work](../track-01-l2s-rollups-crosschain/05-cross-chain-bridges.md) — Understand bridge infrastructure connecting L1 and L2
