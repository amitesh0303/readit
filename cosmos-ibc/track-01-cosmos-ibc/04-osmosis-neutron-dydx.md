# Osmosis, Neutron, and dYdX: Production Cosmos Patterns

**Track:** Cosmos SDK & IBC Development
**Level:** Advanced
**Read time:** 14 min

---

## The Problem

You understand Cosmos SDK basics, but building a production chain requires patterns you won't find in tutorials. How does Osmosis implement concentrated liquidity on-chain? How does Neutron enable CosmWasm smart contracts to make IBC calls? How did dYdX migrate from Ethereum to a sovereign Cosmos chain handling 1000+ orders/second? These production chains have solved real scaling, DeFi, and interoperability problems that you'll face in your own chain.

## Core Concepts

### Osmosis: On-Chain DEX Architecture

Osmosis is the largest DEX in the Cosmos ecosystem. Its key innovation is implementing AMM logic directly as Cosmos SDK modules rather than smart contracts:

```
┌─────────────────────────────────────────────────────────┐
│              Osmosis Architecture                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  x/concentrated-liquidity                               │
│  └── Uniswap V3-style tick-based positions              │
│  └── Custom fee tiers per pool                          │
│                                                         │
│  x/poolmanager                                          │
│  └── Routes swaps across pool types                     │
│  └── Multi-hop routing (A→B→C in one tx)                │
│                                                         │
│  x/superfluid-staking                                   │
│  └── LP tokens earn staking rewards                     │
│  └── Dual yield: swap fees + staking APR                │
│                                                         │
│  x/protorev                                             │
│  └── On-chain MEV capture (arbitrage)                   │
│  └── Profits go to community pool                       │
│                                                         │
│  x/cosmwasmpool                                         │
│  └── CosmWasm contracts as pool backends                │
│  └── Enables custom curve implementations               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

```go
// Osmosis concentrated liquidity — creating a position
// Source: https://github.com/osmosis-labs/osmosis
// osmosis@v25.0.0

package concentrated_liquidity

import (
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types"
	cltypes "github.com/osmosis-labs/osmosis/v25/x/concentrated-liquidity/types"
)

// CreatePosition creates a concentrated liquidity position
// Similar to Uniswap V3 but implemented as a native module
func (k Keeper) CreatePosition(
	ctx sdk.Context,
	poolId uint64,
	owner sdk.AccAddress,
	tokensProvided sdk.Coins,
	lowerTick int64,
	upperTick int64,
) (positionId uint64, actualAmount0 sdk.Int, actualAmount1 sdk.Int, err error) {
	// Validate tick range
	if lowerTick >= upperTick {
		return 0, sdk.Int{}, sdk.Int{}, fmt.Errorf("lower tick must be less than upper tick")
	}

	// Get the pool
	pool, err := k.GetPool(ctx, poolId)
	if err != nil {
		return 0, sdk.Int{}, sdk.Int{}, err
	}

	// Calculate liquidity from provided tokens and tick range
	liquidity := cltypes.CalcLiquidityFromTokens(
		pool.GetCurrentSqrtPrice(),
		cltypes.TickToSqrtPrice(lowerTick),
		cltypes.TickToSqrtPrice(upperTick),
		tokensProvided[0].Amount,
		tokensProvided[1].Amount,
	)

	// Transfer tokens from user to pool
	actualAmount0, actualAmount1, err = k.sendCoinsBetweenPoolAndUser(
		ctx, pool, owner, tokensProvided,
	)
	if err != nil {
		return 0, sdk.Int{}, sdk.Int{}, err
	}

	// Create the position record
	position := cltypes.Position{
		PoolId:    poolId,
		Owner:     owner.String(),
		LowerTick: lowerTick,
		UpperTick: upperTick,
		Liquidity: liquidity,
		JoinTime:  ctx.BlockTime(),
	}

	positionId = k.SetPosition(ctx, position)

	return positionId, actualAmount0, actualAmount1, nil
}
```

### Neutron: Smart Contracts with IBC Powers

Neutron is a CosmWasm-enabled chain that gives smart contracts direct access to IBC. This means a contract can send tokens cross-chain, query another chain's state, or manage an interchain account — all from CosmWasm:

```go
// Neutron's Interchain Queries module — allowing contracts to query remote chains
// Source: https://github.com/neutron-org/neutron
// neutron@v4.0.0

package keeper

import (
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types"
	icqtypes "github.com/neutron-org/neutron/v4/x/interchainqueries/types"
)

// RegisterInterchainQuery registers a query that a contract wants answered
// The relayer will fetch the result from the remote chain and submit it back
func (k Keeper) RegisterInterchainQuery(
	ctx sdk.Context,
	contractAddress sdk.AccAddress,
	queryType string,
	keys []*icqtypes.KVKey,
	transactionsFilter string,
	connectionId string,
	updatePeriod uint64,
) (uint64, error) {
	// Validate the connection exists
	if _, err := k.ibcKeeper.ConnectionKeeper.GetConnection(ctx, connectionId); err != nil {
		return 0, fmt.Errorf("connection %s not found: %w", connectionId, err)
	}

	// Create the registered query
	query := icqtypes.RegisteredQuery{
		QueryType:          queryType,
		Keys:               keys,
		TransactionsFilter: transactionsFilter,
		ConnectionId:       connectionId,
		UpdatePeriod:       updatePeriod,
		Owner:              contractAddress.String(),
	}

	queryId := k.GetNextQueryID(ctx)
	query.Id = queryId

	k.SetQuery(ctx, query)

	// Charge the contract for query registration (deposit)
	deposit := k.GetParams(ctx).QueryDeposit
	if err := k.bankKeeper.SendCoinsFromAccountToModule(
		ctx, contractAddress, icqtypes.ModuleName, sdk.NewCoins(deposit),
	); err != nil {
		return 0, fmt.Errorf("insufficient funds for query deposit: %w", err)
	}

	return queryId, nil
}
```

### dYdX v4: High-Performance Order Book on Cosmos

dYdX migrated from StarkEx (Ethereum L2) to a sovereign Cosmos chain to achieve full decentralization of their order book. Key architectural decisions:

```
┌─────────────────────────────────────────────────────────┐
│              dYdX v4 Architecture                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Off-Chain Order Book (in-memory)                       │
│  └── Validators maintain order book in memory           │
│  └── Orders matched off-chain for speed                 │
│  └── Only fills/settlements go on-chain                 │
│                                                         │
│  x/clob (Central Limit Order Book module)               │
│  └── On-chain settlement of matched orders              │
│  └── Liquidation engine                                 │
│  └── Insurance fund management                          │
│                                                         │
│  x/perpetuals                                           │
│  └── Perpetual futures markets                          │
│  └── Funding rate calculations                          │
│  └── Oracle price integration                           │
│                                                         │
│  x/subaccounts                                          │
│  └── Isolated margin per position                       │
│  └── Cross-margin within subaccount                     │
│                                                         │
│  Custom CometBFT modifications                          │
│  └── Vote extensions for oracle prices                  │
│  └── MEV-aware block building                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Developing on Osmosis Testnet

```shell
# Install osmosisd
git clone https://github.com/osmosis-labs/osmosis.git
cd osmosis
git checkout v25.0.0
make install

osmosisd version
```

```
Expected output:
v25.0.0
```

```shell
# Configure for testnet
osmosisd config chain-id osmo-test-5
osmosisd config node https://rpc.testnet.osmosis.zone:443

# Create a key
osmosisd keys add mykey --keyring-backend test

# Get testnet tokens from faucet
# Osmosis testnet faucet: https://faucet.testnet.osmosis.zone/
# Request tokens for your address

# Query your balance
osmosisd query bank balances $(osmosisd keys show mykey -a --keyring-backend test)
```

### Deploying a CosmWasm Contract on Neutron

```shell
# Install Neutron CLI tools
# Requires Rust toolchain: rustup target add wasm32-unknown-unknown

# Clone a CosmWasm template
cargo generate --git https://github.com/CosmWasm/cw-template.git --name my-contract
cd my-contract

# Build the contract
cargo build --target wasm32-unknown-unknown --release
# Optimize with cosmwasm optimizer
docker run --rm -v "$(pwd)":/code \
  cosmwasm/optimizer:0.15.0

# Deploy to Neutron testnet (pion-1)
neutrond tx wasm store artifacts/my_contract.wasm \
  --from mykey \
  --chain-id pion-1 \
  --node https://rpc-palvus.pion-1.ntrn.tech:443 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025untrn \
  --yes
```

```
Expected output:
code: 0
txhash: A1B2C3D4E5F6...
```

## Common Pitfalls

1. **Assuming all Cosmos chains have CosmWasm** — Only chains that include the `x/wasm` module support smart contracts. Osmosis, Neutron, and Juno have it. dYdX and the Cosmos Hub do not. Check before building.

2. **Ignoring gas model differences** — Each Cosmos chain sets its own gas prices and fee tokens. Osmosis uses `uosmo`, Neutron uses `untrn`. Gas costs for the same operation vary significantly across chains.

3. **Not accounting for IBC token denoms** — When your contract receives tokens via IBC, they arrive as `ibc/HASH` denoms, not the original denom. Your contract must handle both native and IBC denoms correctly.

4. **Underestimating dYdX's custom consensus** — dYdX modified CometBFT itself for their use case (vote extensions for oracle prices, custom block building). This is not a pattern you should copy unless you have similar performance requirements and the engineering team to maintain a consensus fork.

## What to Learn Next

- [Interchain Security](./05-interchain-security.md) — How consumer chains share the Cosmos Hub's validator set
- [Osmosis Documentation](https://docs.osmosis.zone/) — Official Osmosis developer docs
- [Neutron Documentation](https://docs.neutron.org/) — Building IBC-enabled smart contracts
- [dYdX v4 GitHub](https://github.com/dydxprotocol/v4-chain) — Source code for the dYdX Cosmos chain
