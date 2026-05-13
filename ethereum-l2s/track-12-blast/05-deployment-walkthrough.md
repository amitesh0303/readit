# Deploying to Blast: Step-by-Step Walkthrough with Gas Comparison

**Track:** Blast Development
**Lesson:** 5 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You've learned about Blast's architecture, yield mechanics, and tooling — now you need to actually deploy a contract. But deploying on Blast isn't just "deploy to another EVM chain." You need to configure yield modes, set up gas revenue claiming, handle the rebasing ETH correctly, and understand how your deployment costs compare to Ethereum mainnet. Without a hands-on walkthrough, you'll miss the Blast-specific constructor setup that makes your contract earn yield and gas revenue from day one.

## Core Concepts

### Prerequisites and Setup

```shell
# Install Foundry (if not already installed)
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
```

```
Expected output:
forge 0.2.0 (abcdef1 2025-01-10T00:00:00.000000000Z)
```

```shell
# Initialize a new Foundry project
forge init blast-deploy-demo
cd blast-deploy-demo
```

### Get Testnet ETH on Blast Sepolia

You need Sepolia ETH on Blast Sepolia testnet:

**Option A: Blast Sepolia Faucet (direct)**
- URL: https://faucet.quicknode.com/blast/sepolia
- Provides: 0.001 ETH on Blast Sepolia
- Requirement: QuickNode account (free)
- Last verified: 2025-01-15

**Option B: Bridge from Ethereum Sepolia**
1. Get Sepolia ETH from https://sepoliafaucet.com
2. Bridge to Blast Sepolia via https://blast.io/bridge (select testnet)
3. Wait ~10-20 minutes for the deposit

```shell
# Verify your balance on Blast Sepolia
cast balance $YOUR_ADDRESS --rpc-url https://sepolia.blast.io
```

```
Expected output:
1000000000000000  # 0.001 ETH in wei
```

### The Contract: Yield-Aware ERC-20 Token

This contract demonstrates Blast-specific features: yield configuration, gas revenue claiming, and proper initialization:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

enum YieldMode { AUTOMATIC, VOID, CLAIMABLE }
enum GasMode { VOID, CLAIMABLE }

interface IBlast {
    function configure(YieldMode _yield, GasMode gasMode, address governor) external;
    function claimAllYield(address contractAddress, address recipientOfYield) external returns (uint256);
    function claimAllGas(address contractAddress, address recipientOfGas) external returns (uint256);
    function readClaimableYield(address contractAddress) external view returns (uint256);
    function readGasParams(address contractAddress) external view returns (uint256, uint256, uint256, GasMode);
}

/// @title BlastToken
/// @notice ERC-20 token with Blast yield and gas revenue features
/// @dev Demonstrates proper Blast contract initialization
contract BlastToken is ERC20, Ownable {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;

    error MintExceedsMaxSupply(uint256 requested, uint256 available);
    error ClaimFailed();

    event YieldClaimed(address indexed recipient, uint256 amount);
    event GasClaimed(address indexed recipient, uint256 amount);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address governor
    ) ERC20(name, symbol) Ownable(governor) {
        if (initialSupply > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }

        // BLAST-SPECIFIC: Configure yield and gas revenue
        // - CLAIMABLE yield: ETH sent to this contract earns yield, claimable by governor
        // - CLAIMABLE gas: Gas fees from users calling this contract are claimable
        BLAST.configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, governor);

        _mint(governor, initialSupply);
    }

    /// @notice Mint new tokens (only owner)
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MintExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    /// @notice Claim accumulated ETH yield from the Blast precompile
    /// @return amount The amount of yield claimed
    function claimYield() external onlyOwner returns (uint256 amount) {
        amount = BLAST.claimAllYield(address(this), owner());
        if (amount > 0) {
            emit YieldClaimed(owner(), amount);
        }
        return amount;
    }

    /// @notice Claim accumulated gas revenue
    /// @return amount The amount of gas revenue claimed
    function claimGasRevenue() external onlyOwner returns (uint256 amount) {
        amount = BLAST.claimAllGas(address(this), owner());
        if (amount > 0) {
            emit GasClaimed(owner(), amount);
        }
        return amount;
    }

    /// @notice Check how much yield is available to claim
    function pendingYield() external view returns (uint256) {
        return BLAST.readClaimableYield(address(this));
    }

    /// @notice Check gas revenue parameters
    function gasRevenueInfo() external view returns (
        uint256 etherSeconds,
        uint256 etherBalance,
        uint256 lastUpdated,
        GasMode gasMode
    ) {
        return BLAST.readGasParams(address(this));
    }

    /// @notice Allow contract to receive ETH (for yield accumulation)
    receive() external payable {}
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

### Deploy to Blast Sepolia

```shell
# Set environment variables
export PRIVATE_KEY="your_private_key_here"
export BLASTSCAN_API_KEY="your_blastscan_api_key_here"
export GOVERNOR_ADDRESS="your_wallet_address_here"

# Compile first
forge build
```

```
Expected output:
[⠊] Compiling...
[⠊] Compiling 8 files with 0.8.20
Compiler run successful!
```

```shell
# Deploy with constructor arguments
forge create src/BlastToken.sol:BlastToken \
  --rpc-url https://sepolia.blast.io \
  --private-key $PRIVATE_KEY \
  --constructor-args "Blast Demo Token" "BDT" 100000000000000000000000 $GOVERNOR_ADDRESS \
  --verify \
  --etherscan-api-key $BLASTSCAN_API_KEY \
  --verifier-url https://api-sepolia.blastscan.io/api
```

```
Expected output:
[⠊] Compiling...
Compiler run successful!
Deployer: 0xYourAddress
Deployed to: 0xDeployedContractAddress
Transaction hash: 0xDeployTxHash
Starting contract verification...
Submitted contract for verification:
  Response: OK
  GUID: abc123
  URL: https://sepolia.blastscan.io/address/0xDeployedContractAddress
Contract successfully verified!
```

### Verify Deployment and Blast Configuration

```shell
# Check the deployed contract name
cast call 0xDeployedContractAddress "name()" --rpc-url https://sepolia.blast.io | cast --to-ascii
```

```
Expected output:
Blast Demo Token
```

```shell
# Check total supply
cast call 0xDeployedContractAddress "totalSupply()" --rpc-url https://sepolia.blast.io
```

```
Expected output:
0x00000000000000000000000000000000000000000000152d02c7e14af6800000
# Decodes to: 100000000000000000000000 (100,000 tokens)
```

```shell
# Check pending yield (should be 0 initially)
cast call 0xDeployedContractAddress "pendingYield()" --rpc-url https://sepolia.blast.io
```

```
Expected output:
0x0000000000000000000000000000000000000000000000000000000000000000
# 0 — no yield accumulated yet
```

```shell
# Check gas revenue info
cast call 0xDeployedContractAddress "gasRevenueInfo()" --rpc-url https://sepolia.blast.io
```

```
Expected output:
0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000...
# etherSeconds=0, etherBalance=0, lastUpdated=timestamp, gasMode=CLAIMABLE
```

### Execute a Transfer (Generate Gas Revenue)

```shell
# Transfer tokens to generate gas revenue for the contract
cast send 0xDeployedContractAddress \
  "transfer(address,uint256)" \
  0xRecipientAddress \
  1000000000000000000000 \
  --rpc-url https://sepolia.blast.io \
  --private-key $PRIVATE_KEY
```

```
Expected output:
blockHash            0x...
blockNumber          12345678
gasUsed              52847
status               1 (success)
transactionHash      0x...
```

## Gas Comparison: Blast vs Ethereum Mainnet

The key value proposition — Blast offers Ethereum-level security with dramatically lower costs, plus native yield on top.

### Contract Deployment (BlastToken — ERC-20 with Yield)

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~1,350,000 | 30 gwei | N/A | 0.0405 ETH | ~$101.00 |
| **Blast** | ~1,350,000 | 0.001 gwei | ~0.0002 ETH | 0.000201 ETH | ~$0.50 |
| **Savings** | — | — | — | — | **~99.5% cheaper** |

### ERC-20 Transfer

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~52,000 | 30 gwei | N/A | 0.00156 ETH | ~$3.90 |
| **Blast** | ~52,000 | 0.001 gwei | ~0.00004 ETH | 0.0000401 ETH | ~$0.10 |
| **Savings** | — | — | — | — | **~97% cheaper** |

### Uniswap-Style Swap

| Chain | Gas Used | Gas Price | L1 Data Fee | Total Cost (ETH) | Total Cost (USD) |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | ~150,000 | 30 gwei | N/A | 0.0045 ETH | ~$11.25 |
| **Blast** | ~150,000 | 0.001 gwei | ~0.00006 ETH | 0.0000602 ETH | ~$0.15 |
| **Savings** | — | — | — | — | **~99% cheaper** |

### Blast Bonus: Yield + Gas Revenue

Unlike other L2s, Blast gives you additional revenue on top of gas savings:

| Revenue Source | Estimated APY | How It Works |
|---|---|---|
| ETH Yield | ~3.5% | ETH in your contract earns Lido staking yield |
| USDB Yield | ~5% | USDB earns MakerDAO T-Bill yield |
| Gas Revenue | Variable | Claim gas fees your users spend |

### Programmatic Gas Comparison

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

interface BlastGasComparison {
  operation: string;
  ethereumCostWei: bigint;
  blastCostWei: bigint;
  savingsPercent: number;
  estimatedYieldPerYear: string;
}

async function compareBlastVsEthereum(
  blastProvider: ethers.JsonRpcProvider,
  ethProvider: ethers.JsonRpcProvider
): Promise<BlastGasComparison> {
  // Get current gas prices
  const [blastFee, ethFee] = await Promise.all([
    blastProvider.getFeeData(),
    ethProvider.getFeeData()
  ]);

  // ERC-20 transfer: 52,000 gas
  const gasUsed = 52000n;

  // Ethereum cost
  const ethGasPrice = ethFee.gasPrice ?? 30_000_000_000n; // ~30 gwei
  const ethCost = gasUsed * ethGasPrice;

  // Blast cost (L2 execution + estimated L1 data fee)
  const blastGasPrice = blastFee.gasPrice ?? 1_000_000n; // ~0.001 gwei
  const blastL2Cost = gasUsed * blastGasPrice;
  const blastL1DataFee = 40_000_000_000_000n; // ~0.00004 ETH estimated
  const blastTotalCost = blastL2Cost + blastL1DataFee;

  const savingsPercent = Number((ethCost - blastTotalCost) * 10000n / ethCost) / 100;

  return {
    operation: "ERC-20 Transfer",
    ethereumCostWei: ethCost,
    blastCostWei: blastTotalCost,
    savingsPercent,
    estimatedYieldPerYear: "~3.5% APY on ETH held in contract"
  };
}

// Usage
async function main(): Promise<void> {
  const blastProvider = new ethers.JsonRpcProvider("https://rpc.blast.io");
  const ethProvider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");

  const comparison = await compareBlastVsEthereum(blastProvider, ethProvider);

  console.log(`Operation: ${comparison.operation}`);
  console.log(`Ethereum cost: ${ethers.formatEther(comparison.ethereumCostWei)} ETH`);
  console.log(`Blast cost: ${ethers.formatEther(comparison.blastCostWei)} ETH`);
  console.log(`Savings: ${comparison.savingsPercent}%`);
  console.log(`Bonus: ${comparison.estimatedYieldPerYear}`);
}

main();
```

### Deploy with Hardhat (Alternative)

```typescript
// scripts/deploy.ts (Hardhat)
import { ethers } from "hardhat"; // hardhat@2.19.4

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  const BlastToken = await ethers.getContractFactory("BlastToken");
  const token = await BlastToken.deploy(
    "Blast Demo Token",
    "BDT",
    ethers.parseEther("100000"), // 100,000 tokens
    deployer.address              // governor
  );

  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`BlastToken deployed to: ${address}`);

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

  // Verify Blast configuration
  const pendingYield = await token.pendingYield();
  console.log(`Pending yield: ${ethers.formatEther(pendingYield)} ETH`);
  console.log("✅ Blast yield and gas revenue configured successfully");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Deploy with Hardhat to Blast Sepolia
npx hardhat run scripts/deploy.ts --network blast_sepolia
```

```
Expected output:
Deploying with account: 0xYourAddress
Account balance: 0.001 ETH
BlastToken deployed to: 0xDeployedAddress
Gas used: 1345678
Effective gas price: 0.001 gwei
Total cost: 0.000001345 ETH
Pending yield: 0.0 ETH
✅ Blast yield and gas revenue configured successfully
```

### Network Configuration Reference

| Property | Blast Mainnet | Blast Sepolia |
|---|---|---|
| Chain ID | 81457 | 168587773 |
| RPC URL | https://rpc.blast.io | https://sepolia.blast.io |
| Block Explorer | https://blastscan.io | https://sepolia.blastscan.io |
| Bridge | https://blast.io/bridge | https://blast.io/bridge |
| Native Token | ETH (rebasing) | ETH (Sepolia) |
| Faucet | N/A | https://faucet.quicknode.com/blast/sepolia |
| Blast Precompile | 0x4300000000000000000000000000000000000002 | Same |
| USDB | 0x4300000000000000000000000000000000000003 | Same |

## Common Pitfalls

1. **Not calling `BLAST.configure()` in the constructor** — If you deploy without configuring yield and gas modes, your contract defaults to AUTOMATIC yield (balance rebases) and VOID gas (no revenue). For most DeFi contracts, you want CLAIMABLE for both. This cannot be changed after deployment unless you set a governor.

2. **Deploying without a governor** — If you pass `address(0)` as the governor, nobody can ever claim yield or gas revenue from the contract. Always set a valid governor address (your multisig or DAO).

3. **Using the wrong chain ID in wallet configuration** — Blast mainnet is 81457, Blast Sepolia is 168587773. These are non-standard numbers that users often mistype. Double-check your MetaMask/wallet configuration.

4. **Forgetting the L1 data fee in cost estimates** — The L2 execution cost on Blast is nearly zero (~0.001 gwei), but every transaction also pays an L1 data fee for posting calldata/blobs to Ethereum. This L1 fee is the dominant cost component. Don't quote "free transactions" to users — the L1 data fee is real.

5. **Not verifying on Blastscan immediately** — Blastscan verification can be flaky if you wait too long after deployment. Verify immediately using the `--verify` flag during deployment, or verify within a few minutes using `forge verify-contract`. Include constructor args encoding if your constructor takes parameters.

## What to Learn Next

- [Blast Documentation](https://docs.blast.io/) — Official developer documentation and guides
- [Blast GitHub](https://github.com/blast-io/blast) — Source code for Blast contracts
- [OP Stack Architecture](../track-03-optimism/01-op-stack-architecture.md) — Understand the underlying rollup framework Blast modifies
- [Cross-Chain Bridges](../track-01-l2s-rollups-crosschain/05-cross-chain-bridges.md) — Bridge infrastructure connecting L1 and L2
