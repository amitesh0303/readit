# Celestia DA Integration: Modular Data Availability for Cosmos Chains

**Track:** Cosmos SDK & IBC Development
**Level:** Advanced
**Read time:** 13 min

---

## The Problem

Your Cosmos chain produces blocks, but storing all transaction data on-chain is expensive and limits throughput. As your chain grows, full nodes need to download and store every byte of historical data. Celestia offers a solution: post your block data to a dedicated data availability (DA) layer, and your chain only needs to store state roots and DA commitments. This is the "modular" approach — separate execution from data availability. But integrating Celestia with a Cosmos SDK chain requires understanding namespaces, blob submissions, and DA proofs.

## Core Concepts

### Modular vs Monolithic Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Monolithic vs Modular Chain Architecture         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Monolithic (traditional Cosmos chain):                 │
│  └── Execution + Consensus + DA all in one              │
│  └── Every validator stores all data forever            │
│  └── Throughput limited by DA bandwidth                 │
│                                                         │
│  Modular (with Celestia DA):                            │
│  └── Execution: Your Cosmos chain                       │
│  └── Consensus: CometBFT (your validators)             │
│  └── Data Availability: Celestia                        │
│  └── Validators only need state + DA proofs             │
│  └── Light nodes verify via Data Availability Sampling  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### How Celestia DA Works

Celestia uses a unique approach called Data Availability Sampling (DAS):

1. Block producers arrange data in a 2D Reed-Solomon encoded matrix
2. Light nodes sample random cells from the matrix
3. If enough random samples are available, the full data is available with high probability
4. No light node needs to download the full block

### Posting Blobs to Celestia

```go
// Posting data blobs to Celestia from a Cosmos chain
// celestia-app@v1.11.0
// Source: https://github.com/celestiaorg/celestia-app

package da

import (
	"context"
	"fmt"

	"github.com/celestiaorg/celestia-app/v2/pkg/appconsts"
	"github.com/celestiaorg/celestia-app/v2/pkg/namespace"
	blobtypes "github.com/celestiaorg/celestia-app/v2/x/blob/types"
	"github.com/celestiaorg/go-square/blob"
	appns "github.com/celestiaorg/go-square/namespace"
	nodeblob "github.com/celestiaorg/celestia-node/blob"
	nodeclient "github.com/celestiaorg/celestia-node/api/rpc/client"
)

// CelestiaDAClient handles posting and retrieving data from Celestia
type CelestiaDAClient struct {
	client    *nodeclient.Client
	namespace appns.Namespace
	gasPrice  float64
}

// NewCelestiaDAClient creates a new DA client
func NewCelestiaDAClient(nodeURL string, authToken string, namespaceHex string) (*CelestiaDAClient, error) {
	client, err := nodeclient.NewClient(context.Background(), nodeURL, authToken)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Celestia node: %w", err)
	}

	// Create a namespace for your chain's data
	// Namespaces partition Celestia's data space — your chain only downloads its own namespace
	ns, err := appns.NewV0([]byte(namespaceHex))
	if err != nil {
		return nil, fmt.Errorf("invalid namespace: %w", err)
	}

	return &CelestiaDAClient{
		client:    client,
		namespace: ns,
		gasPrice:  0.002, // TIA per gas unit
	}, nil
}

// SubmitBlockData posts a block's transaction data to Celestia
func (c *CelestiaDAClient) SubmitBlockData(ctx context.Context, blockData []byte) (uint64, error) {
	// Create a blob with the block data
	dataBlob, err := nodeblob.NewBlobV0(c.namespace, blockData)
	if err != nil {
		return 0, fmt.Errorf("failed to create blob: %w", err)
	}

	// Submit the blob to Celestia
	// Returns the height at which the blob was included
	height, err := c.client.Blob.Submit(ctx, []*nodeblob.Blob{dataBlob}, c.gasPrice)
	if err != nil {
		return 0, fmt.Errorf("failed to submit blob: %w", err)
	}

	fmt.Printf("Block data posted to Celestia at height %d\n", height)
	return height, nil
}

// RetrieveBlockData fetches block data from Celestia by height
func (c *CelestiaDAClient) RetrieveBlockData(ctx context.Context, height uint64) ([]byte, error) {
	// Get all blobs in our namespace at the given height
	blobs, err := c.client.Blob.GetAll(ctx, height, []appns.Namespace{c.namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve blobs at height %d: %w", height, err)
	}

	if len(blobs) == 0 {
		return nil, fmt.Errorf("no blobs found at height %d in namespace", height)
	}

	// Return the first blob's data (in production, handle multiple blobs)
	return blobs[0].Data, nil
}

// VerifyInclusion verifies that data was included in a Celestia block
func (c *CelestiaDAClient) VerifyInclusion(ctx context.Context, height uint64, dataBlob *nodeblob.Blob) (bool, error) {
	// Get the inclusion proof
	proof, err := c.client.Blob.GetProof(ctx, height, c.namespace, dataBlob.Commitment)
	if err != nil {
		return false, fmt.Errorf("failed to get inclusion proof: %w", err)
	}

	// Verify the proof against the data root
	valid, err := proof.Verify(dataBlob.Commitment)
	if err != nil {
		return false, fmt.Errorf("proof verification failed: %w", err)
	}

	return valid, nil
}
```

### Setting Up a Celestia Light Node

```shell
# Install celestia-node v0.16.0
# Source: https://github.com/celestiaorg/celestia-node
cd $HOME
git clone https://github.com/celestiaorg/celestia-node.git
cd celestia-node
git checkout v0.16.0
make build
make install

celestia version
```

```
Expected output:
Semantic version: v0.16.0
```

```shell
# Initialize a light node for Mocha testnet
celestia light init --p2p.network mocha

# Start the light node
celestia light start --core.ip rpc-mocha.pops.one --p2p.network mocha

# Get your auth token (needed for RPC calls)
celestia light auth admin --p2p.network mocha
```

```
Expected output:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

```shell
# Get testnet TIA tokens
# Celestia Mocha testnet faucet: https://faucet.celestia-mocha.com/
# Discord faucet: https://discord.gg/celestiacommunity (use #mocha-faucet channel)

# Check your balance
celestia state balance --node.store ~/.celestia-light-mocha-4
```

### Rollmint: Cosmos SDK + Celestia DA

Rollmint (formerly Rollkit) replaces CometBFT with a rollup-style sequencer that posts data to Celestia:

```shell
# Install Rollmint for Cosmos SDK integration
# rollmint@v0.13.0
go get github.com/rollmint/rollmint@v0.13.0

# In your chain's main.go, replace CometBFT with Rollmint:
# Instead of:
#   server.NewRootCmd(app.DefaultNodeHome, app.NewApp)
# Use:
#   rollmint.NewRootCmd(app.DefaultNodeHome, app.NewApp)
```

```go
// Rollmint configuration for Celestia DA
// rollmint@v0.13.0

package main

import (
	"github.com/rollmint/rollmint/config"
)

// RollmintConfig configures the rollup to use Celestia for DA
func DefaultRollmintConfig() config.NodeConfig {
	return config.NodeConfig{
		// Celestia DA configuration
		DALayer:    "celestia",
		DAConfig:   `{"base_url":"http://localhost:26658","timeout":60000000000,"gas_limit":6000000,"fee":6000}`,
		// Namespace for this rollup's data on Celestia
		NamespaceID: "000000000000000000000000000000000000000000000000deadbeef",
		// Block production settings
		BlockTime:       "10s",
		// Aggregator (sequencer) mode
		Aggregator:      true,
	}
}
```

### DA Cost Comparison

| DA Layer | Cost per MB | Finality | Throughput |
|---|---|---|---|
| Ethereum calldata | ~$500-2000 | ~12 min | ~80 KB/s |
| Ethereum blobs (4844) | ~$5-50 | ~12 min | ~375 KB/s |
| Celestia | ~$0.01-0.10 | ~12 sec | ~6.67 MB/s |
| Self-hosted (your chain) | Gas costs only | Instant | Limited by block size |

## Common Pitfalls

1. **Confusing DA with execution** — Celestia only stores data and proves it was available. It does not execute transactions or validate state transitions. Your Cosmos chain still handles execution. Celestia just ensures anyone can reconstruct the chain's history.

2. **Namespace collisions** — If you use a common namespace, other chains' data will be mixed with yours. Always use a unique namespace derived from your chain ID or a random value. Namespace bytes must be exactly 29 bytes (v0 format).

3. **Not handling DA failures gracefully** — If Celestia is temporarily unavailable, your chain should queue data and retry rather than halting. Implement a fallback buffer and exponential backoff for blob submissions.

4. **Ignoring blob size limits** — Celestia has a maximum blob size per block (currently ~2MB per blob, ~8MB total per block). If your chain produces blocks larger than this, you need to split data across multiple blobs or multiple Celestia blocks.

## What to Learn Next

- [Multi-Hop IBC Routing](./07-multi-hop-ibc-routing.md) — Route packets across multiple chains with Packet Forward Middleware
- [Celestia Documentation](https://docs.celestia.org/) — Official Celestia developer documentation
- [Celestia Node GitHub](https://github.com/celestiaorg/celestia-node) — Light node and full node source code
- [Rollmint GitHub](https://github.com/rollmint/rollmint) — Cosmos SDK rollup framework using Celestia DA
