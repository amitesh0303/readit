# OP Stack Rollup Deployment: Launch Your Own L2 Chain

**Track:** Appchain Frameworks
**Lesson:** 2 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You want EVM compatibility for your appchain but need lower fees and higher throughput than Ethereum mainnet. The OP Stack (Optimism's modular rollup framework) lets you deploy a fully functional optimistic rollup that settles to Ethereum, but the deployment process involves multiple components — a sequencer, batcher, proposer, and L1 contracts — that must be configured and coordinated correctly. Without a clear walkthrough, you'll spend days debugging misconfigured services.

## Core Concepts

### What is the OP Stack?

The OP Stack is the modular framework behind Optimism, Base, Zora, and dozens of other L2 chains. It gives you:

- **Full EVM equivalence**: Deploy any Solidity contract without modification
- **Ethereum settlement**: Transaction data posted to L1 as blobs (EIP-4844)
- **Fraud proof security**: 7-day challenge window for state assertions
- **Superchain compatibility**: Interop with other OP Stack chains via shared messaging

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
│                  OP Stack Rollup Architecture            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions                              │
│       ↓                                                 │
│  Sequencer (op-node + op-geth)                          │
│  └── Orders txs, produces L2 blocks (~2s)               │
│  └── Provides instant "unsafe" confirmations            │
│       ↓                                                 │
│  Batcher (op-batcher)                                   │
│  └── Compresses L2 blocks into channel frames           │
│  └── Posts data to L1 as blob transactions              │
│       ↓                                                 │
│  Proposer (op-proposer)                                 │
│  └── Posts L2 output roots to L1 contract               │
│  └── Output roots become final after 7-day window       │
│       ↓                                                 │
│  L1 Contracts (on Ethereum)                             │
│  └── OptimismPortal: deposits/withdrawals               │
│  └── L2OutputOracle: state commitments                  │
│  └── SystemConfig: chain parameters                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

```shell
# Install required tools
# Last verified: 2025-01-15

# Docker and Docker Compose (required for devnet)
docker --version   # Docker 24.0+
docker compose version  # Docker Compose v2.20+

# Go 1.21+ (for building OP Stack binaries)
go version  # go1.21+

# Node.js 18+ and pnpm (for L1 contract deployment)
node --version  # v18+
npm install -g pnpm@8.15.4

# Foundry (for contract interaction)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# jq (for JSON parsing in scripts)
jq --version
```

```
Expected output:
Docker version 24.0.7
Docker Compose version v2.23.3
go version go1.21.6 linux/amd64
v18.19.0
8.15.4
forge 0.2.0
jq-1.7
```

### Clone and Build the OP Stack

```shell
# Clone the Optimism monorepo
git clone https://github.com/ethereum-optimism/optimism.git
cd optimism
git checkout v1.9.1  # Pin to stable release

# Build all OP Stack components
make op-node op-batcher op-proposer
cd op-geth
make geth
cd ..
```

```
Expected output:
Building op-node...
Building op-batcher...
Building op-proposer...
Done.
Building geth...
Done.
```

### Deploy L1 Contracts (Local Devnet)

The fastest path is using the built-in devnet that includes a local L1 (Ethereum) and L2:

```shell
# Start the full devnet stack
make devnet-up
```

```
Expected output:
[+] Running 7/7
 ✔ Container ops-bedrock-l1-1         Started
 ✔ Container ops-bedrock-l2-1         Started
 ✔ Container ops-bedrock-op-node-1    Started
 ✔ Container ops-bedrock-op-batcher-1 Started
 ✔ Container ops-bedrock-op-proposer-1 Started
```

For a custom deployment to Sepolia, configure the deploy script:

```shell
# Create deployment configuration
cat > deploy-config/custom-devnet.json << 'JSONEOF'
{
  "l1ChainID": 11155111,
  "l2ChainID": 99999,
  "l2BlockTime": 2,
  "maxSequencerDrift": 600,
  "sequencerWindowSize": 3600,
  "channelTimeout": 300,
  "p2pSequencerAddress": "0xYourSequencerAddress",
  "batchInboxAddress": "0xff00000000000000000000000000000000099999",
  "batchSenderAddress": "0xYourBatcherAddress",
  "l2OutputOracleSubmissionInterval": 120,
  "l2OutputOracleStartingTimestamp": 0,
  "l2OutputOracleProposer": "0xYourProposerAddress",
  "l2OutputOracleChallenger": "0xYourChallengerAddress",
  "finalizationPeriodSeconds": 12,
  "baseFeeVaultRecipient": "0xYourFeeRecipient",
  "l1FeeVaultRecipient": "0xYourFeeRecipient",
  "sequencerFeeVaultRecipient": "0xYourFeeRecipient",
  "governanceTokenName": "MyRollupToken",
  "governanceTokenSymbol": "MRT",
  "governanceTokenOwner": "0xYourGovernanceOwner"
}
JSONEOF
```

### Deploy L1 Contracts to Sepolia

```shell
# Set environment variables
export L1_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export PRIVATE_KEY="your_deployer_private_key"
export DEPLOY_CONFIG_PATH="deploy-config/custom-devnet.json"

# Deploy the L1 contracts
cd packages/contracts-bedrock
forge script scripts/Deploy.s.sol:Deploy \
  --rpc-url $L1_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

```
Expected output:
[⠊] Compiling...
Script ran successfully.
== Logs ==
  Deploying OptimismPortal...
  Deploying L2OutputOracle...
  Deploying SystemConfig...
  All contracts deployed successfully.
```

### Configure and Start the Sequencer

```shell
# Generate the L2 genesis and rollup config
cd ../..
go run cmd/opgen/main.go \
  --deploy-config deploy-config/custom-devnet.json \
  --l1-deployments packages/contracts-bedrock/deployments/sepolia/.deploy \
  --outfile-l2 genesis-l2.json \
  --outfile-rollup rollup.json
```

```shell
# Initialize op-geth with the L2 genesis
./op-geth/build/bin/geth init --datadir=./l2-data genesis-l2.json
```

```
Expected output:
INFO [01-15|10:00:00.000] Successfully wrote genesis state
```

```shell
# Start op-geth (execution layer)
./op-geth/build/bin/geth \
  --datadir=./l2-data \
  --http \
  --http.port=9545 \
  --http.addr=0.0.0.0 \
  --http.api=eth,net,web3,debug,txpool \
  --ws \
  --ws.port=9546 \
  --ws.addr=0.0.0.0 \
  --syncmode=full \
  --gcmode=archive \
  --networkid=99999 \
  --authrpc.port=9551 \
  --authrpc.jwtsecret=./jwt-secret.txt \
  --rollup.sequencerhttp=http://localhost:9545
```

```shell
# Start op-node (consensus layer)
./op-node/bin/op-node \
  --l1=$L1_RPC_URL \
  --l2=http://localhost:9551 \
  --l2.jwt-secret=./jwt-secret.txt \
  --sequencer.enabled \
  --sequencer.l1-confs=3 \
  --p2p.disable \
  --rpc.addr=0.0.0.0 \
  --rpc.port=9547 \
  --rollup.config=./rollup.json
```

### Verify the Rollup is Running

```shell
# Check L2 chain ID
cast chain-id --rpc-url http://localhost:9545
```

```
Expected output:
99999
```

```shell
# Check latest block
cast block latest --rpc-url http://localhost:9545 | grep -E "number|timestamp"
```

```
Expected output:
number           42
timestamp        1705312800
```

### Deploy a Contract to Your Rollup

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HelloRollup
/// @notice Simple contract to verify your OP Stack rollup is working
contract HelloRollup {
    string public message;
    address public owner;

    event MessageUpdated(string oldMessage, string newMessage, address updater);

    error NotOwner(address caller, address owner);

    constructor(string memory _message) {
        message = _message;
        owner = msg.sender;
    }

    function setMessage(string memory _newMessage) external {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender, owner);
        }
        string memory oldMessage = message;
        message = _newMessage;
        emit MessageUpdated(oldMessage, _newMessage, msg.sender);
    }
}
```

```shell
# Deploy to your local rollup
forge create HelloRollup \
  --rpc-url http://localhost:9545 \
  --private-key $PRIVATE_KEY \
  --constructor-args "Hello from my OP Stack rollup!"
```

```
Expected output:
Deployer: 0xYourAddress
Deployed to: 0xContractAddress
Transaction hash: 0x...
```

```shell
# Verify it works
cast call 0xContractAddress "message()" --rpc-url http://localhost:9545 | cast --to-ascii
```

```
Expected output:
Hello from my OP Stack rollup!
```

## Common Pitfalls

1. **Not generating a unique `l2ChainID`** — If your L2 chain ID conflicts with an existing chain (e.g., using 10 which is Optimism mainnet), wallets and tools will route transactions to the wrong network. Use a high random number (e.g., 99999) for devnets and register at https://chainlist.org for production.

2. **Forgetting to start the batcher** — Without `op-batcher` running, your L2 transactions execute locally but never get posted to L1. The chain appears to work but has zero security — a sequencer restart loses all state. Always verify batches are landing on L1.

3. **JWT secret mismatch between op-geth and op-node** — Both services must use the same `jwt-secret.txt` file. A mismatch causes silent authentication failures where op-node can't drive op-geth, and blocks stop being produced.

4. **Setting `finalizationPeriodSeconds` too low in production** — The 7-day (604800 seconds) challenge window exists for security. Setting it to 12 seconds is fine for devnets but would make a production chain trivially attackable. Fraud proofs need time for honest validators to respond.

5. **Running out of L1 ETH for the batcher** — The batcher posts blob transactions to L1 continuously. On Sepolia, this drains faucet ETH quickly. Monitor the batcher address balance and top it up before it hits zero, or batching stops silently.

## What to Learn Next

- [Polygon CDK](./03-polygon-cdk.md) — Deploy a ZK-proven rollup using Polygon's Chain Development Kit
- [OP Stack Documentation](https://docs.optimism.io/builders/chain-operators/tutorials/create-l2-rollup) — Official rollup deployment guide
- [Optimism Monorepo](https://github.com/ethereum-optimism/optimism) — Source code for all OP Stack components
- [Superchain Registry](https://github.com/ethereum-optimism/superchain-registry) — Register your chain for Superchain interop
