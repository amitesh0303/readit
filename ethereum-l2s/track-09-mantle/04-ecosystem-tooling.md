# Mantle Ecosystem Tooling: SDK, Explorers, and Developer Tools

**Track:** Mantle Network Development
**Lesson:** 4 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're ready to build on Mantle but you're not sure which tools to use. Mantle is OP Stack-based, so some Optimism tooling works — but not all of it. The native gas token is MNT, which means wallet configurations and gas estimation differ from other L2s. You need a clear map of the tooling ecosystem: which SDKs to use, how to configure Hardhat and Foundry, which explorers and debugging tools are available, and how to set up an efficient development workflow.

## Core Concepts

### Mantle SDK Overview

The Mantle SDK (`@mantleio/sdk@0.3.0`) provides TypeScript utilities for cross-chain operations, built on top of the Optimism SDK:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import { CrossChainMessenger, MessageStatus } from "@mantleio/sdk"; // @mantleio/sdk@0.3.0

// Initialize providers for both chains
const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");
const l2Provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");

// Create cross-chain messenger
const l1Wallet = new ethers.Wallet("PRIVATE_KEY", l1Provider);
const l2Wallet = new ethers.Wallet("PRIVATE_KEY", l2Provider);

const messenger = new CrossChainMessenger({
  l1ChainId: 1,        // Ethereum mainnet
  l2ChainId: 5000,     // Mantle mainnet
  l1SignerOrProvider: l1Wallet,
  l2SignerOrProvider: l2Wallet
});

// Check message status for a withdrawal
async function checkWithdrawalStatus(l2TxHash: string): Promise<void> {
  const status = await messenger.getMessageStatus(l2TxHash);

  const statusLabels: Record<number, string> = {
    [MessageStatus.UNCONFIRMED_L1_TO_L2_MESSAGE]: "Waiting for L1 confirmation",
    [MessageStatus.FAILED_L1_TO_L2_MESSAGE]: "L1→L2 message failed",
    [MessageStatus.STATE_ROOT_NOT_PUBLISHED]: "Waiting for state root",
    [MessageStatus.READY_TO_PROVE]: "Ready to prove on L1",
    [MessageStatus.IN_CHALLENGE_PERIOD]: "In challenge period (~7 days)",
    [MessageStatus.READY_FOR_RELAY]: "Ready to finalize",
    [MessageStatus.RELAYED]: "Finalized on L1"
  };

  console.log(`Withdrawal status: ${statusLabels[status] ?? "Unknown"}`);
}
```

### Hardhat Configuration

Configure Hardhat for Mantle development with the correct network settings:

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config"; // hardhat@2.19.4
import "@nomicfoundation/hardhat-toolbox"; // @nomicfoundation/hardhat-toolbox@4.0.0

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "shanghai" // PUSH0 supported on Mantle
    }
  },
  networks: {
    // Mantle Mainnet
    mantle: {
      url: "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts: [process.env.PRIVATE_KEY ?? ""],
      // Gas settings for MNT
      gasPrice: 50_000_000 // 0.05 gwei in MNT — adjust based on network
    },
    // Mantle Sepolia Testnet
    mantleSepolia: {
      url: "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts: [process.env.PRIVATE_KEY ?? ""],
      gasPrice: 50_000_000
    }
  },
  etherscan: {
    apiKey: {
      mantle: process.env.MANTLE_EXPLORER_API_KEY ?? "",
      mantleSepolia: process.env.MANTLE_EXPLORER_API_KEY ?? ""
    },
    customChains: [
      {
        network: "mantle",
        chainId: 5000,
        urls: {
          apiURL: "https://api.mantlescan.xyz/api",
          browserURL: "https://mantlescan.xyz"
        }
      },
      {
        network: "mantleSepolia",
        chainId: 5003,
        urls: {
          apiURL: "https://api-sepolia.mantlescan.xyz/api",
          browserURL: "https://sepolia.mantlescan.xyz"
        }
      }
    ]
  }
};

export default config;
```

### Foundry Configuration

Configure Foundry for Mantle with the correct RPC and verification settings:

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
mantle = "https://rpc.mantle.xyz"
mantle_sepolia = "https://rpc.sepolia.mantle.xyz"

[etherscan]
mantle = { key = "${MANTLE_EXPLORER_API_KEY}", url = "https://api.mantlescan.xyz/api", chain = 5000 }
mantle_sepolia = { key = "${MANTLE_EXPLORER_API_KEY}", url = "https://api-sepolia.mantlescan.xyz/api", chain = 5003 }
```

```shell
# Deploy with Foundry to Mantle Sepolia
forge create src/MyContract.sol:MyContract \
  --rpc-url https://rpc.sepolia.mantle.xyz \
  --private-key $PRIVATE_KEY \
  --verify \
  --verifier-url https://api-sepolia.mantlescan.xyz/api \
  --etherscan-api-key $MANTLE_EXPLORER_API_KEY
```

```
Expected output:
[⠊] Compiling...
Compiler run successful!
Deployer: 0xYourAddress
Deployed to: 0xContractAddress
Transaction hash: 0xTxHash
Starting contract verification...
Contract successfully verified!
```

### Block Explorers

Mantle has multiple block explorers for different use cases:

| Explorer | URL | Best For |
|---|---|---|
| Mantlescan | https://mantlescan.xyz | Contract verification, tx lookup |
| Mantle Explorer | https://explorer.mantle.xyz | Official explorer, bridge status |
| Mantlescan Sepolia | https://sepolia.mantlescan.xyz | Testnet contract verification |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Verify a contract programmatically on Mantlescan
async function verifyOnMantlescan(
  contractAddress: string,
  sourceCode: string,
  contractName: string,
  compilerVersion: string
): Promise<string> {
  const apiUrl = "https://api.mantlescan.xyz/api";
  const apiKey = process.env.MANTLE_EXPLORER_API_KEY ?? "";

  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: contractAddress,
    sourceCode: sourceCode,
    codeformat: "solidity-single-file",
    contractname: contractName,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    evmversion: "shanghai"
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    body: params
  });

  const result = await response.json();
  if (result.status === "1") {
    console.log(`Verification submitted. GUID: ${result.result}`);
    return result.result;
  } else {
    throw new Error(`Verification failed: ${result.result}`);
  }
}
```

### Wallet Configuration

Configure MetaMask and other wallets for Mantle:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Add Mantle network to MetaMask programmatically
async function addMantleToWallet(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x1388", // 5000 in hex
        chainName: "Mantle",
        nativeCurrency: {
          name: "MNT",
          symbol: "MNT",
          decimals: 18
        },
        rpcUrls: ["https://rpc.mantle.xyz"],
        blockExplorerUrls: ["https://mantlescan.xyz"]
      }]
    });
    console.log("Mantle network added to wallet");
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 4902) {
      console.error("User rejected the network addition");
    } else {
      throw error;
    }
  }
}

// Add Mantle Sepolia testnet
async function addMantleSepoliaToWallet(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0x138B", // 5003 in hex
      chainName: "Mantle Sepolia Testnet",
      nativeCurrency: {
        name: "MNT",
        symbol: "MNT",
        decimals: 18
      },
      rpcUrls: ["https://rpc.sepolia.mantle.xyz"],
      blockExplorerUrls: ["https://sepolia.mantlescan.xyz"]
    }]
  });
}
```

### Subgraph and Indexing

Mantle supports The Graph for indexing on-chain data:

```typescript
// Example: Query a Mantle subgraph
const SUBGRAPH_URL = "https://subgraph-api.mantle.xyz/subgraphs/name/YOUR_SUBGRAPH";

interface SwapEvent {
  id: string;
  sender: string;
  amount0In: string;
  amount1Out: string;
  timestamp: string;
}

async function queryMantleSubgraph(): Promise<SwapEvent[]> {
  const query = `{
    swaps(first: 10, orderBy: timestamp, orderDirection: desc) {
      id
      sender
      amount0In
      amount1Out
      timestamp
    }
  }`;

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data.data.swaps;
}
```

### RPC Providers

Available RPC endpoints for Mantle:

| Provider | Mainnet URL | Rate Limit |
|---|---|---|
| Mantle (official) | https://rpc.mantle.xyz | Public, rate-limited |
| Ankr | https://rpc.ankr.com/mantle | Free tier available |
| dRPC | https://mantle.drpc.org | Free tier available |
| Blast API | https://mantle-mainnet.public.blastapi.io | Free tier available |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Use a fallback provider for reliability
const providers = [
  new ethers.JsonRpcProvider("https://rpc.mantle.xyz"),
  new ethers.JsonRpcProvider("https://rpc.ankr.com/mantle"),
  new ethers.JsonRpcProvider("https://mantle.drpc.org")
];

// Simple fallback: try each provider in order
async function resilientCall<T>(
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>
): Promise<T> {
  for (const provider of providers) {
    try {
      return await fn(provider);
    } catch (error) {
      console.warn(`Provider failed, trying next...`);
      continue;
    }
  }
  throw new Error("All providers failed");
}

// Usage
const blockNumber = await resilientCall(p => p.getBlockNumber());
console.log(`Current block: ${blockNumber}`);
```

## Common Pitfalls

1. **Using Optimism SDK directly instead of Mantle SDK** — While Mantle is OP Stack-based, the Optimism SDK won't work correctly because of different contract addresses and the MNT gas token. Use `@mantleio/sdk` which handles these differences.

2. **Forgetting to configure custom chain in Hardhat/Foundry for verification** — Mantlescan is not auto-detected by Hardhat or Foundry. You must add it as a custom chain with the correct API URL (`https://api.mantlescan.xyz/api`) or verification will fail silently.

3. **Using the wrong testnet** — Mantle Sepolia (chain ID 5003) is the current testnet. The older Mantle Goerli testnet is deprecated. Always verify you're targeting chain ID 5003 for testing.

4. **Not handling MNT in wallet connection flows** — When prompting users to add Mantle to MetaMask, the `nativeCurrency` must specify MNT (not ETH). If you copy-paste from an Ethereum L2 config, users will see incorrect token labels.

5. **Assuming all Optimism ecosystem tools work on Mantle** — Tools like the OP Stack bridge UI, Optimism's official SDK, and some OP-specific precompiles may not be available or may behave differently on Mantle. Always test on Mantle Sepolia first.

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — Deploy a contract to Mantle Sepolia with gas comparison
- [Mantle Docs: Developer Tools](https://docs.mantle.xyz/network/for-devs/tools) — Official tooling documentation
- [Mantlescan](https://mantlescan.xyz) — Block explorer for contract verification and debugging
