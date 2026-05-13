# Cosmos SDK Architecture: Building Sovereign Application Chains

**Track:** Cosmos SDK & IBC Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You want to build a blockchain application with full sovereignty over its execution environment — custom transaction types, your own validator set, and the ability to upgrade without hard forks. General-purpose smart contract platforms force you into their VM constraints, gas models, and governance. Cosmos SDK lets you build a purpose-built chain from modular components, but the architecture is unlike anything in the EVM world. Without understanding how ABCI, modules, keepers, and the store layer fit together, you'll struggle to build anything beyond a scaffold.

## Core Concepts

### The Cosmos Architecture Stack

Cosmos separates consensus from application logic using the Application Blockchain Interface (ABCI):

```
┌─────────────────────────────────────────────────────────┐
│              Cosmos Application Architecture             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Application Layer (Your Code)                          │
│  └── Custom Modules (x/staking, x/bank, x/your-module) │
│  └── Keepers (module-to-module interfaces)              │
│  └── Message Handlers (transaction processing)          │
│       ↕ ABCI (Application Blockchain Interface)         │
│  CometBFT (Consensus Engine)                            │
│  └── Byzantine Fault Tolerant consensus                 │
│  └── Block production (~6s block time)                  │
│  └── P2P networking and mempool                         │
│  └── Instant finality (no reorgs)                       │
│       ↕                                                 │
│  State Store (IAVL+ Tree)                               │
│  └── Merkle-ized key-value store                        │
│  └── Historical state proofs                            │
│  └── Deterministic state transitions                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Module Architecture

Every Cosmos chain is composed of modules. Each module owns a slice of state and exposes messages (transactions) and queries:

```go
// Module structure in Cosmos SDK v0.50+
// Source: https://github.com/cosmos/cosmos-sdk

package mymodule

import (
	"context"

	"cosmossdk.io/core/appmodule"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

// Keeper holds the module's state access and cross-module references
type Keeper struct {
	storeService store.KVStoreService
	cdc          codec.Codec
	authority    string // governance module address

	bankKeeper   types.BankKeeper   // interface to x/bank
	stakingKeeper types.StakingKeeper // interface to x/staking
}

// NewKeeper creates a new module keeper
func NewKeeper(
	storeService store.KVStoreService,
	cdc codec.Codec,
	authority string,
	bankKeeper types.BankKeeper,
) Keeper {
	return Keeper{
		storeService: storeService,
		cdc:          cdc,
		authority:    authority,
		bankKeeper:   bankKeeper,
	}
}

// MsgServer implements the module's transaction handlers
type MsgServer struct {
	keeper Keeper
}

// CreateRecord handles the MsgCreateRecord transaction
func (ms MsgServer) CreateRecord(ctx context.Context, msg *types.MsgCreateRecord) (*types.MsgCreateRecordResponse, error) {
	sdkCtx := sdk.UnwrapSDKContext(ctx)

	record := types.Record{
		Creator: msg.Creator,
		Data:    msg.Data,
		Height:  sdkCtx.BlockHeight(),
	}

	// Store the record in module state
	err := ms.keeper.SetRecord(ctx, record)
	if err != nil {
		return nil, err
	}

	// Emit event for indexers
	sdkCtx.EventManager().EmitEvent(
		sdk.NewEvent("record_created",
			sdk.NewAttribute("creator", msg.Creator),
			sdk.NewAttribute("height", fmt.Sprintf("%d", sdkCtx.BlockHeight())),
		),
	)

	return &types.MsgCreateRecordResponse{Id: record.Id}, nil
}
```

### Scaffolding a Chain with Ignite CLI

Ignite CLI (formerly Starport) generates the boilerplate for a new Cosmos SDK chain:

```shell
# Install Ignite CLI v28.x
curl https://get.ignite.com/cli! | bash
ignite version
```

```
Expected output:
Ignite CLI version: v28.5.1
```

```shell
# Scaffold a new chain
ignite scaffold chain github.com/myorg/mychain --no-module

# Add a custom module
ignite scaffold module mymodule --dep bank,staking

# Add a message type (transaction)
ignite scaffold message create-record data:string --module mymodule

# Add a query
ignite scaffold query get-record id:uint64 --response data:string,creator:string --module mymodule

# Start the local development chain
ignite chain serve
```

```
Expected output:
🌍 Tendermint node: http://0.0.0.0:26657
🌍 Blockchain API: http://0.0.0.0:1317
🌍 Token faucet:   http://0.0.0.0:4500
```

### ABCI Lifecycle

Every transaction flows through a deterministic lifecycle:

1. **CheckTx** — Validates transaction format and signatures (mempool admission)
2. **BeginBlock** — Module hooks that run at the start of each block (e.g., inflation minting)
3. **DeliverTx** — Executes the transaction's message handler, modifies state
4. **EndBlock** — Module hooks at block end (e.g., validator set updates)
5. **Commit** — Persists state changes to the IAVL+ tree, produces state root

```go
// BeginBlocker example — runs at the start of every block
// cosmos-sdk@v0.50.6
func (am AppModule) BeginBlock(ctx context.Context) error {
	sdkCtx := sdk.UnwrapSDKContext(ctx)

	// Example: expire records older than 1000 blocks
	expiredRecords := am.keeper.GetExpiredRecords(ctx, sdkCtx.BlockHeight()-1000)
	for _, record := range expiredRecords {
		if err := am.keeper.DeleteRecord(ctx, record.Id); err != nil {
			return err
		}
	}

	return nil
}
```

### Key Differences from EVM Chains

| Feature | EVM (Ethereum/L2s) | Cosmos SDK |
|---|---|---|
| Execution model | Shared VM, gas metered | Native Go, custom logic |
| State model | Account + storage slots | Key-value store (IAVL+) |
| Finality | Probabilistic (PoS ~12min) | Instant (CometBFT) |
| Upgrades | Proxy patterns, immutable | Governance proposals, live upgrades |
| Interop | Bridges, L1 settlement | IBC protocol (native) |
| Sovereignty | Shared security | Own validator set |

## Common Pitfalls

1. **Treating Cosmos like a smart contract platform** — You're not deploying contracts to someone else's chain. You're building the chain itself. Every module is compiled into the binary. This means upgrades require coordinated validator binary updates (or governance-triggered software upgrades).

2. **Ignoring determinism requirements** — All state transitions must be deterministic. Using `time.Now()`, random numbers, or floating-point math in message handlers will cause consensus failures. Use `ctx.BlockTime()` and integer math only.

3. **Circular keeper dependencies** — Modules reference each other via keeper interfaces. If module A depends on module B and B depends on A, you'll hit initialization panics. Design one-directional dependencies or use hooks/events for decoupling.

4. **Skipping the AnteHandler chain** — The AnteHandler runs before every transaction (signature verification, fee deduction, gas metering). Custom AnteHandlers that don't call `next()` will break the chain for all subsequent decorators.

## What to Learn Next

- [IBC Protocol Mechanics](./02-ibc-protocol-mechanics.md) — How chains communicate via the Inter-Blockchain Communication protocol
- [Cosmos SDK Documentation](https://docs.cosmos.network/v0.50/) — Official module development guide
- [Cosmos SDK GitHub](https://github.com/cosmos/cosmos-sdk) — Source code and example modules
