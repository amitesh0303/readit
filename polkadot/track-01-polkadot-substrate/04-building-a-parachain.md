# Building a Parachain: From Substrate Runtime to Polkadot-Connected Chain

**Track:** Polkadot & Substrate Development
**Lesson:** 4 of 6
**Level:** Advanced
**Read time:** 14 min

---

## The Problem

You've built a Substrate runtime with custom pallets, but it's running as a standalone "solochain." How do you connect it to Polkadot's relay chain to inherit shared security? The process involves adding Cumulus (the parachain SDK), configuring collator nodes, registering your chain, and understanding the parachain lifecycle. Get this wrong and your chain won't produce blocks, won't finalize, or will lose its slot.

## Core Concepts

### Solochain vs Parachain

A Substrate solochain runs its own consensus and finalizes its own blocks. A parachain delegates consensus to the relay chain:

| Aspect | Solochain | Parachain |
|--------|-----------|-----------|
| Consensus | Self-managed (Aura/BABE + GRANDPA) | Relay chain validators |
| Security | Own validator set | Shared with all parachains |
| Finality | Own GRANDPA | Relay chain GRANDPA |
| Block production | Validators | Collators (no staking needed) |
| Interoperability | Bridges only | Native XCM messaging |

### Cumulus: The Parachain SDK

Cumulus extends Substrate to make your runtime parachain-compatible. It adds:

- **Collator logic**: Produces parachain blocks and submits them to relay chain validators
- **Relay chain interface**: Communicates with the relay chain for block validation
- **Parachain inherents**: Injects relay chain state (like the relay parent block) into parachain blocks
- **Message passing**: Handles inbound/outbound XCM messages

### Project Structure

```
my-parachain/
├── node/
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── chain_spec.rs    # Genesis configuration
│   │   ├── service.rs       # Collator service setup
│   │   └── cli.rs           # CLI arguments
├── runtime/
│   ├── src/
│   │   └── lib.rs           # Runtime with Cumulus pallets
│   └── Cargo.toml
├── pallets/
│   └── my-pallet/           # Custom pallets
└── Cargo.toml
```

### Adding Cumulus to Your Runtime

Transform a solochain runtime into a parachain runtime:

```rust
// runtime/src/lib.rs
// polkadot-sdk@1.7.0 (cumulus-pallet-parachain-system, parachain-info)

use cumulus_pallet_parachain_system::RelayNumberMonotonicallyIncreases;

// Add parachain-specific pallets to construct_runtime!
construct_runtime!(
    pub struct Runtime {
        // System (same as solochain)
        System: frame_system = 0,
        Timestamp: pallet_timestamp = 1,
        Balances: pallet_balances = 10,
        TransactionPayment: pallet_transaction_payment = 11,

        // Parachain-specific pallets (replace Aura/GRANDPA consensus)
        ParachainSystem: cumulus_pallet_parachain_system = 20,
        ParachainInfo: parachain_info = 21,

        // Collator selection (who produces blocks)
        CollatorSelection: pallet_collator_selection = 30,
        Session: pallet_session = 31,
        Aura: pallet_aura = 32,  // Still used for collator slot assignment
        AuraExt: cumulus_pallet_aura_ext = 33,

        // XCM messaging
        XcmpQueue: cumulus_pallet_xcmp_queue = 40,
        CumulusXcm: cumulus_pallet_xcm = 41,
        MessageQueue: pallet_message_queue = 42,

        // Custom pallets
        MyPallet: pallet_my_pallet = 50,
    }
);

/// Configure the parachain system pallet
impl cumulus_pallet_parachain_system::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OnSystemEvent = ();
    type SelfParaId = parachain_info::Pallet<Runtime>;
    /// Ensures relay chain block numbers always increase
    type CheckAssociatedRelayNumber = RelayNumberMonotonicallyIncreases;
    /// How to handle incoming DMP (Downward Message Passing) messages
    type DmpQueue = frame_support::traits::EnqueueWithOrigin<MessageQueue, RelayOrigin>;
    /// Weight information
    type WeightInfo = cumulus_pallet_parachain_system::weights::SubstrateWeight<Runtime>;
}

/// ParachainInfo stores the parachain's ID
impl parachain_info::Config for Runtime {}
```

### Collator Node Service

The collator node differs from a solochain node — it connects to both the parachain network and the relay chain:

```rust
// node/src/service.rs (simplified)
// polkadot-sdk@1.7.0

use cumulus_client_service::{
    build_relay_chain_interface, prepare_node_config, start_relay_chain_tasks,
    CollatorSybilResistance, DARecoveryProfile, StartRelayChainTasksParams,
};
use cumulus_primitives_core::ParaId;

/// Start a parachain collator node
pub async fn start_parachain_node(
    parachain_config: Configuration,
    relay_chain_config: Configuration,
    para_id: ParaId,
) -> Result<TaskManager, sc_service::Error> {
    // Build the relay chain interface (connects to relay chain)
    let relay_chain_interface = build_relay_chain_interface(
        relay_chain_config,
        None, // No telemetry
        &mut task_manager,
    ).await?;

    // Start the collator
    let params = StartRelayChainTasksParams {
        client: client.clone(),
        announce_block: announce_block.clone(),
        para_id,
        relay_chain_interface: relay_chain_interface.clone(),
        task_manager: &mut task_manager,
        da_recovery_profile: DARecoveryProfile::Parachain,
        import_queue: import_queue_service,
        relay_chain_slot_duration: Duration::from_secs(6),
        recovery_handle: Box::new(overseer_handle.clone()),
        sync_service: sync_service.clone(),
    };

    start_relay_chain_tasks(params)?;

    Ok(task_manager)
}
```

### Registering Your Parachain

To connect to a relay chain (Rococo testnet for development):

```shell
# 1. Generate chain spec with your parachain ID
./target/release/my-parachain-node build-spec \
    --chain rococo-local \
    --disable-default-bootnode \
    > chain-spec-plain.json
```

```shell
# 2. Export genesis state (needed for registration)
./target/release/my-parachain-node export-genesis-state \
    --chain chain-spec-plain.json \
    > genesis-state
```

```
Expected output:
0x000000000000000000000000000000000000000000000000...
```

```shell
# 3. Export genesis WASM (the runtime blob)
./target/release/my-parachain-node export-genesis-wasm \
    --chain chain-spec-plain.json \
    > genesis-wasm
```

```shell
# 4. Register on relay chain via Sudo (testnet only)
# Use Polkadot.js Apps → Developer → Sudo → paraSudoWrapper → sudoScheduleParaInitialize
# Parameters:
#   id: 2000 (your ParaId)
#   genesisHead: <contents of genesis-state file>
#   validationCode: <contents of genesis-wasm file>
#   paraKind: true (parachain, not parathread)
```

### Running a Local Relay + Parachain Setup

For development, use `zombienet` to spin up a local relay chain with your parachain:

```shell
# Install zombienet
# zombienet@1.3.100
cargo install zombienet@1.3.100

# Create a zombienet config (zombienet.toml)
```

```toml
# zombienet.toml
[relaychain]
default_command = "./target/release/polkadot"
chain = "rococo-local"

[[relaychain.nodes]]
name = "alice"
validator = true

[[relaychain.nodes]]
name = "bob"
validator = true

[[parachains]]
id = 2000
cumulus_based = true

[parachains.collator]
name = "my-parachain-collator"
command = "./target/release/my-parachain-node"
```

```shell
# Launch the network
zombienet spawn zombienet.toml
```

```
Expected output:
🚀 Network launched successfully
    Relay Chain:
      alice: ws://127.0.0.1:9944
      bob: ws://127.0.0.1:9955
    Parachains:
      my-parachain-collator (id: 2000): ws://127.0.0.1:9988
```

### Parachain Lifecycle

Once registered, your parachain goes through these states:

1. **Onboarding** — Runtime WASM and genesis state uploaded to relay chain
2. **Parathread** — Produces blocks on-demand (pay per block)
3. **Parachain** — Guaranteed block production every relay chain block (requires slot/coretime)
4. **Offboarding** — Graceful removal from relay chain

## Common Pitfalls

1. **Not syncing the relay chain first** — Your collator needs a fully synced relay chain node. If the relay chain isn't synced, your parachain won't produce blocks. Use `--relay-chain-rpc-urls` to connect to an existing relay chain node instead of syncing from scratch.

2. **Wrong ParaId in chain spec** — The ParaId in your chain spec must match what's registered on the relay chain. A mismatch means your blocks are rejected. Double-check with `parachain_info::Pallet::<Runtime>::parachain_id()`.

3. **Forgetting to export genesis state before code changes** — The genesis state and WASM must be generated from the same code version. If you change your runtime after exporting genesis, the relay chain will reject your blocks because the state root won't match.

4. **Assuming collators need staking** — Unlike validators, collators don't need to stake DOT. They just need to be registered in the `CollatorSelection` pallet. However, they do need enough balance to pay transaction fees for block submission.

## What to Learn Next

- [XCM Cross-Chain Messaging](./05-xcm-cross-chain-messaging.md) — Send tokens and execute remote calls between your parachain and others
- [Polkadot Docs: Build a Parachain](https://docs.substrate.io/tutorials/build-a-parachain/) — Official step-by-step tutorial
- [Cumulus GitHub](https://github.com/paritytech/polkadot-sdk/tree/master/cumulus) — Source code for the parachain SDK
