# Polygon CDK: Deploy a ZK-Proven Rollup

**Track:** Appchain Frameworks
**Lesson:** 3 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You want the security guarantees of zero-knowledge proofs for your appchain — mathematical certainty that state transitions are correct, without relying on a 7-day challenge window. Polygon CDK (Chain Development Kit) lets you deploy a ZK-rollup with EVM compatibility, but the stack involves a zkEVM prover, a data availability layer choice, and bridge infrastructure that must be configured correctly. Without understanding how these pieces fit together, you'll deploy a chain that can't generate proofs or bridge assets.

## Core Concepts

### What is Polygon CDK?

Polygon CDK is a modular toolkit for launching ZK-proven L2 chains (called "CDK chains") that connect to the Polygon ecosystem via the AggLayer. Key properties:

- **ZK-proven state**: Every batch of transactions is accompanied by a SNARK proof verifying correct execution
- **EVM equivalence**: Runs the Polygon zkEVM — deploy Solidity contracts without modification
- **Modular DA**: Choose between Ethereum calldata, a Data Availability Committee (DAC), or external DA layers
- **AggLayer connectivity**: Cross-chain interop with other CDK chains via unified bridge

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
│                  Polygon CDK Architecture                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions                              │
│       ↓                                                 │
│  Sequencer (cdk-erigon)                                 │
│  └── Orders txs, produces L2 blocks                     │
│  └── Provides "trusted" state instantly                 │
│       ↓                                                 │
│  Aggregator (cdk-node)                                  │
│  └── Collects batches from sequencer                    │
│  └── Sends batches to Prover for ZK proof generation    │
│       ↓                                                 │
│  Prover (zkProver)                                      │
│  └── Generates SNARK proofs for batch execution         │
│  └── Proof generation takes ~30 min per batch           │
│       ↓                                                 │
│  L1 Contracts (on Ethereum)                             │
│  └── PolygonZkEVM: verifies proofs, stores state roots  │
│  └── PolygonZkEVMBridge: deposits/withdrawals           │
│  └── DAC (optional): data availability attestations     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

```shell
# System requirements for ZK prover:
# - 64GB+ RAM (prover is memory-intensive)
# - 16+ CPU cores recommended
# - 500GB+ SSD storage
# For devnet/testing, 16GB RAM is sufficient (mock prover)

# Install Docker and Docker Compose
docker --version   # Docker 24.0+
docker compose version  # v2.20+

# Install kurtosis (orchestration tool for CDK devnet)
# Source: https://github.com/kurtosis-tech/kurtosis
echo "deb [trusted=yes] https://apt.fury.io/kurtosis-tech/ /" | \
  sudo tee /etc/apt/sources.list.d/kurtosis.list
sudo apt update
sudo apt install kurtosis-cli=0.90.1
```

```
Expected output:
Docker version 24.0.7
Docker Compose version v2.23.3
kurtosis version 0.90.1
```

```shell
# Install Foundry for contract deployment
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install yq for YAML manipulation
sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.40.5/yq_linux_amd64
sudo chmod +x /usr/local/bin/yq
```

### Deploy CDK Devnet with Kurtosis

The fastest way to get a running CDK chain is using the official Kurtosis package:

```shell
# Clone the CDK Kurtosis package
git clone https://github.com/0xPolygon/kurtosis-cdk.git
cd kurtosis-cdk
git checkout v0.2.15  # Pin to stable release
```

```shell
# Review and customize the configuration
cat params.yml
```

```yaml
# params.yml — CDK chain configuration (key fields)
args:
  deployment_suffix: "-001"
  chain_id: 10101
  zkevm_rollup_chain_id: 10101
  sequencer_type: "erigon"
  data_availability_mode: "rollup"  # "rollup" = post to L1, "cdk-validium" = DAC
  consensus_contract_type: "rollup"
  enable_normalcy: false
  zkevm_use_real_verifier: false    # false = mock prover for devnet
```

```shell
# Start the CDK devnet
kurtosis run --enclave cdk-v1 .
```

```
Expected output:
INFO[2025-01-15] Creating enclave 'cdk-v1'
INFO[2025-01-15] Starting L1 chain...
INFO[2025-01-15] Deploying CDK contracts to L1...
INFO[2025-01-15] Starting CDK sequencer...
INFO[2025-01-15] Starting CDK aggregator...
INFO[2025-01-15] Starting CDK prover (mock)...
INFO[2025-01-15] CDK devnet is ready!

========================================
Enclave: cdk-v1
Status: RUNNING

Services:
  l1-el-1-geth        RUNNING  http://127.0.0.1:8545
  cdk-erigon-node-001 RUNNING  http://127.0.0.1:8123
  zkevm-bridge-ui-001 RUNNING  http://127.0.0.1:8080
  zkevm-prover-001    RUNNING
  cdk-node-001        RUNNING
========================================
```

### Interact with Your CDK Chain

```shell
# Get the L2 RPC endpoint
export CDK_RPC=$(kurtosis port print cdk-v1 cdk-erigon-node-001 rpc)
echo $CDK_RPC
```

```
Expected output:
http://127.0.0.1:8123
```

```shell
# Verify chain ID
cast chain-id --rpc-url $CDK_RPC
```

```
Expected output:
10101
```

```shell
# Check the pre-funded sequencer account balance
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url $CDK_RPC
```

```
Expected output:
100000000000000000000000  # 100,000 ETH (devnet)
```

### Deploy a Contract to Your CDK Chain

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZKVerifiedStorage
/// @notice Demonstrates that state changes on CDK are ZK-proven
/// @dev Every write to this contract will be included in a ZK proof batch
contract ZKVerifiedStorage {
    mapping(address => string) public records;
    uint256 public totalRecords;

    event RecordStored(address indexed user, string data, uint256 recordNumber);
    error EmptyData();

    function store(string calldata data) external {
        if (bytes(data).length == 0) revert EmptyData();

        records[msg.sender] = data;
        totalRecords++;

        emit RecordStored(msg.sender, data, totalRecords);
    }

    function retrieve(address user) external view returns (string memory) {
        return records[user];
    }
}
```

```shell
# Deploy using the pre-funded devnet key
forge create ZKVerifiedStorage \
  --rpc-url $CDK_RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

```
Expected output:
Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Transaction hash: 0x...
```

```shell
# Store a record
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "store(string)" "Hello from Polygon CDK!" \
  --rpc-url $CDK_RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

```
Expected output:
status           1 (success)
transactionHash  0x...
gasUsed          47832
```

```shell
# Retrieve the record
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "retrieve(address)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url $CDK_RPC | cast --to-ascii
```

```
Expected output:
Hello from Polygon CDK!
```

### Verify ZK Proof Generation

```shell
# Check the aggregator logs for proof submissions
kurtosis service logs cdk-v1 cdk-node-001 | grep -i "proof"
```

```
Expected output:
INFO aggregator: proof verified successfully batch=1
INFO aggregator: sending verify proof to L1 batch=1
```

### Switching to Validium Mode (DAC)

For lower costs with a Data Availability Committee instead of posting all data to L1:

```yaml
# params.yml — switch to validium mode
args:
  data_availability_mode: "cdk-validium"  # Use DAC instead of L1
  dac_nodes_count: 3                       # Number of DAC members
```

```shell
# Restart with validium configuration
kurtosis clean --name cdk-v1
kurtosis run --enclave cdk-v1 .
```

## Common Pitfalls

1. **Running the real prover without sufficient RAM** — The ZK prover requires 64GB+ RAM for production proof generation. On machines with less memory, the prover OOMs silently and batches never get proven. Use `zkevm_use_real_verifier: false` for development.

2. **Confusing "trusted" vs "virtual" vs "verified" state** — CDK has three finality levels: trusted (sequencer says it's valid), virtual (data posted to L1), and verified (ZK proof accepted on L1). Only "verified" state has full security guarantees.

3. **Not monitoring the aggregator** — If the aggregator crashes or falls behind, proofs stop being generated. The chain continues to work (sequencer still processes txs) but withdrawals to L1 are blocked until proofs catch up.

4. **Using the wrong bridge contract for withdrawals** — CDK chains use `PolygonZkEVMBridge` (not the standard Optimism bridge pattern). Calling the wrong contract locks funds. Always verify the bridge address from the L1 deployment output.

5. **Ignoring the DAC trust assumption in validium mode** — In validium mode, data availability depends on the DAC members being honest. If a majority of DAC members collude, they can withhold data and freeze the chain. For high-value applications, use rollup mode (post to L1).

## What to Learn Next

- [Starknet Appchains](./04-starknet-appchains.md) — Deploy a STARK-proven appchain using Cairo
- [Polygon CDK Documentation](https://docs.polygon.technology/cdk/) — Official CDK reference
- [Kurtosis CDK GitHub](https://github.com/0xPolygon/kurtosis-cdk) — Source code for CDK devnet orchestration
- [AggLayer Specification](https://docs.polygon.technology/agglayer/) — Cross-chain interop between CDK chains
