# Immutable Gaming SDK and Tooling

**Track:** Immutable zkEVM Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You're building a web3 game on Immutable zkEVM and you need to integrate NFT minting, marketplace trading, player wallets, and gas sponsorship. You could build all of this from scratch using raw smart contracts and ethers.js, but Immutable provides a unified SDK that handles the gaming-specific infrastructure. The problem is understanding which SDK modules to use, how they fit together, and what you still need to build yourself. You need to know the difference between the Minting API (server-side, gas-free), the Orderbook (trading), Passport (wallets), and the core blockchain SDK — and when to use each one.

## Core Concepts

### SDK Architecture Overview

The Immutable SDK (`@imtbl/sdk`) is a modular TypeScript package that wraps multiple services:

```
┌─────────────────────────────────────────────────────────┐
│                  @imtbl/sdk Modules                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  passport    — Wallet abstraction (social login)        │
│  orderbook   — NFT trading (list, buy, cancel)          │
│  blockchain  — Direct chain interaction (ethers wrapper) │
│  config      — Environment configuration                │
│                                                         │
│  Server-side APIs (REST, not in SDK):                   │
│  ├── Minting API — Gas-free NFT creation                │
│  ├── Metadata API — NFT metadata management             │
│  └── Collections API — Collection registration          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Installation and Setup

```shell
npm install @imtbl/sdk@1.45.0 ethers@6.9.0
```

```
Expected output:
added 127 packages, and audited 128 packages in 12s
found 0 vulnerabilities
```

```typescript
// Initialize the Immutable SDK
import { config, passport, orderbook, blockchainData } from "@imtbl/sdk"; // @imtbl/sdk@1.45.0

// Configuration — get credentials from https://hub.immutable.com
const immutableConfig = {
  environment: config.Environment.SANDBOX, // SANDBOX for testnet, PRODUCTION for mainnet
  publishableKey: "pk_imapik-YOUR_KEY_HERE", // From Immutable Hub
};

console.log(`Environment: ${immutableConfig.environment}`);
console.log(`Publishable key configured: ${immutableConfig.publishableKey.substring(0, 12)}...`);
```

### Passport Integration (Player Wallets)

Passport is the core of Immutable's gaming UX — it gives every player a smart contract wallet without requiring MetaMask or seed phrases:

```typescript
// Full Passport setup for a web game
import { config, passport } from "@imtbl/sdk"; // @imtbl/sdk@1.45.0
import { ethers } from "ethers"; // ethers@6.9.0

// Initialize Passport
const passportInstance = new passport.Passport({
  baseConfig: {
    environment: config.Environment.SANDBOX,
    publishableKey: "pk_imapik-YOUR_KEY_HERE",
  },
  clientId: "YOUR_CLIENT_ID", // From Immutable Hub
  redirectUri: "http://localhost:3000/callback",
  logoutRedirectUri: "http://localhost:3000/logout",
  audience: "platform_api",
  scope: "openid offline_access email transact",
});

// Connect player — opens social login popup
async function connectPlayer(): Promise<{
  address: string;
  provider: passport.Provider;
}> {
  const provider = passportInstance.connectEvm();

  try {
    // This triggers the login flow (Google, Apple, email)
    const accounts = await provider.request({
      method: "eth_requestAccounts",
    });

    const playerAddress = accounts[0];
    console.log(`Player connected: ${playerAddress}`);

    // Get player's IMX balance
    const balance = await provider.request({
      method: "eth_getBalance",
      params: [playerAddress, "latest"],
    });
    console.log(`IMX balance: ${ethers.formatEther(BigInt(balance as string))} IMX`);

    return { address: playerAddress, provider };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Passport connection failed: ${error.message}`);
    }
    throw error;
  }
}

// Send a transaction through Passport (gas can be sponsored)
async function sendGameTransaction(
  provider: passport.Provider,
  contractAddress: string,
  data: string
): Promise<string> {
  try {
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        to: contractAddress,
        data: data,
        value: "0x0",
      }],
    });

    console.log(`Transaction sent: ${txHash}`);
    return txHash as string;
  } catch (error) {
    if (error instanceof Error) {
      // Common errors:
      // - "User rejected" — player declined the transaction
      // - "Insufficient funds" — no IMX for gas (if not sponsored)
      throw new Error(`Transaction failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Minting API (Server-Side, Gas-Free)

The Minting API lets game servers mint NFTs without paying gas. Immutable subsidizes the minting cost — this is the primary way games create in-game assets:

```typescript
// Server-side minting — your game backend calls this
// No gas cost to your studio or players

interface MintRequest {
  contractAddress: string;
  assets: Array<{
    ownerAddress: string;
    referenceId: string;
    tokenId: string;
    metadata: {
      name: string;
      description: string;
      image: string;
      attributes: Array<{
        trait_type: string;
        value: string | number;
      }>;
    };
  }>;
}

async function mintGameAssets(mintRequest: MintRequest): Promise<void> {
  const API_BASE = "https://api.sandbox.immutable.com"; // Testnet
  const API_KEY = "YOUR_API_SECRET_KEY"; // Server-side secret from Immutable Hub

  const response = await fetch(
    `${API_BASE}/v1/chains/imtbl-zkevm-testnet/collections/${mintRequest.contractAddress}/nfts/mint-requests`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-immutable-api-key": API_KEY,
      },
      body: JSON.stringify(mintRequest.assets.map(asset => ({
        owner_address: asset.ownerAddress,
        reference_id: asset.referenceId,
        token_id: asset.tokenId,
        metadata: {
          name: asset.metadata.name,
          description: asset.metadata.description,
          image: asset.metadata.image,
          attributes: asset.metadata.attributes,
        },
      }))),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Minting failed (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  console.log(`Mint request submitted successfully`);
  console.log(`Status: ${JSON.stringify(result, null, 2)}`);
}

// Example: Mint a sword NFT to a player
await mintGameAssets({
  contractAddress: "0xYOUR_COLLECTION_CONTRACT",
  assets: [{
    ownerAddress: "0xPLAYER_WALLET_ADDRESS",
    referenceId: "sword-001-unique-ref",
    tokenId: "1",
    metadata: {
      name: "Flame Sword of the North",
      description: "A legendary sword forged in dragon fire. +50 ATK, +20 Fire DMG.",
      image: "https://your-game.com/assets/swords/flame-sword.png",
      attributes: [
        { trait_type: "Rarity", value: "Legendary" },
        { trait_type: "Attack", value: 50 },
        { trait_type: "Element", value: "Fire" },
        { trait_type: "Level Requirement", value: 25 },
      ],
    },
  }],
});
```

### Orderbook (NFT Trading)

The Immutable Orderbook enables peer-to-peer NFT trading with enforced royalties:

```typescript
// Creating and filling orders on the Immutable Orderbook
import { config, orderbook } from "@imtbl/sdk"; // @imtbl/sdk@1.45.0
import { ethers } from "ethers"; // ethers@6.9.0

const orderbookClient = new orderbook.Orderbook({
  baseConfig: {
    environment: config.Environment.SANDBOX,
    publishableKey: "pk_imapik-YOUR_KEY_HERE",
  },
});

// List an NFT for sale
async function listNFTForSale(
  sellerAddress: string,
  contractAddress: string,
  tokenId: string,
  priceInIMX: string
): Promise<string> {
  try {
    // Prepare the listing
    const preparedListing = await orderbookClient.prepareListing({
      makerAddress: sellerAddress,
      sell: {
        contractAddress: contractAddress,
        tokenId: tokenId,
        type: "ERC721",
      },
      buy: {
        amount: ethers.parseEther(priceInIMX).toString(),
        type: "NATIVE", // IMX
      },
    });

    console.log(`Listing prepared. Actions required: ${preparedListing.actions.length}`);

    // The prepared listing returns actions the seller needs to sign:
    // 1. Approve the orderbook to transfer the NFT
    // 2. Sign the order message
    // These are executed through the player's wallet (Passport or MetaMask)

    for (const action of preparedListing.actions) {
      console.log(`Action type: ${action.type}`);
      // In a real implementation, send these to the player's wallet for signing
    }

    // After signing, create the listing
    const listingResult = await orderbookClient.createListing({
      orderComponents: preparedListing.orderComponents,
      orderHash: preparedListing.orderHash,
      orderSignature: "SIGNED_BY_PLAYER", // Player signs this
      makerFees: [{
        amount: "0",
        recipientAddress: sellerAddress,
      }],
    });

    console.log(`NFT listed! Listing ID: ${listingResult.result.id}`);
    return listingResult.result.id;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Listing failed: ${error.message}`);
    }
    throw error;
  }
}

// Buy a listed NFT
async function buyNFT(
  buyerAddress: string,
  listingId: string
): Promise<string> {
  try {
    const fulfillment = await orderbookClient.fulfillOrder(
      listingId,
      buyerAddress,
      [{
        amount: "0",
        recipientAddress: buyerAddress,
      }]
    );

    console.log(`Order fulfilled! TX actions: ${fulfillment.actions.length}`);

    // Returns transactions the buyer needs to execute:
    // 1. Approve IMX spending (if ERC-20 payment)
    // 2. Execute the fill transaction
    for (const action of fulfillment.actions) {
      console.log(`Execute: ${action.type}`);
    }

    return listingId;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Purchase failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Collection Registration

Before minting, you must register your NFT collection with Immutable:

```typescript
// Register a collection on Immutable zkEVM
// This is done once per collection, typically during game setup

async function registerCollection(
  contractAddress: string,
  collectionName: string,
  description: string,
  iconUrl: string
): Promise<void> {
  const API_BASE = "https://api.sandbox.immutable.com";
  const API_KEY = "YOUR_API_SECRET_KEY";

  const response = await fetch(
    `${API_BASE}/v1/chains/imtbl-zkevm-testnet/collections`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-immutable-api-key": API_KEY,
      },
      body: JSON.stringify({
        contract_address: contractAddress,
        name: collectionName,
        description: description,
        icon_url: iconUrl,
        metadata_syncing_mode: "platform", // Immutable manages metadata
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Collection registration failed: ${error}`);
  }

  const result = await response.json();
  console.log(`Collection registered: ${result.name}`);
  console.log(`Contract: ${result.contract_address}`);
  console.log(`Status: ${result.status}`);
}

await registerCollection(
  "0xYOUR_NFT_CONTRACT",
  "Dragon Warriors Collection",
  "In-game assets for Dragon Warriors — swords, shields, and armor",
  "https://your-game.com/collection-icon.png"
);
```

### Immutable Hub Dashboard

The [Immutable Hub](https://hub.immutable.com/) is where you manage your game project:

```shell
# What you configure in Immutable Hub:
# 1. Create a project (get publishableKey and API secret)
# 2. Register your game's smart contracts
# 3. Configure Passport (OAuth redirect URIs)
# 4. Set up gas sponsorship policies
# 5. Monitor minting activity and marketplace volume

# Hub URL: https://hub.immutable.com
# Last verified: 2025-01-15
```

### Unity and Unreal Engine SDKs

For game engine integration, Immutable provides native SDKs:

```shell
# Unity SDK installation
# Add via Unity Package Manager:
# https://github.com/nickthorpe71/immutable-unity-sdk.git

# Unreal Engine SDK
# Available as a plugin:
# https://github.com/nickthorpe71/immutable-unreal-sdk.git

# Both SDKs wrap the same Passport and blockchain functionality
# for native game engine integration
```

```typescript
// The TypeScript SDK is used for web games and backend services
// Unity/Unreal SDKs provide equivalent functionality in C#/C++

// Key SDK modules and their purposes:
const SDK_MODULES = {
  "@imtbl/sdk": "Core SDK — Passport, Orderbook, Blockchain Data",
  "Immutable Unity SDK": "Unity game engine integration (C#)",
  "Immutable Unreal SDK": "Unreal Engine integration (C++)",
  "Minting API": "REST API for server-side gas-free minting",
  "Metadata API": "REST API for NFT metadata management",
};

console.log("Available SDKs and tools:");
for (const [name, description] of Object.entries(SDK_MODULES)) {
  console.log(`  ${name}: ${description}`);
}
```

## Common Pitfalls

1. **Using the Minting API from the client** — The Minting API requires your secret API key. Never expose this in frontend code or game clients. Minting should always happen from your game server. If you need client-initiated minting, have the client call your backend, which then calls the Minting API.

2. **Not registering collections before minting** — You must register your NFT contract with Immutable before the Minting API will accept mint requests. This is a one-time setup step that developers often miss, leading to "collection not found" errors.

3. **Ignoring Passport's transaction confirmation UX** — Passport shows players a confirmation popup for every transaction. If your game sends many transactions rapidly (e.g., crafting 10 items), players get 10 popups. Use batch transactions or session keys to reduce confirmation fatigue.

4. **Hardcoding testnet configuration for production** — The SDK uses `Environment.SANDBOX` for testnet and `Environment.PRODUCTION` for mainnet. These connect to completely different chains (testnet chain ID 13473 vs mainnet 13371). Use environment variables to switch between them.

5. **Not handling Passport disconnection** — Players can revoke Passport sessions. Your game needs to handle the case where a previously connected player's session expires mid-game. Listen for disconnection events and prompt re-authentication gracefully.

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — Deploy an NFT contract to Immutable zkEVM testnet with gas comparison
- [Immutable SDK Documentation](https://docs.immutable.com/docs/zkEVM/sdks) — Complete SDK reference
- [Immutable Hub](https://hub.immutable.com/) — Project management dashboard
- [Immutable GitHub](https://github.com/immutable) — Open source contracts and SDK code
