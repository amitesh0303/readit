# Deploying to Mode: Step-by-Step Walkthrough with Gas Comparison

**Track:** Mode Network Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You've read about Mode's architecture and tooling, but you haven't deployed anything yet. You need a concrete, end-to-end walkthrough: get testnet ETH, configure your project, deploy a contract with SFS registration, verify it on Mode Explorer, and understand exactly how much you save compared to Ethereum mainnet. Without doing this hands-on, you won't internalize the deployment flow, SFS integration pattern, or the real cost savings Mode provides.

## Core Concepts

### Prerequisites and Setup

```shell
# Install Foundry (recommended for Mode development)
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
forge init mode-deploy-demo
cd mode-deploy-demo
```

### Get Testnet ETH on Mode Sepolia

You need ETH on Mode Sepolia (chainId 919) for deployment:

**Option A: Mode Faucet (direct)**
- URL: https://faucet.mode.network
- Provides: 0.05 ETH on Mode Sepolia
- Requirement: Connect wallet set to Mode Sepolia
- Last verified: 2025-01-15

**Option B: Bridge from Ethereum Sepolia**
1. Get Sepolia ETH from https://sepoliafaucet.com (requires Alchemy account)
2. Bridge to Mode Sepolia via https://bridge.mode.network
3. Wait ~5 minutes for the deposit to arrive

```shell
# Verify your balance on Mode Sepolia
cast balance $YOUR_ADDRESS --rpc-url https://sepolia.mode.network
```

```
Expected output:
50000000000000000  # 0.05 ETH in wei
```

### The Contract: ERC-20 Token with SFS Registration

We'll deploy an ERC-20 token that registers with Mode's Sequencer Fee Sharing:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/// @title IModeSFS
/// @notice Interface for Mode's Sequencer Fee Sharing contract
interface IModeSFS {
    function register(address recipient) external returns (uint256 tokenId);
    function balances(uint256 tokenId) external view returns (uint256);
    function withdraw(uint256 tokenId, address recipient, uint256 amount) external returns (uint256);
}

/// @title ModeToken
/// @notice ERC-20 token with Mode SFS integration for deployment cost comparison
/// @dev Registers with SFS in constructor to earn sequencer fee revenue
contract ModeToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;

    /// @dev SFS contract address (Mode Sepolia: 0xBBd707815a7F7eb6897C7686274AFabd7B579Ff6)
    /// @dev SFS contract address (Mode Mainnet: 0x8680CEaBcb9b56913c519c069Add6Bc3494B7020)
    address public immutable sfsContract;
    uint256 public immutable sfsTokenId;

    error MintExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address _sfsContract,
        address feeRecipient
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }

        sfsContract = _sfsContract;

        // Register this contract with Mode SFS
        // The feeRecipient receives an NFT representing accumulated fees
        sfsTokenId = IModeSFS(_sfsContract).register(feeRecipient);

        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    /// @notice Check accumulated SFS revenue
    function checkSFSBalance() external view returns (uint256) {
        return IModeSFS(sfsContract).balances(sfsTokenId);
    }

    /// @notice Withdraw accumulated SFS revenue
    function withdrawSFSFees(address recipient, uint256 amount) external onlyOwner {
        IModeSFS(sfsContract).withdraw(sfsTokenId, recipient, amount);
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

### Deploy to Mode Sepolia

```shell
# Set environment variables
export PRIVATE_KEY="your_private_key_here"

# Mode Sepolia SFS contract address
export SFS_CONTRACT="0xBBd707815a7F7eb6897C7686274AFabd7B579Ff6"

# Deploy with constructor arguments
forge create src/ModeToken.sol:ModeToken \
  --rpc-url https://sepolia.mode.network \
  --private-key $PRIVATE_KEY \
  --constructor-args "Mode Demo Token" "MDT" 100000000000000000000000 $SFS_CONTRACT $YOUR_ADDRESS
```

```
Expected output:
[⠊] Compiling...
[⠊] Compiling 8 files with 0.8.20
Compiler run successful!
Deployer: 0xYourAddress
Deployed to: 0xDeployedContractAddress
Transaction hash: 0xDeployTxHash
```

### Verify on Mode Explorer

```shell
# Verify contract on Mode Sepolia (Blockscout-based explorer)
forge verify-contract \
  0xDeployedContractAddress \
  src/ModeToken.sol:ModeToken \
  --chain 919 \
  --verifier blockscout \
  --verifier-url "https://sepolia.explorer.mode.network/api" \
  --constructor-args $(cast abi-encode "constructor(string,string,uint256,address,address)" "Mode Demo Token" "MDT" 100000000000000000000000 $SFS_CONTRACT $YOUR_ADDRESS)
```

```
Expected output:
Start verifying contract `0xDeployedContractAddress` deployed on mode-sepolia
Submitting verification for [src/ModeToken.sol:ModeToken]
Contract successfully verified
Explorer URL: https://sepolia.explorer.mode.network/address/0xDeployedContractAddress
```

### Verify Deployment and SFS Registration

```shell
# Check the deployed contract
cast call 0xDeployedContractAddress "name()" --rpc-url https://sepolia.mode.network | cast --to-ascii
```

```
Expected output:
Mode Demo Token
```

```shell
# Check SFS token ID (confirms registration succeeded)
cast call 0xDeployedContractAddress "sfsTokenId()" --rpc-url https://sepolia.mode.network
```

```
Expected output:
0x0000000000000000000000000000000000000000000000000000000000000042
# Your SFS NFT token ID (varies)
```

```shell
# Check SFS balance (will be 0 initially, grows with usage)
cast call 0xDeployedContractAddress "checkSFSBalance()" --rpc-url https://sepolia.mode.network
```

```
Expected output:
0x0000000000000000000000000000000000000000000000000000000000000000
# 0 initially — accumulates as users interact with the contract
```

### Execute a Transfer (for Gas Comparison)

```shell
# Transfer 1000 tokens to another address
cast send 0xDeployedContractAddress \
  "transfer(address,uint256)" \
  0xRecipientAddress \
  1000000000000000000000 \
  --rpc-url https://sepolia.mode.network \
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

## Gas Comparison: Mode vs Ethereum Mainnet

Here's a real cost comparison for common operations (prices as of January 2025, Ethereum base fee ~30 gwei, Mode L2 base fee ~0.001 gwei):

### Contract Deployment (ERC-20 Token with SFS)

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~1,400,000 | 30 gwei | N/A | 0.042 ETH | ~$105.00 |
| **Mode** | ~1,400,000 | 0.001 gwei | ~0.0003 ETH | 0.000301 ETH | ~$0.75 |
| **Savings** | — | — | — | — | **~99.3% cheaper** |

### ERC-20 Transfer

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~52,000 | 30 gwei | N/A | 0.00156 ETH | ~$3.90 |
| **Mode** | ~52,000 | 0.001 gwei | ~0.00004 ETH | 0.0000401 ETH | ~$0.10 |
| **Savings** | — | — | — | — | **~97% cheaper** |

### Uniswap-Style Swap

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~150,000 | 30 gwei | N/A | 0.0045 ETH | ~$11.25 |
| **Mode** | ~150,000 | 0.001 gwei | ~0.00007 ETH | 0.0000702 ETH | ~$0.18 |
| **Savings** | — | — | — | — | **~98.4% cheaper** |

### Programmatic Gas Estimation

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

interface ModeGasEstimate {
  l2ExecutionCost: bigint;
  l1DataFee: bigint;
  totalCost: bigint;
  ethereumEquivalent: bigint;
  savingsPercent: number;
}

async function estimateModeGasCost(
  to: string,
  data: string
): Promise<ModeGasEstimate> {
  const modeProvider = new ethers.JsonRpcProvider("https://mainnet.mode.network");

  // Estimate L2 execution gas
  const gasEstimate = await modeProvider.estimateGas({ to, data });
  const feeData = await modeProvider.getFeeData();
  const l2GasPrice = feeData.gasPrice ?? 1_000_000n; // ~0.001 gwei

  const l2ExecutionCost = gasEstimate * l2GasPrice;

  // Estimate L1 data fee via GasPriceOracle
  const gasPriceOracle = new ethers.Contract(
    "0x420000000000000000000000000000000000000F",
    [
      "function getL1Fee(bytes) view returns (uint256)",
      "function l1BaseFee() view returns (uint256)"
    ],
    modeProvider
  );

  const l1DataFee = await gasPriceOracle.getL1Fee(data);
  const totalCost = l2ExecutionCost + l1DataFee;

  // Compare with Ethereum mainnet (assuming 30 gwei gas price)
  const ethMainnetGasPrice = 30_000_000_000n; // 30 gwei
  const ethereumEquivalent = gasEstimate * ethMainnetGasPrice;

  const savingsPercent = Number(
    (ethereumEquivalent - totalCost) * 10000n / ethereumEquivalent
  ) / 100;

  return {
    l2ExecutionCost,
    l1DataFee,
    totalCost,
    ethereumEquivalent,
    savingsPercent
  };
}

// Usage example
const transferData = new ethers.Interface([
  "function transfer(address to, uint256 amount)"
]).encodeFunctionData("transfer", [
  "0x1234567890123456789012345678901234567890",
  ethers.parseEther("100")
]);

const estimate = await estimateModeGasCost("0xTokenAddress", transferData);
console.log(`L2 execution: ${ethers.formatEther(estimate.l2ExecutionCost)} ETH`);
console.log(`L1 data fee: ${ethers.formatEther(estimate.l1DataFee)} ETH`);
console.log(`Total Mode cost: ${ethers.formatEther(estimate.totalCost)} ETH`);
console.log(`Ethereum equivalent: ${ethers.formatEther(estimate.ethereumEquivalent)} ETH`);
console.log(`Savings: ${estimate.savingsPercent}%`);
```

```
Expected output:
L2 execution: 0.000000000052 ETH
L1 data fee: 0.00004 ETH
Total Mode cost: 0.0000400052 ETH
Ethereum equivalent: 0.00156 ETH
Savings: 97.44%
```

### Network Configuration Reference

| Property | Mode Mainnet | Mode Sepolia (Testnet) |
|---|---|---|
| Chain ID | 34443 | 919 |
| RPC URL | https://mainnet.mode.network | https://sepolia.mode.network |
| Block Explorer | https://explorer.mode.network | https://sepolia.explorer.mode.network |
| Bridge | https://bridge.mode.network | https://bridge.mode.network |
| Native Token | ETH | ETH (Sepolia) |
| Faucet | N/A | https://faucet.mode.network |
| SFS Contract | 0x8680CEaBcb9b56913c519c069Add6Bc3494B7020 | 0xBBd707815a7F7eb6897C7686274AFabd7B579Ff6 |

### Alternative: Deploy with Hardhat

```typescript
// scripts/deploy.ts (Hardhat@2.19.4)
import { ethers } from "hardhat"; // hardhat@2.19.4

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  // Mode Sepolia SFS contract
  const SFS_CONTRACT = "0xBBd707815a7F7eb6897C7686274AFabd7B579Ff6";

  const ModeToken = await ethers.getContractFactory("ModeToken");
  const token = await ModeToken.deploy(
    "Mode Demo Token",
    "MDT",
    ethers.parseEther("100000"), // 100,000 tokens
    SFS_CONTRACT,
    deployer.address // fee recipient
  );

  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`ModeToken deployed to: ${address}`);

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

  // Verify SFS registration
  const sfsTokenId = await token.sfsTokenId();
  console.log(`SFS Token ID: ${sfsTokenId}`);
  console.log("✅ Contract registered for Mode Sequencer Fee Sharing");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Deploy with Hardhat to Mode Sepolia
npx hardhat run scripts/deploy.ts --network modeSepolia
```

```
Expected output:
Deploying with account: 0xYourAddress
Account balance: 0.05 ETH
ModeToken deployed to: 0xDeployedAddress
Gas used: 1389543
Effective gas price: 0.001 gwei
Total cost: 0.000001389 ETH
SFS Token ID: 66
✅ Contract registered for Mode Sequencer Fee Sharing
```

## Common Pitfalls

1. **Not registering with SFS during deployment** — If you deploy without SFS registration and later want to register, you'll need to deploy a new contract or use a proxy pattern. The `register()` call must come from the contract being registered. Always include SFS registration in your constructor.

2. **Using `--verifier etherscan` instead of `--verifier blockscout`** — Mode Explorer is Blockscout-based. Using the Etherscan verifier flag will fail. Always use `--verifier blockscout` with the correct `--verifier-url`.

3. **Comparing only L2 gas costs** — If you only look at `gasUsed × L2_gasPrice`, Mode appears 30,000x cheaper than Ethereum. The real comparison must include the L1 data fee. Actual savings are ~95-99% (still excellent, but the L1 data fee is the dominant cost on Mode).

4. **Deploying to mainnet without testnet validation** — Mode Sepolia (chainId 919) mirrors mainnet behavior including SFS. Always validate your full deployment flow on testnet first, especially SFS registration and fee withdrawal.

5. **Forgetting constructor args in verification** — When verifying contracts with constructor arguments on Mode Explorer, you must provide the ABI-encoded constructor args. Use `cast abi-encode` to generate the correct encoding, or verification will fail silently.

## What to Learn Next

- [Mode Docs: SFS Revenue Dashboard](https://docs.mode.network/build-on-mode/sfs-sequencer-fee-sharing/sfs-faq) — Track your SFS earnings
- [Mode Architecture](./01-mode-architecture.md) — Review the OP Stack foundation and SFS mechanics
- [OP Stack Deployment Guide](https://docs.optimism.io/builders/chain-operators/tutorials/create-l2-rollup) — Deploy your own OP Stack chain
- [Mode DeFi Ecosystem](https://www.mode.network/ecosystem) — Explore protocols building on Mode
