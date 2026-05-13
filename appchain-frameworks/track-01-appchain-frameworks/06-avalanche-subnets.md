# Avalanche Subnets: Sub-Second Finality with Custom VMs

**Track:** Appchain Frameworks
**Lesson:** 6 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You need an appchain with the fastest possible finality — sub-second confirmation times that make your application feel instant. Most appchain frameworks offer 2-6 second block times at best, and rollups require minutes to hours for true finality. Avalanche Subnets give you sub-second finality through the Snowman consensus protocol, plus the flexibility to run EVM, custom VMs, or even your own execution environment. But the subnet creation process involves staking, validator management, and VM configuration that isn't obvious from the documentation alone.

## Core Concepts

### What are Avalanche Subnets?

An Avalanche Subnet is a sovereign network of validators that reach consensus on one or more blockchains. Key properties:

- **Sub-second finality**: Snowman consensus achieves finality in <1 second through repeated random sampling
- **Custom VMs**: Run the Subnet-EVM (EVM compatible), HyperSDK (high-performance custom VM), or any WASM-based VM
- **Elastic subnets**: Validators stake the subnet's native token (not just AVAX) via Elastic Subnet transforms
- **No shared state**: Each subnet has independent state, throughput, and gas economics

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
│              Avalanche Subnet Architecture               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Primary Network (P-Chain, X-Chain, C-Chain)            │
│  └── P-Chain: Subnet/validator management               │
│  └── All subnet validators must also validate Primary   │
│       ↓                                                 │
│  Your Subnet                                            │
│  └── Subset of Primary Network validators               │
│  └── Independent consensus (Snowman)                    │
│  └── Own block space, own gas token                     │
│       ↓                                                 │
│  Your Blockchain (runs on the Subnet)                   │
│  └── Subnet-EVM: Full EVM compatibility                 │
│  └── OR HyperSDK: Custom high-performance VM            │
│  └── OR Custom VM: Any execution environment            │
│       ↓                                                 │
│  Consensus: Snowman Protocol                            │
│  └── Repeated random sampling of validators             │
│  └── Achieves finality in <1 second                     │
│  └── No leader election, no block proposer rotation     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

```shell
# Install Avalanche CLI
# Source: https://github.com/ava-labs/avalanche-cli
# Last verified: 2025-01-15
curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin v1.7.4
```

```
Expected output:
ava-labs/avalanche-cli v1.7.4: installed successfully in /usr/local/bin
```

```shell
# Verify installation
avalanche --version
```

```
Expected output:
avalanche version 1.7.4
```

```shell
# Install Foundry (for EVM subnet interaction)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install AvalancheGo (node software) — optional for local testing
# The CLI handles this automatically for local deployments
```

### Create a Subnet-EVM Chain (Local)

The Avalanche CLI provides the fastest path to a running subnet:

```shell
# Create a new subnet with EVM compatibility
avalanche subnet create mysubnet
```

The CLI will prompt for configuration. Here's what to select:

```
? Choose your VM: Subnet-EVM
? What version of Subnet-EVM would you like?: Use latest release
? How would you like to set fees: Low disk use / Low throughput (12.5 tokens/s)
? How would you like to distribute funds: Airdrop 1 million tokens to the default ewoq address
? Advanced: Would you like to add a custom precompile?: No

✓ Successfully created subnet configuration
```

```shell
# Deploy the subnet locally (starts a 5-node local network)
avalanche subnet deploy mysubnet --local
```

```
Expected output:
Deploying [mysubnet] to Local Network

Backend controller started, pid: 12345, output at: ~/.avalanche-cli/runs/...

Network ready to use.

+-------+----------+-------------------------------------------+
| NODE  |    VM    |                    URL                    |
+-------+----------+-------------------------------------------+
| node1 | mysubnet | http://127.0.0.1:9650/ext/bc/mysubnet/rpc |
| node2 | mysubnet | http://127.0.0.1:9652/ext/bc/mysubnet/rpc |
| node3 | mysubnet | http://127.0.0.1:9654/ext/bc/mysubnet/rpc |
| node4 | mysubnet | http://127.0.0.1:9656/ext/bc/mysubnet/rpc |
| node5 | mysubnet | http://127.0.0.1:9658/ext/bc/mysubnet/rpc |
+-------+----------+-------------------------------------------+

Browser Extension connection details (any node URL from above works):
RPC URL:          http://127.0.0.1:9650/ext/bc/mysubnet/rpc
Funded address:   0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC
Network name:     mysubnet
Chain ID:         12345
Currency Symbol:  TEST
```

### Verify Sub-Second Finality

```shell
# Set the RPC URL
export SUBNET_RPC="http://127.0.0.1:9650/ext/bc/mysubnet/rpc"

# Check chain ID
cast chain-id --rpc-url $SUBNET_RPC
```

```
Expected output:
12345
```

```shell
# Measure finality time by sending a transaction and checking confirmation
time cast send 0x0000000000000000000000000000000000000001 \
  --value 0.001ether \
  --rpc-url $SUBNET_RPC \
  --private-key 0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
```

```
Expected output:
status           1 (success)
transactionHash  0x...
blockNumber      1

real    0m0.847s   # Sub-second finality!
user    0m0.123s
sys     0m0.045s
```

### Deploy a Contract to Your Subnet

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title InstantSettlement
/// @notice Demonstrates sub-second finality on Avalanche Subnets
/// @dev Transactions are final in <1s — no reorgs, no waiting
contract InstantSettlement {
    struct Trade {
        address maker;
        address taker;
        uint256 amount;
        uint256 price;
        uint256 settledAt;
        bool settled;
    }

    mapping(uint256 => Trade) public trades;
    uint256 public tradeCount;

    event TradeCreated(uint256 indexed tradeId, address maker, uint256 amount, uint256 price);
    event TradeSettled(uint256 indexed tradeId, address taker, uint256 settledAt);

    error TradeNotFound(uint256 tradeId);
    error TradeAlreadySettled(uint256 tradeId);
    error InsufficientPayment(uint256 required, uint256 sent);

    /// @notice Create a new trade offer
    function createTrade(uint256 amount, uint256 price) external returns (uint256) {
        uint256 tradeId = tradeCount++;
        trades[tradeId] = Trade({
            maker: msg.sender,
            taker: address(0),
            amount: amount,
            price: price,
            settledAt: 0,
            settled: false
        });

        emit TradeCreated(tradeId, msg.sender, amount, price);
        return tradeId;
    }

    /// @notice Settle a trade — final in <1 second on Avalanche Subnet
    function settleTrade(uint256 tradeId) external payable {
        Trade storage trade = trades[tradeId];
        if (trade.maker == address(0)) revert TradeNotFound(tradeId);
        if (trade.settled) revert TradeAlreadySettled(tradeId);
        if (msg.value < trade.price) revert InsufficientPayment(trade.price, msg.value);

        trade.taker = msg.sender;
        trade.settledAt = block.timestamp;
        trade.settled = true;

        // Transfer payment to maker
        (bool success, ) = trade.maker.call{value: trade.price}("");
        require(success, "Payment transfer failed");

        // Refund excess
        if (msg.value > trade.price) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - trade.price}("");
            require(refundSuccess, "Refund failed");
        }

        emit TradeSettled(tradeId, msg.sender, block.timestamp);
    }
}
```

```shell
# Deploy the contract
forge create InstantSettlement \
  --rpc-url $SUBNET_RPC \
  --private-key 0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
```

```
Expected output:
Deployer: 0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC
Deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Transaction hash: 0x...
```

```shell
# Create a trade
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "createTrade(uint256,uint256)" 100 1000000000000000000 \
  --rpc-url $SUBNET_RPC \
  --private-key 0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
```

```
Expected output:
status           1 (success)
transactionHash  0x...
```

```shell
# Settle the trade (with payment)
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "settleTrade(uint256)" 0 \
  --value 1ether \
  --rpc-url $SUBNET_RPC \
  --private-key 0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
```

```
Expected output:
status           1 (success)
transactionHash  0x...
```

### Custom Subnet Configuration

For production subnets, customize gas fees, block size, and precompiles:

```json
// genesis.json — Custom Subnet-EVM genesis
{
  "config": {
    "chainId": 12345,
    "homesteadBlock": 0,
    "eip150Block": 0,
    "eip155Block": 0,
    "eip158Block": 0,
    "byzantiumBlock": 0,
    "constantinopleBlock": 0,
    "petersburgBlock": 0,
    "istanbulBlock": 0,
    "subnetEVMTimestamp": 0,
    "feeConfig": {
      "gasLimit": 15000000,
      "targetBlockRate": 1,
      "minBaseFee": 25000000000,
      "targetGas": 15000000,
      "baseFeeChangeDenominator": 36,
      "minBlockGasCost": 0,
      "maxBlockGasCost": 1000000,
      "blockGasCostStep": 200000
    },
    "allowFeeRecipients": true
  },
  "alloc": {
    "8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC": {
      "balance": "0x204FCE5E3E25026110000000"
    }
  },
  "nonce": "0x0",
  "timestamp": "0x0",
  "extraData": "0x",
  "gasLimit": "0xE4E1C0",
  "difficulty": "0x0",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "coinbase": "0x0000000000000000000000000000000000000000"
}
```

```shell
# Create subnet with custom genesis
avalanche subnet create mysubnet-custom --genesis genesis.json --vm subnet-evm
```

### Deploy to Fuji Testnet

For a public testnet deployment:

```shell
# Configure for Fuji testnet
avalanche subnet deploy mysubnet --fuji
```

```
Expected output:
Deploying [mysubnet] to Fuji

? Which private key would you like to use?: Use stored key "mykey"
? How many validators would you like to add?: 5

Subnet has been created with ID: 2ABC123...
Blockchain has been created with ID: 2DEF456...

Your subnet is now validating on Fuji!

RPC URL: https://api.avax-test.network/ext/bc/2DEF456.../rpc
Chain ID: 12345

Add validators with:
  avalanche subnet addValidator mysubnet --fuji
```

```shell
# Verify on Fuji
export FUJI_SUBNET_RPC="https://api.avax-test.network/ext/bc/2DEF456.../rpc"
cast chain-id --rpc-url $FUJI_SUBNET_RPC
```

```
Expected output:
12345
```

### Teleporter: Cross-Subnet Messaging

Avalanche Teleporter enables cross-subnet communication:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITeleporterMessenger} from "@teleporter/ITeleporterMessenger.sol"; // teleporter@1.0.0
import {ITeleporterReceiver} from "@teleporter/ITeleporterReceiver.sol";

/// @title CrossSubnetMessenger
/// @notice Send messages between Avalanche Subnets via Teleporter
contract CrossSubnetMessenger is ITeleporterReceiver {
    ITeleporterMessenger public immutable teleporter;
    mapping(bytes32 => string) public receivedMessages;

    event MessageSent(bytes32 indexed destinationChainID, string message);
    event MessageReceived(bytes32 indexed sourceChainID, string message);

    error InvalidTeleporter(address caller);

    constructor(address _teleporter) {
        teleporter = ITeleporterMessenger(_teleporter);
    }

    function sendMessage(
        bytes32 destinationChainID,
        address destinationContract,
        string calldata message
    ) external {
        teleporter.sendCrossChainMessage(
            ITeleporterMessenger.TeleporterMessageInput({
                destinationBlockchainID: destinationChainID,
                destinationAddress: destinationContract,
                feeInfo: ITeleporterMessenger.TeleporterFeeInfo({
                    feeTokenAddress: address(0),
                    amount: 0
                }),
                requiredGasLimit: 100000,
                allowedRelayerAddresses: new address[](0),
                message: abi.encode(message)
            })
        );

        emit MessageSent(destinationChainID, message);
    }

    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address,
        bytes calldata message
    ) external {
        if (msg.sender != address(teleporter)) {
            revert InvalidTeleporter(msg.sender);
        }

        string memory decodedMessage = abi.decode(message, (string));
        receivedMessages[sourceBlockchainID] = decodedMessage;

        emit MessageReceived(sourceBlockchainID, decodedMessage);
    }
}
```

## Common Pitfalls

1. **Forgetting that subnet validators must also validate the Primary Network** — Every subnet validator must stake at least 2000 AVAX on the Primary Network. This is a significant capital requirement. On Fuji testnet, get AVAX from https://faucet.avax.network (last verified: 2025-01-15).

2. **Setting `targetBlockRate` too aggressively** — A `targetBlockRate` of 1 means the network targets 1 block per second. Setting it lower doesn't guarantee faster blocks — it depends on transaction volume. Empty blocks are still produced at this rate, consuming validator resources.

3. **Not configuring fee recipients** — By default, transaction fees are burned. If you want validators to earn fees, set `allowFeeRecipients: true` in genesis and configure each validator's fee recipient address. Missing this means validators have no economic incentive beyond staking rewards.

4. **Assuming cross-subnet atomicity** — Teleporter messages are asynchronous. A transaction on Subnet A that sends a message to Subnet B will finalize on A in <1 second, but the message delivery to B depends on relayer activity (typically 2-10 seconds). Don't design protocols that assume atomic cross-subnet execution.

5. **Running too few validators** — While a subnet can technically run with 1 validator, this provides zero fault tolerance. For production, use at least 5 validators (tolerates 1 Byzantine failure). The Snowman consensus requires >80% of stake to be honest for liveness.

## What to Learn Next

- [Cosmos SDK Chain Creation](./01-cosmos-sdk-chain-creation.md) — Compare with the Cosmos approach to sovereign chains
- [Avalanche Documentation](https://docs.avax.network/subnets) — Official subnet developer reference
- [Avalanche CLI GitHub](https://github.com/ava-labs/avalanche-cli) — Source code for the Avalanche CLI
- [Teleporter GitHub](https://github.com/ava-labs/teleporter) — Cross-subnet messaging protocol
- [HyperSDK](https://github.com/ava-labs/hypersdk) — High-performance custom VM framework for Avalanche
