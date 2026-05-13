# Avalanche Development Environment: CLI, Core Wallet, and Fuji Testnet

**Track:** Avalanche Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to start building on Avalanche, but the tooling landscape is different from Ethereum. There's the Avalanche CLI for Subnet management, Core wallet instead of MetaMask (though MetaMask works too), and a testnet called "Fuji" instead of Sepolia or Goerli. You need to install the right tools, get testnet AVAX from the faucet, and configure your environment before writing any contracts.

This lesson gets you from zero to a fully configured Avalanche development environment with testnet funds ready to deploy.

---

## Core Concepts

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥18.0.0 | Runtime for Hardhat/scripts |
| Avalanche CLI | 1.7.x | Subnet creation, local network |
| Hardhat | 2.19.x | Smart contract development |
| Core Wallet | Latest | Avalanche-native wallet (browser extension) |
| Git | ≥2.30 | Version control |

### Installing Avalanche CLI

The Avalanche CLI (`avalanche`) is the primary tool for creating and managing Subnets, running local Avalanche networks, and deploying blockchain configurations.

```shell
# macOS / Linux — install via curl
curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s
```

```
Expected output:
ava-labs/avalanche-cli info checking GitHub for latest tag
ava-labs/avalanche-cli info found version: 1.7.3 for linux/amd64
ava-labs/avalanche-cli info installed /usr/local/bin/avalanche
```

```shell
# Verify installation
avalanche --version
```

```
Expected output:
avalanche version 1.7.3
```

```shell
# Windows — download binary from GitHub releases
# https://github.com/ava-labs/avalanche-cli/releases
# Extract and add to PATH
```

### Starting a Local Avalanche Network

The CLI can spin up a local 5-node Avalanche network for development — no testnet needed for initial testing:

```shell
# Start a local Avalanche network
avalanche network start
```

```
Expected output:
Starting previously deployed and stopped snapshot
Booting Network. Wait until healthy...
Node logs directory: /home/user/.avalanche-cli/runs/network_20250115_001/
Network ready to use.
```

```shell
# Check network status
avalanche network status
```

```
Expected output:
Network is Up. Network information:
==================================
Healthy: true
Custom VMs healthy: true
Number of nodes: 5
Number of custom VMs: 0
```

```shell
# Stop the local network
avalanche network stop
```

### Setting Up Hardhat for Avalanche

Initialize a Hardhat project configured for Avalanche C-Chain:

```shell
# Create project directory
mkdir avalanche-project && cd avalanche-project

# Initialize with Hardhat
npm init -y
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0
npx hardhat init
```

```
Expected output:
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /home/user/avalanche-project
✔ Do you want to add a .gitignore? (Y/n) · y
✔ Do you want to install this sample project's dependencies with npm? · y
```

Configure `hardhat.config.ts` for Avalanche networks:

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

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
    // Local Avalanche network (started via avalanche network start)
    local: {
      url: "http://127.0.0.1:9650/ext/bc/C/rpc",
      chainId: 43112,
      accounts: [PRIVATE_KEY],
    },
    // Fuji Testnet C-Chain
    fuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: [PRIVATE_KEY],
      gasPrice: 25000000000, // 25 nAVAX
    },
    // Mainnet C-Chain (use with caution)
    mainnet: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
    },
  },
};

export default config;
```

Create the `.env` file (never commit this):

```shell
# .env
PRIVATE_KEY=your_private_key_here_without_0x_prefix
SNOWTRACE_API_KEY=your_snowtrace_api_key
```

### Core Wallet Setup

[Core](https://core.app/) is Avalanche's native wallet that supports C-Chain, X-Chain, and P-Chain in a single interface. Install it as a browser extension:

1. Visit [https://core.app/](https://core.app/) and install the browser extension
2. Create a new wallet or import an existing seed phrase
3. Switch to **Fuji Testnet** in the network selector (top-right)
4. Copy your C-Chain address (starts with `0x`)

### Getting Testnet AVAX from the Faucet

The Fuji faucet provides free testnet AVAX for development:

```shell
# Fuji Testnet Faucet URL
# https://faucet.avax.network/

# Steps:
# 1. Visit https://faucet.avax.network/
# 2. Select "Fuji (C-Chain)" from the network dropdown
# 3. Paste your C-Chain address (0x...)
# 4. Complete the CAPTCHA
# 5. Click "Request 2 AVAX"
# Rate limit: 1 request per hour per address
```

Verify your balance:

```typescript
// scripts/check-balance.ts
import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);

  console.log("Address:", signer.address);
  console.log("Balance:", ethers.formatEther(balance), "AVAX");
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/check-balance.ts --network fuji
```

```
Expected output:
Address: 0xYourAddress...
Balance: 2.0 AVAX
Network: unknown
Chain ID: 43113n
```

### Adding Fuji to MetaMask (Alternative)

If you prefer MetaMask over Core wallet:

```typescript
// Network configuration for MetaMask
const fujiNetwork = {
  chainId: "0xA869",           // 43113 in hex
  chainName: "Avalanche Fuji Testnet",
  nativeCurrency: {
    name: "AVAX",
    symbol: "AVAX",
    decimals: 18,
  },
  rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
  blockExplorerUrls: ["https://testnet.snowtrace.io/"],
};

// Programmatically add network to MetaMask
async function addFujiNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [fujiNetwork],
    });
    console.log("Fuji testnet added to MetaMask");
  } catch (error) {
    console.error("Failed to add network:", error);
  }
}
```

### Project Structure

After setup, your project should look like this:

```text
avalanche-project/
├── contracts/          # Solidity smart contracts
│   └── Lock.sol        # Sample contract from Hardhat init
├── scripts/            # Deployment and interaction scripts
│   └── check-balance.ts
├── test/               # Test files
├── hardhat.config.ts   # Network configuration
├── .env                # Private keys (gitignored)
├── package.json
└── tsconfig.json
```

---

## Common Pitfalls

1. **Using the wrong RPC URL format** — Avalanche RPC endpoints include the chain path: `https://api.avax-test.network/ext/bc/C/rpc` for C-Chain. Forgetting `/ext/bc/C/rpc` and using just the base URL will return errors. Each chain (C, X, P) has its own endpoint path.

2. **Confusing Chain IDs** — Fuji C-Chain is `43113`, Mainnet C-Chain is `43114`, local network is `43112`. Using the wrong chain ID causes transaction signing failures. Always double-check your `hardhat.config.ts` matches the network you're targeting.

3. **Running out of testnet AVAX** — The faucet has a rate limit of 2 AVAX per hour per address. If you're deploying multiple contracts, plan your gas usage. A typical contract deployment on Fuji costs 0.01-0.05 AVAX. Use the local network (`avalanche network start`) for iterative development to avoid faucet limits.

4. **Not installing the Avalanche CLI prerequisites** — The CLI requires Go 1.21+ if building from source. The install script handles binary downloads, but if it fails, check that you have `curl` and write permissions to `/usr/local/bin`. On Windows, manually download the binary from GitHub releases.

5. **Forgetting to set gasPrice for Fuji** — Unlike Ethereum testnets that use EIP-1559, Fuji C-Chain transactions work best with an explicit `gasPrice` setting (25 gwei / 25 nAVAX). Without it, some transactions may get stuck in the mempool.

---

## What to Learn Next

- [Deploy Your First Smart Contract](./03-first-smart-contract.md) — Write and deploy a Solidity contract to Fuji C-Chain with full CLI walkthrough
- [Avalanche CLI documentation](https://docs.avax.network/tooling/avalanche-cli) — Official reference for all CLI commands
- [Core Wallet documentation](https://docs.core.app/) — Full guide to Core wallet features including cross-chain transfers
