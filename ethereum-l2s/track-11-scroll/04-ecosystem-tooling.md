# Scroll Ecosystem Tooling: SDKs, Explorers, and Dev Tools

**Track:** Scroll Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You're ready to build on Scroll, but you need to know what tools are available. Since Scroll is bytecode-equivalent to Ethereum, most Ethereum tooling works out of the box — but there are Scroll-specific tools for bridging, gas estimation, and proof tracking that you'll need. This lesson maps out the ecosystem: what works unchanged, what needs configuration, and what's Scroll-specific.

## Core Concepts

### Development Frameworks

Since Scroll uses standard EVM bytecode, all major Ethereum development frameworks work without modification:

```shell
# Hardhat — works out of the box, just add network config
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0

# Foundry — works out of the box, just specify RPC
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

```
Expected output (foundryup):
foundryup: installing foundry (version nightly-2024-01-15)
foundryup: done!
```

### Hardhat Configuration for Scroll

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

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
    scrollMainnet: {
      url: "https://rpc.scroll.io",
      chainId: 534352,
      accounts: [process.env.PRIVATE_KEY!],
      // Scroll supports EIP-1559
      // Gas settings are auto-detected by ethers.js
    },
    scrollSepolia: {
      url: "https://sepolia-rpc.scroll.io",
      chainId: 534351,
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  etherscan: {
    apiKey: {
      scrollMainnet: process.env.SCROLLSCAN_API_KEY!,
      scrollSepolia: process.env.SCROLLSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "scrollMainnet",
        chainId: 534352,
        urls: {
          apiURL: "https://api.scrollscan.com/api",
          browserURL: "https://scrollscan.com",
        },
      },
      {
        network: "scrollSepolia",
        chainId: 534351,
        urls: {
          apiURL: "https://api-sepolia.scrollscan.com/api",
          browserURL: "https://sepolia.scrollscan.com",
        },
      },
    ],
  },
};

export default config;
```

### Foundry Configuration for Scroll

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
scroll_mainnet = "https://rpc.scroll.io"
scroll_sepolia = "https://sepolia-rpc.scroll.io"

[etherscan]
scroll_mainnet = { key = "${SCROLLSCAN_API_KEY}", url = "https://api.scrollscan.com/api", chain = 534352 }
scroll_sepolia = { key = "${SCROLLSCAN_API_KEY}", url = "https://api-sepolia.scrollscan.com/api", chain = 534351 }
```

```shell
# Deploy with Foundry to Scroll Sepolia
forge create src/MyContract.sol:MyContract \
  --rpc-url scroll_sepolia \
  --private-key $PRIVATE_KEY \
  --verify \
  --verifier-url "https://api-sepolia.scrollscan.com/api" \
  --etherscan-api-key $SCROLLSCAN_API_KEY
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
Contract successfully verified!
```

### RPC Providers

```typescript
// rpc-providers.ts
// Multiple RPC options for Scroll (Last verified: 2025-01-15)

interface RPCProvider {
  name: string;
  mainnetUrl: string;
  sepoliaUrl: string;
  rateLimit: string;
  features: string[];
}

const scrollRPCProviders: RPCProvider[] = [
  {
    name: "Scroll Official",
    mainnetUrl: "https://rpc.scroll.io",
    sepoliaUrl: "https://sepolia-rpc.scroll.io",
    rateLimit: "Shared, best-effort",
    features: ["Free", "No API key required", "Rate limited"],
  },
  {
    name: "Alchemy",
    mainnetUrl: "https://scroll-mainnet.g.alchemy.com/v2/YOUR_KEY",
    sepoliaUrl: "https://scroll-sepolia.g.alchemy.com/v2/YOUR_KEY",
    rateLimit: "300 req/s (Growth plan)",
    features: ["Enhanced APIs", "Webhooks", "Debug/trace methods"],
  },
  {
    name: "Infura",
    mainnetUrl: "https://scroll-mainnet.infura.io/v3/YOUR_KEY",
    sepoliaUrl: "https://scroll-sepolia.infura.io/v3/YOUR_KEY",
    rateLimit: "100 req/s (Developer plan)",
    features: ["Archive data", "WebSocket support"],
  },
  {
    name: "Ankr",
    mainnetUrl: "https://rpc.ankr.com/scroll",
    sepoliaUrl: "https://rpc.ankr.com/scroll_sepolia",
    rateLimit: "30 req/s (free tier)",
    features: ["Free tier available", "Multi-chain"],
  },
  {
    name: "BlockPI",
    mainnetUrl: "https://scroll.blockpi.network/v1/rpc/public",
    sepoliaUrl: "https://scroll-sepolia.blockpi.network/v1/rpc/public",
    rateLimit: "20 req/s (free tier)",
    features: ["Free public endpoint", "Low latency"],
  },
];

// Recommendation for production:
// - Use Alchemy or Infura for reliability and enhanced APIs
// - Use Scroll Official RPC for development/testing only
// - Always configure a fallback RPC provider
```

### Block Explorers

```typescript
// explorers.ts
interface Explorer {
  name: string;
  mainnetUrl: string;
  sepoliaUrl: string;
  apiAvailable: boolean;
  features: string[];
}

const scrollExplorers: Explorer[] = [
  {
    name: "Scrollscan (Etherscan)",
    mainnetUrl: "https://scrollscan.com",
    sepoliaUrl: "https://sepolia.scrollscan.com",
    apiAvailable: true,
    features: [
      "Contract verification",
      "Read/Write contract interaction",
      "Token tracker",
      "API compatible with Etherscan",
    ],
  },
  {
    name: "Scroll Explorer (Official)",
    mainnetUrl: "https://scroll.io/rollupscan",
    sepoliaUrl: "https://sepolia.scroll.io/rollupscan",
    apiAvailable: false,
    features: [
      "Batch/chunk tracking",
      "Proof status monitoring",
      "L1↔L2 message tracking",
      "Rollup-specific data",
    ],
  },
  {
    name: "Dora Explorer",
    mainnetUrl: "https://www.ondora.xyz/network/scroll",
    sepoliaUrl: "https://www.ondora.xyz/network/scroll-sepolia",
    apiAvailable: false,
    features: [
      "Multi-chain explorer",
      "Advanced analytics",
      "Contract diff tools",
    ],
  },
];
```

### Contract Verification

```shell
# Verify with Hardhat
npx hardhat verify --network scrollSepolia 0xYOUR_CONTRACT_ADDRESS "Constructor" "Args"
```

```
Expected output:
Successfully submitted source code for contract
contracts/MyToken.sol:MyToken at 0xYOUR_CONTRACT_ADDRESS
for verification on the block explorer. Waiting for verification result...

Successfully verified contract MyToken on the block explorer.
https://sepolia.scrollscan.com/address/0xYOUR_CONTRACT_ADDRESS#code
```

```shell
# Verify with Foundry
forge verify-contract 0xYOUR_CONTRACT_ADDRESS src/MyToken.sol:MyToken \
  --chain-id 534351 \
  --verifier-url "https://api-sepolia.scrollscan.com/api" \
  --etherscan-api-key $SCROLLSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(string,string)" "MyToken" "MTK")
```

```
Expected output:
Start verifying contract `0xYOUR_CONTRACT_ADDRESS` deployed on scroll-sepolia
Submitting verification for [src/MyToken.sol:MyToken]...
Contract successfully verified
```

### Scroll SDK and Libraries

```typescript
// scroll-sdk-usage.ts
import { ethers } from "ethers";

// Scroll doesn't require a custom SDK for most operations.
// Standard ethers.js or viem works because Scroll is EVM-equivalent.

// For bridge operations, use the contract ABIs directly:
// https://docs.scroll.io/en/developers/scroll-contracts/

// For L1 fee estimation, interact with the L1GasPriceOracle:
const L1_GAS_PRICE_ORACLE = "0x5300000000000000000000000000000000000002";

const L1_ORACLE_ABI = [
  "function getL1Fee(bytes memory _data) view returns (uint256)",
  "function l1BaseFee() view returns (uint256)",
  "function overhead() view returns (uint256)",
  "function scalar() view returns (uint256)",
  "function getL1GasUsed(bytes memory _data) view returns (uint256)",
];

async function estimateScrollGasCost(
  provider: ethers.Provider,
  txData: string
): Promise<{ l2Gas: bigint; l1Fee: bigint; totalCost: bigint }> {
  const oracle = new ethers.Contract(L1_GAS_PRICE_ORACLE, L1_ORACLE_ABI, provider);

  // Get L1 data fee
  const l1Fee = await oracle.getL1Fee(txData);

  // Get L2 execution gas estimate (standard eth_estimateGas)
  const l2Gas = await provider.estimateGas({
    to: "0x0000000000000000000000000000000000000000",
    data: txData,
  });

  // Get current gas price on L2
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;

  const l2Cost = l2Gas * gasPrice;
  const totalCost = l2Cost + l1Fee;

  console.log(`L2 execution gas: ${l2Gas.toString()}`);
  console.log(`L2 execution cost: ${ethers.formatEther(l2Cost)} ETH`);
  console.log(`L1 data fee: ${ethers.formatEther(l1Fee)} ETH`);
  console.log(`Total cost: ${ethers.formatEther(totalCost)} ETH`);

  return { l2Gas, l1Fee, totalCost };
}
```

### Wallet Configuration

```typescript
// wallet-setup.ts
// Adding Scroll to MetaMask or any EVM wallet

interface NetworkConfig {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

const scrollMainnet: NetworkConfig = {
  chainId: "0x82750", // 534352 in hex
  chainName: "Scroll",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.scroll.io"],
  blockExplorerUrls: ["https://scrollscan.com"],
};

const scrollSepolia: NetworkConfig = {
  chainId: "0x8274F", // 534351 in hex
  chainName: "Scroll Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia-rpc.scroll.io"],
  blockExplorerUrls: ["https://sepolia.scrollscan.com"],
};

// Add network programmatically (for dApp integration)
async function addScrollNetwork(testnet: boolean = false): Promise<void> {
  const config = testnet ? scrollSepolia : scrollMainnet;

  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [config],
    });
    console.log(`${config.chainName} added to wallet`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("already exists")) {
        console.log(`${config.chainName} already configured`);
      } else {
        throw new Error(`Failed to add network: ${error.message}`);
      }
    }
  }
}
```

### Testnet Faucets

```typescript
// faucets.ts
// Getting testnet ETH on Scroll Sepolia (Last verified: 2025-01-15)

interface Faucet {
  name: string;
  url: string;
  amount: string;
  cooldown: string;
  requirements: string;
}

const scrollSepoliaFaucets: Faucet[] = [
  {
    name: "Scroll Official Faucet",
    url: "https://scroll.io/bridge",
    amount: "Bridge from Sepolia ETH",
    cooldown: "No cooldown (bridge)",
    requirements: "Sepolia ETH (get from Sepolia faucets first)",
  },
  {
    name: "Alchemy Scroll Sepolia Faucet",
    url: "https://www.alchemy.com/faucets/scroll-sepolia",
    amount: "0.1 ETH",
    cooldown: "24 hours",
    requirements: "Alchemy account",
  },
  {
    name: "Bware Labs Faucet",
    url: "https://bwarelabs.com/faucets/scroll-testnet",
    amount: "0.025 ETH",
    cooldown: "24 hours",
    requirements: "None",
  },
];

// Recommended approach:
// 1. Get Sepolia ETH from any Ethereum Sepolia faucet
// 2. Bridge to Scroll Sepolia via https://scroll.io/bridge
// This gives you the most ETH with no restrictions
```

### Subgraph and Indexing

```typescript
// indexing-options.ts
// Indexing data on Scroll

interface IndexingService {
  name: string;
  scrollSupport: string;
  setup: string;
}

const indexingOptions: IndexingService[] = [
  {
    name: "The Graph (Hosted Service)",
    scrollSupport: "Supported — Scroll mainnet and Sepolia",
    setup: "graph init --from-contract 0xYOUR_CONTRACT --network scroll",
  },
  {
    name: "Goldsky",
    scrollSupport: "Supported — subgraphs and Mirror pipelines",
    setup: "goldsky subgraph deploy my-subgraph/1.0.0 --from-abi ./abi.json",
  },
  {
    name: "Envio",
    scrollSupport: "Supported — HyperIndex for Scroll",
    setup: "npx envio init --chain scroll",
  },
  {
    name: "Alchemy Subgraphs",
    scrollSupport: "Supported via Alchemy's hosted subgraph service",
    setup: "Deploy via Alchemy dashboard",
  },
];
```

## Common Pitfalls

1. **Using the public RPC for production** — Scroll's official `rpc.scroll.io` is rate-limited and intended for development. For production dApps, use Alchemy, Infura, or another dedicated provider. Public RPCs can drop requests during high traffic.

2. **Forgetting to register custom chains for verification** — Hardhat's `etherscan` plugin doesn't know about Scroll by default. You must add `customChains` configuration with the correct API URL (`api.scrollscan.com`). Without this, `npx hardhat verify` will fail with "network not supported."

3. **Not accounting for L1 fee in gas estimates** — Standard `eth_estimateGas` returns only the L2 execution gas. The actual transaction cost includes the L1 data fee. Use the `L1GasPriceOracle` contract to get the full cost estimate, or rely on wallet auto-estimation which includes both components.

4. **Using outdated chain IDs** — Scroll's testnet has changed chain IDs across iterations. The current Scroll Sepolia testnet uses chain ID `534351`. Older tutorials may reference deprecated testnets. Always verify from [Scroll's official docs](https://docs.scroll.io/en/developers/developer-quickstart/).

5. **Assuming Scrollscan API is identical to Etherscan** — While Scrollscan uses the Etherscan codebase, some API endpoints may have different rate limits or missing features. Test your integration against the actual Scrollscan API before relying on it in production.

## What to Learn Next

- [Deployment Walkthrough on Scroll](./05-deployment-walkthrough.md) — Complete deployment with gas comparison
- [Scroll Developer Quickstart](https://docs.scroll.io/en/developers/developer-quickstart/) — Official getting-started guide
- [Scrollscan API Documentation](https://docs.scrollscan.com/) — API reference for contract verification and data queries
