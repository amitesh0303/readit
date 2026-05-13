# Rootstock: EVM Smart Contracts Secured by Bitcoin

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 7 of 8
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You're an EVM developer who wants to build on Bitcoin. You know Solidity, you know Hardhat, and you don't want to learn a new language. Rootstock (RSK) is a merge-mined sidechain that runs a full EVM — your existing Solidity contracts deploy with minimal changes. But you need to understand how RSK's merge-mining works, how the Powpeg bridges BTC, and what's different about gas and block times compared to Ethereum.

## Core Concepts

### RSK Architecture

Rootstock is merge-mined with Bitcoin, meaning Bitcoin miners simultaneously secure both networks without additional energy expenditure. The network processes ~30 transactions per second with 30-second block times.

```
┌─────────────────────────────────────────────────────────┐
│              Rootstock (RSK) Architecture                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Bitcoin Miners (merge-mining)                          │
│  └── Mine BTC blocks + RSK blocks simultaneously        │
│  └── ~60% of Bitcoin hashrate secures RSK               │
│                                                         │
│  Powpeg (2-way peg)                                     │
│  ├── Peg-in: BTC → RBTC (100 BTC confirmations)        │
│  └── Peg-out: RBTC → BTC (4000 RSK blocks, ~33 hours)  │
│  └── Secured by HSMs + federation multisig              │
│                                                         │
│  RSK Virtual Machine (RVM)                              │
│  ├── EVM-compatible (Solidity, Vyper)                   │
│  ├── 30-second block time                               │
│  ├── Gas paid in RBTC (pegged 1:1 to BTC)              │
│  └── Precompiled contracts for Bitcoin integration      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Setting Up the Development Environment

```shell
# Install Hardhat for RSK development - hardhat@2.19.4
mkdir rsk-project && cd rsk-project
npm init -y
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0

# Initialize Hardhat project
npx hardhat init
# Select: Create a TypeScript project
```

Configure Hardhat for RSK networks:

```typescript
// hardhat.config.ts
// hardhat@2.19.4
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    rsktestnet: {
      url: "https://public-node.testnet.rsk.co",
      chainId: 31,
      gasPrice: 60000000, // 0.06 gwei - RSK has lower gas prices
      accounts: [process.env.RSK_PRIVATE_KEY || ""],
    },
    rskmainnet: {
      url: "https://public-node.rsk.co",
      chainId: 30,
      gasPrice: 60000000,
      accounts: [process.env.RSK_PRIVATE_KEY || ""],
    },
  },
};

export default config;
```

### Deploying a Contract to RSK

Here's a complete ERC-20 token deployment on RSK. The Solidity code is identical to what you'd deploy on Ethereum:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.0/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/// @title BitcoinDeFiToken
/// @notice ERC-20 token deployed on Rootstock (RSK)
/// @dev Identical to Ethereum deployment - RSK is fully EVM-compatible
contract BitcoinDeFiToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10**18; // 21M cap (Bitcoin-inspired)

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor() ERC20("Bitcoin DeFi Token", "BDF") Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 1_000_000 * 10**18);
    }

    /// @notice Mint new tokens (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint (in wei units)
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    /// @notice Burn tokens from caller's balance
    /// @param amount Amount to burn
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
```

Deploy script:

```typescript
// scripts/deploy.ts
// hardhat@2.19.4
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "RBTC");

  const Token = await ethers.getContractFactory("BitcoinDeFiToken");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log("BitcoinDeFiToken deployed to:", address);
  console.log("Total supply:", ethers.formatEther(await token.totalSupply()), "BDF");

  // Verify on RSK Explorer
  console.log(`Explorer: https://explorer.testnet.rsk.co/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Get testnet RBTC from faucet: https://faucet.rsk.co/
# Deploy to RSK testnet
npx hardhat run scripts/deploy.ts --network rsktestnet
```

```
Expected output:
Deploying with account: 0x1234...
Account balance: 0.05 RBTC
BitcoinDeFiToken deployed to: 0xAbCd...
Total supply: 1000000.0 BDF
Explorer: https://explorer.testnet.rsk.co/address/0xAbCd...
```

### RSK vs Ethereum: Key Differences

| Feature | Ethereum | RSK |
|---|---|---|
| Block time | ~12 seconds | ~30 seconds |
| Gas token | ETH | RBTC (pegged to BTC) |
| Security | PoS validators | Merge-mined with BTC |
| Gas price | Variable (gwei) | Lower (~0.06 gwei) |
| Chain ID | 1 (mainnet) | 30 (mainnet), 31 (testnet) |
| Address format | EIP-55 checksum | RSK checksum (chain-id aware) |

### Gas Cost Comparison

```typescript
// Compare deployment costs: Ethereum vs RSK
// Approximate costs at time of writing (January 2025)

const deploymentGas = 1_500_000n; // Typical ERC-20 deployment

// Ethereum mainnet: ~30 gwei gas price, ETH at $3,000
const ethCost = (deploymentGas * 30n * 1000000000n) / 10n**18n;
// 0.045 ETH ≈ $135

// RSK: ~0.06 gwei gas price, RBTC at $95,000 (pegged to BTC)
const rskCost = (deploymentGas * 60000000n) / 10n**18n;
// 0.00009 RBTC ≈ $8.55

console.log(`Ethereum deployment: ~$135`);
console.log(`RSK deployment: ~$8.55`);
console.log(`Savings: ~94%`);
```

### Interacting with the Powpeg

The Powpeg bridge allows moving BTC to RSK as RBTC:

```shell
# Check Powpeg bridge status (RSK mainnet)
# Bridge contract: 0x0000000000000000000000000000000001000006

# Using cast (foundry@0.2.0) to query the bridge
cast call 0x0000000000000000000000000000000001000006 \
  "getFederationSize()(uint256)" \
  --rpc-url https://public-node.rsk.co
```

```
Expected output:
9
```

## Common Pitfalls

1. **Using Ethereum address checksums on RSK** — RSK uses a chain-id-aware checksum (EIP-1191). An address valid on Ethereum may have a different checksum on RSK. Use RSK-aware libraries or disable checksum validation when porting code.

2. **Expecting Ethereum gas prices** — RSK gas prices are much lower than Ethereum, but gas is paid in RBTC (which is pegged to BTC at ~$95,000). A "cheap" gas price in gwei terms can still be meaningful in dollar terms because RBTC is expensive per unit.

3. **Ignoring the 30-second block time** — RSK blocks are 2.5x slower than Ethereum. Adjust confirmation wait times in your frontend and don't assume sub-15-second finality.

4. **Not accounting for merge-mining security variance** — RSK's security depends on what percentage of Bitcoin hashrate is merge-mining. Currently ~60%, but this can fluctuate. During low-hashrate periods, the network is theoretically more vulnerable to 51% attacks than Bitcoin itself.

## What to Learn Next

- [Merlin Chain](./08-merlin-chain.md) — Explore Bitcoin's ZK-rollup for scalable EVM execution
- [RSK Developer Portal](https://developers.rsk.co/) — Official RSK documentation and tutorials
- [RSK GitHub](https://github.com/rsksmart) — RSK smart contract libraries and tools
