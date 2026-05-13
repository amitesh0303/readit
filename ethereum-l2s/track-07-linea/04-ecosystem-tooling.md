# Linea Ecosystem Tooling: SDKs, Explorers, and Developer Tools

**Track:** Linea Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

You're ready to build on Linea but need to know what tools are available. Unlike some L2s that require custom toolchains, Linea's EVM equivalence means most Ethereum tools work out of the box. But there are Linea-specific tools, RPC endpoints, explorers, and SDKs that make development smoother. You need to know which tools to use, how to configure them for Linea, and what Linea-specific capabilities exist beyond standard Ethereum tooling.

## Core Concepts

### RPC Endpoints and Providers

Linea offers multiple RPC options, with Infura as the primary provider (both from Consensys):

```typescript
// tooling/providers.ts
import { ethers } from "ethers";

// Option 1: Infura (recommended — same company as Linea)
// Free tier: 100,000 requests/day
const infuraMainnet = new ethers.JsonRpcProvider(
  `https://linea-mainnet.infura.io/v3/${process.env.INFURA_KEY}`
);
const infuraSepolia = new ethers.JsonRpcProvider(
  `https://linea-sepolia.infura.io/v3/${process.env.INFURA_KEY}`
);

// Option 2: Public RPC (rate-limited, for quick testing only)
const publicMainnet = new ethers.JsonRpcProvider(
  "https://rpc.linea.build"
);
const publicSepolia = new ethers.JsonRpcProvider(
  "https://rpc.sepolia.linea.build"
);

// Option 3: Alchemy
const alchemyMainnet = new ethers.JsonRpcProvider(
  `https://linea-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
);

// Network details
const LINEA_MAINNET = {
  chainId: 59144,
  name: "Linea Mainnet",
  rpc: "https://rpc.linea.build",
  explorer: "https://lineascan.build",
  bridge: "https://bridge.linea.build",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
};

const LINEA_SEPOLIA = {
  chainId: 59141,
  name: "Linea Sepolia",
  rpc: "https://rpc.sepolia.linea.build",
  explorer: "https://sepolia.lineascan.build",
  faucet: "https://faucet.goerli.linea.build", // Last verified: 2025-01-15
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
};

// Verify connection
async function checkConnection() {
  const provider = infuraSepolia;
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();
  const feeData = await provider.getFeeData();

  console.log(`Connected to: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Latest block: ${blockNumber}`);
  console.log(`Gas price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} gwei`);
  console.log(`Max fee: ${ethers.formatUnits(feeData.maxFeePerGas || 0n, "gwei")} gwei`);
}

checkConnection().catch(console.error);
```

```shell
npx ts-node tooling/providers.ts
```

```
Expected output:
Connected to: linea-sepolia (chainId: 59141)
Latest block: 4523891
Gas price: 0.072 gwei
Max fee: 0.144 gwei
```

### Hardhat Configuration

Standard Hardhat works with Linea — no plugins required beyond the standard setup:

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
      evmVersion: "paris", // or "shanghai" — Linea supports both
    },
  },
  networks: {
    lineaMainnet: {
      url: `https://linea-mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 59144,
      // Gas settings — Linea has very low gas prices
      gasPrice: "auto",
    },
    lineaSepolia: {
      url: `https://linea-sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 59141,
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      // Lineascan uses a separate API key from Etherscan
      lineaMainnet: process.env.LINEASCAN_API_KEY!,
      lineaSepolia: process.env.LINEASCAN_API_KEY!,
    },
    customChains: [
      {
        network: "lineaMainnet",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
      {
        network: "lineaSepolia",
        chainId: 59141,
        urls: {
          apiURL: "https://api-sepolia.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build",
        },
      },
    ],
  },
};

export default config;
```

### Foundry Configuration

Foundry works seamlessly with Linea:

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
evm_version = "paris"

[rpc_endpoints]
linea_mainnet = "https://linea-mainnet.infura.io/v3/${INFURA_KEY}"
linea_sepolia = "https://linea-sepolia.infura.io/v3/${INFURA_KEY}"

[etherscan]
linea_mainnet = { key = "${LINEASCAN_API_KEY}", url = "https://api.lineascan.build/api" }
linea_sepolia = { key = "${LINEASCAN_API_KEY}", url = "https://api-sepolia.lineascan.build/api" }
```

```shell
# Deploy with Foundry
forge create src/MyContract.sol:MyContract \
  --rpc-url linea_sepolia \
  --private-key $PRIVATE_KEY \
  --verify \
  --verifier-url https://api-sepolia.lineascan.build/api \
  --etherscan-api-key $LINEASCAN_API_KEY
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

### Block Explorers

```typescript
// tooling/explorer-links.ts

// Primary explorer: Lineascan (Etherscan-based)
const LINEASCAN = {
  mainnet: "https://lineascan.build",
  sepolia: "https://sepolia.lineascan.build",
  api: {
    mainnet: "https://api.lineascan.build/api",
    sepolia: "https://api-sepolia.lineascan.build/api",
  },
  features: [
    "Contract verification",
    "Token tracking",
    "Internal transactions",
    "Event logs",
    "Read/Write contract interaction",
  ],
};

// Alternative explorer: L2Scan
const L2SCAN = {
  mainnet: "https://linea.l2scan.co",
  features: [
    "Batch tracking",
    "L1↔L2 message status",
    "Proof verification status",
  ],
};

// Generate explorer links
function explorerLink(
  address: string,
  type: "address" | "tx" | "token" = "address",
  network: "mainnet" | "sepolia" = "sepolia"
): string {
  const base = network === "mainnet"
    ? LINEASCAN.mainnet
    : LINEASCAN.sepolia;
  return `${base}/${type}/${address}`;
}

console.log(explorerLink("0xAbCd...1234", "address", "sepolia"));
// https://sepolia.lineascan.build/address/0xAbCd...1234
```

### MetaMask Integration

Since Linea is built by Consensys (MetaMask's parent), it has native support:

```typescript
// tooling/metamask-add-network.ts
// This runs in a browser environment with MetaMask installed

async function addLineaToMetaMask(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  try {
    // Linea is pre-configured in MetaMask — just switch to it
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xE708" }], // 59144 in hex
    });
    console.log("Switched to Linea Mainnet");
  } catch (switchError: any) {
    // If Linea isn't added yet (shouldn't happen with recent MetaMask)
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xE708",
            chainName: "Linea Mainnet",
            nativeCurrency: {
              name: "ETH",
              symbol: "ETH",
              decimals: 18,
            },
            rpcUrls: ["https://rpc.linea.build"],
            blockExplorerUrls: ["https://lineascan.build"],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

// For Linea Sepolia testnet
async function addLineaSepoliaToMetaMask(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xE705" }], // 59141 in hex
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xE705",
            chainName: "Linea Sepolia",
            nativeCurrency: {
              name: "ETH",
              symbol: "ETH",
              decimals: 18,
            },
            rpcUrls: ["https://rpc.sepolia.linea.build"],
            blockExplorerUrls: ["https://sepolia.lineascan.build"],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}
```

### Linea SDK

The official Linea SDK provides utilities for bridging and message passing:

```shell
npm install @consensys/linea-sdk@0.3.0 ethers@6.9.0
```

```
Expected output:
added 45 packages, and audited 46 packages in 5s
found 0 vulnerabilities
```

```typescript
// tooling/linea-sdk-usage.ts
import { LineaSDK, OnChainMessageStatus } from "@consensys/linea-sdk@0.3.0";
import { ethers } from "ethers";

async function checkMessageStatus(messageHash: string) {
  const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const l2Provider = new ethers.JsonRpcProvider(
    `https://linea-sepolia.infura.io/v3/${process.env.INFURA_KEY}`
  );

  const sdk = new LineaSDK({
    l1: {
      provider: l1Provider,
      contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
    },
    l2: {
      provider: l2Provider,
      contractAddress: "0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec",
    },
  });

  const status = await sdk.getMessageStatus(messageHash);

  switch (status) {
    case OnChainMessageStatus.UNKNOWN:
      console.log("Message not found — check the hash");
      break;
    case OnChainMessageStatus.CLAIMABLE:
      console.log("Message is claimable — proof verified, ready to claim on L1");
      break;
    case OnChainMessageStatus.CLAIMED:
      console.log("Message already claimed — withdrawal complete");
      break;
    default:
      console.log(`Status: ${status}`);
  }
}

checkMessageStatus("0xYOUR_MESSAGE_HASH").catch(console.error);
```

### Verax Attestation Registry

Linea includes Verax, an on-chain attestation registry for identity and reputation:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for reading Verax attestations on Linea
/// Verax allows dApps to check user attestations (KYC, reputation, etc.)
interface IVeraxAttestationRegistry {
    struct Attestation {
        bytes32 schemaId;
        address attester;
        address subject;
        uint64 attestedDate;
        uint64 expirationDate;
        bytes attestationData;
    }

    function getAttestation(
        bytes32 attestationId
    ) external view returns (Attestation memory);
}

/// @notice Example: Gate a function based on Verax attestation
contract AttestationGated {
    IVeraxAttestationRegistry public immutable verax;
    bytes32 public immutable requiredSchema;

    error MissingAttestation();
    error ExpiredAttestation();

    constructor(address veraxAddress, bytes32 schemaId) {
        verax = IVeraxAttestationRegistry(veraxAddress);
        requiredSchema = schemaId;
    }

    modifier onlyAttested(bytes32 attestationId) {
        IVeraxAttestationRegistry.Attestation memory att = verax.getAttestation(attestationId);
        if (att.subject != msg.sender) revert MissingAttestation();
        if (att.schemaId != requiredSchema) revert MissingAttestation();
        if (att.expirationDate != 0 && att.expirationDate < block.timestamp) {
            revert ExpiredAttestation();
        }
        _;
    }

    function protectedAction(bytes32 attestationId) external onlyAttested(attestationId) {
        // Only users with valid attestation can call this
    }
}
```

### Useful CLI Commands

```shell
# Check Linea Sepolia balance using cast (Foundry)
cast balance 0xYourAddress --rpc-url https://rpc.sepolia.linea.build

# Get current gas price
cast gas-price --rpc-url https://rpc.sepolia.linea.build

# Get latest block number
cast block-number --rpc-url https://rpc.sepolia.linea.build

# Call a view function
cast call 0xContractAddress "balanceOf(address)(uint256)" 0xYourAddress \
  --rpc-url https://rpc.sepolia.linea.build

# Send a transaction
cast send 0xContractAddress "transfer(address,uint256)" 0xRecipient 1000000000000000000 \
  --rpc-url https://rpc.sepolia.linea.build \
  --private-key $PRIVATE_KEY
```

```
Expected output (balance check):
500000000000000000  # 0.5 ETH in wei
```

### Tool Compatibility Matrix

```
Tool                    Linea Support    Notes
─────────────────────────────────────────────────────────
Hardhat                 ✅ Full          Standard config, no plugins needed
Foundry                 ✅ Full          forge, cast, anvil all work
Remix IDE               ✅ Full          Deploy via Injected Provider
OpenZeppelin            ✅ Full          All contracts compatible
Chainlink               ✅ Partial       Price feeds available, VRF check status
The Graph               ✅ Full          Subgraph indexing supported
Tenderly                ✅ Full          Simulation and debugging
Alchemy                 ✅ Full          RPC + enhanced APIs
Infura                  ✅ Full          Native support (same company)
MetaMask                ✅ Native        Built-in network, no manual add
Safe{Wallet}            ✅ Full          Multisig support
Ethers.js               ✅ Full          Standard provider
Viem                    ✅ Full          Chain definition included
Wagmi                   ✅ Full          Linea chain config available
```

## Common Pitfalls

1. **Using the wrong Lineascan API key** — Lineascan requires its own API key, separate from Etherscan. Register at [lineascan.build](https://lineascan.build) to get a free API key. Using an Etherscan API key will result in verification failures.

2. **Not configuring custom chains in Hardhat** — While Linea works with standard Hardhat, contract verification requires the `customChains` configuration in `hardhat.config.ts` pointing to Lineascan's API URL. Without this, `npx hardhat verify` will fail with "network not supported."

3. **Relying on the public RPC for production** — The public RPC (`rpc.linea.build`) is rate-limited and intended for quick testing only. Production dApps should use Infura or Alchemy with proper API keys. Rate limiting on the public endpoint can cause intermittent failures in your application.

4. **Assuming all Chainlink services are available** — While Chainlink price feeds are deployed on Linea, not all Chainlink services (VRF, Automation, CCIP) may be available yet. Check the [Chainlink documentation](https://docs.chain.link/data-feeds/price-feeds/addresses?network=linea) for current Linea support before depending on a specific service.

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — Complete deployment guide with gas comparison
- [Linea Developer Portal](https://docs.linea.build/) — Official documentation and guides
- [Infura Linea Documentation](https://docs.infura.io/api/networks/linea) — RPC endpoint reference
- [Lineascan](https://lineascan.build/) — Block explorer and contract verification
- [Verax Documentation](https://docs.ver.ax/) — Attestation registry guide
