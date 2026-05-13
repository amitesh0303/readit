# EigenDA and Restaking: Ethereum-Secured Data Availability

**Track:** Modular Blockchain & Data Availability Layers
**Lesson:** 3 of 5
**Level:** Advanced
**Read time:** 14 min

---

## The Problem

You want cheaper data availability than Ethereum blobs but don't want to trust a separate validator set like Celestia's. EigenDA solves this by using Ethereum's own staked ETH (via EigenLayer restaking) to secure a DA layer. But the architecture is complex: you need to understand how restaking works, how operators register, how data is dispersed and retrieved, and what the actual security guarantees are. Without this, you can't evaluate whether EigenDA's trust model fits your rollup.

## Environment Setup

### Prerequisites

- Node.js 20+ and npm/yarn
- An Ethereum Holesky testnet wallet with ETH (for operator registration)
- Understanding of EigenLayer restaking (explained below)

### Install EigenDA Tools

```shell
# Install the EigenDA proxy client (for rollup integration)
# Source: https://github.com/Layr-Labs/eigenda

# Clone the EigenDA repository
git clone https://github.com/Layr-Labs/eigenda.git
cd eigenda
git checkout v0.8.0

# Build the disperser client
make build

# Install the EigenDA proxy (sidecar for rollup sequencers)
cd tools/eigenda-proxy
go build -o eigenda-proxy .

# Verify
./eigenda-proxy --version
```

```
Expected output:
eigenda-proxy version v0.8.0
```

### Configure EigenDA Proxy (Holesky Testnet)

```shell
# Start the EigenDA proxy pointing to Holesky testnet disperser
./eigenda-proxy \
  --eigenda-disperser-rpc disperser-holesky.eigenda.xyz:443 \
  --eigenda-status-query-timeout 45s \
  --eigenda-status-query-retry-interval 5s \
  --eigenda-disable-tls=false \
  --addr 0.0.0.0 \
  --port 4242
```

```
Expected output:
INFO [01-15|10:00:00] Starting EigenDA proxy server addr=0.0.0.0 port=4242
INFO [01-15|10:00:00] Connected to EigenDA disperser endpoint=disperser-holesky.eigenda.xyz:443
```

## Core Concepts

### EigenLayer Restaking: The Security Foundation

EigenDA doesn't have its own validator set. Instead, it leverages EigenLayer — a protocol that lets Ethereum stakers "restake" their ETH to secure additional services (called Actively Validated Services, or AVSs). EigenDA is the flagship AVS.

```
┌─────────────────────────────────────────────────────────────┐
│              EigenLayer Restaking Architecture                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ETH Stakers (32 ETH validators)                            │
│       │                                                      │
│       ▼                                                      │
│  EigenLayer Core Contracts (Ethereum L1)                     │
│  └── Stakers opt-in to restaking                            │
│  └── Delegate to Operators                                   │
│       │                                                      │
│       ▼                                                      │
│  Operators (run EigenDA node software)                       │
│  └── Register with EigenDA AVS                              │
│  └── Store data chunks assigned to them                     │
│  └── Serve data on request                                  │
│  └── Subject to slashing if they fail                       │
│       │                                                      │
│       ▼                                                      │
│  EigenDA Service                                             │
│  └── Disperser: splits data into chunks, assigns to ops     │
│  └── Retriever: reassembles data from operator chunks       │
│  └── On-chain registry: tracks operator stakes + duties     │
│                                                              │
│  SLASHING: If an operator fails to store/serve data,        │
│  their restaked ETH can be slashed via EigenLayer            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### The Restaking Prerequisite

**This is critical**: EigenDA's security comes entirely from restaked ETH. The more ETH restaked to EigenDA operators, the higher the cost of attacking the system. Here's how the chain of trust works:

```typescript
// Understanding the restaking security model
// ethers@6.9.0

import { ethers } from "ethers";

// EigenLayer core contracts on Ethereum mainnet
const EIGENLAYER_CONTRACTS = {
  // Source: https://github.com/Layr-Labs/eigenlayer-contracts
  delegationManager: "0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A",
  strategyManager: "0x858646372CC42E1A627fcE94aa7A7033e7CF075A",
  eigenDAServiceManager: "0x870679E138bCdf293b7Ff14dD44b70FC97e12fc0",
  // Holesky testnet equivalents:
  holeskyDelegationManager: "0xA44151489861Fe9e3055d95adC98FbD462B948e7",
  holeskyEigenDAServiceManager: "0xD4A7E1Bd8015057293f0D0A557088c286942e84b"
};

// The security model:
// 1. Stakers deposit ETH into EigenLayer strategies
// 2. Stakers delegate to Operators
// 3. Operators register with EigenDA AVS
// 4. Operators must maintain uptime and serve data
// 5. If operators fail, their delegated stake can be slashed

interface EigenDASecurityParams {
  totalRestaked: bigint;          // Total ETH securing EigenDA
  quorumThreshold: number;        // % of operators that must attest (e.g., 67%)
  adversaryThreshold: number;     // % of stake an attacker needs (e.g., 33%)
  numOperators: number;           // Active registered operators
  minOperatorStake: bigint;       // Minimum stake to be an operator
}

// As of early 2025, EigenDA has:
// - ~$10B+ in restaked ETH
// - 200+ registered operators
// - Quorum threshold: operators holding 67%+ of stake must sign
const currentParams: EigenDASecurityParams = {
  totalRestaked: ethers.parseEther("3000000"),  // ~3M ETH restaked
  quorumThreshold: 67,
  adversaryThreshold: 33,
  numOperators: 200,
  minOperatorStake: ethers.parseEther("32")
};

console.log(`EigenDA secured by: ${ethers.formatEther(currentParams.totalRestaked)} ETH`);
console.log(`Attack cost: ${ethers.formatEther(
  currentParams.totalRestaked * BigInt(currentParams.adversaryThreshold) / 100n
)} ETH (${currentParams.adversaryThreshold}% of stake)`);
```

### Posting Data to EigenDA

EigenDA uses a disperser service that splits data into chunks, erasure-codes them, and distributes chunks to operators. Here's how to post data:

```typescript
// Post a blob to EigenDA via the disperser
// Using the EigenDA proxy (HTTP interface)
// Node.js 20+

const EIGENDA_PROXY_URL = "http://localhost:4242";

interface DisperseResponse {
  commitment: string;    // KZG commitment to the blob
  blobIndex: number;     // Index within the batch
  batchHeaderHash: string;
  referenceBlockNumber: number;
}

async function postBlobToEigenDA(data: Uint8Array): Promise<DisperseResponse> {
  // The EigenDA proxy accepts raw bytes via PUT
  // It handles dispersal to operators automatically
  const response = await fetch(`${EIGENDA_PROXY_URL}/put`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream"
    },
    body: data
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`EigenDA dispersal failed: ${response.status} — ${errorText}`);
  }

  // Response contains the commitment (used to retrieve data later)
  const commitmentHex = await response.text();
  console.log(`Blob dispersed. Commitment: ${commitmentHex}`);

  return {
    commitment: commitmentHex,
    blobIndex: 0,
    batchHeaderHash: "",  // Available after batch confirmation
    referenceBlockNumber: 0
  };
}

// Example: disperse rollup batch data
const batchData = new TextEncoder().encode(JSON.stringify({
  batchNumber: 100,
  transactions: [
    { hash: "0xabc...", from: "0x1...", to: "0x2...", value: "1000" },
    { hash: "0xdef...", from: "0x3...", to: "0x4...", value: "2000" }
  ],
  prevStateRoot: "0x111...",
  postStateRoot: "0x222..."
}));

const disperseResult = await postBlobToEigenDA(batchData);
console.log(`Store this commitment for retrieval: ${disperseResult.commitment}`);
```

### Retrieving Data from EigenDA

```typescript
// Retrieve a blob from EigenDA using the commitment
// The proxy handles reassembly from operator chunks

async function getBlobFromEigenDA(commitment: string): Promise<Uint8Array> {
  // GET request with the commitment as the path
  const response = await fetch(`${EIGENDA_PROXY_URL}/get/${commitment}`, {
    method: "GET"
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Blob not found — may not be confirmed yet or has expired");
    }
    throw new Error(`EigenDA retrieval failed: ${response.status}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  console.log(`Retrieved ${data.length} bytes from EigenDA`);
  return data;
}

// Retrieve the batch we posted
const retrievedData = await getBlobFromEigenDA(disperseResult.commitment);
const decoded = new TextDecoder().decode(retrievedData);
const batch = JSON.parse(decoded);
console.log(`Retrieved batch #${batch.batchNumber} with ${batch.transactions.length} txs`);
```

### On-Chain Verification (Rollup Settlement)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Source: https://github.com/Layr-Labs/eigenda/tree/master/contracts

import {IEigenDAServiceManager} from "@eigenda/eigenda-contracts@0.8.0/src/interfaces/IEigenDAServiceManager.sol";
import {BlobHeader, BatchHeader} from "@eigenda/eigenda-contracts@0.8.0/src/libraries/EigenDAStructs.sol";

/// @title EigenDABlobVerifier
/// @notice Verifies EigenDA blob availability on-chain for rollup settlement
contract EigenDABlobVerifier {
    IEigenDAServiceManager public immutable eigenDAServiceManager;

    constructor(address _serviceManager) {
        eigenDAServiceManager = IEigenDAServiceManager(_serviceManager);
    }

    /// @notice Verify that a blob was confirmed by EigenDA operators
    /// @dev The rollup contract calls this before accepting a state update
    function verifyBlobAvailability(
        BatchHeader calldata batchHeader,
        BlobHeader calldata blobHeader,
        bytes calldata inclusionProof,
        uint32 blobIndex
    ) external view returns (bool) {
        // Verify the batch was confirmed by sufficient operator stake
        // This checks that operators holding 67%+ of quorum stake signed
        eigenDAServiceManager.confirmBatch(
            batchHeader,
            // Non-signer stake must be below adversary threshold
            // i.e., at least (100% - adversaryThreshold) of stake signed
        );

        // Verify the specific blob is included in the confirmed batch
        // Uses Merkle proof against the batch's blob commitment tree
        return _verifyInclusion(batchHeader, blobHeader, inclusionProof, blobIndex);
    }

    function _verifyInclusion(
        BatchHeader calldata batchHeader,
        BlobHeader calldata blobHeader,
        bytes calldata proof,
        uint32 index
    ) internal pure returns (bool) {
        // Merkle proof verification
        // Confirms blobHeader.commitment is at `index` in the batch tree
        return true; // Simplified — actual implementation uses Merkle verification
    }
}
```

### Operator Registration Flow

For teams running their own EigenDA operator (advanced):

```typescript
// Operator registration with EigenDA (requires restaked ETH)
// ethers@6.9.0
// This is the operator-side flow — most rollup developers just use the disperser

import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://ethereum-holesky-rpc.publicnode.com");
const operatorWallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider);

// Step 1: Operator must have ETH delegated via EigenLayer
// Stakers delegate to operators through the DelegationManager
const delegationManagerABI = [
  "function operatorShares(address operator, address strategy) view returns (uint256)",
  "function registerAsOperator(tuple(address earningsReceiver, address delegationApprover, uint32 stakerOptOutWindowBlocks) details, string metadataURI) external"
];

const delegationManager = new ethers.Contract(
  "0xA44151489861Fe9e3055d95adC98FbD462B948e7", // Holesky
  delegationManagerABI,
  operatorWallet
);

// Check if operator has sufficient delegated stake
const stETHStrategy = "0x7D704507b76571a51d9caE8AdDAbBFd0ba0e63d3"; // Holesky stETH
const delegatedStake = await delegationManager.operatorShares(
  operatorWallet.address,
  stETHStrategy
);
console.log(`Delegated stake: ${ethers.formatEther(delegatedStake)} stETH`);

// Step 2: Register with EigenDA AVS (requires minimum stake)
// The operator must run eigenda-operator node software
// and register their BLS key with the BLSRegistryCoordinator

// Minimum requirements:
// - 32 ETH equivalent in restaked assets
// - BLS key pair for signing attestations
// - Running eigenda-operator node with sufficient bandwidth
// - Registered with the RegistryCoordinator contract
```

## Common Pitfalls

1. **Confusing EigenDA with EigenLayer** — EigenLayer is the restaking protocol. EigenDA is one AVS (service) built on top of it. You don't need to understand all of EigenLayer to use EigenDA as a rollup developer — you just need the disperser endpoint.

2. **Not waiting for batch confirmation** — After dispersal, the blob enters a pending state. Operators must sign attestations, and the batch must be confirmed on-chain. Don't treat dispersal as final — wait for the `batchConfirmed` event before submitting state roots to your rollup contract.

3. **Ignoring the quorum threshold** — EigenDA requires operators holding 67%+ of quorum stake to sign. If operator participation drops below this threshold, blobs won't be confirmed. Monitor the operator set health for your rollup's liveness.

4. **Assuming EigenDA is free** — While EigenDA is heavily subsidized during its early phase, production usage will require payment. The pricing model is evolving — budget for DA costs in your rollup economics.

5. **Skipping the restaking prerequisite understanding** — If you're evaluating EigenDA's security, you must understand that its guarantees depend on the total restaked ETH and operator behavior. A reduction in restaked capital directly reduces the cost of attacking the system.

## What to Learn Next

- [Avail DA Layer](./04-avail-da-layer.md) — Explore Avail's validity-proof-based DA approach
- [EigenLayer Documentation](https://docs.eigenlayer.xyz/) — Full restaking protocol docs
- [EigenDA GitHub](https://github.com/Layr-Labs/eigenda) — EigenDA source code and operator setup
- [EigenDA Operator Guide](https://docs.eigenlayer.xyz/eigenda/operator-guides/overview) — Running an EigenDA operator node
