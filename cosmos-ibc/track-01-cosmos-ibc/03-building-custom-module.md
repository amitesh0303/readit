# Building a Custom Cosmos SDK Module

**Track:** Cosmos SDK & IBC Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

You need custom on-chain logic that doesn't exist in any standard Cosmos SDK module. Maybe it's a DEX order book, a name service, or a cross-chain oracle. You need to define your own state, messages, queries, and lifecycle hooks — and wire them into the chain binary. The module system is powerful but has strict conventions around protobuf definitions, keeper patterns, and registration. Getting any of these wrong means your chain won't compile or, worse, will panic at runtime.

## Core Concepts

### Module Scaffolding with Ignite CLI

Start by scaffolding the module structure:

```shell
# Scaffold a new module with bank dependency (for handling coins)
# ignite@v28.5.1
ignite scaffold module nameservice --dep bank

# Scaffold a message (transaction type)
ignite scaffold message register-name name:string value:string bid:coin --module nameservice

# Scaffold a query
ignite scaffold query resolve-name name:string --response value:string,owner:string --module nameservice

# Scaffold a map (indexed storage type)
ignite scaffold map whois value:string owner:string price:string --index name --module nameservice

# Verify the chain compiles
ignite chain build
```

```
Expected output:
🛠  Building proto...
📦 Installing dependencies...
🛠  Building the blockchain...
✔ Build completed!
```

### Protobuf Message Definitions

All messages and queries are defined in protobuf. Ignite generates these, but you'll need to customize them:

```go
// proto/nameservice/tx.proto (generated, then customized)
// This defines the transaction types your module accepts

// MsgRegisterName registers a new name in the name service
// cosmos-sdk@v0.50.6
syntax = "proto3";
package myorg.nameservice;

import "cosmos/msg/v1/msg.proto";
import "cosmos/base/v1beta1/coin.proto";
import "gogoproto/gogo.proto";

option go_package = "github.com/myorg/mychain/x/nameservice/types";

service Msg {
  option (cosmos.msg.v1.service) = true;

  rpc RegisterName(MsgRegisterName) returns (MsgRegisterNameResponse);
  rpc UpdateName(MsgUpdateName) returns (MsgUpdateNameResponse);
  rpc DeleteName(MsgDeleteName) returns (MsgDeleteNameResponse);
}

message MsgRegisterName {
  option (cosmos.msg.v1.signer) = "creator";

  string creator = 1;
  string name = 2;
  string value = 3;
  cosmos.base.v1beta1.Coin bid = 4 [(gogoproto.nullable) = false];
}

message MsgRegisterNameResponse {}
```

### Implementing the Keeper

The keeper is where your business logic lives. It manages state access and enforces rules:

```go
// x/nameservice/keeper/msg_server.go
// cosmos-sdk@v0.50.6

package keeper

import (
	"context"
	"fmt"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"

	"github.com/myorg/mychain/x/nameservice/types"
)

type msgServer struct {
	Keeper
}

func NewMsgServerImpl(keeper Keeper) types.MsgServer {
	return &msgServer{Keeper: keeper}
}

// RegisterName handles name registration with bidding
func (k msgServer) RegisterName(ctx context.Context, msg *types.MsgRegisterName) (*types.MsgRegisterNameResponse, error) {
	sdkCtx := sdk.UnwrapSDKContext(ctx)

	// Check if name already exists
	existing, found := k.GetWhois(ctx, msg.Name)
	if found {
		// Name exists — new bid must be higher than current price
		currentPrice, err := sdk.ParseCoinNormalized(existing.Price)
		if err != nil {
			return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "invalid existing price")
		}
		if msg.Bid.IsLT(currentPrice) {
			return nil, errorsmod.Wrapf(
				sdkerrors.ErrInsufficientFunds,
				"bid %s is less than current price %s",
				msg.Bid.String(), currentPrice.String(),
			)
		}

		// Refund previous owner
		prevOwner, err := sdk.AccAddressFromBech32(existing.Owner)
		if err != nil {
			return nil, err
		}
		refund, err := sdk.ParseCoinNormalized(existing.Price)
		if err != nil {
			return nil, err
		}
		if err := k.bankKeeper.SendCoinsFromModuleToAccount(
			ctx, types.ModuleName, prevOwner, sdk.NewCoins(refund),
		); err != nil {
			return nil, err
		}
	}

	// Collect bid from new owner
	creator, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return nil, err
	}
	if err := k.bankKeeper.SendCoinsFromAccountToModule(
		ctx, creator, types.ModuleName, sdk.NewCoins(msg.Bid),
	); err != nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrInsufficientFunds, "cannot pay bid")
	}

	// Store the new whois record
	whois := types.Whois{
		Name:  msg.Name,
		Value: msg.Value,
		Owner: msg.Creator,
		Price: msg.Bid.String(),
	}
	k.SetWhois(ctx, whois)

	// Emit event
	sdkCtx.EventManager().EmitEvent(
		sdk.NewEvent("name_registered",
			sdk.NewAttribute("name", msg.Name),
			sdk.NewAttribute("owner", msg.Creator),
			sdk.NewAttribute("price", msg.Bid.String()),
		),
	)

	return &types.MsgRegisterNameResponse{}, nil
}
```

### Testing Your Module

```shell
# Run unit tests for the module
cd x/nameservice
go test ./... -v

# Run the full chain test suite
cd ../..
ignite chain serve --reset-once

# In another terminal, test the transaction
mychaind tx nameservice register-name alice.cosmos "192.168.1.1" 100stake \
  --from alice \
  --chain-id mychain \
  --keyring-backend test \
  --yes

# Query the registered name
mychaind query nameservice resolve-name alice.cosmos
```

```
Expected output:
value: "192.168.1.1"
owner: cosmos1abc...
```

### Wiring the Module into app.go

Every module must be registered in the chain's `app.go`:

```go
// app/app.go — registering your module
// cosmos-sdk@v0.50.6

import (
	nameservicemodule "github.com/myorg/mychain/x/nameservice/module"
	nameservicekeeper "github.com/myorg/mychain/x/nameservice/keeper"
	nameservicetypes "github.com/myorg/mychain/x/nameservice/types"
)

// In the App struct
type App struct {
	// ... other keepers
	NameserviceKeeper nameservicekeeper.Keeper
}

// In NewApp()
func NewApp(...) *App {
	// Initialize the keeper
	app.NameserviceKeeper = nameservicekeeper.NewKeeper(
		appCodec,
		runtime.NewKVStoreService(keys[nameservicetypes.StoreKey]),
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
		app.BankKeeper,
	)

	// Register the module
	app.ModuleManager.RegisterModules(
		nameservicemodule.NewAppModule(appCodec, app.NameserviceKeeper),
	)

	return app
}
```

## Common Pitfalls

1. **Forgetting to register the module store key** — If you add a new module but don't add its store key to the `app.go` key list, the keeper will panic on first state access. Always add `nameservicetypes.StoreKey` to the `keys` map.

2. **Non-deterministic message handlers** — Using maps (which have random iteration order in Go), `time.Now()`, or goroutines in message handlers will cause consensus failures. All validators must produce identical state transitions for the same input.

3. **Missing ValidateBasic()** — Every message type needs a `ValidateBasic()` method that checks field constraints before the message reaches the keeper. Without it, invalid messages consume gas and clutter error logs.

4. **Not handling genesis state** — Your module needs `InitGenesis` and `ExportGenesis` functions. Without them, chain upgrades and state exports will lose your module's data.

## What to Learn Next

- [Osmosis, Neutron, and dYdX Patterns](./04-osmosis-neutron-dydx.md) — Real-world module patterns from production Cosmos chains
- [Ignite CLI Documentation](https://docs.ignite.com/) — Full scaffolding and development guide
- [Cosmos SDK Module Tutorial](https://tutorials.cosmos.network/) — Step-by-step module building tutorial
