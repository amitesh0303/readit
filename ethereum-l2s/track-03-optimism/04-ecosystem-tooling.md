# Optimism Ecosystem Tooling: SDKs, Explorers, and Dev Tools

**Track:** Optimism & OP Stack Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

You're ready to build on Optimism but you're not sure which tools to use. There's the Optimism SDK, viem's OP Stack extensions, multiple block explorers, and various testing approaches. You need to know which tools solve which problems, how they differ from standard Ethereum tooling, and how to set up a productive development environment specifically for OP Stack chains.

## Core Concepts

### The Optimism SDK (@eth-optimism/sdk)

The official SDK provides high-level abstractions for cross-chain operations:

```typescript
// @eth-optimism/sdk@3.3.1
// ethers@6.13.0
import { ethers } from "ethers";
import {
  CrossChainMessenger,
  MessageStatus,
  MessageDirection,
} from "@eth-optimism/sdk";

async function setupMessenger() {
  const l1Provider = new ethers.JsonRpcProvider(
    `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const l2Provider = new ethers.JsonRpcProvider(
    "https://sepolia.optimism.io"
  );

  const l1Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);
  const l2Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  const messenger = new CrossChainMessenger({
    l1ChainId: 11155111,  // Sepolia
    l2ChainId: 11155420,  // OP Sepolia
    l1SignerOrProvider: l1Wallet,
    l2SignerOrProvider: l2Wallet,
    bedrock: true,
  });

  // Get all messages sent by an address
  try {
    const sentMessages = await messenger.getMessagesByAddress(
      l1Wallet.address,
      { direction: MessageDirection.L1_TO_L2 }
    );
    console.log("Messages sent L1→L2:", sentMessages.length);

    // Check balances on both chains
    const l1Balance = await l1Provider.getBalance(l1Wallet.address);
    const l2Balance = await l2Provider.getBalance(l2Wallet.address);
    console.log("L1 balance:", ethers.formatEther(l1Balance), "ETH");
    console.log("L2 balance:", ethers.formatEther(l2Balance), "ETH");
  } catch (error) {
    if (error instanceof Error) {
      console.error("SDK error:", error.message);
    }
    throw error;
  }

  return messenger;
}

setupMessenger().catch(console.error);
```

### Viem OP Stack Extensions

Viem provides first-class OP Stack support with type-safe chain definitions:

```typescript
// viem@2.21.0
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimism, optimismSepolia } from "viem/chains";
import {
  publicActionsL2,
  walletActionsL2,
  getL2TransactionHashes,
} from "viem/op-stack";

// Create an OP-aware public client
const publicClient = createPublicClient({
  chain: optimismSepolia,
  transport: http("https://sepolia.optimism.io"),
}).extend(publicActionsL2());

// Create an OP-aware wallet client
const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
const walletClient = createWalletClient({
  account,
  chain: optimismSepolia,
  transport: http("https://sepolia.optimism.io"),
}).extend(walletActionsL2());

async function viemOPExample() {
  try {
    // Get gas estimate including L1 data fee
    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: "0x0000000000000000000000000000000000000000",
      value: parseEther("0.001"),
    });
    console.log("Gas estimate (L2 units):", gasEstimate);

    // Get the L1 base fee from the GasPriceOracle
    const l1BaseFee = await publicClient.readContract({
      address: "0x420000000000000000000000000000000000000F",
      abi: [
        {
          name: "l1BaseFee",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "l1BaseFee",
    });
    console.log("L1 base fee:", formatEther(l1BaseFee), "ETH");

    // Get current block with OP-specific fields
    const block = await publicClient.getBlock();
    console.log("L2 block:", block.number);
    console.log("L2 timestamp:", new Date(Number(block.timestamp) * 1000));
  } catch (error) {
    console.error("Viem OP error:", error);
    throw error;
  }
}

viemOPExample().catch(console.error);
```

### Block Explorers

Optimism has multiple block explorers for different use cases:

```typescript
// Helper: Generate explorer URLs for OP Stack chains
// Last verified: 2025-01-15

interface ExplorerConfig {
  name: string;
  baseUrl: string;
  apiUrl: string;
  apiKeyEnv: string;
}

const OP_EXPLORERS: Record<string, ExplorerConfig> = {
  optimism: {
    name: "Optimistic Etherscan",
    baseUrl: "https://optimistic.etherscan.io",
    apiUrl: "https://api-optimistic.etherscan.io/api",
    apiKeyEnv: "OPTIMISTIC_ETHERSCAN_API_KEY",
  },
  optimismSepolia: {
    name: "OP Sepolia Etherscan",
    baseUrl: "https://sepolia-optimism.etherscan.io",
    apiUrl: "https://api-sepolia-optimistic.etherscan.io/api",
    apiKeyEnv: "OPTIMISTIC_ETHERSCAN_API_KEY",
  },
  blockscout: {
    name: "Blockscout (OP Mainnet)",
    baseUrl: "https://optimism.blockscout.com",
    apiUrl: "https://optimism.blockscout.com/api",
    apiKeyEnv: "", // No API key needed
  },
};

function getExplorerUrl(
  network: string,
  type: "tx" | "address" | "token",
  value: string
): string {
  const explorer = OP_EXPLORERS[network];
  if (!explorer) throw new Error(`Unknown network: ${network}`);
  return `${explorer.baseUrl}/${type}/${value}`;
}

// Usage
console.log(getExplorerUrl("optimism", "tx", "0x123..."));
// https://optimistic.etherscan.io/tx/0x123...
```

### Hardhat Configuration for Optimism

```typescript
// hardhat.config.ts
// hardhat@2.22.0
// @nomicfoundation/hardhat-toolbox@5.0.0
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun", // OP Stack supports Cancun opcodes
    },
  },
  networks: {
    optimismMainnet: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 10,
      gasPrice: "auto",
    },
    optimismSepolia: {
      url: `https://opt-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 11155420,
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY!,
      optimismSepolia: process.env.OPTIMISTIC_ETHERSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "optimismSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io",
        },
      },
    ],
  },
};

export default config;
```

### Foundry Configuration for Optimism

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
optimism = "https://mainnet.optimism.io"
optimism_sepolia = "https://sepolia.optimism.io"

[etherscan]
optimism = { key = "${OPTIMISTIC_ETHERSCAN_API_KEY}", url = "https://api-optimistic.etherscan.io/api" }
optimism_sepolia = { key = "${OPTIMISTIC_ETHERSCAN_API_KEY}", url = "https://api-sepolia-optimistic.etherscan.io/api" }
```

```bash
# Foundry commands for Optimism development
# Last verified: 2025-01-15

# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Create new project
forge init my-op-project
cd my-op-project

# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2

# Compile
forge build

# Test locally (forks OP Mainnet state)
forge test --fork-url https://mainnet.optimism.io -vvv

# Deploy to OP Sepolia
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://sepolia.optimism.io \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $OPTIMISTIC_ETHERSCAN_API_KEY \
  -vvvv
```

### Testing with Forked State

```typescript
// test/MyContract.test.ts
// hardhat@2.22.0
import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("MyContract on Optimism Fork", function () {
  before(async function () {
    // Fork OP Mainnet at a specific block for reproducible tests
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
            blockNumber: 115000000, // Pin to specific block
          },
        },
      ],
    });
  });

  it("should read L1 block info from predeploy", async function () {
    const l1Block = await ethers.getContractAt(
      ["function number() view returns (uint64)"],
      "0x4200000000000000000000000000000000000015"
    );

    const l1Number = await l1Block.number();
    expect(l1Number).to.be.greaterThan(0);
  });

  it("should read gas price oracle", async function () {
    const oracle = await ethers.getContractAt(
      [
        "function l1BaseFee() view returns (uint256)",
        "function baseFeeScalar() view returns (uint32)",
      ],
      "0x420000000000000000000000000000000000000F"
    );

    const l1BaseFee = await oracle.l1BaseFee();
    expect(l1BaseFee).to.be.greaterThan(0);
  });
});
```

### Monitoring and Debugging

```typescript
// scripts/monitor-op.ts
// ethers@6.13.0
import { ethers } from "ethers";

async function monitorOptimism() {
  const provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

  // Subscribe to new blocks
  provider.on("block", async (blockNumber: number) => {
    const block = await provider.getBlock(blockNumber);
    if (!block) return;

    console.log(`Block ${blockNumber}:`, {
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      transactions: block.transactions.length,
      gasUsed: block.gasUsed.toString(),
      gasLimit: block.gasLimit.toString(),
    });
  });

  // Monitor specific contract events
  const contractAddress = "0xYourContractAddress";
  const contract = new ethers.Contract(
    contractAddress,
    ["event Transfer(address indexed from, address indexed to, uint256 value)"],
    provider
  );

  contract.on("Transfer", (from, to, value, event) => {
    console.log("Transfer detected:", {
      from,
      to,
      value: ethers.formatEther(value),
      txHash: event.log.transactionHash,
      block: event.log.blockNumber,
    });
  });

  console.log("Monitoring Optimism... (Ctrl+C to stop)");
}

monitorOptimism().catch(console.error);
```

## Common Pitfalls

1. **Using the wrong chain ID** — OP Mainnet is chain ID 10, OP Sepolia is 11155420. Confusing these will send transactions to the wrong network. Always verify chain ID in your config before deploying.

2. **Not setting up contract verification** — Optimism uses Optimistic Etherscan (separate from regular Etherscan). You need a separate API key from [https://optimistic.etherscan.io/](https://optimistic.etherscan.io/). Without verification, users can't read your contract source on the explorer.

3. **Forgetting to test with forked state** — Local Hardhat/Anvil tests don't include OP Stack predeploys. Always fork OP Mainnet or Sepolia to test interactions with the GasPriceOracle, L1Block, or bridge contracts. Pin to a specific block number for reproducibility.

4. **Not accounting for L1 data fees in gas estimation** — Standard `eth_estimateGas` returns L2 execution gas only. For accurate cost estimates, also query the GasPriceOracle's `getL1Fee()` with your transaction data. This is especially important for data-heavy transactions.

5. **Using outdated SDK versions** — The Optimism SDK has gone through major changes (pre-Bedrock → Bedrock → Fault Proofs). Always use `@eth-optimism/sdk@3.x` for current OP Stack chains. Older versions may use deprecated contract interfaces.

## What to Learn Next

- [Deployment Walkthrough with Gas Comparison](./05-deployment-walkthrough.md) — deploy a contract to OP Sepolia and compare costs with Ethereum mainnet
- [Optimism Developer Docs](https://docs.optimism.io/builders/app-developers/overview) — official developer documentation
- [OP Stack GitHub](https://github.com/ethereum-optimism/optimism) — monorepo containing all OP Stack components
