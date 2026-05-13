# Arbitrum Ecosystem Tooling: SDK, Explorers, and Developer Tools

**Track:** Arbitrum Development
**Lesson:** 4 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're ready to build on Arbitrum but you're not sure which tools to use. The Arbitrum SDK has multiple packages with overlapping functionality, there are Arbitrum-specific block explorers and debugging tools, and you need to configure Hardhat/Foundry correctly for Arbitrum's two-component gas model. You need a clear map of the tooling ecosystem so you can set up an efficient development workflow.

## Core Concepts

### Arbitrum SDK Overview

The Arbitrum SDK (`@arbitrum/sdk@4.0.1`) provides TypeScript utilities for cross-chain operations:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import {
  EthBridger,
  Erc20Bridger,
  getArbitrumNetwork,
  ChildTransactionReceipt,
  ParentToChildMessageStatus
} from "@arbitrum/sdk"; // @arbitrum/sdk@4.0.1

// Initialize providers for both chains
const l1Provider = new ethers.JsonRpcProvider(
  "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
);
const l2Provider = new ethers.JsonRpcProvider(
  "https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
);

// Get network configuration (includes contract addresses)
const arbitrumOne = await getArbitrumNetwork(42161);

console.log("Arbitrum One configuration:");
console.log(`  Inbox: ${arbitrumOne.ethBridge.inbox}`);
console.log(`  Outbox: ${arbitrumOne.ethBridge.outbox}`);
console.log(`  Rollup: ${arbitrumOne.ethBridge.rollup}`);
console.log(`  Token Bridge Router: ${arbitrumOne.tokenBridge.parentGatewayRouter}`);

// The SDK handles:
// - ETH deposits/withdrawals (EthBridger)
// - ERC-20 bridging with gateway routing (Erc20Bridger)
// - Cross-chain message status tracking
// - Retryable ticket creation and redemption
// - Gas estimation for cross-chain operations
```

### Monitoring Cross-Chain Messages

Track the status of L1→L2 messages (retryable tickets):

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus
} from "@arbitrum/sdk"; // @arbitrum/sdk@4.0.1

async function monitorDeposit(
  l1Provider: ethers.Provider,
  l2Provider: ethers.Provider,
  l1TxHash: string
): Promise<void> {
  // Get the L1 transaction receipt
  const l1Receipt = await l1Provider.getTransactionReceipt(l1TxHash);
  if (!l1Receipt) {
    throw new Error(`L1 transaction ${l1TxHash} not found`);
  }

  // Wrap in SDK receipt to extract cross-chain messages
  const parentReceipt = new ParentTransactionReceipt(l1Receipt);
  const messages = await parentReceipt.getParentToChildMessages(l2Provider);

  if (messages.length === 0) {
    console.log("No cross-chain messages found in this transaction.");
    return;
  }

  for (const message of messages) {
    console.log(`Retryable ticket found. Waiting for L2 execution...`);

    // Wait for the message to be executed on L2
    const messageResult = await message.waitForStatus();

    switch (messageResult.status) {
      case ParentToChildMessageStatus.REDEEMED:
        console.log("✅ Message successfully executed on L2!");
        break;
      case ParentToChildMessageStatus.EXPIRED:
        console.log("❌ Retryable ticket expired without redemption.");
        console.log("   Funds may be lost. Check if manual redemption is possible.");
        break;
      case ParentToChildMessageStatus.CREATION_FAILED:
        console.log("❌ Retryable ticket creation failed on L2.");
        break;
      default:
        console.log(`⏳ Status: ${messageResult.status}. Still pending.`);
    }
  }
}
```

### Hardhat Configuration for Arbitrum

Configure Hardhat to work with Arbitrum's networks:

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
      // Arbitrum supports all EVM versions up to Shanghai
      evmVersion: "shanghai"
    }
  },
  networks: {
    // Arbitrum One (mainnet)
    arbitrumOne: {
      url: "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    // Arbitrum Sepolia (testnet)
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    // Arbitrum Nova (AnyTrust chain — gaming/social)
    arbitrumNova: {
      url: "https://nova.arbitrum.io/rpc",
      chainId: 42170,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY ?? "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? ""
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      }
    ]
  }
};

export default config;
```

### Foundry Configuration for Arbitrum

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200
evm_version = "shanghai"

[rpc_endpoints]
arbitrum_one = "https://arb1.arbitrum.io/rpc"
arbitrum_sepolia = "https://sepolia-rollup.arbitrum.io/rpc"
arbitrum_nova = "https://nova.arbitrum.io/rpc"

[etherscan]
arbitrum_one = { key = "${ARBISCAN_API_KEY}", url = "https://api.arbiscan.io/api" }
arbitrum_sepolia = { key = "${ARBISCAN_API_KEY}", url = "https://api-sepolia.arbiscan.io/api" }
```

Deploy and verify with Foundry:

```shell
# Deploy to Arbitrum Sepolia
forge create src/MyContract.sol:MyContract \
  --rpc-url arbitrum_sepolia \
  --private-key $PRIVATE_KEY \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY
```

```
Expected output:
[⠊] Compiling...
[⠊] Compiling 1 files with 0.8.20
Deployer: 0xYourAddress
Deployed to: 0xContractAddress
Transaction hash: 0xTxHash
Starting contract verification...
Contract successfully verified!
```

### Block Explorers and Debugging

| Tool | URL | Purpose |
|---|---|---|
| Arbiscan | https://arbiscan.io | Primary block explorer (Etherscan-compatible) |
| Arbiscan Sepolia | https://sepolia.arbiscan.io | Testnet explorer |
| Arbitrum Bridge | https://bridge.arbitrum.io | Official bridge UI |
| Retryable Dashboard | https://retryable-dashboard.arbitrum.io | Monitor retryable ticket status |
| Arbitrum Orbit | https://orbit.arbitrum.io | Launch your own Arbitrum L3 |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Debugging: Check if a transaction is an L1→L2 retryable ticket
async function debugTransaction(
  provider: ethers.JsonRpcProvider,
  txHash: string
): Promise<void> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.log("Transaction not found. It may still be pending.");
    return;
  }

  console.log(`Status: ${receipt.status === 1 ? "Success" : "Reverted"}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  console.log(`Block: ${receipt.blockNumber}`);

  // Check for Arbitrum-specific transaction types
  const tx = await provider.getTransaction(txHash);
  if (tx) {
    console.log(`Type: ${tx.type}`);
    if (tx.type === 100) console.log("  → This is an L1→L2 deposit transaction");
    if (tx.type === 104) console.log("  → This is a retryable ticket redemption");
    if (tx.type === 105) console.log("  → This is a retryable ticket submission");
  }
}
```

### Arbitrum Precompile Addresses

Quick reference for Arbitrum-specific precompiles:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ArbitrumPrecompiles
/// @notice Reference for all Arbitrum precompile addresses
library ArbitrumPrecompiles {
    // ArbSys: L2 system calls (block numbers, withdrawals, messaging)
    address constant ARBSYS = address(100); // 0x64

    // ArbInfo: Account info
    address constant ARB_INFO = address(101); // 0x65

    // ArbAddressTable: Address compression for cheaper calldata
    address constant ARB_ADDRESS_TABLE = address(102); // 0x66

    // ArbOwner: Chain owner operations (governance)
    address constant ARB_OWNER = address(112); // 0x70

    // ArbGasInfo: Gas pricing information
    address constant ARB_GAS_INFO = address(108); // 0x6C

    // ArbRetryableTx: Retryable ticket management
    address constant ARB_RETRYABLE_TX = address(110); // 0x6E

    // NodeInterface: Off-chain gas estimation (not callable from contracts)
    address constant NODE_INTERFACE = address(200); // 0xC8
}
```

## Common Pitfalls

1. **Using the wrong Arbiscan API key format** — Arbiscan uses a separate API key from Etherscan. Register at https://arbiscan.io/apis to get one. The same key works for both Arbitrum One and Arbitrum Sepolia.

2. **Not installing `@arbitrum/sdk` peer dependencies** — The SDK requires `ethers@6.x`. If you're using ethers v5, you need `@arbitrum/sdk@3.x` instead. Version mismatch causes cryptic type errors.

3. **Forgetting to configure custom chains in Hardhat** — Arbitrum Sepolia isn't in Hardhat's default chain list. You must add it to `etherscan.customChains` for verification to work. Without this, `npx hardhat verify` fails silently.

4. **Not using the Retryable Dashboard for debugging** — When an L1→L2 deposit doesn't arrive, check https://retryable-dashboard.arbitrum.io first. It shows whether the ticket was created, auto-redeemed, or needs manual redemption.

5. **Calling NodeInterface from a contract** — The NodeInterface precompile at `0xC8` is only callable off-chain (via `eth_call`). Attempting to call it from a deployed contract will revert. Use it only in your frontend/backend code for gas estimation.

## What to Learn Next

- [Deployment Walkthrough with Gas Comparison](./05-deployment-walkthrough.md) — Deploy a contract to Arbitrum Sepolia with step-by-step commands and cost comparison to Ethereum
- [Arbitrum SDK Documentation](https://docs.arbitrum.io/sdk/overview) — Official SDK reference
- [Arbiscan API Documentation](https://docs.arbiscan.io/) — Block explorer API for building dApps
