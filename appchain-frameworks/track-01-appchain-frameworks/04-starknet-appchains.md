# Starknet Appchains: Deploy a STARK-Proven Chain with Cairo

**Track:** Appchain Frameworks
**Lesson:** 4 of 6
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You want the strongest cryptographic guarantees for your appchain — STARK proofs that are quantum-resistant and don't require a trusted setup. Starknet's appchain framework (powered by Madara) lets you deploy a sovereign chain that uses Cairo for smart contracts and STARK proofs for state verification. But Cairo is a different programming model from Solidity, and the Madara sequencer stack has its own configuration requirements. Without a clear path, you'll struggle with Cairo's ownership model and Madara's genesis configuration.

## Core Concepts

### What are Starknet Appchains?

Starknet appchains (also called "Starknet Stack" or "Madara chains") are sovereign chains that use:

- **Cairo VM**: A custom virtual machine designed for provable computation
- **STARK proofs**: Transparent, quantum-resistant proofs with no trusted setup
- **Madara sequencer**: A Substrate-based sequencer that produces blocks and generates proofs
- **Flexible settlement**: Settle to Ethereum, Starknet mainnet, or run fully sovereign

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
│              Starknet Appchain Architecture              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit transactions (invoke/deploy/declare)      │
│       ↓                                                 │
│  Madara Sequencer (Substrate-based)                     │
│  └── Orders txs, executes via Cairo VM                  │
│  └── Produces blocks (~6s default)                      │
│  └── Maintains state trie (contract storage)            │
│       ↓                                                 │
│  STARK Prover (Stone/Stwo)                              │
│  └── Generates execution trace                          │
│  └── Produces STARK proof (~hours for large batches)    │
│  └── Proof size: ~200KB (grows logarithmically)         │
│       ↓                                                 │
│  Settlement Layer (Ethereum or Starknet L1)             │
│  └── Verifies STARK proof on-chain                      │
│  └── Stores state commitment                            │
│  └── Enables L1 ↔ appchain messaging                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

```shell
# Install Rust (required for Madara)
# Last verified: 2025-01-15
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup default stable
rustup update
```

```
Expected output:
info: default toolchain set to 'stable-x86_64-unknown-linux-gnu'
stable-x86_64-unknown-linux-gnu installed - rustc 1.75.0
```

```shell
# Install Scarb (Cairo package manager and compiler)
# Source: https://github.com/software-mansion/scarb
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh -s -- -v 2.8.4
```

```
Expected output:
scarb 2.8.4 (a]b2c3d4e 2025-01-10)
cairo: 2.8.4
sierra: 1.6.0
```

```shell
# Install Starkli (Starknet CLI tool)
# Source: https://github.com/xJonathanLEI/starkli
curl https://get.starkli.sh | sh
starkliup
```

```
Expected output:
starkli 0.3.5 (abcdef1 2025-01-08)
```

```shell
# Install Docker (for Madara devnet)
docker --version  # Docker 24.0+
```

### Launch a Madara Devnet

```shell
# Clone Madara
git clone https://github.com/madara-alliance/madara.git
cd madara
git checkout v0.7.0  # Pin to stable release

# Build Madara (takes ~10 minutes first time)
cargo build --release
```

```
Expected output:
   Compiling madara v0.7.0
    Finished release [optimized] target(s) in 10m 32s
```

```shell
# Start a local devnet with pre-funded accounts
./target/release/madara \
  --dev \
  --rpc-port 9944 \
  --rpc-cors all \
  --chain-config-path configs/presets/devnet.yaml
```

```
Expected output:
2025-01-15 10:00:00 [info] Madara starting...
2025-01-15 10:00:01 [info] Chain: madara-devnet
2025-01-15 10:00:01 [info] RPC server started at http://0.0.0.0:9944
2025-01-15 10:00:01 [info] Pre-funded accounts:
  Account 0: 0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691
  Private key: 0x0000000000000000000000000000000071d7bb07b9a64f6f78ac4c816aff4da9
```

Alternatively, use Docker for a quick start:

```shell
# Run Madara devnet via Docker
docker run -d \
  --name madara-devnet \
  -p 9944:9944 \
  ghcr.io/madara-alliance/madara:v0.7.0 \
  --dev --rpc-port 9944 --rpc-cors all
```

```
Expected output:
Status: Downloaded newer image for ghcr.io/madara-alliance/madara:v0.7.0
abc123def456...
```

### Write a Cairo Contract

Cairo uses a different programming model than Solidity — it's designed for provable computation with an ownership/linear type system:

```cairo
// src/lib.cairo — A simple registry contract in Cairo
// Scarb.toml: cairo-version = "2.8.4"

#[starknet::interface]
trait IRegistry<TContractState> {
    fn store_record(ref self: TContractState, key: felt252, value: felt252);
    fn get_record(self: @TContractState, key: felt252) -> felt252;
    fn get_record_count(self: @TContractState) -> u256;
}

#[starknet::contract]
mod Registry {
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StoragePathEntry
    };
    use starknet::get_caller_address;
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        records: Map<felt252, felt252>,
        record_owners: Map<felt252, ContractAddress>,
        record_count: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        RecordStored: RecordStored,
    }

    #[derive(Drop, starknet::Event)]
    struct RecordStored {
        #[key]
        key: felt252,
        value: felt252,
        owner: ContractAddress,
    }

    #[abi(embed_v0)]
    impl RegistryImpl of super::IRegistry<ContractState> {
        fn store_record(ref self: ContractState, key: felt252, value: felt252) {
            let caller = get_caller_address();

            self.records.entry(key).write(value);
            self.record_owners.entry(key).write(caller);
            self.record_count.write(self.record_count.read() + 1);

            self.emit(RecordStored { key, value, owner: caller });
        }

        fn get_record(self: @ContractState, key: felt252) -> felt252 {
            self.records.entry(key).read()
        }

        fn get_record_count(self: @ContractState) -> u256 {
            self.record_count.read()
        }
    }
}
```

### Build and Deploy the Contract

```shell
# Initialize a Scarb project
scarb init registry_contract
cd registry_contract
```

Create the `Scarb.toml`:

```toml
# Scarb.toml
[package]
name = "registry_contract"
version = "0.1.0"
cairo-version = "2.8.4"

[dependencies]
starknet = "2.8.4"

[[target.starknet-contract]]
sierra = true
casm = true
```

```shell
# Build the contract
scarb build
```

```
Expected output:
   Compiling registry_contract v0.1.0
    Finished release target(s) in 2.31s
```

```shell
# Set up Starkli with the devnet account
export STARKNET_RPC="http://localhost:9944"
export STARKNET_ACCOUNT="~/.starkli-wallets/devnet/account.json"
export STARKNET_KEYSTORE="~/.starkli-wallets/devnet/keystore.json"

# Create account descriptor for devnet pre-funded account
mkdir -p ~/.starkli-wallets/devnet
starkli account fetch \
  0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691 \
  --rpc $STARKNET_RPC \
  --output $STARKNET_ACCOUNT
```

```shell
# Declare the contract class (upload Sierra code)
starkli declare target/dev/registry_contract_Registry.contract_class.json \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE
```

```
Expected output:
Declaring Cairo 1 class: 0x01a2b3c4d5e6f7...
Transaction hash: 0x0abc123...
Class hash declared: 0x01a2b3c4d5e6f7...
```

```shell
# Deploy an instance of the contract
starkli deploy 0x01a2b3c4d5e6f7... \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE
```

```
Expected output:
Deploying class 0x01a2b3c4d5e6f7... with salt 0x...
Contract deployed: 0x07890abcdef123...
Transaction hash: 0x0def456...
```

### Interact with the Deployed Contract

```shell
# Store a record (invoke transaction)
starkli invoke 0x07890abcdef123... store_record 0x68656c6c6f 0x776f726c64 \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE
```

```
Expected output:
Invoke transaction hash: 0x0789abc...
```

```shell
# Read the record (call — no transaction needed)
starkli call 0x07890abcdef123... get_record 0x68656c6c6f \
  --rpc $STARKNET_RPC
```

```
Expected output:
[
  "0x776f726c64"
]
```

```shell
# Check record count
starkli call 0x07890abcdef123... get_record_count \
  --rpc $STARKNET_RPC
```

```
Expected output:
[
  "0x1",
  "0x0"
]
```

### Custom Chain Configuration

For production appchains, customize the Madara chain config:

```yaml
# configs/presets/my-appchain.yaml
chain_name: "my-starknet-appchain"
chain_id: "MY_APPCHAIN"
native_fee_token_address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
parent_fee_token_address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
latest_protocol_version: "0.13.2"
block_time: "6s"
pending_block_update_time: "2s"
sequencer_address: "0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691"
eth_core_contract_address: "0x0000000000000000000000000000000000000000"
```

```shell
# Start with custom config
./target/release/madara \
  --dev \
  --rpc-port 9944 \
  --chain-config-path configs/presets/my-appchain.yaml \
  --base-path /data/my-appchain
```

## Common Pitfalls

1. **Treating Cairo like Solidity** — Cairo has no inheritance, no dynamic dispatch, and uses a linear type system. You can't "transfer" a variable after it's been moved. Read the Cairo Book (https://book.cairo-lang.org/) before writing contracts.

2. **Forgetting `felt252` limitations** — `felt252` is a 251-bit prime field element, not a 256-bit integer. Values wrap around the prime `P = 2^251 + 17*2^192 + 1`. For large numbers, use `u256` (which is two `felt252` values internally).

3. **Not declaring before deploying** — Starknet separates "declare" (upload code) from "deploy" (create instance). You must declare the contract class first, get the class hash, then deploy using that hash. Skipping declare gives a "class not found" error.

4. **Underestimating STARK proof generation time** — STARK proofs for large batches can take hours on standard hardware. For production appchains, you need dedicated prover infrastructure (GPU-accelerated or distributed proving). Don't promise sub-minute finality unless you have the hardware.

5. **Using devnet accounts on testnet** — The pre-funded devnet accounts (starting with `0x064b...`) only exist on your local Madara instance. On Starknet Sepolia or mainnet, you need to deploy your own account contract and fund it separately.

## What to Learn Next

- [Saga Chainlets](./05-saga-chainlets.md) — Launch a dedicated chain in minutes using Saga's infrastructure
- [Starknet Documentation](https://docs.starknet.io/) — Official Starknet developer reference
- [Madara GitHub](https://github.com/madara-alliance/madara) — Source code for the Madara sequencer
- [The Cairo Book](https://book.cairo-lang.org/) — Complete Cairo language reference
- [Blockchain Scaling: STARKs](https://starkware.co/stark/) — STARK proof system fundamentals
