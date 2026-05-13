# IBC Protocol Mechanics: Cross-Chain Communication

**Track:** Cosmos SDK & IBC Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've built a Cosmos chain, but it exists in isolation. Your users need to move tokens from Osmosis, receive data from another chain, or participate in interchain DeFi. The Inter-Blockchain Communication (IBC) protocol enables this, but it's not a simple bridge — it's a full protocol stack with clients, connections, channels, and packet lifecycle. Without understanding how light clients verify state proofs across chains, you can't reason about security guarantees or debug failed packet relays.

## Core Concepts

### IBC Protocol Stack

IBC is layered like a networking protocol. Each layer has a specific responsibility:

```
┌─────────────────────────────────────────────────────────┐
│                    IBC Protocol Stack                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Application Layer (ICS-20, ICS-27, custom)             │
│  └── Token transfers, interchain accounts, your logic   │
│       ↕                                                 │
│  Channel Layer (ICS-4)                                  │
│  └── Ordered/unordered packet delivery                  │
│  └── Packet commitment, acknowledgement, timeout        │
│       ↕                                                 │
│  Connection Layer (ICS-3)                               │
│  └── Authenticated connection between two chains        │
│  └── Version negotiation                                │
│       ↕                                                 │
│  Client Layer (ICS-2)                                   │
│  └── Light client verification (Tendermint, Solo, etc.) │
│  └── Consensus state tracking                           │
│  └── Misbehaviour detection                             │
│       ↕                                                 │
│  Relayer (off-chain)                                    │
│  └── Submits packets between chains                     │
│  └── Pays gas on both chains                            │
│  └── Permissionless — anyone can relay                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### IBC Token Transfer (ICS-20)

The most common IBC application is fungible token transfer. Here's a complete Go implementation of sending tokens from one chain to another:

```go
// IBC Token Transfer — sending tokens from Chain A to Chain B
// Uses ibc-go@v8.3.0
// Source: https://github.com/cosmos/ibc-go

package keeper

import (
	"fmt"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	transfertypes "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
)

// SendIBCTransfer sends tokens from this chain to a destination chain via IBC
func (k Keeper) SendIBCTransfer(
	ctx sdk.Context,
	sender sdk.AccAddress,
	receiver string, // bech32 address on destination chain
	amount sdk.Coin,
	sourcePort string,
	sourceChannel string,
) error {
	// Set timeout: 10 minutes from now (absolute timestamp)
	timeoutTimestamp := uint64(ctx.BlockTime().Add(10 * time.Minute).UnixNano())

	// No height-based timeout — use timestamp only
	timeoutHeight := clienttypes.ZeroHeight()

	// Construct the transfer message
	msg := transfertypes.NewMsgTransfer(
		sourcePort,       // typically "transfer"
		sourceChannel,    // e.g., "channel-0"
		amount,           // sdk.NewCoin("uatom", sdkmath.NewInt(1000000))
		sender.String(),  // sender on source chain
		receiver,         // receiver on destination chain
		timeoutHeight,    // no height timeout
		timeoutTimestamp, // 10 min timestamp timeout
		"",               // memo (optional, used for PFM)
	)

	// Validate the message
	if err := msg.ValidateBasic(); err != nil {
		return fmt.Errorf("invalid transfer message: %w", err)
	}

	// Execute the transfer via the transfer module's message server
	res, err := k.transferKeeper.Transfer(ctx, msg)
	if err != nil {
		return fmt.Errorf("IBC transfer failed: %w", err)
	}

	// Emit event for tracking
	ctx.EventManager().EmitEvent(
		sdk.NewEvent("ibc_transfer_sent",
			sdk.NewAttribute("sender", sender.String()),
			sdk.NewAttribute("receiver", receiver),
			sdk.NewAttribute("amount", amount.String()),
			sdk.NewAttribute("channel", sourceChannel),
			sdk.NewAttribute("sequence", fmt.Sprintf("%d", res.Sequence)),
		),
	)

	return nil
}
```

### Packet Lifecycle

Every IBC packet goes through a deterministic lifecycle:

1. **SendPacket** — Source chain commits packet data to its state
2. **RecvPacket** — Relayer submits packet + proof to destination chain
3. **Acknowledgement** — Destination chain writes ack, relayer submits ack + proof back to source
4. **Timeout** — If packet isn't received before timeout, source chain refunds

```go
// Custom IBC packet data — sending arbitrary data between chains
// ibc-go@v8.3.0

package types

import (
	"encoding/json"
	"fmt"
)

// CustomPacketData represents application-specific data sent via IBC
type CustomPacketData struct {
	// Type identifies the packet purpose
	Type string `json:"type"`
	// Sender on the source chain
	Sender string `json:"sender"`
	// Data payload (application-specific)
	Data json.RawMessage `json:"data"`
	// Memo for routing (used by Packet Forward Middleware)
	Memo string `json:"memo,omitempty"`
}

// OraclePrice is an example payload — sending price data cross-chain
type OraclePrice struct {
	Symbol    string `json:"symbol"`
	Price     string `json:"price"` // use string for deterministic decimal handling
	Timestamp int64  `json:"timestamp"`
	Source    string `json:"source"`
}

// Validate ensures the packet data is well-formed
func (p CustomPacketData) Validate() error {
	if p.Type == "" {
		return fmt.Errorf("packet type cannot be empty")
	}
	if p.Sender == "" {
		return fmt.Errorf("sender cannot be empty")
	}
	if len(p.Data) == 0 {
		return fmt.Errorf("data payload cannot be empty")
	}
	return nil
}

// GetBytes serializes the packet for IBC transmission
func (p CustomPacketData) GetBytes() ([]byte, error) {
	return json.Marshal(p)
}
```

### Handling Received Packets

On the destination chain, your module implements the `IBCModule` interface to process incoming packets:

```go
// OnRecvPacket handles incoming IBC packets on the destination chain
// ibc-go@v8.3.0

package ibc

import (
	"encoding/json"

	sdk "github.com/cosmos/cosmos-sdk/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// OnRecvPacket processes an incoming IBC packet
func (im IBCModule) OnRecvPacket(
	ctx sdk.Context,
	packet channeltypes.Packet,
	relayer sdk.AccAddress,
) exported.Acknowledgement {
	// Deserialize the packet data
	var packetData types.CustomPacketData
	if err := json.Unmarshal(packet.GetData(), &packetData); err != nil {
		// Return error acknowledgement — packet will not be retried
		return channeltypes.NewErrorAcknowledgement(err)
	}

	// Validate the packet
	if err := packetData.Validate(); err != nil {
		return channeltypes.NewErrorAcknowledgement(err)
	}

	// Route based on packet type
	switch packetData.Type {
	case "oracle_price":
		return im.handleOraclePrice(ctx, packet, packetData)
	case "governance_vote":
		return im.handleGovernanceVote(ctx, packet, packetData)
	default:
		return channeltypes.NewErrorAcknowledgement(
			fmt.Errorf("unknown packet type: %s", packetData.Type),
		)
	}
}

func (im IBCModule) handleOraclePrice(
	ctx sdk.Context,
	packet channeltypes.Packet,
	packetData types.CustomPacketData,
) exported.Acknowledgement {
	var price types.OraclePrice
	if err := json.Unmarshal(packetData.Data, &price); err != nil {
		return channeltypes.NewErrorAcknowledgement(err)
	}

	// Store the price in module state
	if err := im.keeper.SetPrice(ctx, price); err != nil {
		return channeltypes.NewErrorAcknowledgement(err)
	}

	// Return success acknowledgement
	ack := channeltypes.NewResultAcknowledgement([]byte(`{"status":"ok"}`))
	return ack
}
```

### Relayer Setup

Relayers are off-chain processes that shuttle packets between chains. The most common relayer is Hermes:

```shell
# Install Hermes relayer v1.10+
cargo install ibc-relayer-cli --version 1.10.0 --bin hermes

# Or download pre-built binary
wget https://github.com/informalsystems/hermes/releases/download/v1.10.0/hermes-v1.10.0-x86_64-unknown-linux-gnu.tar.gz
tar -xzf hermes-v1.10.0-x86_64-unknown-linux-gnu.tar.gz

hermes version
```

```
Expected output:
hermes 1.10.0
```

```shell
# Create a channel between two chains
hermes create channel \
  --a-chain cosmoshub-4 \
  --b-chain osmosis-1 \
  --a-port transfer \
  --b-port transfer \
  --new-client-connection
```

## Common Pitfalls

1. **Ignoring packet timeouts** — If you don't set appropriate timeouts, packets can hang indefinitely when the destination chain is down. Always set both height-based and timestamp-based timeouts. A 10-minute timestamp timeout is a reasonable default for most applications.

2. **Assuming ordered channels for token transfers** — ICS-20 token transfers use unordered channels. If you build a custom application that requires strict ordering (like a game state machine), you must explicitly create an ordered channel — but be aware that a single failed packet on an ordered channel blocks all subsequent packets.

3. **Not handling acknowledgement errors** — When `OnRecvPacket` returns an error acknowledgement, the source chain's `OnAcknowledgementPacket` receives it. If you don't handle this case, tokens or state changes on the source chain won't be properly reverted.

4. **Confusing IBC denoms** — When tokens arrive via IBC, they get a new denom: `ibc/{hash(port/channel/denom)}`. The denom `uatom` on Osmosis becomes `ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2`. Always use the full IBC denom when querying balances on the receiving chain.

## What to Learn Next

- [Building a Custom Module](./03-building-custom-module.md) — Create your own Cosmos SDK module with IBC capabilities
- [IBC-Go Documentation](https://ibc.cosmos.network/main) — Official IBC protocol specification and implementation guide
- [IBC-Go GitHub](https://github.com/cosmos/ibc-go) — Source code for the IBC implementation in Go
