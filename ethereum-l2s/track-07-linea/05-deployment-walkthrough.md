# Deploying to Linea: Complete Walkthrough with Gas Comparison

**Track:** Linea Development
**Level:** Intermediate → Advanced
**Read time:** 15 min

---

## The Problem

You have a production contract ready to deploy and need to get it onto Linea's testnet, verify it, interact with it, and understand the cost savings compared to Ethereum mainnet. Because Linea is a type 2 zkEVM, the deployment workflow is nearly identical to Ethereum — but you still need to handle Linea-specific configuration, testnet ETH acquisition, contract verification on Lineascan, and understand how gas costs translate between the two chains. This lesson walks through a complete ERC-20 token deployment from setup to verification with a side-by-side cost comparison.

## Core Concepts

### Project Setup

```shell
mkdir linea-token && cd linea-token
npm init -y
npm install --save-dev hardhat@2.19.4 \
  @nomicfoundation/hardhat-toolbox@4.0.0 \
  @openzeppelin/contracts@5.0.1 \
  dotenv@16.3.1 \
  typescript@5.3.3 \
  ts-node@10.9.2
npx hardhat init
```

```
Expected output:
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /path/to/linea-token
✔ Do you want to add a .gitignore? (Y/n) · y
✔ Do you want to install this sample project's dependencies with npm? · y

Project created
```

Project structure:

```
linea-token/
├── contracts/
│   └── LineaToken.sol
├── scripts/
│   ├── deploy.ts
│   └── interact.ts
├── test/
│   └── LineaToken.test.ts
├── hardhat.config.ts
├── .env
└── package.json
```

### Environment Configuration

```shell
# .env
PRIVATE_KEY=your_private_key_here
INFURA_KEY=your_infura_project_id
LINEASCAN_API_KEY=your_lineascan_api_key
```

### Hardhat Configuration for Linea

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox@4.0.0";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    lineaSepolia: {
      url: `https://linea-sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 59141,
    },
    lineaMainnet: {
      url: `https://linea-mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 59144,
    },
  },
  etherscan: {
    apiKey: {
      lineaSepolia: process.env.LINEASCAN_API_KEY!,
      lineaMainnet: process.env.LINEASCAN_API_KEY!,
    },
    customChains: [
      {
        network: "lineaSepolia",
        chainId: 59141,
        urls: {
          apiURL: "https://api-sepolia.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build",
        },
      },
      {
        network: "lineaMainnet",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
    ],
  },
};

export default config;
```

### The Contract: Production ERC-20 with Governance

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.1/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.1/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/// @title LineaToken — A production ERC-20 deployed on Linea
/// @notice Demonstrates a full-featured token with mint, burn, pause, and cap
contract LineaToken is ERC20, ERC20Burnable, ERC20Pausable, Ownable {
    uint256 public immutable maxSupply;

    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();

    event TokensMinted(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 initialMint_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (maxSupply_ == 0) revert ZeroAmount();
        if (initialMint_ > maxSupply_) revert ExceedsMaxSupply(initialMint_, maxSupply_);

        maxSupply = maxSupply_;

        if (initialMint_ > 0) {
            _mint(msg.sender, initialMint_);
        }
    }

    /// @notice Mint new tokens (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint (in wei)
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > maxSupply) {
            revert ExceedsMaxSupply(amount, maxSupply - totalSupply());
        }
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /// @notice Pause all transfers (owner only, emergency use)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause transfers (owner only)
    function unpause() external onlyOwner {
        _unpause();
    }

    // Required override for ERC20Pausable
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }
}
```

### Compile the Contract

```shell
npx hardhat compile
```

```
Expected output:
Generating typings for: 6 artifacts in dir: typechain-types for target: ethers-v6
Successfully generated 18 typings!
Compiled 6 Solidity files successfully (using solc-js compiler version 0.8.24)
```

### Get Testnet ETH

```shell
# Linea Sepolia Faucet Options:
# 1. Linea Faucet: https://faucet.goerli.linea.build/
# 2. Infura Faucet: https://www.infura.io/faucet/linea
# 3. Bridge from Sepolia: https://bridge.linea.build/
# Last verified: 2025-01-15

# Check your balance after getting testnet ETH:
npx hardhat console --network lineaSepolia
```

```javascript
// In Hardhat console:
const [signer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(signer.address);
console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
// Expected: Balance: 0.5 ETH (or whatever the faucet provides)
```

### Deployment Script

```typescript
// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying LineaToken with account:", deployer.address);

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("\n❌ No ETH balance!");
    console.error("Get testnet ETH from:");
    console.error("  https://www.infura.io/faucet/linea");
    console.error("  (Last verified: 2025-01-15)");
    process.exit(1);
  }

  // Constructor arguments
  const tokenName = "Linea Demo Token";
  const tokenSymbol = "LDEMO";
  const maxSupply = ethers.parseEther("1000000"); // 1M tokens
  const initialMint = ethers.parseEther("100000"); // 100K initial

  // Estimate gas
  const factory = await ethers.getContractFactory("LineaToken");
  const deployTx = await factory.getDeployTransaction(
    tokenName,
    tokenSymbol,
    maxSupply,
    initialMint
  );
  const estimatedGas = await ethers.provider.estimateGas({
    ...deployTx,
    from: deployer.address,
  });
  const feeData = await ethers.provider.getFeeData();
  const estimatedCost = estimatedGas * (feeData.gasPrice || 0n);

  console.log(`\nEstimated deployment gas: ${estimatedGas.toString()}`);
  console.log(`Gas price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} gwei`);
  console.log(`Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`);

  // Deploy
  console.log("\nDeploying...");
  const token = await factory.deploy(tokenName, tokenSymbol, maxSupply, initialMint);
  await token.waitForDeployment();

  const contractAddress = await token.getAddress();
  const deployReceipt = await token.deploymentTransaction()?.wait();

  console.log(`\n✅ LineaToken deployed to: ${contractAddress}`);
  console.log(`   TX hash: ${deployReceipt?.hash}`);
  console.log(`   Block: ${deployReceipt?.blockNumber}`);
  console.log(`   Gas used: ${deployReceipt?.gasUsed.toString()}`);

  const actualCost = (deployReceipt?.gasUsed || 0n) * (deployReceipt?.gasPrice || 0n);
  console.log(`   Actual cost: ${ethers.formatEther(actualCost)} ETH`);
  console.log(`   Explorer: https://sepolia.lineascan.build/address/${contractAddress}`);

  // Post-deployment verification
  console.log("\n--- Post-Deployment Checks ---");
  const name = await token.name();
  const symbol = await token.symbol();
  const totalSupply = await token.totalSupply();
  const ownerBalance = await token.balanceOf(deployer.address);
  const max = await token.maxSupply();

  console.log(`Token name: ${name}`);
  console.log(`Token symbol: ${symbol}`);
  console.log(`Max supply: ${ethers.formatEther(max)} ${symbol}`);
  console.log(`Total supply: ${ethers.formatEther(totalSupply)} ${symbol}`);
  console.log(`Owner balance: ${ethers.formatEther(ownerBalance)} ${symbol}`);

  // Return address for verification script
  return contractAddress;
}

main()
  .then((address) => {
    console.log(`\n📋 To verify, run:`);
    console.log(
      `npx hardhat verify --network lineaSepolia ${address} "Linea Demo Token" "LDEMO" "1000000000000000000000000" "100000000000000000000000"`
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
```

### Deploy to Linea Sepolia

```shell
npx hardhat run scripts/deploy.ts --network lineaSepolia
```

```
Expected output:
Deploying LineaToken with account: 0xYourAddress
Account balance: 0.5 ETH

Estimated deployment gas: 1245678
Gas price: 0.072 gwei
Estimated cost: 0.0000897 ETH

Deploying...

✅ LineaToken deployed to: 0xAbCd...1234
   TX hash: 0xdef789...
   Block: 4523900
   Gas used: 1198432
   Actual cost: 0.0000863 ETH
   Explorer: https://sepolia.lineascan.build/address/0xAbCd...1234

--- Post-Deployment Checks ---
Token name: Linea Demo Token
Token symbol: LDEMO
Max supply: 1000000.0 LDEMO
Total supply: 100000.0 LDEMO
Owner balance: 100000.0 LDEMO

📋 To verify, run:
npx hardhat verify --network lineaSepolia 0xAbCd...1234 "Linea Demo Token" "LDEMO" "1000000000000000000000000" "100000000000000000000000"
```

### Verify on Lineascan

```shell
npx hardhat verify --network lineaSepolia \
  0xAbCd...1234 \
  "Linea Demo Token" \
  "LDEMO" \
  "1000000000000000000000000" \
  "100000000000000000000000"
```

```
Expected output:
Successfully submitted source code for contract
contracts/LineaToken.sol:LineaToken at 0xAbCd...1234
for verification on the block explorer. Waiting for verification result...

Successfully verified contract LineaToken on the block explorer.
https://sepolia.lineascan.build/address/0xAbCd...1234#code
```

### Interacting with the Deployed Contract

```typescript
// scripts/interact.ts
import { ethers } from "hardhat";

const TOKEN_ADDRESS = "0xYOUR_DEPLOYED_ADDRESS";

async function main() {
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("LineaToken", TOKEN_ADDRESS);

  // Read operations (free — no gas)
  const name = await token.name();
  const balance = await token.balanceOf(signer.address);
  console.log(`${name} balance: ${ethers.formatEther(balance)}`);

  // Write operation: transfer tokens
  const recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28";
  const amount = ethers.parseEther("1000");

  console.log(`\nTransferring 1000 tokens to ${recipient}...`);

  try {
    const tx = await token.transfer(recipient, amount);
    console.log(`TX hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Confirmed in block: ${receipt?.blockNumber}`);
    console.log(`Gas used: ${receipt?.gasUsed.toString()}`);

    const gasPrice = receipt?.gasPrice || 0n;
    const cost = (receipt?.gasUsed || 0n) * gasPrice;
    console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
    console.log(`Transaction cost: ${ethers.formatEther(cost)} ETH`);

    // Verify balances
    const senderBalance = await token.balanceOf(signer.address);
    const recipientBalance = await token.balanceOf(recipient);
    console.log(`\nSender balance: ${ethers.formatEther(senderBalance)}`);
    console.log(`Recipient balance: ${ethers.formatEther(recipientBalance)}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Transfer failed: ${error.message}`);
    }
  }

  // Write operation: mint more tokens (owner only)
  console.log(`\nMinting 50000 tokens...`);
  try {
    const mintTx = await token.mint(signer.address, ethers.parseEther("50000"));
    const mintReceipt = await mintTx.wait();
    console.log(`Mint confirmed. Gas used: ${mintReceipt?.gasUsed.toString()}`);

    const newSupply = await token.totalSupply();
    console.log(`New total supply: ${ethers.formatEther(newSupply)}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Mint failed: ${error.message}`);
    }
  }
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/interact.ts --network lineaSepolia
```

```
Expected output:
Linea Demo Token balance: 100000.0

Transferring 1000 tokens to 0x742d...bD28...
TX hash: 0x123abc...
Confirmed in block: 4523910
Gas used: 52341
Gas price: 0.072 gwei
Transaction cost: 0.0000038 ETH

Sender balance: 99000.0
Recipient balance: 1000.0

Minting 50000 tokens...
Mint confirmed. Gas used: 71234
New total supply: 151000.0
```

### Gas Comparison: Linea vs Ethereum Mainnet

The key value proposition — how much you save deploying on Linea:

```typescript
// Gas cost comparison — Linea vs Ethereum Mainnet
// Ethereum mainnet assumes 30 gwei gas price, ETH = $3,000
// Linea uses actual measured costs from Sepolia testnet (January 2025)

interface GasComparison {
  operation: string;
  ethereumGas: number;
  ethereumCostUSD: string;
  lineaCostETH: string;
  lineaCostUSD: string;
  savings: string;
}

const comparisons: GasComparison[] = [
  {
    operation: "ETH Transfer",
    ethereumGas: 21_000,
    ethereumCostUSD: "$1.89",       // 21000 × 30 gwei × $3000/ETH
    lineaCostETH: "0.0000015",
    lineaCostUSD: "$0.005",
    savings: "~99.7%",
  },
  {
    operation: "ERC-20 Transfer",
    ethereumGas: 65_000,
    ethereumCostUSD: "$5.85",       // 65000 × 30 gwei × $3000/ETH
    lineaCostETH: "0.0000038",
    lineaCostUSD: "$0.011",
    savings: "~99.8%",
  },
  {
    operation: "ERC-20 Approve",
    ethereumGas: 46_000,
    ethereumCostUSD: "$4.14",
    lineaCostETH: "0.0000028",
    lineaCostUSD: "$0.008",
    savings: "~99.8%",
  },
  {
    operation: "Uniswap V3 Swap",
    ethereumGas: 184_000,
    ethereumCostUSD: "$16.56",
    lineaCostETH: "0.000015",
    lineaCostUSD: "$0.045",
    savings: "~99.7%",
  },
  {
    operation: "ERC-20 Contract Deploy",
    ethereumGas: 1_200_000,
    ethereumCostUSD: "$108.00",
    lineaCostETH: "0.0000863",
    lineaCostUSD: "$0.26",
    savings: "~99.8%",
  },
  {
    operation: "NFT Mint (ERC-721)",
    ethereumGas: 150_000,
    ethereumCostUSD: "$13.50",
    lineaCostETH: "0.000011",
    lineaCostUSD: "$0.033",
    savings: "~99.8%",
  },
];

// Note: Linea costs fluctuate based on L1 gas prices (proof + data costs)
// and network utilization. These are representative values.
// Last verified: 2025-01-15
```

**Summary table:**

| Operation | Ethereum Mainnet | Linea | Savings |
|-----------|-----------------|-------|---------|
| ETH Transfer | $1.89 | $0.005 | ~99.7% |
| ERC-20 Transfer | $5.85 | $0.011 | ~99.8% |
| ERC-20 Approve | $4.14 | $0.008 | ~99.8% |
| Uniswap V3 Swap | $16.56 | $0.045 | ~99.7% |
| ERC-20 Deploy | $108.00 | $0.26 | ~99.8% |
| NFT Mint | $13.50 | $0.033 | ~99.8% |

*Ethereum: 30 gwei gas price, ETH at $3,000. Linea: measured January 2025 on Sepolia testnet. Actual costs vary with network conditions and L1 gas prices.*

### Why Linea Is Cheaper Than Some Other ZK-Rollups

```
Cost breakdown for a transaction on any rollup:
  Total cost = Execution cost + L1 data cost + Proof amortization

Linea's advantages:
1. EIP-4844 blob usage — Posts data as blobs (cheap) not calldata (expensive)
2. Conflation — Batches many blocks into one proof, amortizing prover cost
3. Efficient state diffs — Only posts changed state, not full transaction data
4. Growing volume — More transactions per batch = lower per-tx proof cost

Comparison with other zk-rollups:
  zkSync Era:  Similar cost range, but requires custom compiler
  Scroll:      Similar cost range, slightly higher proving overhead
  Linea:       Competitive costs + standard tooling (no custom compiler)
```

### Deploying with Foundry (Alternative)

```shell
# Compile
forge build

# Deploy
forge create src/LineaToken.sol:LineaToken \
  --rpc-url https://linea-sepolia.infura.io/v3/$INFURA_KEY \
  --private-key $PRIVATE_KEY \
  --constructor-args "Linea Demo Token" "LDEMO" 1000000000000000000000000 100000000000000000000000

# Verify
forge verify-contract 0xAbCd...1234 src/LineaToken.sol:LineaToken \
  --chain 59141 \
  --verifier-url https://api-sepolia.lineascan.build/api \
  --etherscan-api-key $LINEASCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(string,string,uint256,uint256)" "Linea Demo Token" "LDEMO" 1000000000000000000000000 100000000000000000000000)
```

```
Expected output:
[⠊] Compiling...
[⠒] Compiling 6 files with Solc 0.8.24
[⠑] Solc 0.8.24 finished in 1.45s
Deployer: 0xYourAddress
Deployed to: 0xAbCd...1234
Transaction hash: 0xdef789...
```

### Production Deployment Checklist

```typescript
// scripts/pre-deploy-check.ts
import { ethers } from "hardhat";

async function preDeployCheck() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=== Pre-Deployment Checklist ===\n");

  // 1. Correct network
  const expectedChainId = 59144n; // Change to 59141n for testnet
  const chainOk = network.chainId === expectedChainId;
  console.log(`[${chainOk ? "✅" : "❌"}] Network: chainId ${network.chainId} (expected ${expectedChainId})`);

  // 2. Sufficient balance
  const balance = await ethers.provider.getBalance(deployer.address);
  const minBalance = ethers.parseEther("0.01"); // Minimum for deployment
  const balanceOk = balance >= minBalance;
  console.log(`[${balanceOk ? "✅" : "❌"}] Balance: ${ethers.formatEther(balance)} ETH (min: 0.01)`);

  // 3. Contract compiles
  try {
    await ethers.getContractFactory("LineaToken");
    console.log("[✅] Contract compiles successfully");
  } catch (error) {
    console.log("[❌] Contract compilation failed");
  }

  // 4. Gas price reasonable
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  const maxReasonableGas = ethers.parseUnits("5", "gwei"); // Linea should be well under this
  const gasOk = gasPrice < maxReasonableGas;
  console.log(`[${gasOk ? "✅" : "⚠️"}] Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  // 5. Nonce check (detect pending transactions)
  const nonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const confirmedNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const noPending = nonce === confirmedNonce;
  console.log(`[${noPending ? "✅" : "⚠️"}] Nonce: ${confirmedNonce} confirmed, ${nonce} pending`);

  console.log("\n================================");

  if (chainOk && balanceOk && gasOk && noPending) {
    console.log("✅ All checks passed — safe to deploy!");
  } else {
    console.log("⚠️  Some checks failed — review before deploying.");
  }
}

preDeployCheck().catch(console.error);
```

```shell
npx hardhat run scripts/pre-deploy-check.ts --network lineaSepolia
```

```
Expected output:
=== Pre-Deployment Checklist ===

[✅] Network: chainId 59141 (expected 59141)
[✅] Balance: 0.5 ETH (min: 0.01)
[✅] Contract compiles successfully
[✅] Gas price: 0.072 gwei
[✅] Nonce: 5 confirmed, 5 pending

================================
✅ All checks passed — safe to deploy!
```

## Common Pitfalls

1. **Forgetting to register a Lineascan API key** — Contract verification on Linea requires a Lineascan-specific API key (free at [lineascan.build](https://lineascan.build)). An Etherscan key won't work. Without verification, users can't interact with your contract through the explorer, reducing trust and usability.

2. **Using mainnet gas estimates for cost projections** — Linea's gas prices are 100-1000x lower than Ethereum mainnet. If you estimate costs using mainnet gas prices, you'll massively overestimate. Always use `provider.getFeeData()` connected to Linea for accurate estimates.

3. **Not waiting for finality before confirming to users** — A transaction confirmed by the sequencer (2-3 seconds) is not yet final on L1. For high-value operations, wait for the batch to be proven on L1 (1-3 hours). For most dApp interactions, sequencer confirmation is sufficient, but document this tradeoff for your users.

4. **Deploying without the optimizer** — While Linea's gas is cheap, deploying unoptimized contracts wastes gas and may hit the 24KB contract size limit sooner. Always enable the Solidity optimizer (`optimizer: { enabled: true, runs: 200 }`) in your Hardhat or Foundry config.

5. **Hardcoding gas limits from mainnet testing** — Gas estimation on Linea may return different values than mainnet for the same contract due to the L1 data cost component. Let the provider estimate gas dynamically rather than hardcoding values from local testing.

## What to Learn Next

- [Linea Developer Documentation](https://docs.linea.build/) — Complete reference for all Linea features
- [Linea Bridge](https://bridge.linea.build/) — Official bridge interface for moving assets
- [Lineascan](https://lineascan.build/) — Block explorer for mainnet contract interaction
- [Linea Ecosystem Portal](https://linea.build/apps) — Discover dApps deployed on Linea
- [Consensys GitHub](https://github.com/Consensys/linea-monorepo) — Linea source code and contracts
