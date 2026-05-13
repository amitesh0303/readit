# XCM Cross-Chain Messaging: Tokens and Remote Calls Between Parachains

**Track:** Polkadot & Substrate Development
**Lesson:** 5 of 6
**Level:** Advanced
**Read time:** 13 min

---

## The Problem

Your parachain is running and connected to the relay chain, but it's isolated. Users want to move tokens from Acala to your chain, or your chain needs to call a function on another parachain. Polkadot's answer is XCM (Cross-Consensus Messaging) — a language for expressing what you want to happen on another chain. But XCM isn't a simple "send tokens" API. It's a virtual machine with instructions like `WithdrawAsset`, `BuyExecution`, and `Transact`. Without understanding how XCM programs work, your cross-chain messages will fail silently, trap assets, or execute with unexpected results.

## Core Concepts

### What is XCM?

XCM is a messaging format — not a transport protocol. It describes *what* should happen, not *how* the message gets delivered. Think of it as a cross-chain instruction set:

- **XCMP (Cross-Chain Message Passing)**: Parachain ↔ Parachain (horizontal)
- **DMP (Downward Message Passing)**: Relay chain → Parachain
- **UMP (Upward Message Passing)**: Parachain → Relay chain

```
┌─────────────────────────────────────────────────────┐
│              XCM Message Flow                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Parachain A ──── XCMP ────→ Parachain B            │
│       │                           │                 │
│      UMP                         DMP                │
│       │                           │                 │
│       └──→ Relay Chain ───────────┘                 │
│                                                     │
│  XCM Instructions:                                  │
│  1. WithdrawAsset    - Take assets from origin      │
│  2. BuyExecution     - Pay for execution on dest    │
│  3. DepositAsset     - Place assets in dest account │
│  4. Transact         - Execute arbitrary call       │
│  5. TransferAsset    - Combined withdraw+deposit    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### MultiLocation: Addressing in XCM

Everything in XCM is addressed using `MultiLocation` — a relative path from the current chain:

```rust
// polkadot-sdk@1.7.0 (xcm@7.0.0)

use xcm::v4::prelude::*;

// The relay chain (one level up from a parachain)
let relay_chain = Location::parent();

// Parachain 2000 (sibling, from another parachain's perspective)
let sibling_para = Location::new(1, [Parachain(2000)]);

// An account on parachain 2000
let account_on_sibling = Location::new(
    1,
    [
        Parachain(2000),
        AccountId32 { network: None, id: [1u8; 32] },
    ],
);

// The native token of the relay chain (DOT)
let dot = Location::parent();

// A specific asset on parachain 2000 (e.g., their native token)
let foreign_token = Location::new(1, [Parachain(2000), PalletInstance(10)]);
```

### XCM Program: Cross-Chain Token Transfer

Here's a complete XCM program that transfers DOT from your parachain to an account on a sibling parachain:

```rust
// Example: Transfer 1 DOT from Parachain A to an account on Parachain B
// polkadot-sdk@1.7.0 (xcm@7.0.0, xcm-builder, xcm-executor)

use xcm::v4::prelude::*;
use frame_support::traits::Currency;

/// Build an XCM message to transfer DOT to a sibling parachain
fn build_reserve_transfer_message(
    dest_para_id: u32,
    beneficiary: [u8; 32],
    amount: u128,
) -> Xcm<()> {
    // 1 DOT = 10^10 planck
    let asset = Asset {
        id: AssetId(Location::parent()), // DOT lives on relay chain
        fun: Fungibility::Fungible(amount),
    };

    Xcm(vec![
        // Step 1: Withdraw DOT from the sender's sovereign account
        WithdrawAsset(asset.clone().into()),

        // Step 2: Pay for execution on the destination chain
        // Fee estimation: ~0.01 DOT for a simple transfer
        BuyExecution {
            fees: Asset {
                id: AssetId(Location::parent()),
                fun: Fungibility::Fungible(amount / 10), // 10% for fees (generous)
            },
            weight_limit: WeightLimit::Unlimited,
        },

        // Step 3: Deposit remaining assets into beneficiary account
        DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary: Location::new(
                0,
                [AccountId32 { network: None, id: beneficiary }],
            ),
        },
    ])
}

/// Execute the transfer from a pallet dispatchable
#[pallet::call]
impl<T: Config> Pallet<T> {
    #[pallet::call_index(0)]
    #[pallet::weight(Weight::from_parts(200_000_000, 0))]
    pub fn transfer_dot_to_sibling(
        origin: OriginFor<T>,
        dest_para_id: u32,
        beneficiary: [u8; 32],
        amount: u128,
    ) -> DispatchResult {
        let who = ensure_signed(origin)?;

        let destination = Location::new(1, [Parachain(dest_para_id)]);
        let message = build_reserve_transfer_message(dest_para_id, beneficiary, amount);

        // Send the XCM message via the router
        let ticket = T::XcmRouter::validate(&mut Some(destination), &mut Some(message))
            .map_err(|_| Error::<T>::XcmSendFailed)?;
        T::XcmRouter::deliver(ticket)
            .map_err(|_| Error::<T>::XcmDeliveryFailed)?;

        Self::deposit_event(Event::TransferSent { who, dest_para_id, amount });
        Ok(())
    }
}
```

### XCM Remote Calls with Transact

XCM can execute arbitrary calls on remote chains using the `Transact` instruction:

```rust
// Example: Execute a remote call on a sibling parachain
// This calls the `set_value` function on Parachain B's KvStore pallet
// polkadot-sdk@1.7.0 (xcm@7.0.0)

use xcm::v4::prelude::*;
use parity_scale_codec::Encode;

/// Build an XCM message that executes a remote call on another parachain
fn build_remote_call_message(
    encoded_call: Vec<u8>,
    fee_amount: u128,
) -> Xcm<()> {
    Xcm(vec![
        // Pay for execution on the remote chain
        WithdrawAsset(
            Asset {
                id: AssetId(Location::parent()),
                fun: Fungibility::Fungible(fee_amount),
            }
            .into(),
        ),
        BuyExecution {
            fees: Asset {
                id: AssetId(Location::parent()),
                fun: Fungibility::Fungible(fee_amount),
            },
            weight_limit: WeightLimit::Limited(Weight::from_parts(1_000_000_000, 65536)),
        },

        // Execute the encoded call on the destination chain
        Transact {
            origin_kind: OriginKind::SovereignAccount,
            require_weight_at_most: Weight::from_parts(500_000_000, 32768),
            call: encoded_call.into(),
        },

        // Refund any unused fees back to sender's sovereign account
        RefundSurplus,
        DepositAsset {
            assets: Wild(All),
            beneficiary: Location::new(1, [Parachain(1000)]), // Back to sender para
        },
    ])
}

/// Example: Call KvStore::set_value on Parachain B (id: 2001)
fn send_remote_set_value(
    dest_para_id: u32,
    key: Vec<u8>,
    value: Vec<u8>,
) -> Result<(), XcmError> {
    // Encode the call as it would appear on the destination chain
    // This must match the destination's pallet index and call index exactly
    let call = pallet_kv_store::Call::<DestRuntime>::set_value {
        key: key.try_into().map_err(|_| XcmError::FailedToTransactAsset)?,
        value: value.try_into().map_err(|_| XcmError::FailedToTransactAsset)?,
    };
    let encoded_call = call.encode();

    let destination = Location::new(1, [Parachain(dest_para_id)]);
    let message = build_remote_call_message(encoded_call, 100_000_000_000); // 0.01 DOT fee

    // Send via XCM router
    send_xcm::<T::XcmRouter>(destination, message)?;
    Ok(())
}
```

### Configuring XCM in Your Runtime

Your parachain needs XCM configuration to send and receive messages:

```rust
// runtime/src/xcm_config.rs
// polkadot-sdk@1.7.0

use xcm_builder::{
    AccountId32Aliases, AllowTopLevelPaidExecutionFrom, FixedWeightBounds,
    ParentIsPreset, RelayChainAsNative, SiblingParachainAsNative,
    SiblingParachainConvertsVia, SignedAccountId32AsNative,
    SovereignSignedViaLocation, TakeWeightCredit, UsingComponents,
};
use xcm_executor::XcmExecutor;

parameter_types! {
    pub const RelayLocation: Location = Location::parent();
    pub const RelayNetwork: Option<NetworkId> = Some(NetworkId::Polkadot);
    pub RelayChainOrigin: RuntimeOrigin = cumulus_pallet_xcm::Origin::Relay.into();
    pub UniversalLocation: InteriorLocation = [
        GlobalConsensus(RelayNetwork::get().unwrap()),
        Parachain(ParachainInfo::parachain_id().into()),
    ].into();
}

/// Who can execute XCM on this chain
pub type Barrier = (
    TakeWeightCredit,                    // Allow internal XCM execution
    AllowTopLevelPaidExecutionFrom<Everything>, // Allow paid execution from anywhere
);

/// How to convert XCM locations to local account IDs
pub type LocationToAccountId = (
    ParentIsPreset<AccountId>,           // Relay chain → known account
    SiblingParachainConvertsVia<polkadot_parachain_primitives::Sibling, AccountId>,
    AccountId32Aliases<RelayNetwork, AccountId>,
);

/// How to weigh XCM instructions
pub type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;

/// The XCM executor configuration
pub struct XcmConfig;
impl xcm_executor::Config for XcmConfig {
    type RuntimeCall = RuntimeCall;
    type XcmSender = XcmRouter;
    type AssetTransactor = LocalAssetTransactor;
    type OriginConverter = XcmOriginToTransactDispatchOrigin;
    type IsReserve = NativeAsset;  // Which assets we trust as reserves
    type IsTeleporter = ();        // No teleportation allowed
    type Barrier = Barrier;
    type Weigher = Weigher;
    type Trader = UsingComponents<WeightToFee, RelayLocation, AccountId, Balances, ()>;
    type ResponseHandler = PolkadotXcm;
    type AssetTrap = PolkadotXcm;
    type AssetLocker = ();
    type AssetExchanger = ();
    type SubscriptionService = PolkadotXcm;
    type PalletInstancesInfo = AllPalletsWithSystem;
    type MaxAssetsIntoHolding = MaxAssetsIntoHolding;
    type FeeManager = ();
    type MessageExporter = ();
    type UniversalAliases = Nothing;
    type CallDispatcher = RuntimeCall;
    type SafeCallFilter = Everything;
    type Aliasers = Nothing;
    type TransactionalProcessor = FrameTransactionalProcessor;
}
```

### Testing XCM Locally

Use `xcm-simulator` or `zombienet` to test cross-chain messages:

```shell
# Run a zombienet with two parachains for XCM testing
# zombienet@1.3.100
zombienet spawn xcm-test-network.toml
```

```shell
# Send a test XCM transfer using polkadot-js CLI
# @polkadot/api-cli@0.58.0
polkadot-js-api --ws ws://127.0.0.1:9988 tx.polkadotXcm.limitedReserveTransferAssets \
    '{"V4":{"parents":1,"interior":{"X1":[{"Parachain":2001}]}}}' \
    '{"V4":{"parents":0,"interior":{"X1":[{"AccountId32":{"id":"0x1234...","network":null}}]}}}' \
    '{"V4":[{"id":{"parents":1,"interior":"Here"},"fun":{"Fungible":10000000000}}]}' \
    0 \
    "Unlimited"
```

```
Expected output:
Transfer submitted in block 0xabcd...
Events:
  xcmpQueue.XcmpMessageSent { messageHash: 0x5678... }
```

## Common Pitfalls

1. **Forgetting `BuyExecution`** — Every XCM message that executes on a remote chain must pay for execution. Without `BuyExecution`, the message is rejected by the destination's `Barrier`. Always include fee payment as the second instruction.

2. **Wrong asset location for fees** — The fee asset must be something the destination chain recognizes. If you try to pay with your parachain's native token on a chain that doesn't know about it, execution fails. Use DOT (relay chain native) as a universal fee asset.

3. **Mismatched `Transact` call encoding** — When using `Transact` for remote calls, the encoded call must exactly match the destination chain's runtime. If the destination upgrades their runtime (changing pallet indices or call indices), your `Transact` messages break silently.

4. **Not handling trapped assets** — If an XCM program fails partway through (e.g., after `WithdrawAsset` but before `DepositAsset`), the assets are "trapped" in the destination's asset trap. You need to claim them back using `ClaimAsset`. Always test failure paths.

## What to Learn Next

- [Polkadot 2.0 and Coretime](./06-polkadot-2-coretime.md) — Understand the new economic model replacing parachain auctions
- [XCM Documentation](https://wiki.polkadot.network/docs/learn-xcm) — Official XCM specification and examples
- [XCM GitHub](https://github.com/paritytech/polkadot-sdk/tree/master/polkadot/xcm) — Source code for XCM format, builder, and executor
