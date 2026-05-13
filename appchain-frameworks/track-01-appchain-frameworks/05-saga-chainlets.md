# Saga Chainlets: Launch a Dedicated Chain in Minutes

**Track:** Appchain Frameworks
**Lesson:** 5 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You want a dedicated appchain but don't want to manage validators, configure consensus, or worry about security bootstrapping. Running your own validator set is expensive and operationally complex — you need to recruit validators, manage staking economics, and handle upgrades. Saga solves this by providing "Chainlets" — dedicated chains that inherit security from the Saga mainnet via Interchain Security, deployable in minutes rather than weeks.

## Core Concepts

### What are Saga Chainlets?

Saga is a protocol that provides dedicated blockchains (Chainlets) as a service. Key properties:

- **Shared security**: Chainlets inherit validator security from the Saga mainnet (no need to bootstrap your own validator set)
- **Cosmos SDK-based**: Each Chainlet is a full Cosmos SDK chain with CometBFT consensus
- **EVM or CosmWasm**: Choose your execution environment — EVM (via Ethermint) or CosmWasm
- **Automatic scaling**: Saga handles validator assignment, upgrades, and chain lifecycle
- **IBC-native**: Built-in cross-chain communication with other Cosmos chains

### Framework Comparison

| Property | Cosmos SDK | OP Stack | Polygon CDK | Starknet Appchains | Saga | Avalanche Subnets |
|---|---|---|---|---|---|---|
| **Consensus** | CometBFT (BFT) | Single sequencer + L1 fraud proofs | Single sequencer + ZK proofs | Single sequencer + STARK proofs | Interchain Security (CometBFT) | Snowman (DAG-based) |
| **Languages** | Go (modules) | Solidity (EVM) | Solidity (EVM) | Cairo | Go (Cosmos SDK) | Solidity (EVM) or custom VM |
| **Deploy time** | ~30 min (devnet) | ~45 min (devnet) | ~60 min (devnet) | ~45 min (devnet) | ~15 min (chainlet) | ~30 min (local subnet) |
| **Finality** | 1-6 seconds (instant) | 7 days (challenge window) | ~30 min (ZK proof generation) | ~hours (STARK proof) | 1-6 seconds (instant) | <1 second (sub-second) |
| **Data Availability** | Self-hosted or Celestia | Ethereum L1 (blobs) | Ethereum L1 or DAC | Ethereum L1 | Inherited from hub | Self-hosted or external |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              Saga Chainlet Architecture                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Saga Mainnet (Security Hub)                            │
│  └── Validators stake SAGA tokens                       │
│  └── Provides Interchain Security to Chainlets          │
│  └── Manages Chainlet lifecycle (create/upgrade/stop)   │
│       ↓                                                 │
│  Chainlet (Your Dedicated Chain)                        │
│  └── Full Cosmos SDK chain                              │
│  └── Own block space, own state                         │
│  └── EVM (Ethermint) or CosmWasm execution              │
│  └── 1-6 second block times                            │
│  └── IBC connections to other chains                    │
│       ↓                                                 │
│  Users interact via:                                    │
│  └── EVM RPC (if EVM Chainlet)                          │
│  └── Cosmos RPC/gRPC                                    │
│  └── IBC transfers from other Cosmos chains             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

```shell
# Install the Saga CLI (sagacli)
# Source: https://github.com/sagaxyz/ssc
# Last verified: 2025-01-15

# Download the latest release
curl -L https://github.com/sagaxyz/ssc/releases/download/v0.2.3/sagacli-linux-amd64 \
  -o /usr/local/bin/sagacli
chmod +x /usr/local/bin/sagacli

# Verify installation
sagacli version
```

```
Expected output:
sagacli version 0.2.3
```

```shell
# Install Node.js 18+ (for EVM interaction)
node --version  # v18+

# Install Foundry (for EVM Chainlet deployment)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install jq
jq --version
```

### Create a Saga Account

```shell
# Generate a new key for Saga testnet
sagacli keys add my-chainlet-deployer --keyring-backend test
```

```
Expected output:
- address: saga1abc123def456...
  name: my-chainlet-deployer
  pubkey: '{"@type":"/cosmos.crypto.secp256k1.PubKey","key":"..."}'
  type: local

**Important** write this mnemonic phrase in a safe place:
[24-word mnemonic phrase]
```

```shell
# Get testnet SAGA tokens from the faucet
# Faucet URL: https://faucet.saga.xyz
# Last verified: 2025-01-15
# Requires: Discord verification

# Check balance after faucet
sagacli query bank balances saga1abc123def456... \
  --node https://rpc.testnet.saga.xyz:443
```

```
Expected output:
balances:
- amount: "10000000"
  denom: utsaga
```

### Launch an EVM Chainlet

Saga provides a web interface and CLI for Chainlet deployment. Here's the CLI approach:

```shell
# Initialize a Chainlet configuration
sagacli chainlet init \
  --name "my-gaming-chain" \
  --vm-type evm \
  --chain-id 12345 \
  --denom ugame \
  --block-time 2s
```

```
Expected output:
Chainlet configuration initialized:
  Name: my-gaming-chain
  VM: EVM (Ethermint)
  Chain ID: 12345
  Native denom: ugame
  Block time: 2s
  Config saved to: ./chainlet-config.json
```

```json
// chainlet-config.json — Generated Chainlet configuration
{
  "name": "my-gaming-chain",
  "vmType": "evm",
  "chainId": 12345,
  "denom": "ugame",
  "blockTime": "2s",
  "maxValidators": 100,
  "unbondingTime": "1209600s",
  "initialSupply": "1000000000000ugame",
  "mintParams": {
    "inflation": "0.07",
    "inflationMax": "0.10",
    "inflationMin": "0.03"
  },
  "evmParams": {
    "evmDenom": "ugame",
    "enableCreate": true,
    "enableCall": true,
    "extraEIPs": []
  }
}
```

```shell
# Launch the Chainlet on Saga testnet
sagacli chainlet launch \
  --config ./chainlet-config.json \
  --from my-chainlet-deployer \
  --keyring-backend test \
  --node https://rpc.testnet.saga.xyz:443 \
  --gas auto \
  --gas-adjustment 1.5
```

```
Expected output:
Broadcasting Chainlet launch transaction...
Transaction hash: 0xABC123...
Chainlet "my-gaming-chain" is being provisioned...

Status: PROVISIONING → ACTIVE

Your Chainlet is ready!
  EVM RPC: https://my-gaming-chain-evm.testnet.saga.xyz
  Cosmos RPC: https://my-gaming-chain.testnet.saga.xyz:26657
  Chain ID: 12345
  Explorer: https://my-gaming-chain.testnet.saga.xyz/explorer
```

### Deploy a Contract to Your Chainlet

Once the Chainlet is active, it's a standard EVM chain:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GameItem
/// @notice Simple game item registry for a Saga Chainlet
/// @dev Demonstrates EVM compatibility on Saga's Ethermint-based Chainlet
contract GameItem {
    struct Item {
        string name;
        uint256 power;
        address owner;
        uint256 createdAt;
    }

    mapping(uint256 => Item) public items;
    uint256 public nextItemId;

    event ItemCreated(uint256 indexed itemId, string name, uint256 power, address owner);
    event ItemTransferred(uint256 indexed itemId, address from, address to);

    error ItemNotFound(uint256 itemId);
    error NotItemOwner(uint256 itemId, address caller);
    error InvalidPower(uint256 power);

    function createItem(string calldata name, uint256 power) external returns (uint256) {
        if (power == 0 || power > 1000) revert InvalidPower(power);

        uint256 itemId = nextItemId++;
        items[itemId] = Item({
            name: name,
            power: power,
            owner: msg.sender,
            createdAt: block.timestamp
        });

        emit ItemCreated(itemId, name, power, msg.sender);
        return itemId;
    }

    function transferItem(uint256 itemId, address to) external {
        Item storage item = items[itemId];
        if (item.owner == address(0)) revert ItemNotFound(itemId);
        if (item.owner != msg.sender) revert NotItemOwner(itemId, msg.sender);

        address from = item.owner;
        item.owner = to;

        emit ItemTransferred(itemId, from, to);
    }

    function getItem(uint256 itemId) external view returns (Item memory) {
        Item memory item = items[itemId];
        if (item.owner == address(0)) revert ItemNotFound(itemId);
        return item;
    }
}
```

```shell
# Deploy to your Chainlet's EVM RPC
export CHAINLET_RPC="https://my-gaming-chain-evm.testnet.saga.xyz"
export PRIVATE_KEY="your_evm_private_key"

forge create GameItem \
  --rpc-url $CHAINLET_RPC \
  --private-key $PRIVATE_KEY
```

```
Expected output:
Deployer: 0xYourAddress
Deployed to: 0xGameItemContractAddress
Transaction hash: 0x...
```

```shell
# Create a game item
cast send 0xGameItemContractAddress \
  "createItem(string,uint256)" "Excalibur" 950 \
  --rpc-url $CHAINLET_RPC \
  --private-key $PRIVATE_KEY
```

```
Expected output:
status           1 (success)
transactionHash  0x...
gasUsed          89432
```

```shell
# Query the item
cast call 0xGameItemContractAddress \
  "getItem(uint256)" 0 \
  --rpc-url $CHAINLET_RPC
```

```
Expected output:
(Excalibur, 950, 0xYourAddress, 1705312800)
```

### IBC Integration

Chainlets can communicate with other Cosmos chains via IBC:

```shell
# Check IBC channels on your Chainlet
sagacli query ibc channel channels \
  --node https://my-gaming-chain.testnet.saga.xyz:26657
```

```shell
# Transfer tokens from Saga mainnet to your Chainlet via IBC
sagacli tx ibc-transfer transfer \
  transfer channel-0 \
  saga1recipient... \
  1000000utsaga \
  --from my-chainlet-deployer \
  --node https://rpc.testnet.saga.xyz:443 \
  --keyring-backend test \
  --packet-timeout-height 0-0 \
  --packet-timeout-timestamp 600000000000
```

```
Expected output:
Transaction hash: 0xDEF789...
IBC transfer initiated on channel-0
```

### Monitoring Your Chainlet

```shell
# Check Chainlet status
sagacli query chainlet status my-gaming-chain \
  --node https://rpc.testnet.saga.xyz:443
```

```
Expected output:
chainlet:
  name: my-gaming-chain
  status: ACTIVE
  chain_id: "12345"
  validators: 50
  block_height: 1234
  last_block_time: "2025-01-15T10:05:00Z"
```

```shell
# View Chainlet metrics
curl https://my-gaming-chain.testnet.saga.xyz:26657/status | jq '.result.sync_info'
```

```
Expected output:
{
  "latest_block_hash": "ABC123...",
  "latest_block_height": "1234",
  "latest_block_time": "2025-01-15T10:05:00.000Z",
  "catching_up": false
}
```

## Common Pitfalls

1. **Not having enough SAGA tokens for Chainlet fees** — Launching and maintaining a Chainlet requires SAGA tokens for security deposits. If your balance drops below the minimum, the Chainlet can be suspended. Monitor your balance and top up from the faucet (testnet) or purchase (mainnet).

2. **Confusing Cosmos addresses with EVM addresses** — Saga Chainlets with EVM support have both address formats. The Cosmos address (`saga1...`) and EVM address (`0x...`) represent the same account but use different encodings. Use `sagacli debug addr` to convert between them.

3. **Assuming instant IBC transfers** — IBC transfers between chains require relayer activity and packet acknowledgment. On testnet, relayers may be slow or offline. Transfers can take 30 seconds to several minutes. Don't assume instant cross-chain settlement.

4. **Deploying without checking gas denom** — Your Chainlet uses a custom gas token (e.g., `ugame`). If you try to pay gas with ETH or SAGA on the Chainlet, transactions will fail. Fund your EVM account with the Chainlet's native token first.

5. **Ignoring the Interchain Security model** — Chainlet security comes from Saga mainnet validators. If Saga mainnet has a liveness failure, your Chainlet also halts. This is a different trust model than running your own validators — you're trading operational complexity for dependency on Saga's validator set.

## What to Learn Next

- [Avalanche Subnets](./06-avalanche-subnets.md) — Deploy a subnet with sub-second finality using Avalanche's consensus
- [Saga Documentation](https://docs.saga.xyz/) — Official Saga developer reference
- [Saga GitHub](https://github.com/sagaxyz/ssc) — Source code for Saga CLI and chain tools
- [Interchain Security](https://cosmos.github.io/interchain-security/) — How shared security works in the Cosmos ecosystem
