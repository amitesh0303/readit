# Cosmos SDK Chain Creation: From Scaffold to Running Devnet

**Track:** Appchain Frameworks
**Lesson:** 1 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You want to launch a sovereign application chain with full control over consensus, governance, and fee logic. General-purpose L1s force you into their execution model — you can't change block times, customize transaction ordering, or add native protocol-level features. Cosmos SDK lets you build a purpose-built blockchain from scratch, but the tooling landscape (Ignite CLI, raw SDK scaffolding, CometBFT configuration) is overwhelming without a clear path from zero to running devnet.

## Core Concepts

### Why Cosmos SDK for Appchains

Cosmos SDK is the most battle-tested appchain framework. Chains like dYdX, Osmosis, Celestia, and Injective all run on it. Key properties:

- **Sovereign consensus**: Your chain runs its own CometBFT (formerly Tendermint) validator set
- **Custom modules**: Add native protocol logic (DEX, NFT marketplace, oracle) at the consensus layer
- **IBC-native**: Built-in cross-chain communication with 50+ connected chains
- **Go-based**: All chain logic is written in Go — no VM overhead, no gas metering at the protocol level

### Framework Comparison

| Property | Cosmos SDK | OP Stack | Polygon CDK | Starknet Appchains | Saga | Avalanche Subnets |
|---|---|---|---|---|---|---|
| **Consensus** | CometBFT (BFT) | Single sequencer + L1 fraud proofs | Single sequencer + ZK proofs | Single sequencer + STARK proofs | Interchain Security (CometBFT) | Snowman (DAG-based) |
| **Languages** | Go (modules) | Solidity (EVM) | Solidity (EVM) | Cairo | Go (Cosmos SDK) | Solidity (EVM) or custom VM |
| **Deploy time** | ~30 min (devnet) | ~45 min (devnet) | ~60 min (devnet) | ~45 min (devnet) | ~15 min (chainlet) | ~30 min (local subnet) |
| **Finality** | 1-6 seconds (instant) | 7 days (challenge window) | ~30 min (ZK proof generation) | ~hours (STARK proof) | 1-6 seconds (instant) | <1 second (sub-second) |
| **Data Availability** | Self-hosted or Celestia | Ethereum L1 (blobs) | Ethereum L1 or DAC | Ethereum L1 | Inherited from hub | Self-hosted or external |

### Prerequisites

```shell
# Install Go 1.22+ (required for Cosmos SDK v0.50+)
# Last verified: 2025-01-15
# macOS
brew install go@1.22

# Linux
wget https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
```

```
Expected output:
go version go1.22.5 linux/amd64
```

```shell
# Install Ignite CLI v28 (chain scaffolding tool)
# Source: https://github.com/ignite/cli
curl https://get.ignite.com/cli@v28.5.1! | bash
```

```
Expected output:
✔ Done! Ignite CLI v28.5.1 is installed.
```

```shell
# Verify installations
go version
ignite version
```

```
Expected output:
go version go1.22.5 linux/amd64
Ignite CLI version: v28.5.1
```

### Scaffold a New Chain

Ignite CLI generates a complete chain scaffold with CometBFT consensus, a working genesis, and module boilerplate:

```shell
# Create a new chain called "myappchain"
ignite scaffold chain myappchain --address-prefix myapp
cd myappchain
```

```
Expected output:
⭐️ Successfully created a new blockchain 'myappchain'.
👉 Get started with the following commands:

 cd myappchain
 ignite chain serve

Documentation: https://docs.ignite.com
```

The generated structure:

```
myappchain/
├── app/                    # Application wiring (module registration)
│   ├── app.go             # Main app struct, module manager
│   └── app_config.go      # Dependency injection config
├── cmd/                    # CLI entry points
│   └── myappchaind/       # Daemon binary
├── proto/                  # Protobuf definitions for messages/queries
│   └── myappchain/
├── x/                      # Custom modules live here
│   └── myappchain/
│       ├── keeper/        # State management
│       ├── types/         # Message types, genesis state
│       └── module.go      # Module interface implementation
├── config.yml             # Ignite chain configuration
├── go.mod                 # Go dependencies
└── go.sum
```

### Add a Custom Module

Let's add a simple "registry" module that stores key-value pairs on-chain:

```shell
# Scaffold a new module with a message type
ignite scaffold module registry

# Add a message that stores a record
ignite scaffold message create-record key value --module registry
```

```
Expected output:
🎉 Created a new module 'registry'.
modify app/app_config.go
modify app/app.go
create x/registry/...

🎉 Created a message 'create-record'.
modify proto/myappchain/registry/tx.proto
modify x/registry/keeper/msg_server_create_record.go
```

Now implement the keeper logic:

```go
// x/registry/keeper/msg_server_create_record.go
package keeper

import (
	"context"
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types" // cosmos-sdk@v0.50.6
	"myappchain/x/registry/types"
)

func (k msgServer) CreateRecord(
	goCtx context.Context,
	msg *types.MsgCreateRecord,
) (*types.MsgCreateRecordResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Validate key length
	if len(msg.Key) == 0 || len(msg.Key) > 128 {
		return nil, fmt.Errorf("key must be 1-128 characters, got %d", len(msg.Key))
	}

	// Store the record in the module's KV store
	store := ctx.KVStore(k.storeKey)
	recordKey := []byte(fmt.Sprintf("record/%s", msg.Key))

	// Check if key already exists
	if store.Has(recordKey) {
		return nil, fmt.Errorf("record with key %s already exists", msg.Key)
	}

	store.Set(recordKey, []byte(msg.Value))

	// Emit event for indexers
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			"record_created",
			sdk.NewAttribute("creator", msg.Creator),
			sdk.NewAttribute("key", msg.Key),
			sdk.NewAttribute("value", msg.Value),
		),
	)

	return &types.MsgCreateRecordResponse{}, nil
}
```

### Configure the Chain

Edit `config.yml` to customize your chain parameters:

```yaml
# config.yml — Ignite chain configuration
version: 1
build:
  proto:
    path: proto
accounts:
  - name: alice
    coins:
      - 20000token
      - 200000000stake
  - name: bob
    coins:
      - 10000token
      - 100000000stake
validators:
  - name: alice
    bonded: 100000000stake
    app:
      minimum-gas-prices: "0.025stake"
    config:
      consensus:
        timeout_commit: "2s"    # Block time — 2 seconds
        timeout_propose: "3s"
    client:
      chain-id: "myappchain-1"
genesis:
  chain_id: "myappchain-1"
  app_state:
    staking:
      params:
        bond_denom: "stake"
        unbonding_time: "1814400s"  # 21 days
    mint:
      minter:
        inflation: "0.130000000000000000"
```

### Launch the Devnet

```shell
# Build and start the chain (single-validator devnet)
ignite chain serve --reset-once
```

```
Expected output:
  Blockchain is running

  ✔ Added account alice with address myapp1... and mnemonic:
    [12-word mnemonic]
  ✔ Added account bob with address myapp1... and mnemonic:
    [12-word mnemonic]

  🌍 Tendermint node: http://0.0.0.0:26657
  🌍 Blockchain API: http://0.0.0.0:1317
  🌍 Token faucet:   http://0.0.0.0:4500
```

### Interact with Your Chain

```shell
# Query the chain status
curl http://localhost:26657/status | jq '.result.node_info.network'
```

```
Expected output:
"myappchain-1"
```

```shell
# Submit a transaction using the CLI
myappchaind tx registry create-record "hello" "world" \
  --from alice \
  --chain-id myappchain-1 \
  --keyring-backend test \
  --yes
```

```
Expected output:
code: 0
txhash: A1B2C3D4E5F6...
```

```shell
# Query the stored record
myappchaind query registry show-record "hello"
```

```
Expected output:
record:
  key: hello
  value: world
  creator: myapp1...
```

### Multi-Validator Testnet

For a more realistic setup, launch a 4-validator testnet:

```shell
# Generate testnet files for 4 validators
ignite network chain init myappchain-1 \
  --validator-count 4 \
  --output-dir ./testnet
```

```go
// scripts/setup_testnet.go — Programmatic testnet configuration
package main

import (
	"fmt"
	"os"
	"os/exec"
)

func main() {
	validators := []string{"val1", "val2", "val3", "val4"}
	chainID := "myappchain-testnet-1"

	for i, val := range validators {
		port := 26657 + (i * 100)
		cmd := exec.Command("myappchaind", "init", val,
			"--chain-id", chainID,
			"--home", fmt.Sprintf("./testnet/%s", val),
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Printf("Failed to init %s: %v\n", val, err)
			os.Exit(1)
		}
		fmt.Printf("Initialized %s on port %d\n", val, port)
	}
}
```

## Common Pitfalls

1. **Using an outdated Ignite CLI version with Cosmos SDK v0.50** — Ignite CLI v28+ is required for SDK v0.50. Older versions generate incompatible module scaffolds. Always check compatibility at https://docs.ignite.com/references/compatibility.

2. **Forgetting to register the module in `app.go`** — Ignite auto-registers scaffolded modules, but if you manually create one, you must add it to both `ModuleBasics` and the module manager in `app/app.go`. Missing registration causes silent failures where transactions succeed but state never updates.

3. **Setting `timeout_commit` too low** — Block times under 1 second cause validator synchronization issues on real networks. Use 2-6 seconds for testnets. Sub-second blocks only work reliably in single-validator devnets.

4. **Not handling store key collisions** — Multiple modules sharing the same store key prefix will overwrite each other's data. Always namespace your KV store keys with the module name (e.g., `registry/record/key`).

5. **Ignoring gas metering in custom modules** — By default, Cosmos SDK modules don't charge gas for state reads/writes unless you explicitly call `ctx.GasMeter().ConsumeGas()`. Without gas metering, a single transaction can perform unbounded computation.

## What to Learn Next

- [OP Stack Rollup Deployment](./02-op-stack-rollup-deployment.md) — Deploy an EVM-compatible rollup using Optimism's OP Stack
- [Cosmos SDK Documentation](https://docs.cosmos.network/v0.50/) — Official SDK reference
- [Ignite CLI GitHub](https://github.com/ignite/cli) — Source code and examples for chain scaffolding
- [IBC Protocol Specification](https://ibc.cosmos.network/) — Cross-chain communication between Cosmos chains
