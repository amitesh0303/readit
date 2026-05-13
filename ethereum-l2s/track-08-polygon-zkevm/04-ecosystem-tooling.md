# Polygon zkEVM Ecosystem Tooling

**Track:** Polygon zkEVM Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You're ready to build on Polygon zkEVM but don't know which tools to use. Since Polygon zkEVM is EVM-equivalent, most Ethereum tools work — but which ones have native support? Which block explorers show zkEVM-specific data like batch proofs and L1 verification status? What SDKs provide bridge integration? How do you set up Hardhat or Foundry for Polygon zkEVM deployment? This lesson maps out the complete developer tooling landscape.

## Core Concepts

### Development Frameworks

Since Polygon zkEVM uses standard EVM bytecode, both Hardhat and Foundry work without special plugins:

#### Hardhat Configuration

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
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "shanghai",
    },
  },
  networks: {
    // Polygon zkEVM Mainnet
    polygonZkEvm: {
      url: "https://zkevm-rpc.com",
      chainId: 1101,
      accounts: [process.env.PRIVATE_KEY!],
      gasPrice: "auto",
    },
    // Polygon zkEVM Cardona Testnet
    polygonZkEvmCardona: {
      url: "https://rpc.cardona.zkevm-rpc.com",
      chainId: 2442,
      accounts: [process.env.PRIVATE_KEY!],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      // Polygon zkEVM uses its own explorer API
      polygonZkEvm: process.env.POLYGONSCAN_ZKEVM_API_KEY!,
      polygonZkEvmCardona: process.env.POLYGONSCAN_ZKEVM_API_KEY!,
    },
    customChains: [
      {
        network: "polygonZkEvm",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api",
          browserURL: "https://zkevm.polygonscan.com",
        },
      },
      {
        network: "polygonZkEvmCardona",
        chainId: 2442,
        urls: {
          apiURL: "https://api-cardona-zkevm.polygonscan.com/api",
          browserURL: "https://cardona-zkevm.polygonscan.com",
        },
      },
    ],
  },
};

export default config;
```

#### Foundry Configuration

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
evm_version = "shanghai"

[rpc_endpoints]
polygon_zkevm = "https://zkevm-rpc.com"
polygon_zkevm_cardona = "https://rpc.cardona.zkevm-rpc.com"

[etherscan]
polygon_zkevm = { key = "${POLYGONSCAN_ZKEVM_API_KEY}", url = "https://api-zkevm.polygonscan.com/api", chain = 1101 }
polygon_zkevm_cardona = { key = "${POLYGONSCAN_ZKEVM_API_KEY}", url = "https://api-cardona-zkevm.polygonscan.com/api", chain = 2442 }
```

```shell
# Deploy with Foundry
forge create src/MyContract.sol:MyContract \
  --rpc-url polygon_zkevm_cardona \
  --private-key $PRIVATE_KEY \
  --constructor-args "arg1" "arg2" \
  --verify
```

```
Expected output:
[⠊] Compiling...
[⠒] Compiling 1 files with Solc 0.8.24
[⠑] Solc 0.8.24 finished in 1.23s
Deployer: 0xYourAddress
Deployed to: 0xContractAddress
Transaction hash: 0xabc123...
Starting contract verification...
Contract verified!
```

### Block Explorers

| Explorer | URL | Features |
|----------|-----|----------|
| PolygonScan zkEVM | https://zkevm.polygonscan.com | Contract verification, tx details, token tracking |
| PolygonScan Cardona | https://cardona-zkevm.polygonscan.com | Testnet explorer |
| Blockscout zkEVM | https://zkevm.blockscout.com | Alternative explorer with API |

The PolygonScan zkEVM explorer shows zkEVM-specific information:
- **Batch number**: Which L2 batch contains the transaction
- **Sequence TX**: The L1 transaction that sequenced the batch
- **Verify TX**: The L1 transaction that verified the ZK proof
- **State**: Trusted → Virtual → Consolidated

```typescript
// Query batch information via RPC
import { ethers } from "ethers"; // ethers@6.9.0

const provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");

// Get current batch number
const batchNumber = await provider.send("zkevm_batchNumber", []);
console.log(`Current batch: ${parseInt(batchNumber, 16)}`);

// Get batch details
const batchDetails = await provider.send("zkevm_getBatchByNumber", [batchNumber, true]);
console.log(`Batch ${parseInt(batchNumber, 16)}:`);
console.log(`  Transactions: ${batchDetails.transactions.length}`);
console.log(`  Timestamp: ${new Date(parseInt(batchDetails.timestamp, 16) * 1000).toISOString()}`);
console.log(`  Global exit root: ${batchDetails.globalExitRoot}`);
console.log(`  Coinbase: ${batchDetails.coinbase}`);

// Check if a batch is verified (consolidated)
const verifiedBatch = await provider.send("zkevm_verifiedBatchNumber", []);
console.log(`Last verified batch: ${parseInt(verifiedBatch, 16)}`);
console.log(`Batches pending verification: ${parseInt(batchNumber, 16) - parseInt(verifiedBatch, 16)}`);
```

### RPC Providers

| Provider | Endpoint | Free Tier |
|----------|----------|-----------|
| Public RPC | https://zkevm-rpc.com | Unlimited (rate limited) |
| Alchemy | https://polygonzkevm-mainnet.g.alchemy.com/v2/KEY | 300M compute units/month |
| Infura | https://polygon-zkevm-mainnet.infura.io/v3/KEY | 100K requests/day |
| QuickNode | Custom endpoint | 10M API credits/month |
| Chainstack | Custom endpoint | 3M requests/month |

```typescript
// Provider setup with fallback
import { ethers } from "ethers"; // ethers@6.9.0

// Primary: Alchemy (fastest, most reliable)
const primary = new ethers.JsonRpcProvider(
  `https://polygonzkevm-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
);

// Fallback: Public RPC
const fallback = new ethers.JsonRpcProvider("https://zkevm-rpc.com");

// Use FallbackProvider for reliability
const provider = new ethers.FallbackProvider([
  { provider: primary, priority: 1, stallTimeout: 2000 },
  { provider: fallback, priority: 2, stallTimeout: 4000 },
]);

const block = await provider.getBlock("latest");
console.log(`Latest block: ${block?.number}`);
```

### Polygon zkEVM-Specific RPC Methods

Polygon zkEVM extends the standard Ethereum JSON-RPC with additional methods:

```typescript
// zkEVM-specific RPC methods
import { ethers } from "ethers"; // ethers@6.9.0

const provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");

// Get the current batch number
const batchNum = await provider.send("zkevm_batchNumber", []);
console.log(`Batch: ${parseInt(batchNum, 16)}`);

// Get the last verified batch number (consolidated state)
const verifiedBatch = await provider.send("zkevm_verifiedBatchNumber", []);
console.log(`Verified: ${parseInt(verifiedBatch, 16)}`);

// Get the last virtual batch number (data posted to L1)
const virtualBatch = await provider.send("zkevm_virtualBatchNumber", []);
console.log(`Virtual: ${parseInt(virtualBatch, 16)}`);

// Check if an exit/withdrawal is ready to claim
const isExitReady = await provider.send("zkevm_isBlockConsolidated", [
  "0x" + (12345).toString(16), // block number in hex
]);
console.log(`Block consolidated: ${isExitReady}`);

// Get batch by number with full transaction objects
const batch = await provider.send("zkevm_getBatchByNumber", [
  batchNum,
  true, // include full tx objects
]);
console.log(`Batch coinbase: ${batch.coinbase}`);
console.log(`Batch state root: ${batch.stateRoot}`);
```

### Wallet Configuration

MetaMask and other wallets need manual network configuration:

```typescript
// Add Polygon zkEVM to MetaMask programmatically
async function addPolygonZkEVM(): Promise<void> {
  if (typeof window.ethereum === "undefined") {
    throw new Error("MetaMask not installed");
  }

  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x44D",  // 1101 in hex
          chainName: "Polygon zkEVM",
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: ["https://zkevm-rpc.com"],
          blockExplorerUrls: ["https://zkevm.polygonscan.com"],
        },
      ],
    });
    console.log("Polygon zkEVM added to MetaMask");
  } catch (error) {
    if (error instanceof Error) {
      if ((error as any).code === 4001) {
        console.log("User rejected the request");
      } else {
        throw error;
      }
    }
  }
}

// Add Cardona testnet
async function addCardoraTestnet(): Promise<void> {
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: "0x98A",  // 2442 in hex
        chainName: "Polygon zkEVM Cardona Testnet",
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18,
        },
        rpcUrls: ["https://rpc.cardona.zkevm-rpc.com"],
        blockExplorerUrls: ["https://cardona-zkevm.polygonscan.com"],
      },
    ],
  });
}
```

### Faucets and Testnet ETH

| Faucet | URL | Amount | Frequency |
|--------|-----|--------|-----------|
| Polygon Faucet | https://faucet.polygon.technology/ | 0.025 ETH | Every 24h |
| Cardona Bridge | Bridge from Sepolia via official bridge | Unlimited | N/A |

*Last verified: 2025-01-15*

```shell
# Alternative: Bridge Sepolia ETH to Cardona testnet
# 1. Get Sepolia ETH from any Sepolia faucet
# 2. Use the bridge UI: https://bridge-ui.cardona.zkevm-rpc.com/
# 3. Bridge Sepolia ETH → Cardona zkEVM ETH
```

### Oracles and Data Feeds

Chainlink provides price feeds on Polygon zkEVM:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts@1.1.0/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title PriceFeedConsumer
/// @notice Read Chainlink price feeds on Polygon zkEVM
contract PriceFeedConsumer {
    // ETH/USD on Polygon zkEVM mainnet
    AggregatorV3Interface internal immutable priceFeed;

    constructor(address feedAddress) {
        // ETH/USD: 0x97d9F9A00dEE0004BE8ca0A8fa374d486567eE2D (Polygon zkEVM mainnet)
        priceFeed = AggregatorV3Interface(feedAddress);
    }

    /// @notice Get the latest ETH/USD price
    /// @return price The price with 8 decimals
    function getLatestPrice() external view returns (int256 price) {
        (
            /* uint80 roundID */,
            price,
            /* uint256 startedAt */,
            uint256 updatedAt,
            /* uint80 answeredInRound */
        ) = priceFeed.latestRoundData();

        // Verify the price is fresh (within 1 hour)
        require(block.timestamp - updatedAt < 3600, "Stale price feed");
        require(price > 0, "Invalid price");

        return price;
    }
}
```

### Subgraph and Indexing

The Graph supports Polygon zkEVM for indexing on-chain data:

```yaml
# subgraph.yaml for Polygon zkEVM
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: MyContract
    network: polygon-zkevm  # Network name for The Graph
    source:
      address: "0xYourContractAddress"
      abi: MyContract
      startBlock: 1000000
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Transfer
      abis:
        - name: MyContract
          file: ./abis/MyContract.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
      file: ./src/mapping.ts
```

```shell
# Deploy subgraph to The Graph's hosted service
graph deploy --product hosted-service your-name/polygon-zkevm-subgraph
```

```
Expected output:
✔ Upload subgraph to IPFS
Build completed: QmXyz...
Deployed to https://thegraph.com/hosted-service/subgraph/your-name/polygon-zkevm-subgraph
```

## Common Pitfalls

1. **Using Polygon PoS RPC endpoints for zkEVM** — Polygon PoS (`https://polygon-rpc.com`, chain 137) and Polygon zkEVM (`https://zkevm-rpc.com`, chain 1101) are completely different networks. Double-check your RPC URL matches the chain you intend to deploy to.

2. **Not configuring custom chains for verification** — Hardhat's `hardhat-verify` plugin doesn't know about Polygon zkEVM by default. You must add it as a custom chain in `etherscan.customChains` with the correct API URL (`api-zkevm.polygonscan.com`), or verification will fail silently.

3. **Expecting zkEVM-specific RPC methods on standard providers** — Methods like `zkevm_batchNumber` and `zkevm_getBatchByNumber` are only available on Polygon zkEVM nodes. Standard Ethereum RPC providers may not expose these. Use the public RPC or a provider that explicitly supports zkEVM extensions.

4. **Forgetting that Polygon zkEVM uses ETH for gas** — Unlike Polygon PoS (which uses MATIC), Polygon zkEVM uses ETH as the native gas token. Make sure your wallet has ETH on the zkEVM network, not MATIC.

5. **Using outdated Chainlink feed addresses** — Chainlink feed addresses differ between Polygon PoS and Polygon zkEVM. Always verify the correct feed address from the [Chainlink docs for Polygon zkEVM](https://docs.chain.link/data-feeds/price-feeds/addresses?network=polygon-zkevm).

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — Complete testnet deployment with gas comparison
- [Polygon zkEVM Developer Docs](https://docs.polygon.technology/zkEVM/) — Official documentation
- [Chainlink on Polygon zkEVM](https://docs.chain.link/data-feeds/price-feeds/addresses?network=polygon-zkevm) — Available price feeds
- [The Graph on Polygon zkEVM](https://thegraph.com/docs/en/developing/supported-networks/) — Subgraph deployment guide
