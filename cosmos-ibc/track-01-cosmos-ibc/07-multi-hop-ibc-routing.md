# Multi-Hop IBC Routing: Packet Forward Middleware

**Track:** Cosmos SDK & IBC Development
**Level:** Advanced
**Read time:** 12 min

---

## The Problem

You want to send ATOM from the Cosmos Hub to Osmosis, then to Neutron — but IBC only supports direct point-to-point channels. Without multi-hop routing, users must manually execute separate transfers on each intermediate chain, paying gas on each one and waiting for each packet to finalize. Packet Forward Middleware (PFM) solves this by enabling automatic forwarding: a single transaction on the source chain routes tokens through intermediate chains to the final destination. But configuring PFM correctly requires understanding memo fields, timeout propagation, and error handling across multiple hops.

## Core Concepts

### The Multi-Hop Problem

Without PFM, transferring tokens across non-directly-connected chains requires manual steps:

```
Without PFM (manual multi-hop):
Chain A → Chain B → Chain C

Step 1: User sends from A to B (wait for finality)
Step 2: User sends from B to C (requires gas on B)
Step 3: If step 2 fails, tokens are stuck on B

With PFM (automatic forwarding):
Chain A → Chain B → Chain C

Step 1: User sends from A with forwarding memo
        B automatically forwards to C
        Single transaction, single gas payment on A
```

### Packet Forward Middleware Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Packet Forward Middleware (PFM)                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Source Chain (Chain A)                                  │
│  └── User submits IBC transfer with PFM memo            │
│  └── Memo contains forwarding instructions              │
│       ↓ IBC packet (channel-0)                          │
│  Intermediate Chain (Chain B) — has PFM installed        │
│  └── Receives packet, parses memo                       │
│  └── Automatically initiates forward transfer           │
│  └── Holds escrow until final ack/timeout               │
│       ↓ IBC packet (channel-5)                          │
│  Destination Chain (Chain C)                             │
│  └── Receives tokens, sends acknowledgement             │
│  └── Ack propagates back through all hops               │
│                                                         │
│  Error Handling:                                        │
│  └── If any hop fails → tokens refunded to source       │
│  └── Timeout on any hop → full refund to sender         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### PFM Memo Format

The forwarding instructions are encoded in the IBC transfer memo field as JSON:

```go
// Constructing a PFM memo for multi-hop transfer
// ibc-go@v8.3.0, pfm@v8.0.0
// Source: https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware

package pfm

import (
	"encoding/json"
	"fmt"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	transfertypes "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// ForwardMetadata defines the PFM forwarding instructions
type ForwardMetadata struct {
	Receiver string           `json:"receiver"`
	Port     string           `json:"port"`
	Channel  string           `json:"channel"`
	Timeout  time.Duration    `json:"timeout,omitempty"`
	Retries  *uint8           `json:"retries,omitempty"`
	Next     *ForwardMetadata `json:"next,omitempty"` // For 3+ hop routes
}

// PacketMetadata wraps the forward instructions in the memo format
type PacketMetadata struct {
	Forward *ForwardMetadata `json:"forward"`
}

// BuildMultiHopTransfer creates an IBC transfer message with PFM memo
// Route: Source → Intermediate → Destination
func BuildMultiHopTransfer(
	sender sdk.AccAddress,
	intermediateReceiver string, // address on intermediate chain (can be empty for PFM)
	finalReceiver string,       // address on destination chain
	amount sdk.Coin,
	sourceChannel string,       // channel from source to intermediate
	forwardChannel string,      // channel from intermediate to destination
) (*transfertypes.MsgTransfer, error) {
	// Build the forwarding memo
	retries := uint8(2)
	metadata := PacketMetadata{
		Forward: &ForwardMetadata{
			Receiver: finalReceiver,
			Port:     "transfer",
			Channel:  forwardChannel,
			Timeout:  10 * time.Minute,
			Retries:  &retries,
		},
	}

	memoBytes, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal PFM memo: %w", err)
	}

	// Create the IBC transfer with the PFM memo
	msg := transfertypes.NewMsgTransfer(
		"transfer",
		sourceChannel,
		amount,
		sender.String(),
		intermediateReceiver, // PFM uses this as the intermediate handler
		clienttypes.ZeroHeight(),
		uint64(time.Now().Add(30 * time.Minute).UnixNano()),
		string(memoBytes), // The PFM forwarding instructions
	)

	return msg, nil
}

// BuildThreeHopTransfer creates a transfer across 3 chains
// Route: A → B → C → D
func BuildThreeHopTransfer(
	sender sdk.AccAddress,
	finalReceiver string,
	amount sdk.Coin,
	channelAtoB string,
	channelBtoC string,
	channelCtoD string,
) (*transfertypes.MsgTransfer, error) {
	retries := uint8(2)

	// Nested forwarding: B forwards to C, C forwards to D
	metadata := PacketMetadata{
		Forward: &ForwardMetadata{
			Receiver: finalReceiver, // intermediate receiver on B (PFM handles)
			Port:     "transfer",
			Channel:  channelBtoC,
			Timeout:  10 * time.Minute,
			Retries:  &retries,
			Next: &ForwardMetadata{
				Receiver: finalReceiver,
				Port:     "transfer",
				Channel:  channelCtoD,
				Timeout:  10 * time.Minute,
				Retries:  &retries,
			},
		},
	}

	memoBytes, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal PFM memo: %w", err)
	}

	msg := transfertypes.NewMsgTransfer(
		"transfer",
		channelAtoB,
		amount,
		sender.String(),
		finalReceiver,
		clienttypes.ZeroHeight(),
		uint64(time.Now().Add(60 * time.Minute).UnixNano()),
		string(memoBytes),
	)

	return msg, nil
}
```

### Installing PFM on Your Chain

```go
// Adding Packet Forward Middleware to your chain's app.go
// pfm@v8.0.0
// Source: https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware

package app

import (
	"github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v8/packetforward"
	packetforwardkeeper "github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v8/packetforward/keeper"
	packetforwardtypes "github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v8/packetforward/types"
)

type App struct {
	PacketForwardKeeper *packetforwardkeeper.Keeper
}

func NewApp(...) *App {
	// Initialize PFM keeper
	app.PacketForwardKeeper = packetforwardkeeper.NewKeeper(
		appCodec,
		keys[packetforwardtypes.StoreKey],
		app.TransferKeeper,
		app.IBCKeeper.ChannelKeeper,
		app.DistrKeeper,
		app.BankKeeper,
		app.IBCKeeper.ChannelKeeper,
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)

	// Stack PFM as middleware around the transfer module
	// Order matters: PFM wraps transfer, which wraps the base IBC module
	var transferStack porttypes.IBCModule
	transferStack = transfer.NewIBCModule(app.TransferKeeper)
	transferStack = packetforward.NewIBCMiddleware(
		transferStack,
		app.PacketForwardKeeper,
		0, // retries on timeout
		packetforwardkeeper.DefaultForwardTransferPacketTimeoutTimestamp,
		packetforwardkeeper.DefaultRefundTransferPacketTimeoutTimestamp,
	)

	// Register the stacked IBC module
	ibcRouter.AddRoute(transfertypes.ModuleName, transferStack)

	return app
}
```

### Testing Multi-Hop Transfers

```shell
# Test a multi-hop transfer: Cosmos Hub → Osmosis → Neutron
# Using gaiad CLI with PFM memo

# First, check available channels
gaiad query ibc channel channels --node https://rpc.cosmos.network:443

# Send ATOM from Hub to Neutron via Osmosis
# channel-141 = Hub→Osmosis, channel-874 = Osmosis→Neutron
gaiad tx ibc-transfer transfer transfer channel-141 \
  "osmo1intermediate..." \
  1000000uatom \
  --memo '{"forward":{"receiver":"neutron1final...","port":"transfer","channel":"channel-874","timeout":"10m","retries":2}}' \
  --from mykey \
  --chain-id cosmoshub-4 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uatom \
  --yes
```

```
Expected output:
code: 0
txhash: F7A8B9C0D1E2...
```

```shell
# Verify tokens arrived on Neutron
neutrond query bank balances neutron1final... \
  --node https://rpc-palvus.pion-1.ntrn.tech:443
```

### Testnet Deployment and Faucets

```shell
# Cosmos Hub testnet (theta-testnet-001)
# Faucet: https://faucet.cosmos.network/
gaiad config chain-id theta-testnet-001
gaiad config node https://rpc.sentry-01.theta-testnet.polypore.xyz:26657

# Osmosis testnet (osmo-test-5)
# Faucet: https://faucet.testnet.osmosis.zone/
osmosisd config chain-id osmo-test-5
osmosisd config node https://rpc.testnet.osmosis.zone:443

# Neutron testnet (pion-1)
# Faucet: https://docs.neutron.org/neutron/faq/#where-is-the-testnet-faucet
neutrond config chain-id pion-1
neutrond config node https://rpc-palvus.pion-1.ntrn.tech:443

# Request testnet tokens from each faucet before testing multi-hop routes
```

### IBC Channel Discovery

Finding the right channels for multi-hop routes:

```shell
# Query channels on Osmosis connected to Cosmos Hub
osmosisd query ibc channel channels \
  --node https://rpc.testnet.osmosis.zone:443 \
  --output json | jq '.channels[] | select(.counterparty.port_id == "transfer")'

# Use the IBC channel registry for mainnet routes
# https://github.com/cosmos/chain-registry/tree/master/_IBC
```

## Common Pitfalls

1. **Setting timeouts too short for multi-hop** — Each hop adds latency (relayer submission + block confirmation). A 5-minute timeout that works for single-hop will fail on a 3-hop route. Use at least 10 minutes per hop, so a 3-hop route needs 30+ minutes total timeout.

2. **Not checking PFM support on intermediate chains** — PFM must be installed on every intermediate chain in the route. If chain B doesn't have PFM, the tokens will arrive on B and stop there. Check the chain registry or query the chain's module list before building routes.

3. **Incorrect intermediate receiver address** — For PFM, the receiver on intermediate chains should be a valid address format for that chain, but PFM will handle the forwarding regardless of what address you use. However, if PFM fails and tokens need to be refunded, they go to this address. Use a controlled address.

4. **Ignoring IBC denom unwinding** — After multi-hop, tokens accumulate path prefixes in their denom. ATOM that went Hub→Osmosis→Neutron has a different IBC denom than ATOM that went Hub→Neutron directly. Use denom traces to understand the token's path and ensure your application handles both variants.

## What to Learn Next

- [Cosmos SDK Architecture](./01-cosmos-sdk-architecture.md) — Review the fundamentals if you need a refresher on module development
- [PFM GitHub](https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware) — Source code and integration examples
- [IBC Channel Registry](https://github.com/cosmos/chain-registry/tree/master/_IBC) — Official registry of IBC connections between chains
- [Skip Protocol](https://docs.skip.build/) — Advanced multi-hop routing and MEV protection for IBC
