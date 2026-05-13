# Celestia DA Integration: Posting and Retrieving Data Blobs

**Track:** Modular Blockchain & Data Availability Layers
**Lesson:** 2 of 5
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You're building a rollup or appchain and you've decided to use Celestia for data availability instead of posting everything to Ethereum calldata. But how do you actually submit data to Celestia? How do you retrieve it? What namespace do you use? You need to set up a Celestia light node, connect to the network, and use the Node API to post and read blobs. Without this, your rollup can't publish transaction data to a DA layer.

## Environment Setup

### Prerequisites

- Go 1.22+ installed
- A Celestia wallet with testnet TIA tokens
- ~2 GB disk space for the light node

### Install Celestia Node

```shell
# Install celestia-node v0.16.0
# Source: https://github.com/celestiaorg/celestia-node

# Option 1: Install from source
git clone https://github.com/celestiaorg/celestia-node.git
cd celestia-node
git checkout v0.16.0
make build
sudo make install

# Verify installation
celestia version
```

```
Expected output:
Semantic version: v0.16.0
Commit: <commit-hash>
Build Date: <date>
System version: <os/arch>
Golang version: go1.22.x
```

### Initialize and Start Light Node (Mocha Testnet)

```shell
# Initialize the light node for Mocha testnet
celestia light init --p2p.network mocha

# Start the light node
# This connects to Celestia's Mocha testnet and begins syncing headers
celestia light start --core.ip rpc-mocha.pops.one --p2p.network mocha
```

```
Expected output:
INFO    node    node/init.go:29    Initializing Light Node Store over '/home/user/.celestia-light-mocha-4'
INFO    node    node/node.go:90    Starting Light Node...
INFO    header/sync    sync/sync.go:94    syncing headers from height 1...
```

### Get Testnet TIA Tokens

```shell
# Get your node's address
celestia state account-address --node.store ~/.celestia-light-mocha-4

# Fund via Mocha testnet faucet:
# https://faucet.celestia-mocha.com/
# Or use Discord faucet: https://discord.gg/celestiacommunity
# Request tokens to your address
```

### Configure Auth Token

```shell
# Generate an auth token for the Node API
# Permissions: read, write, admin
export CELESTIA_NODE_AUTH_TOKEN=$(celestia light auth admin --node.store ~/.celestia-light-mocha-4)

echo $CELESTIA_NODE_AUTH_TOKEN
```

## Core Concepts

### Namespaces and Blobs

Celestia organizes data into namespaces — 29-byte identifiers that let rollups filter for only their data. Each rollup picks a unique namespace and posts blobs (binary large objects) to it.

```typescript
// celestia-node-api client example
// @celestia-org/celestia-node-api is conceptual — use HTTP/JSON-RPC directly
// Node.js 20+, fetch API

const CELESTIA_NODE_URL = "http://localhost:26658";
const AUTH_TOKEN = process.env.CELESTIA_NODE_AUTH_TOKEN;

// Namespaces are 29 bytes (version byte + 28 byte ID)
// Version 0 namespaces: first byte is 0x00, next 18 bytes are 0x00 padding,
// last 10 bytes are your custom ID
function createNamespace(customId: string): string {
  // Convert custom ID to hex, pad to 10 bytes
  const idHex = Buffer.from(customId.padEnd(10, "\0")).toString("hex").slice(0, 20);
  // Version 0 namespace: 00 + 18 zero bytes + 10 byte custom ID
  const namespace = "00" + "0".repeat(36) + idHex;
  return Buffer.from(namespace, "hex").toString("base64");
}

const MY_NAMESPACE = createNamespace("my_rollup");
console.log(`Namespace (base64): ${MY_NAMESPACE}`);
```

### Posting a Data Blob

```typescript
// Post a blob to Celestia using the Node API (JSON-RPC)
// celestia-node v0.16.0 API

interface BlobSubmitRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: [
    {
      namespace: string;      // base64 encoded namespace
      data: string;           // base64 encoded blob data
      share_version: number;  // 0 for standard shares
      commitment: string;     // empty string, node computes it
    }[],
    number  // gas price in utia (0.002 for testnet)
  ];
}

async function postBlob(data: string): Promise<{ height: number; commitment: string }> {
  const blobData = Buffer.from(data).toString("base64");

  const request: BlobSubmitRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "blob.Submit",
    params: [
      [
        {
          namespace: MY_NAMESPACE,
          data: blobData,
          share_version: 0,
          commitment: ""  // Node computes the commitment
        }
      ],
      0.002  // Gas price in utia
    ]
  };

  const response = await fetch(CELESTIA_NODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Blob submission failed: ${response.status} — ${errorText}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }

  // Result is the block height where the blob was included
  console.log(`Blob posted at height: ${result.result}`);

  return {
    height: result.result,
    commitment: "" // Retrieve commitment separately
  };
}

// Example: post rollup batch data
const rollupBatchData = JSON.stringify({
  batchId: 42,
  transactions: [
    { from: "0xabc...", to: "0xdef...", value: "1000000", nonce: 5 },
    { from: "0x123...", to: "0x456...", value: "500000", nonce: 12 }
  ],
  stateRoot: "0xdeadbeef..."
});

const { height } = await postBlob(rollupBatchData);
console.log(`Batch posted at Celestia height ${height}`);
```

### Retrieving a Data Blob

```typescript
// Retrieve blobs from a specific height and namespace
// celestia-node v0.16.0 API

interface BlobGetRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: [number, string, string];  // [height, namespace, commitment]
}

interface CelestiaBlob {
  namespace: string;
  data: string;           // base64 encoded
  share_version: number;
  commitment: string;
  index: number;
}

async function getBlobsByHeight(height: number): Promise<CelestiaBlob[]> {
  // Get all blobs in our namespace at a specific height
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "blob.GetAll",
    params: [height, [MY_NAMESPACE]]
  };

  const response = await fetch(CELESTIA_NODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(`Failed to get blobs: ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    // "blob: not found" is expected if no blobs at that height
    if (result.error.message.includes("not found")) {
      console.log(`No blobs found at height ${height} for our namespace`);
      return [];
    }
    throw new Error(`RPC error: ${result.error.message}`);
  }

  const blobs: CelestiaBlob[] = result.result;

  for (const blob of blobs) {
    const decodedData = Buffer.from(blob.data, "base64").toString("utf-8");
    console.log(`Blob at index ${blob.index}:`);
    console.log(`  Commitment: ${blob.commitment}`);
    console.log(`  Data: ${decodedData.slice(0, 100)}...`);
  }

  return blobs;
}

// Retrieve the blob we posted earlier
const blobs = await getBlobsByHeight(height);
if (blobs.length > 0) {
  const decoded = Buffer.from(blobs[0].data, "base64").toString("utf-8");
  const batchData = JSON.parse(decoded);
  console.log(`Retrieved batch #${batchData.batchId} with ${batchData.transactions.length} txs`);
}
```

### Using the Celestia CLI Directly

```shell
# Post a blob via CLI (alternative to programmatic API)
celestia blob submit 0x00000000000000000000000000000000000000000000006d795f726f6c6c7570 \
  '"SGVsbG8gZnJvbSBteSByb2xsdXAh"' \
  --node.store ~/.celestia-light-mocha-4

# Get a blob by height, namespace, and commitment
celestia blob get 123456 \
  0x00000000000000000000000000000000000000000000006d795f726f6c6c7570 \
  "nmt_commitment_base64_here" \
  --node.store ~/.celestia-light-mocha-4

# Get all blobs at a height for a namespace
celestia blob get-all 123456 \
  0x00000000000000000000000000000000000000000000006d795f726f6c6c7570 \
  --node.store ~/.celestia-light-mocha-4
```

```
Expected output (blob submit):
{
  "result": 123456,
  "error": null
}
```

### Verifying Blob Inclusion (for Rollup Contracts)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Blobstream contract verifies Celestia data roots on Ethereum
// Source: https://github.com/celestiaorg/blobstream-contracts

import {IDAOracle} from "@celestia/blobstream-contracts@3.1.0/src/IDAOracle.sol";
import {DataRootTuple} from "@celestia/blobstream-contracts@3.1.0/src/DataRootTuple.sol";

/// @title CelestiaDAVerifier
/// @notice Verifies that rollup data was posted to Celestia via Blobstream
contract CelestiaDAVerifier {
    IDAOracle public immutable blobstream;

    constructor(address _blobstream) {
        blobstream = IDAOracle(_blobstream);
    }

    /// @notice Verify a data root was attested by Blobstream validators
    /// @param _tupleRootNonce The nonce of the data root tuple
    /// @param _tuple The data root tuple (height + data root)
    /// @param _proof Binary Merkle proof of inclusion
    function verifyDataPosted(
        uint256 _tupleRootNonce,
        DataRootTuple memory _tuple,
        bytes32[] memory _proof
    ) external view returns (bool) {
        return blobstream.verifyAttestation(
            _tupleRootNonce,
            _tuple,
            _proof
        );
    }
}
```

## Common Pitfalls

1. **Not waiting for blob inclusion** — `blob.Submit` returns the height where the blob is expected to be included, but you should verify inclusion before relying on it. Use `blob.Get` with the commitment to confirm the blob is actually in the block.

2. **Using wrong namespace format** — Celestia v0.16+ uses 29-byte namespaces (version byte + 28 bytes). Older tutorials may show 8-byte or 10-byte namespaces from previous versions. Always check the version you're running.

3. **Ignoring gas price spikes** — Celestia's blob fee market can spike during high demand. Set a reasonable gas price (0.002 utia for testnet) but implement retry logic with increasing gas prices for production.

4. **Assuming permanent storage** — Celestia light nodes prune blob data after the DA window (~30 days on mainnet). If you need historical blob data, run a full/archival node or use a third-party indexer like Celenium.

## What to Learn Next

- [EigenDA and Restaking](./03-eigenda-restaking.md) — Use Ethereum's restaked security for data availability
- [Celestia Documentation: Node API](https://docs.celestia.org/developers/node-api) — Full API reference
- [Blobstream GitHub](https://github.com/celestiaorg/blobstream-contracts) — Celestia-to-Ethereum bridge contracts
- [Celestia Node GitHub](https://github.com/celestiaorg/celestia-node) — Light/full node source code
