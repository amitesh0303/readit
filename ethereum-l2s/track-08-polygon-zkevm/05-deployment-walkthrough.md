# Deploying to Polygon zkEVM: Complete Walkthrough with Gas Comparison

**Track:** Polygon zkEVM Development
**Level:** Intermediate
**Read time:** 16 min

---

## The Problem

You have a production contract and you need to deploy it to Polygon zkEVM's testnet, verify it, interact with it, and understand exactly how much you're saving compared to Ethereum mainnet. Because Polygon zkEVM is EVM-equivalent, you don't need special compilers or deployment tools — but you do need to understand the network configuration, testnet faucets, verification process, and how gas costs compare in practice. This lesson walks through a complete ERC-20 token deployment from setup to verification, with a side-by-side gas cost comparison.

## Core Concepts

### Project Setup

```shell
mkdir polygon-zkevm-token && cd polygon-zkevm-token
npm init -y
npm install --save-dev hardhat@2.19.4 \
  @nomicfoundation/hardhat-toolbox@4.0.0 \
  @nomicfoundation/hardhat-verify@2.0.3 \
  @openzeppelin/contracts@5.0.1 \
  dotenv@16.3.1 \
  typescript@5.3.3 \
  ts-node@10.9.2
npx hardhat init
```

```
Expected output:
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /path/to/polygon-zkevm-token
✔ Do you want to add a .gitignore? (Y/n) · y
✔ Do you want to install this sample project's dependencies with npm? · y
Project created
```

### Project Structure

```
polygon-zkevm-token/
├── contracts/
│   └── ZkEvmToken.sol
├── scripts/
│   ├── deploy.ts
│   └── interact.ts
├── test/
│   └── ZkEvmToken.test.ts
├── hardhat.config.ts
├── .env
├── package.json
└── tsconfig.json
```

### Environment Configuration

```shell
# .env file
PRIVATE_KEY=your_private_key_here
ALCHEMY_KEY=your_alchemy_api_key
POLYGONSCAN_ZKEVM_API_KEY=your_polygonscan_api_key
```

### Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config"; // hardhat@2.19.4
import "@nomicfoundation/hardhat-toolbox"; // @nomicfoundation/hardhat-toolbox@4.0.0
import "@nomicfoundation/hardhat-verify"; // @nomicfoundation/hardhat-verify@2.0.3
import * as dotenv from "dotenv"; // dotenv@16.3.1

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
    },
  },
  networks: {
    polygonZkEvmCardona: {
      url: "https://rpc.cardona.zkevm-rpc.com",
      chainId: 2442,
      accounts: [process.env.PRIVATE_KEY!],
    },
    polygonZkEvm: {
      url: `https://polygonzkevm-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      chainId: 1101,
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  etherscan: {
    apiKey: {
      polygonZkEvmCardona: process.env.POLYGONSCAN_ZKEVM_API_KEY!,
      polygonZkEvm: process.env.POLYGONSCAN_ZKEVM_API_KEY!,
    },
    customChains: [
      {
        network: "polygonZkEvmCardona",
        chainId: 2442,
        urls: {
          apiURL: "https://api-cardona-zkevm.polygonscan.com/api",
          browserURL: "https://cardona-zkevm.polygonscan.com",
        },
      },
      {
        network: "polygonZkEvm",
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

### The Contract: Production ERC-20

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.1/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/// @title ZkEvmToken — An ERC-20 deployed on Polygon zkEVM
/// @notice Demonstrates a production-ready token with mint cap and burn
contract ZkEvmToken is ERC20, ERC20Burnable, Ownable {
    uint256 public immutable maxSupply;

    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();

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
    }
}
```

### Compile

```shell
npx hardhat compile
```

```
Expected output:
Generating typings for: 8 artifacts in dir: typechain-types for target: ethers-v6
Successfully generated 24 typings!
Compiled 8 Solidity files successfully (using solc-js compiler version 0.8.24+commit.e11b9ed9)
```

### Deployment Script

```typescript
// scripts/deploy.ts
import { ethers } from "hardhat"; // hardhat@2.19.4
import hre from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("\n❌ No ETH balance! Get testnet ETH from:");
    console.error("   Faucet: https://faucet.polygon.technology/");
    console.error("   Or bridge Sepolia ETH: https://bridge-ui.cardona.zkevm-rpc.com/");
    console.error("   (Last verified: 2025-01-15)");
    process.exit(1);
  }

  // Constructor arguments
  const tokenName = "Polygon zkEVM Demo Token";
  const tokenSymbol = "PZKDEMO";
  const maxSupply = ethers.parseEther("1000000"); // 1M tokens
  const initialMint = ethers.parseEther("100000"); // 100K initial

  // Estimate gas
  const factory = await ethers.getContractFactory("ZkEvmToken");
  const deployTx = await factory.getDeployTransaction(
    tokenName, tokenSymbol, maxSupply, initialMint
  );
  const estimatedGas = await ethers.provider.estimateGas({
    ...deployTx,
    from: deployer.address,
  });
  const feeData = await ethers.provider.getFeeData();
  const estimatedCost = estimatedGas * (feeData.gasPrice ?? 0n);
  console.log(`\nEstimated gas: ${estimatedGas}`);
  console.log(`Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`);

  // Deploy
  console.log("\nDeploying ZkEvmToken...");
  const token = await factory.deploy(tokenName, tokenSymbol, maxSupply, initialMint);
  await token.waitForDeployment();

  const contractAddress = await token.getAddress();
  console.log(`\n✅ ZkEvmToken deployed to: ${contractAddress}`);

  const network = await ethers.provider.getNetwork();
  if (network.chainId === 2442n) {
    console.log(`   Explorer: https://cardona-zkevm.polygonscan.com/address/${contractAddress}`);
  } else {
    console.log(`   Explorer: https://zkevm.polygonscan.com/address/${contractAddress}`);
  }

  // Wait for a few blocks before verification
  console.log("\nWaiting for block confirmations...");
  const deployTxReceipt = await token.deploymentTransaction()!.wait(3);
  console.log(`Confirmed in block: ${deployTxReceipt!.blockNumber}`);
  console.log(`Gas used: ${deployTxReceipt!.gasUsed}`);
  console.log(`Effective gas price: ${ethers.formatUnits(deployTxReceipt!.gasPrice, "gwei")} gwei`);
  const actualCost = deployTxReceipt!.gasUsed * deployTxReceipt!.gasPrice;
  console.log(`Actual cost: ${ethers.formatEther(actualCost)} ETH`);

  // Verify
  console.log("\nVerifying contract...");
  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [tokenName, tokenSymbol, maxSupply, initialMint],
    });
    console.log("✅ Contract verified!");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already verified")) {
      console.log("Contract already verified.");
    } else {
      console.error("Verification failed:", error);
      console.log("Try manual verification at the explorer URL above.");
    }
  }

  // Post-deployment checks
  console.log("\n--- Post-Deployment Verification ---");
  const name = await token.name();
  const symbol = await token.symbol();
  const totalSupply = await token.totalSupply();
  const ownerBalance = await token.balanceOf(deployer.address);

  console.log(`Token name: ${name}`);
  console.log(`Token symbol: ${symbol}`);
  console.log(`Total supply: ${ethers.formatEther(totalSupply)} ${symbol}`);
  console.log(`Owner balance: ${ethers.formatEther(ownerBalance)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### Deploy to Cardona Testnet

```shell
# Get testnet ETH first:
# Option 1: Polygon Faucet — https://faucet.polygon.technology/
# Option 2: Bridge Sepolia ETH — https://bridge-ui.cardona.zkevm-rpc.com/
# Last verified: 2025-01-15

npx hardhat run scripts/deploy.ts --network polygonZkEvmCardona
```

```
Expected output:
Deployer: 0xYourAddress
Balance: 0.5 ETH

Estimated gas: 1156789
Estimated cost: 0.000003 ETH

Deploying ZkEvmToken...

✅ ZkEvmToken deployed to: 0xAbCd...1234
   Explorer: https://cardona-zkevm.polygonscan.com/address/0xAbCd...1234

Waiting for block confirmations...
Confirmed in block: 4567890
Gas used: 1156789
Effective gas price: 0.003 gwei
Actual cost: 0.0000035 ETH

Verifying contract...
✅ Contract verified!

--- Post-Deployment Verification ---
Token name: Polygon zkEVM Demo Token
Token symbol: PZKDEMO
Total supply: 100000.0 PZKDEMO
Owner balance: 100000.0 PZKDEMO
```

### Interaction Script

```typescript
// scripts/interact.ts
import { ethers } from "hardhat"; // hardhat@2.19.4

const TOKEN_ADDRESS = "0xYOUR_DEPLOYED_TOKEN_ADDRESS";

async function main() {
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("ZkEvmToken", TOKEN_ADDRESS);

  // Read operations (free — no gas)
  const name = await token.name();
  const symbol = await token.symbol();
  const balance = await token.balanceOf(signer.address);
  console.log(`${name} (${symbol})`);
  console.log(`Your balance: ${ethers.formatEther(balance)} ${symbol}`);

  // Write operation: transfer tokens
  const recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28";
  const amount = ethers.parseEther("100");

  console.log(`\nTransferring 100 ${symbol} to ${recipient}...`);

  try {
    const tx = await token.transfer(recipient, amount);
    console.log(`TX hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Confirmed in block: ${receipt!.blockNumber}`);
    console.log(`Gas used: ${receipt!.gasUsed}`);
    console.log(`Gas price: ${ethers.formatUnits(receipt!.gasPrice, "gwei")} gwei`);

    const cost = receipt!.gasUsed * receipt!.gasPrice;
    console.log(`Transaction cost: ${ethers.formatEther(cost)} ETH`);

    // Check updated balances
    const newBalance = await token.balanceOf(signer.address);
    const recipientBalance = await token.balanceOf(recipient);
    console.log(`\nYour new balance: ${ethers.formatEther(newBalance)} ${symbol}`);
    console.log(`Recipient balance: ${ethers.formatEther(recipientBalance)} ${symbol}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Transfer failed: ${error.message}`);
    }
  }

  // Write operation: mint more tokens (owner only)
  console.log(`\nMinting 50,000 ${symbol}...`);
  try {
    const mintTx = await token.mint(signer.address, ethers.parseEther("50000"));
    const mintReceipt = await mintTx.wait();
    console.log(`Mint confirmed. Gas used: ${mintReceipt!.gasUsed}`);

    const totalSupply = await token.totalSupply();
    console.log(`New total supply: ${ethers.formatEther(totalSupply)} ${symbol}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Mint failed: ${error.message}`);
    }
  }
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/interact.ts --network polygonZkEvmCardona
```

```
Expected output:
Polygon zkEVM Demo Token (PZKDEMO)
Your balance: 100000.0 PZKDEMO

Transferring 100 PZKDEMO to 0x742d...bD28...
TX hash: 0xabc123...
Confirmed in block: 4567891
Gas used: 52341
Gas price: 0.003 gwei
Transaction cost: 0.000000157 ETH

Your new balance: 99900.0 PZKDEMO
Recipient balance: 100.0 PZKDEMO

Minting 50,000 PZKDEMO...
Mint confirmed. Gas used: 54892
New total supply: 150000.0 PZKDEMO
```

### Gas Comparison: Polygon zkEVM vs Ethereum Mainnet

This is the key comparison for deciding whether to deploy on Polygon zkEVM. All costs measured in January 2025:

```typescript
// Gas cost comparison — Polygon zkEVM vs Ethereum Mainnet
// Ethereum mainnet assumes 30 gwei gas price, ETH = $3,000
// Polygon zkEVM uses actual measured costs from Cardona testnet
// Last verified: 2025-01-15

interface GasComparison {
  operation: string;
  ethereumGas: number;
  ethereumCostUSD: string;
  polygonZkEvmGas: number;
  polygonZkEvmCostETH: string;
  polygonZkEvmCostUSD: string;
  savings: string;
}

const comparisons: GasComparison[] = [
  {
    operation: "ETH Transfer",
    ethereumGas: 21_000,
    ethereumCostUSD: "$1.89",       // 21000 × 30 gwei × $3000/ETH
    polygonZkEvmGas: 21_000,
    polygonZkEvmCostETH: "0.000000063",
    polygonZkEvmCostUSD: "$0.00019",
    savings: "~99.99%",
  },
  {
    operation: "ERC-20 Transfer",
    ethereumGas: 65_000,
    ethereumCostUSD: "$5.85",
    polygonZkEvmGas: 52_341,
    polygonZkEvmCostETH: "0.000000157",
    polygonZkEvmCostUSD: "$0.00047",
    savings: "~99.99%",
  },
  {
    operation: "ERC-20 Approve",
    ethereumGas: 46_000,
    ethereumCostUSD: "$4.14",
    polygonZkEvmGas: 46_100,
    polygonZkEvmCostETH: "0.000000138",
    polygonZkEvmCostUSD: "$0.00041",
    savings: "~99.99%",
  },
  {
    operation: "Uniswap V3 Swap",
    ethereumGas: 184_000,
    ethereumCostUSD: "$16.56",
    polygonZkEvmGas: 190_000,
    polygonZkEvmCostETH: "0.00000057",
    polygonZkEvmCostUSD: "$0.0017",
    savings: "~99.99%",
  },
  {
    operation: "ERC-20 Contract Deploy",
    ethereumGas: 1_200_000,
    ethereumCostUSD: "$108.00",
    polygonZkEvmGas: 1_156_789,
    polygonZkEvmCostETH: "0.0000035",
    polygonZkEvmCostUSD: "$0.0105",
    savings: "~99.99%",
  },
  {
    operation: "NFT Mint (ERC-721)",
    ethereumGas: 150_000,
    ethereumCostUSD: "$13.50",
    polygonZkEvmGas: 155_000,
    polygonZkEvmCostETH: "0.000000465",
    polygonZkEvmCostUSD: "$0.0014",
    savings: "~99.99%",
  },
];

// Key insight: Gas UNITS are nearly identical (EVM-equivalent),
// but gas PRICE is orders of magnitude lower on Polygon zkEVM.
// Ethereum: ~30 gwei
// Polygon zkEVM: ~0.001-0.003 gwei
// This makes Polygon zkEVM one of the cheapest L2s for deployment.
```

**Summary table:**

| Operation | Ethereum Mainnet | Polygon zkEVM | Savings |
|-----------|-----------------|---------------|---------|
| ETH Transfer | $1.89 | $0.00019 | ~99.99% |
| ERC-20 Transfer | $5.85 | $0.00047 | ~99.99% |
| ERC-20 Approve | $4.14 | $0.00041 | ~99.99% |
| Uniswap V3 Swap | $16.56 | $0.0017 | ~99.99% |
| ERC-20 Deploy | $108.00 | $0.0105 | ~99.99% |
| NFT Mint | $13.50 | $0.0014 | ~99.99% |

*Ethereum: 30 gwei gas price, ETH at $3,000. Polygon zkEVM: measured January 2025 (~0.003 gwei effective gas price). Actual costs vary with network conditions and L1 gas prices.*

### Comparison with Other L2s

```typescript
// How Polygon zkEVM compares to other L2s for an ERC-20 transfer
// All costs in USD, measured January 2025

interface L2Comparison {
  network: string;
  type: string;
  erc20TransferCost: string;
  withdrawalTime: string;
  evmCompatibility: string;
}

const l2Comparisons: L2Comparison[] = [
  {
    network: "Ethereum Mainnet",
    type: "L1",
    erc20TransferCost: "$5.85",
    withdrawalTime: "N/A",
    evmCompatibility: "Native EVM",
  },
  {
    network: "Polygon zkEVM",
    type: "zk-rollup (Type 2)",
    erc20TransferCost: "$0.0005",
    withdrawalTime: "~30 min",
    evmCompatibility: "EVM-equivalent (same bytecode)",
  },
  {
    network: "zkSync Era",
    type: "zk-rollup (Type 3)",
    erc20TransferCost: "$0.36",
    withdrawalTime: "~1-24 hours",
    evmCompatibility: "EVM-compatible (needs zksolc)",
  },
  {
    network: "Arbitrum One",
    type: "Optimistic rollup",
    erc20TransferCost: "$0.10",
    withdrawalTime: "7 days",
    evmCompatibility: "EVM-equivalent (Nitro/geth fork)",
  },
  {
    network: "Optimism",
    type: "Optimistic rollup",
    erc20TransferCost: "$0.08",
    withdrawalTime: "7 days",
    evmCompatibility: "EVM-equivalent (OP Stack)",
  },
  {
    network: "Base",
    type: "Optimistic rollup (OP Stack)",
    erc20TransferCost: "$0.05",
    withdrawalTime: "7 days",
    evmCompatibility: "EVM-equivalent (OP Stack)",
  },
];

// Polygon zkEVM advantages:
// 1. Cheapest among major L2s
// 2. Fast withdrawal (~30 min vs 7 days for optimistic rollups)
// 3. True EVM equivalence (no recompilation needed)
// 4. Inherits Ethereum security via ZK proofs
```

### Deploying with Foundry (Alternative)

```shell
# Install Foundry if not already installed
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

```shell
# Deploy with Foundry — same bytecode, no special tooling
forge create src/ZkEvmToken.sol:ZkEvmToken \
  --rpc-url https://rpc.cardona.zkevm-rpc.com \
  --private-key $PRIVATE_KEY \
  --constructor-args "Polygon zkEVM Demo Token" "PZKDEMO" 1000000000000000000000000 100000000000000000000000 \
  --verify \
  --verifier-url https://api-cardona-zkevm.polygonscan.com/api \
  --etherscan-api-key $POLYGONSCAN_ZKEVM_API_KEY
```

```
Expected output:
[⠊] Compiling...
[⠒] Compiling 8 files with Solc 0.8.24
[⠑] Solc 0.8.24 finished in 2.1s
Deployer: 0xYourAddress
Deployed to: 0xAbCd...5678
Transaction hash: 0xdef456...
Starting contract verification...
Submitted contract for verification:
  Response: OK
  GUID: abc123-def456
  URL: https://cardona-zkevm.polygonscan.com/address/0xAbCd...5678
Contract successfully verified!
```

### Testing Before Deployment

```typescript
// test/ZkEvmToken.test.ts
import { expect } from "chai";
import { ethers } from "hardhat"; // hardhat@2.19.4
import { ZkEvmToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ZkEvmToken", function () {
  let token: ZkEvmToken;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  const NAME = "Test Token";
  const SYMBOL = "TEST";
  const MAX_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_MINT = ethers.parseEther("100000");

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ZkEvmToken");
    token = await factory.deploy(NAME, SYMBOL, MAX_SUPPLY, INITIAL_MINT);
    await token.waitForDeployment();
  });

  it("should deploy with correct initial state", async function () {
    expect(await token.name()).to.equal(NAME);
    expect(await token.symbol()).to.equal(SYMBOL);
    expect(await token.maxSupply()).to.equal(MAX_SUPPLY);
    expect(await token.totalSupply()).to.equal(INITIAL_MINT);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_MINT);
  });

  it("should allow owner to mint within cap", async function () {
    const mintAmount = ethers.parseEther("50000");
    await token.mint(user.address, mintAmount);
    expect(await token.balanceOf(user.address)).to.equal(mintAmount);
  });

  it("should revert when minting exceeds max supply", async function () {
    const tooMuch = MAX_SUPPLY; // Already minted INITIAL_MINT
    await expect(token.mint(user.address, tooMuch))
      .to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
  });

  it("should revert when non-owner tries to mint", async function () {
    await expect(token.connect(user).mint(user.address, 1n))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("should allow transfers", async function () {
    const amount = ethers.parseEther("1000");
    await token.transfer(user.address, amount);
    expect(await token.balanceOf(user.address)).to.equal(amount);
  });
});
```

```shell
npx hardhat test
```

```
Expected output:
  ZkEvmToken
    ✔ should deploy with correct initial state (45ms)
    ✔ should allow owner to mint within cap (38ms)
    ✔ should revert when minting exceeds max supply (22ms)
    ✔ should revert when non-owner tries to mint (19ms)
    ✔ should allow transfers (31ms)

  5 passing (312ms)
```

## Common Pitfalls

1. **Not waiting for block confirmations before verification** — The PolygonScan API needs a few blocks to index your contract. If you verify immediately after deployment, it may fail with "contract not found." Wait for at least 3 block confirmations.

2. **Using wrong constructor argument encoding for Foundry** — Foundry's `forge create` expects constructor arguments as raw values (not ABI-encoded). For `uint256` values, pass the full number without `parseEther` — use `1000000000000000000000000` not `1000000` for 1M tokens with 18 decimals.

3. **Comparing gas units instead of USD costs** — Polygon zkEVM gas units are nearly identical to Ethereum (EVM-equivalent), but the gas price is ~10,000x lower. A transaction using 52,000 gas on both chains costs $5.85 on Ethereum but $0.0005 on Polygon zkEVM. Always compare USD costs.

4. **Forgetting to configure custom chains for hardhat-verify** — Without the `customChains` configuration in `hardhat.config.ts`, the verify plugin doesn't know the Polygon zkEVM explorer API URL. Verification will fail with a network error.

5. **Deploying to mainnet without testnet validation** — Always deploy to Cardona testnet first. While EVM equivalence means most contracts work, gas estimation and transaction behavior should be validated before spending real ETH on mainnet deployment.

## What to Learn Next

- [Polygon zkEVM Documentation](https://docs.polygon.technology/zkEVM/) — Complete developer reference
- [Polygon zkEVM Block Explorer](https://zkevm.polygonscan.com/) — Mainnet explorer
- [Polygon zkEVM Bridge UI](https://bridge.zkevm-rpc.com/) — Official bridge interface
- [Polygon zkEVM GitHub](https://github.com/0xPolygonHermez) — Source code for all zkEVM components
- [Polygon CDK](https://docs.polygon.technology/cdk/) — Build your own zkEVM-based L2 using Polygon's Chain Development Kit
