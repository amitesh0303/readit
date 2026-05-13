# Interchain Security: Shared Validator Sets

**Track:** Cosmos SDK & IBC Development
**Level:** Advanced
**Read time:** 12 min

---

## The Problem

Launching a new Cosmos chain means bootstrapping a validator set from scratch. You need to attract validators, distribute stake, and hope enough honest validators participate to secure the chain. For a new project, this is a chicken-and-egg problem — validators won't secure a chain without value, and the chain can't create value without security. Interchain Security (ICS) solves this by letting new chains ("consumer chains") borrow the Cosmos Hub's validator set, getting $2B+ in economic security from day one.

## Core Concepts

### How Interchain Security Works

```
┌─────────────────────────────────────────────────────────┐
│           Interchain Security Architecture              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Provider Chain (Cosmos Hub)                            │
│  └── Validators stake ATOM                              │
│  └── x/ccv/provider module                              │
│  └── Tracks consumer chain validator sets               │
│  └── Slashes validators for consumer misbehaviour       │
│       ↕ IBC (Cross-Chain Validation packets)            │
│  Consumer Chain (e.g., Neutron, Stride)                 │
│  └── Runs same validators as provider                   │
│  └── x/ccv/consumer module                              │
│  └── Reports evidence of misbehaviour to provider       │
│  └── Sends portion of fees/rewards to provider          │
│                                                         │
│  Partial Set Security (PSS) — opt-in model              │
│  └── Validators choose which consumers to validate      │
│  └── Minimum validator participation threshold          │
│  └── Top N% validators can be required                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Provider-Side: Proposing a Consumer Chain

Adding a consumer chain requires a governance proposal on the Cosmos Hub:

```go
// Interchain Security — Consumer chain addition proposal
// interchain-security@v5.0.0
// Source: https://github.com/cosmos/interchain-security

package types

import (
	"time"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// ConsumerAdditionProposal defines the governance proposal to add a consumer chain
type ConsumerAdditionProposal struct {
	// Title of the proposal
	Title string `json:"title"`
	// Description of the consumer chain
	Description string `json:"description"`
	// ChainId of the new consumer chain
	ChainId string `json:"chain_id"`
	// InitialHeight is the initial block height of the consumer chain
	InitialHeight clienttypes.Height `json:"initial_height"`
	// GenesisHash is the hash of the consumer chain genesis state
	GenesisHash []byte `json:"genesis_hash"`
	// BinaryHash is the hash of the consumer chain binary
	BinaryHash []byte `json:"binary_hash"`
	// SpawnTime is when the consumer chain starts
	SpawnTime time.Time `json:"spawn_time"`
	// UnbondingPeriod for the consumer chain (should match provider)
	UnbondingPeriod time.Duration `json:"unbonding_period"`
	// CcvTimeoutPeriod is the timeout for CCV IBC packets
	CcvTimeoutPeriod time.Duration `json:"ccv_timeout_period"`
	// TransferTimeoutPeriod for IBC token transfers
	TransferTimeoutPeriod time.Duration `json:"transfer_timeout_period"`
	// ConsumerRedistributionFraction — portion of consumer rewards sent to provider
	ConsumerRedistributionFraction string `json:"consumer_redistribution_fraction"`
	// Top_N — percentage of top validators required to validate (0 = opt-in only)
	Top_N uint32 `json:"top_N"`
}
```

### Consumer-Side: Integrating CCV Module

On the consumer chain, you integrate the Cross-Chain Validation (CCV) consumer module:

```go
// Consumer chain app.go integration
// interchain-security@v5.0.0

package app

import (
	ccvconsumer "github.com/cosmos/interchain-security/v5/x/ccv/consumer"
	ccvconsumerkeeper "github.com/cosmos/interchain-security/v5/x/ccv/consumer/keeper"
	ccvconsumertypes "github.com/cosmos/interchain-security/v5/x/ccv/consumer/types"
)

type App struct {
	// Consumer CCV keeper — replaces x/staking for validator set management
	ConsumerKeeper ccvconsumerkeeper.Keeper
}

func NewApp(...) *App {
	// Initialize the consumer keeper
	app.ConsumerKeeper = ccvconsumerkeeper.NewKeeper(
		appCodec,
		keys[ccvconsumertypes.StoreKey],
		app.GetSubspace(ccvconsumertypes.ModuleName),
		scopedConsumerKeeper,
		app.IBCKeeper.ChannelKeeper,
		app.IBCKeeper.PortKeeper,
		app.IBCKeeper.ConnectionKeeper,
		app.IBCKeeper.ClientKeeper,
		app.SlashingKeeper,
		app.BankKeeper,
		app.AccountKeeper,
		&app.TransferKeeper,
		app.IBCKeeper,
		authtypes.FeeCollectorName,
	)

	// The consumer module replaces the staking module's validator set management
	// Validators are determined by the provider chain, not local staking
	app.ModuleManager.RegisterModules(
		ccvconsumer.NewAppModule(app.ConsumerKeeper, app.GetSubspace(ccvconsumertypes.ModuleName)),
	)

	return app
}
```

### Partial Set Security (PSS)

Since ICS v4.0, consumer chains can use Partial Set Security — validators opt in rather than being forced to validate:

| Security Model | Description | Use Case |
|---|---|---|
| Top N (N=100%) | All Hub validators must validate | High-security chains (Neutron) |
| Top N (N=67%) | Top 67% by stake must validate | Medium-security chains |
| Opt-in (N=0%) | Validators choose to participate | Lower-security, experimental chains |

```shell
# Submit a consumer addition proposal (opt-in model)
gaiad tx gov submit-proposal consumer-addition proposal.json \
  --from mykey \
  --chain-id cosmoshub-4 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uatom \
  --yes

# Validator opts in to a consumer chain
gaiad tx provider opt-in <consumer-chain-id> \
  --from myvalidator \
  --chain-id cosmoshub-4 \
  --yes

# Check which consumers a validator is opted into
gaiad query provider validator-consumer-opt-in <validator-address>
```

### Reward Distribution

Consumer chains share revenue with the provider chain's validators:

```go
// Consumer chain reward distribution
// interchain-security@v5.0.0

// ConsumerRedistributionFraction determines how rewards are split:
// - e.g., "0.75" means 75% stays on consumer, 25% goes to provider validators
// - Provider validators receive rewards proportional to their voting power

// The consumer module automatically:
// 1. Collects transaction fees on the consumer chain
// 2. Sends ConsumerRedistributionFraction to the provider via IBC
// 3. Provider distributes to validators based on their stake weight

// Example: Neutron sends 25% of fees to Cosmos Hub validators
// This creates economic alignment — Hub validators are incentivized
// to properly validate Neutron because they earn from it
```

### Launching a Consumer Chain on Testnet

```shell
# 1. Prepare the consumer chain binary
ignite scaffold chain github.com/myorg/consumer-chain
cd consumer-chain

# Add the CCV consumer module (replace x/staking)
# This requires modifying app.go to use ccv/consumer instead of x/staking

# 2. Build the binary
ignite chain build

# 3. Generate genesis for the consumer chain
consumer-chaind init mynode --chain-id consumer-test-1

# 4. The provider chain provides the initial validator set via genesis
# Fetch the CCV state from the provider
gaiad query provider consumer-genesis consumer-test-1 -o json > ccv-genesis.json

# 5. Add CCV genesis state to consumer genesis
jq -s '.[0] * {"app_state": {"ccvconsumer": .[1]}}' \
  genesis.json ccv-genesis.json > genesis-final.json

# 6. Start the consumer chain
consumer-chaind start --home ~/.consumer-chain
```

## Common Pitfalls

1. **Confusing ICS with bridges** — Interchain Security is not a bridge. It shares the validator set, not liquidity or state. Consumer chains still need IBC channels for token transfers. ICS provides economic security (slashing), not data availability.

2. **Assuming instant slashing** — When a consumer chain detects misbehaviour, it sends evidence to the provider via IBC. This takes at least one IBC packet relay cycle (~30 seconds to minutes). During this window, the misbehaving validator is still active on the provider.

3. **Ignoring the unbonding period alignment** — The consumer chain's unbonding period must be shorter than the provider's. If it's longer, validators could unbond on the provider and escape slashing for consumer chain misbehaviour.

4. **Not planning for CCV channel failures** — If the IBC channel between provider and consumer goes down (e.g., relayer failure), the consumer chain will eventually halt because it can't receive validator set updates. Build monitoring and redundant relayers.

## What to Learn Next

- [Celestia DA Integration](./06-celestia-da-integration.md) — Using Celestia as a data availability layer for Cosmos chains
- [ICS Documentation](https://cosmos.github.io/interchain-security/) — Official Interchain Security specification
- [Interchain Security GitHub](https://github.com/cosmos/interchain-security) — Source code and integration examples
