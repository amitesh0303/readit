# Mode Ecosystem Tooling: SDKs, Explorers, and Developer Tools

**Track:** Mode Network Development
**Level:** Intermediate
**Read time:** 9 min

---

## The Problem

You're ready to build on Mode but don't know which tools to use. Mode is EVM-equivalent, so standard Ethereum tooling works — but there are Mode-specific tools for SFS registration, gas estimation with L1 data fees, and ecosystem-specific SDKs. Without knowing the right toolchain, you'll waste time discovering tools mid-project or miss Mode-specific features like sequencer fee sharing integration.

## Core Concepts

### Development Framework Setup

Mode works with all standard EVM development frameworks. Here's the recommended setup:

```shell
# Option 1: Foundry (recommended for Mode development)
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
# Option 2: Hardhat
mkdir mode-project && cd mode-project
npm init -y
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0
npx hardhat init
```

```
Expected output:
✔ What do you want to do? · Create a TypeScript project
✔ Hardhat project root: · /path/to/mode-project
✔ Do you want to add a .gitignore? (Y/n) · y
✨ Project created
```

### Network Configuration

Configure your development framework for Mode networks:

```typescript
// hardhat.config.ts (Hardhat@2.19.4)
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox"; // @nomicfoundation/hardhat-toolbox@4.0.0

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  networks: {
    modeMainnet: {
      url: "https://mainnet.mode.network",
      chainId: 34443,
      accounts: [process.env.PRIVATE_KEY ?? ""],
      gasPrice: "auto"
    },
    modeSepolia: {
      url: "https://sepolia.mode.network",
      chainId: 919,
      accounts: [process.env.PRIVATE_KEY ?? ""],
      gasPrice: "auto"
    }
  },
  etherscan: {
    apiKey: {
      modeMainnet: process.env.MODE_EXPLORER_API_KEY ?? "",
      modeSepolia: process.env.MODE_EXPLORER_API_KEY ?? ""
    },
    customChains: [
      {
        network: "modeMainnet",
        chainId: 34443,
        urls: {
          apiURL: "https://explorer.mode.network/api",
          browserURL: "https://explorer.mode.network"
        }
      },
      {
        network: "modeSepolia",
        chainId: 919,
        urls: {
          apiURL: "https://sepolia.explorer.mode.network/api",
          browserURL: "https://sepolia.explorer.mode.network"
        }
      }
    ]
  }
};

export default config;
```

```toml
# foundry.toml (Foundry)
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200
via_ir = true

[rpc_endpoints]
mode_mainnet = "https://mainnet.mode.network"
mode_sepolia = "https://sepolia.mode.network"

[etherscan]
mode_mainnet = { key = "${MODE_EXPLORER_API_KEY}", url = "https://explorer.mode.network/api", chain = 34443 }
mode_sepolia = { key = "${MODE_EXPLORER_API_KEY}", url = "https://sepolia.explorer.mode.network/api", chain = 919 }
```

### Block Explorer: Mode Explorer

Mode uses a Blockscout-based explorer (not Etherscan):

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Mode Explorer API (Blockscout-compatible)
// Mainnet: https://explorer.mode.network
// Testnet: https://sepolia.explorer.mode.network

interface ContractVerification {
  status: string;
  message: string;
  result: string;
}

async function verifyContractOnMode(
  contractAddress: string,
  sourceCode: string,
  contractName: string,
  compilerVersion: string,
  network: "mainnet" | "testnet" = "testnet"
): Promise<ContractVerification> {
  const baseUrl = network === "mainnet"
    ? "https://explorer.mode.network/api"
    : "https://sepolia.explorer.mode.network/api";

  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: contractAddress,
    sourceCode: sourceCode,
    codeformat: "solidity-single-file",
    contractname: contractName,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200"
  });

  const response = await fetch(`${baseUrl}?${params.toString()}`, {
    method: "POST"
  });

  return response.json() as Promise<ContractVerification>;
}
```

```shell
# Verify with Foundry (Mode Sepolia)
forge verify-contract \
  0xYourContractAddress \
  src/MyContract.sol:MyContract \
  --chain 919 \
  --verifier blockscout \
  --verifier-url "https://sepolia.explorer.mode.network/api"
```

```
Expected output:
Start verifying contract `0xYourContractAddress` deployed on mode-sepolia
Submitting verification for [src/MyContract.sol:MyContract]
Contract successfully verified
```

### SFS Integration Library

A helper library for integrating Mode's Sequencer Fee Sharing:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ModeSFSLib
/// @notice Library for Mode Sequencer Fee Sharing integration
/// @dev Use this in your contracts to register and manage SFS
library ModeSFSLib {
    /// @dev SFS contract on Mode Mainnet
    address constant SFS_MAINNET = 0x8680CEaBcb9b56913c519c069Add6Bc3494B7020;
    /// @dev SFS contract on Mode Sepolia
    address constant SFS_TESTNET = 0xBBd707815a7F7eb6897C7686274AFabd7B579Ff6;

    /// @notice Register the calling contract for fee sharing
    /// @param recipient Address to receive the SFS NFT
    /// @return tokenId The minted SFS NFT token ID
    function register(address recipient) internal returns (uint256 tokenId) {
        address sfs = block.chainid == 34443 ? SFS_MAINNET : SFS_TESTNET;
        (bool success, bytes memory data) = sfs.call(
            abi.encodeWithSignature("register(address)", recipient)
        );
        require(success, "SFS registration failed");
        tokenId = abi.decode(data, (uint256));
    }

    /// @notice Assign the calling contract to an existing SFS NFT
    /// @param tokenId Existing SFS NFT to assign fees to
    function assign(uint256 tokenId) internal {
        address sfs = block.chainid == 34443 ? SFS_MAINNET : SFS_TESTNET;
        (bool success, ) = sfs.call(
            abi.encodeWithSignature("assign(uint256)", tokenId)
        );
        require(success, "SFS assignment failed");
    }

    /// @notice Check accumulated balance for an SFS token
    /// @param tokenId The SFS NFT token ID
    /// @return balance Accumulated fee balance in wei
    function getBalance(uint256 tokenId) internal view returns (uint256 balance) {
        address sfs = block.chainid == 34443 ? SFS_MAINNET : SFS_TESTNET;
        (bool success, bytes memory data) = sfs.staticcall(
            abi.encodeWithSignature("balances(uint256)", tokenId)
        );
        require(success, "SFS balance check failed");
        balance = abi.decode(data, (uint256));
    }
}
```

### RPC Providers

Mode is supported by multiple RPC providers:

| Provider | Free Tier | Rate Limit | URL |
|---|---|---|---|
| Mode Public RPC | Yes | Moderate | `https://mainnet.mode.network` |
| Alchemy | Yes (300M CU/mo) | High | `https://mode-mainnet.g.alchemy.com/v2/KEY` |
| QuickNode | Yes (limited) | High | Custom endpoint |
| Tenderly | Yes (25M CU/mo) | High | Custom endpoint |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Multi-provider setup with fallback for reliability
function createModeProvider(): ethers.FallbackProvider {
  const providers = [
    {
      provider: new ethers.JsonRpcProvider("https://mainnet.mode.network"),
      priority: 1,
      stallTimeout: 2000,
      weight: 1
    },
    {
      provider: new ethers.JsonRpcProvider(
        `https://mode-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
      ),
      priority: 2,
      stallTimeout: 2000,
      weight: 1
    }
  ];

  return new ethers.FallbackProvider(providers, 1);
}
```

### Wallet Configuration

Add Mode to MetaMask or any EVM wallet:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Programmatically add Mode network to MetaMask
async function addModeToWallet(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected");
  }

  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x868B", // 34443 in hex
        chainName: "Mode Mainnet",
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18
        },
        rpcUrls: ["https://mainnet.mode.network"],
        blockExplorerUrls: ["https://explorer.mode.network"]
      }]
    });
    console.log("Mode network added to wallet");
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 4902) {
      console.error("Failed to add network");
    }
    throw error;
  }
}

// Switch to Mode network
async function switchToMode(): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet detected");

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x868B" }]
    });
  } catch (error: unknown) {
    // If chain not added, add it first
    if ((error as { code?: number }).code === 4902) {
      await addModeToWallet();
    } else {
      throw error;
    }
  }
}
```

### Testing with Mode Sepolia

```shell
# Get Mode Sepolia testnet ETH
# Faucet: https://faucet.mode.network (requires Mode Sepolia network in wallet)
# Alternative: Bridge Sepolia ETH via https://bridge.mode.network
# Last verified: 2025-01-15
```

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Verify testnet connection and balance
async function checkTestnetSetup(): Promise<void> {
  const provider = new ethers.JsonRpcProvider("https://sepolia.mode.network");
  const network = await provider.getNetwork();

  console.log(`Connected to Mode Sepolia (chainId: ${network.chainId})`);

  // Check if you have testnet ETH
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY ?? "", provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`Address: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.log("\n⚠️  No testnet ETH. Get some from:");
    console.log("   https://faucet.mode.network");
    console.log("   Or bridge Sepolia ETH via https://bridge.mode.network");
  }
}
```

### Subgraph and Indexing

Mode supports The Graph for indexing on-chain data:

```typescript
// Example: Query Mode DeFi data via a subgraph
// Mode subgraphs are hosted on The Graph's decentralized network

const EXAMPLE_SUBGRAPH_URL = "https://api.studio.thegraph.com/query/YOUR_ID/mode-dex/version/latest";

interface SwapEvent {
  id: string;
  sender: string;
  amount0In: string;
  amount1Out: string;
  timestamp: string;
}

async function queryModeSwaps(): Promise<SwapEvent[]> {
  const query = `{
    swaps(first: 10, orderBy: timestamp, orderDirection: desc) {
      id
      sender
      amount0In
      amount1Out
      timestamp
    }
  }`;

  const response = await fetch(EXAMPLE_SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data.data.swaps;
}
```

## Common Pitfalls

1. **Using Etherscan API format for Mode Explorer** — Mode uses Blockscout, not Etherscan. The API is compatible but the base URL and verification flow differ. Use `--verifier blockscout` in Foundry, not `--verifier etherscan`.

2. **Forgetting to configure custom chains in Hardhat** — Hardhat doesn't know about Mode by default. You must add it to `customChains` in the etherscan config, or verification commands will fail with "network not supported."

3. **Relying solely on the public RPC for production** — The public RPC (`mainnet.mode.network`) has rate limits suitable for development but not production traffic. Use Alchemy, QuickNode, or another provider for production dApps.

4. **Not testing SFS registration on testnet first** — The SFS contract behaves identically on testnet (Mode Sepolia, chainId 919) but with different addresses. Always test your SFS integration on testnet before mainnet deployment to avoid wasting gas on failed registrations.

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — End-to-end deployment with gas comparison
- [Mode Docs: Developer Quickstart](https://docs.mode.network/build-on-mode/quickstart) — Official getting started guide
- [The Graph on Mode](https://thegraph.com/docs/en/developing/supported-networks/) — Subgraph deployment for Mode indexing
- [Mode GitHub](https://github.com/mode-network) — Source code and developer resources
