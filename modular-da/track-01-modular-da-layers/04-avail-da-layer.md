# Avail DA Layer: Validity-Proof Data Availability

**Track:** Modular Blockchain & Data Availability Layers
**Lesson:** 4 of 5
**Level:** Intermediate → Advanced
**Read time:** 12 min

---

## The Problem

You're evaluating DA layers for your rollup and you've looked at Celestia (separate validator set) and EigenDA (Ethereum restaking). Avail offers a third approach: a purpose-built DA chain using KZG polynomial commitments and validity proofs for data verification. But how do you actually integrate with Avail? How do you submit data, verify availability, and bridge attestations back to Ethereum? You need to understand Avail's architecture, set up the SDK, and write code that posts and retrieves blobs.

## Environment Setup

### Prerequisites

- Node.js 20+ with npm
- Rust toolchain (for running a local Avail node, optional)
- An Avail wallet with testnet AVAIL tokens

### Install Avail SDK

```shell
# Install the Avail JavaScript SDK
# Source: https://github.com/availproject/avail

npm init -y
npm install avail-js-sdk@0.3.0

# Or use the TypeScript types
npm install avail-js-sdk@0.3.0 typescript@5.4.0 @types/node@20.11.0 tsx@4.7.0
```

```
Expected output:
added 45 packages in 3s
```

### Get Testnet AVAIL Tokens

```shell
# Avail Turing Testnet faucet:
# https://faucet.avail.tools/
# Or use the Discord faucet: https://discord.gg/availproject

# Generate a new account (or import existing)
# The SDK can generate accounts from mnemonics
```

### Configure Avail Connection

```typescript
// avail-config.ts
// avail-js-sdk@0.3.0

import { initialize, getKeyringFromSeed } from "avail-js-sdk";

// Avail Turing Testnet endpoint
const AVAIL_RPC = "wss://turing-rpc.avail.so/ws";

// Initialize the API connection
export async function connectToAvail() {
  const api = await initialize(AVAIL_RPC);
  console.log(`Connected to Avail: ${(await api.rpc.system.chain()).toString()}`);
  console.log(`Node version: ${(await api.rpc.system.version()).toString()}`);
  return api;
}

// Create a keyring from seed phrase
// NEVER use this seed in production — generate your own
export function getWallet(seed: string) {
  const keyring = getKeyringFromSeed(seed);
  console.log(`Wallet address: ${keyring.address}`);
  return keyring;
}
```

```shell
# Run the config test
npx tsx avail-config.ts
```

```
Expected output:
Connected to Avail: Avail Turing Network
Node version: 2.2.0-<hash>
Wallet address: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
```

## Core Concepts

### Avail's Architecture

Avail is a purpose-built blockchain optimized exclusively for data availability. Unlike Celestia (which uses Tendermint consensus) or EigenDA (which uses Ethereum restaking), Avail uses a nominated Proof-of-Stake consensus based on Substrate/Polkadot SDK with KZG commitments for data verification.

```
┌─────────────────────────────────────────────────────────────┐
│                    Avail DA Architecture                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Rollup Sequencer                                           │
│  └── Submits transaction data to Avail                      │
│       │                                                      │
│       ▼                                                      │
│  Avail Validators (Nominated PoS)                           │
│  └── Order data submissions into blocks                     │
│  └── Generate KZG commitments per data cell                 │
│  └── Erasure code data (2D Reed-Solomon)                    │
│  └── Produce block headers with data roots                  │
│       │                                                      │
│       ▼                                                      │
│  Avail Light Clients (DAS)                                  │
│  └── Sample random cells from blocks                        │
│  └── Verify KZG proofs for sampled cells                    │
│  └── Achieve high confidence DA with minimal bandwidth      │
│       │                                                      │
│       ▼                                                      │
│  Avail Bridge (VectorX)                                     │
│  └── Posts Avail block headers + data roots to Ethereum     │
│  └── Uses SNARK proofs for header verification              │
│  └── Enables on-chain DA verification on Ethereum           │
│                                                              │
│  KEY DIFFERENTIATOR:                                         │
│  KZG commitments allow validity proofs (not just fraud      │
│  proofs) — a light client can verify DA without             │
│  downloading the full data                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Posting a Data Blob to Avail

```typescript
// Post data to Avail using the JS SDK
// avail-js-sdk@0.3.0

import { initialize, getKeyringFromSeed, disconnect } from "avail-js-sdk";

const AVAIL_RPC = "wss://turing-rpc.avail.so/ws";
const SEED = "bottom drive obey lake curtain smoke basket hold race lonely fit walk"; // TESTNET ONLY

async function postDataBlob(data: string): Promise<{
  blockHash: string;
  txHash: string;
  txIndex: number;
}> {
  const api = await initialize(AVAIL_RPC);
  const keyring = getKeyringFromSeed(SEED);

  console.log(`Submitting ${data.length} bytes to Avail...`);

  // Create the data submission transaction
  // app_id 0 is the default; rollups should register their own app_id
  const tx = api.tx.dataAvailability.submitData(data);

  // Sign and send the transaction
  return new Promise((resolve, reject) => {
    tx.signAndSend(keyring, { app_id: 1, nonce: -1 }, (result) => {
      if (result.status.isInBlock) {
        const blockHash = result.status.asInBlock.toString();
        const txHash = result.txHash.toString();
        const txIndex = result.txIndex ?? 0;

        console.log(`Data included in block: ${blockHash}`);
        console.log(`Transaction hash: ${txHash}`);
        console.log(`Transaction index: ${txIndex}`);

        resolve({ blockHash, txHash, txIndex });
      }

      if (result.status.isFinalized) {
        console.log(`Finalized in block: ${result.status.asFinalized.toString()}`);
        disconnect();
      }

      if (result.isError) {
        reject(new Error("Transaction failed"));
      }
    });
  });
}

// Example: submit rollup batch data
const rollupBatch = JSON.stringify({
  batchId: 55,
  rollupId: "my-optimistic-rollup",
  transactions: [
    { from: "0xaaa...", to: "0xbbb...", value: "1000000", data: "0x" },
    { from: "0xccc...", to: "0xddd...", value: "2500000", data: "0xabcdef" }
  ],
  stateRoot: "0x9876543210abcdef..."
});

const result = await postDataBlob(rollupBatch);
console.log(`Blob posted! Block: ${result.blockHash}, TX: ${result.txHash}`);
```

### Retrieving Data from Avail

```typescript
// Retrieve submitted data from Avail
// avail-js-sdk@0.3.0

import { initialize, disconnect } from "avail-js-sdk";

const AVAIL_RPC = "wss://turing-rpc.avail.so/ws";

interface AvailDataSubmission {
  txHash: string;
  sender: string;
  appId: number;
  data: string;
  dataHex: string;
}

async function getDataByBlockHash(
  blockHash: string,
  appId: number = 1
): Promise<AvailDataSubmission[]> {
  const api = await initialize(AVAIL_RPC);

  // Get the block
  const block = await api.rpc.chain.getBlock(blockHash);
  const submissions: AvailDataSubmission[] = [];

  // Iterate through extrinsics to find data submissions
  for (const [index, extrinsic] of block.block.extrinsics.entries()) {
    // Check if this is a dataAvailability.submitData call
    if (
      extrinsic.method.section === "dataAvailability" &&
      extrinsic.method.method === "submitData"
    ) {
      const dataHex = extrinsic.method.args[0].toString();
      const data = Buffer.from(dataHex.slice(2), "hex").toString("utf-8");

      submissions.push({
        txHash: extrinsic.hash.toString(),
        sender: extrinsic.signer.toString(),
        appId: appId,
        data: data,
        dataHex: dataHex
      });

      console.log(`Found submission at index ${index}:`);
      console.log(`  Sender: ${extrinsic.signer.toString()}`);
      console.log(`  Data (first 100 chars): ${data.slice(0, 100)}...`);
    }
  }

  await disconnect();
  return submissions;
}

// Retrieve data from the block where we posted
const submissions = await getDataByBlockHash(result.blockHash);
if (submissions.length > 0) {
  const batch = JSON.parse(submissions[0].data);
  console.log(`Retrieved batch #${batch.batchId} with ${batch.transactions.length} txs`);
}
```

### Querying Data by App ID

```typescript
// Avail assigns app_ids to rollups for data filtering
// Each rollup registers a unique app_id and only downloads its own data

import { initialize, disconnect } from "avail-js-sdk";

const AVAIL_RPC = "wss://turing-rpc.avail.so/ws";

async function registerAppId(name: string): Promise<number> {
  const api = await initialize(AVAIL_RPC);
  const keyring = getKeyringFromSeed(
    "bottom drive obey lake curtain smoke basket hold race lonely fit walk"
  );

  // Register a new application ID
  const tx = api.tx.dataAvailability.createApplicationKey(name);

  return new Promise((resolve, reject) => {
    tx.signAndSend(keyring, { nonce: -1 }, (result) => {
      if (result.status.isInBlock) {
        // Extract the app_id from events
        for (const event of result.events) {
          if (event.event.section === "dataAvailability" &&
              event.event.method === "ApplicationKeyCreated") {
            const appId = event.event.data[2].toString();
            console.log(`Registered app_id: ${appId} for "${name}"`);
            resolve(parseInt(appId));
            return;
          }
        }
        reject(new Error("App ID creation event not found"));
      }
    });
  });
}

// Register your rollup's app_id (one-time operation)
const myAppId = await registerAppId("my-optimistic-rollup");
console.log(`Use app_id ${myAppId} for all future data submissions`);
```

### Verifying DA on Ethereum (VectorX Bridge)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Avail's VectorX bridge posts attestations to Ethereum
// Source: https://github.com/availproject/avail/tree/main/contracts

/// @title IAvailBridge
/// @notice Interface for verifying Avail data availability on Ethereum
interface IAvailBridge {
    struct MerkleProof {
        bytes32[] proof;
        uint256 width;
        uint256 index;
        bytes32 leaf;
    }

    /// @notice Verify that data was included in an Avail block
    /// @param attestation The bridge attestation containing the data root
    /// @param proof Merkle proof of data inclusion
    function verifyDataInclusion(
        bytes calldata attestation,
        MerkleProof calldata proof
    ) external view returns (bool);
}

/// @title AvailDAConsumer
/// @notice Example rollup contract that verifies DA via Avail bridge
contract AvailDAConsumer {
    IAvailBridge public immutable availBridge;

    // Mapping of verified data roots
    mapping(bytes32 => bool) public verifiedRoots;

    event DataVerified(bytes32 indexed dataRoot, uint256 blockNumber);

    constructor(address _bridge) {
        availBridge = IAvailBridge(_bridge);
    }

    /// @notice Verify that rollup batch data was posted to Avail
    /// @param attestation Bridge attestation from VectorX
    /// @param proof Merkle proof of inclusion in Avail block
    /// @param dataRoot The expected data root
    function verifyBatchDA(
        bytes calldata attestation,
        IAvailBridge.MerkleProof calldata proof,
        bytes32 dataRoot
    ) external {
        require(
            availBridge.verifyDataInclusion(attestation, proof),
            "DA verification failed"
        );

        verifiedRoots[dataRoot] = true;
        emit DataVerified(dataRoot, block.number);
    }

    /// @notice Check if a data root has been verified
    function isDataAvailable(bytes32 dataRoot) external view returns (bool) {
        return verifiedRoots[dataRoot];
    }
}
```

### Using the Avail CLI

```shell
# Install Avail CLI (alternative to SDK)
# Source: https://github.com/availproject/cli

curl -sL https://cli.avail.tools | bash

# Configure for Turing testnet
avail config --network turing --seed "your seed phrase here"

# Submit data via CLI
avail data submit --data "Hello from my rollup" --app-id 1

# Query data at a specific block
avail data get --block 12345 --app-id 1
```

```
Expected output (data submit):
Transaction submitted successfully
  Block hash: 0xabc123...
  Block number: 54321
  Transaction hash: 0xdef456...
  Transaction index: 2
```

## Common Pitfalls

1. **Not registering an app_id** — Using app_id 0 (default) means your data is mixed with everyone else's. Register a unique app_id for your rollup so light clients can efficiently filter for only your data.

2. **Confusing finality with inclusion** — Data being "in block" (included) is not the same as finalized. Avail uses GRANDPA finality — wait for finalization before treating data as permanently available. This typically takes 1-2 blocks (~20-40 seconds).

3. **Ignoring the VectorX bridge latency** — Avail attestations are bridged to Ethereum via VectorX, but there's a delay (minutes to hours). Your rollup's settlement contract on Ethereum can't verify DA instantly — design for this latency in your state update flow.

4. **Assuming unlimited blob size** — Avail blocks have a maximum data capacity (~2 MB per block currently). If your rollup produces batches larger than this, you need to split across multiple submissions or compress more aggressively.

## What to Learn Next

- [DA Layer Comparison](./05-da-layer-comparison.md) — Compare cost, throughput, and security across all DA layers
- [Avail Documentation](https://docs.availproject.org/) — Official Avail developer docs
- [Avail GitHub](https://github.com/availproject/avail) — Avail node and SDK source code
- [VectorX Bridge](https://github.com/availproject/avail/tree/main/contracts) — Avail-to-Ethereum bridge contracts
