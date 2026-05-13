# Base Ecosystem Tooling

**Track:** Base Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You're ready to build on Base but the tooling landscape is fragmented. You need to know which SDKs to use for onchain interactions, how to verify contracts on Basescan, what indexing solutions work, and how to leverage Base-specific tools like OnchainKit and Coinbase Smart Wallet. Picking the wrong tools means rewriting integrations later or missing features that could simplify your development workflow.

## Core Concepts

### Development Frameworks

Base is EVM-equivalent, so standard Ethereum development frameworks work out of the box. You only need to configure the correct RPC and chain ID.

**Hardhat Configuration:**

```typescript
// hardhat.config.ts
// hardhat@2.19.0, @nomicfoundation/hardhat-toolbox@4.0.0
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun", // Base supports Cancun opcodes
    },
  },
  networks: {
    base: {
      url: "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 8453,
      gasPrice: "auto",
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY!,
      baseSepolia: process.env.BASESCAN_API_KEY!,
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
```

**Foundry Configuration:**

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
base = "https://mainnet.base.org"
base_sepolia = "https://sepolia.base.org"

[etherscan]
base = { key = "${BASESCAN_API_KEY}", url = "https://api.basescan.org/api" }
base_sepolia = { key = "${BASESCAN_API_KEY}", url = "https://api-sepolia.basescan.org/api" }
```

### OnchainKit: Base's Official React SDK

OnchainKit is Coinbase's React component library for building onchain apps on Base. It provides pre-built components for wallet connection, identity, transactions, and token swaps.

```typescript
// @coinbase/onchainkit@0.35.0
// React component example using OnchainKit
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownDisconnect,
} from "@coinbase/onchainkit/wallet";
import {
  Name,
  Avatar,
  Identity,
} from "@coinbase/onchainkit/identity";
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusLabel,
  TransactionStatusAction,
} from "@coinbase/onchainkit/transaction";
import { base } from "viem/chains";

// Wallet connection with ENS/Basename resolution
function WalletSection() {
  return (
    <Wallet>
      <ConnectWallet>
        <Avatar className="h-6 w-6" />
        <Name />
      </ConnectWallet>
      <WalletDropdown>
        <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick={true}>
          <Avatar />
          <Name />
        </Identity>
        <WalletDropdownDisconnect />
      </WalletDropdown>
    </Wallet>
  );
}

// Transaction component with status tracking
function MintButton() {
  const contracts = [
    {
      address: "0xYourContractAddress" as `0x${string}`,
      abi: [
        {
          name: "mint",
          type: "function",
          stateMutability: "payable",
          inputs: [{ name: "to", type: "address" }],
          outputs: [],
        },
      ],
      functionName: "mint",
      args: ["0xUserAddress"],
      value: BigInt(0),
    },
  ];

  return (
    <Transaction
      chainId={base.id}
      contracts={contracts}
      onError={(error) => console.error("Transaction failed:", error)}
      onSuccess={(response) => console.log("Transaction success:", response)}
    >
      <TransactionButton text="Mint NFT" />
      <TransactionStatus>
        <TransactionStatusLabel />
        <TransactionStatusAction />
      </TransactionStatus>
    </Transaction>
  );
}
```

### Coinbase Smart Wallet

Coinbase Smart Wallet is an ERC-4337 smart contract wallet that enables gasless transactions and passkey authentication. It's deeply integrated with Base.

```typescript
// viem@2.21.0, @coinbase/wallet-sdk@4.0.0
import { createPublicClient, createWalletClient, http, custom } from "viem";
import { base } from "viem/chains";
import CoinbaseWalletSDK from "@coinbase/wallet-sdk";

// Initialize Coinbase Wallet SDK with Smart Wallet preference
const sdk = new CoinbaseWalletSDK({
  appName: "My Base dApp",
  appChainIds: [8453], // Base mainnet
});

// Create provider — Smart Wallet is the default for new users
const provider = sdk.makeWeb3Provider();

// Create viem clients
const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const walletClient = createWalletClient({
  chain: base,
  transport: custom(provider),
});

async function connectAndSend(): Promise<void> {
  try {
    // Request accounts — triggers Smart Wallet creation if new user
    const [address] = await walletClient.requestAddresses();
    console.log("Connected:", address);

    // Check balance
    const balance = await publicClient.getBalance({ address });
    console.log("Balance:", balance, "wei");

    // Smart Wallet supports batched transactions (ERC-4337)
    // and sponsored gas (paymaster) for gasless UX
  } catch (error) {
    console.error("Connection failed:", (error as Error).message);
  }
}
```

### Basenames: Onchain Identity

Basenames are ENS-compatible names on Base (e.g., `yourname.base.eth`). They provide human-readable addresses and onchain identity.

```typescript
// viem@2.21.0
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { normalize } from "viem/ens";

const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Resolve a Basename to an address
async function resolveBasename(name: string): Promise<string | null> {
  try {
    const address = await client.getEnsAddress({
      name: normalize(name),
      universalResolverAddress: "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD",
    });
    return address;
  } catch (error) {
    console.error(`Failed to resolve ${name}:`, (error as Error).message);
    return null;
  }
}

// Reverse resolve an address to a Basename
async function reverseResolve(address: `0x${string}`): Promise<string | null> {
  try {
    const name = await client.getEnsName({
      address,
      universalResolverAddress: "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD",
    });
    return name;
  } catch (error) {
    console.error(`Failed to reverse resolve:`, (error as Error).message);
    return null;
  }
}
```

### Block Explorers and Verification

**Basescan** (https://basescan.org) is the primary block explorer, built by the Etherscan team. Contract verification works identically to Etherscan.

```shell
# Verify contract with Foundry (last verified: 2025-01-15)
forge verify-contract \
  --chain-id 8453 \
  --compiler-version v0.8.24 \
  --num-of-optimizations 200 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0xYourContractAddress \
  src/MyContract.sol:MyContract
```

```
Expected output:
Start verifying contract `0xYourContractAddress` deployed on base
Submitting verification for [src/MyContract.sol:MyContract]...
Submitted contract for verification:
  Response: OK
  GUID: abc123...
  URL: https://basescan.org/address/0xYourContractAddress#code
Waiting for verification result...
Contract successfully verified
```

### Indexing and Data

| Tool | Purpose | Base Support |
|------|---------|--------------|
| [The Graph](https://thegraph.com) | Subgraph indexing | Hosted + decentralized |
| [Alchemy](https://alchemy.com) | RPC + enhanced APIs | Full support |
| [QuickNode](https://quicknode.com) | RPC + streams | Full support |
| [Goldsky](https://goldsky.com) | Subgraph + Mirror | Full support |
| [Dune Analytics](https://dune.com) | SQL analytics | Full support |
| [Blockscout](https://base.blockscout.com) | Alternative explorer | Full support |

### Paymaster: Sponsored Transactions

Base supports ERC-4337 paymasters for gasless user experiences. Coinbase provides a paymaster service for Base:

```typescript
// Example paymaster integration concept
// @coinbase/onchainkit@0.35.0
import { base } from "viem/chains";

// Coinbase Developer Platform paymaster endpoint
const PAYMASTER_URL = `https://api.developer.coinbase.com/rpc/v1/base/${process.env.CDP_API_KEY}`;

// With OnchainKit, paymaster is configured at the provider level
// The Transaction component automatically uses it when available
const paymasterConfig = {
  url: PAYMASTER_URL,
  // Paymaster sponsors gas for approved contract interactions
  // Configure allowed contracts and methods in the CDP dashboard
};

console.log("Paymaster configured for gasless transactions on Base");
console.log("Users interact without holding ETH for gas");
```

## Common Pitfalls

1. **Not getting a Basescan API key** — Contract verification, reading verified source, and API queries all require a free Basescan API key. Register at https://basescan.org/apis before starting development.

2. **Using Ethereum mainnet RPC for Base queries** — Base has its own RPC endpoints. Querying `eth_call` against Ethereum mainnet returns Ethereum state, not Base state. Always verify your provider is connected to chain ID 8453 (mainnet) or 84532 (Sepolia).

3. **Ignoring OnchainKit for consumer apps** — If you're building a consumer-facing dApp on Base, OnchainKit provides polished components that handle wallet connection, identity, and transactions. Building these from scratch wastes time and produces a worse UX.

4. **Assuming all ERC-20s have the same address on Base and Ethereum** — Token addresses differ between chains. USDC on Ethereum is `0xA0b8...` but native USDC on Base is `0x8335...`. Always use a token list or registry to resolve addresses per chain.

5. **Not testing with Coinbase Smart Wallet** — A significant portion of Base users use Smart Wallet. If your dApp doesn't support ERC-4337 wallets (contract accounts), you'll exclude these users. Test with both EOA and Smart Wallet.

## What to Learn Next

- [Deploying to Base: Complete Walkthrough](./05-deployment-walkthrough.md) — Step-by-step deployment with gas comparison to Ethereum
- [OnchainKit Documentation](https://onchainkit.xyz) — Full component reference for Base React development
- [Coinbase Developer Platform](https://www.coinbase.com/developer-platform) — Paymaster, Smart Wallet, and Base infrastructure tools
