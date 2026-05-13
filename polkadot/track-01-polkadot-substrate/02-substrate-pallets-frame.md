# Substrate Pallets and FRAME: Building Modular Blockchain Logic

**Track:** Polkadot & Substrate Development
**Lesson:** 2 of 6
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You want to build custom blockchain logic on Substrate, but the framework feels overwhelming. What's a pallet? How does FRAME work? What are all these macros doing? Unlike smart contract development where you write a single file and deploy it, Substrate requires you to understand a modular architecture where each piece of functionality is a separate "pallet" composed together into a runtime. Without grasping this model, you'll struggle to write even a basic storage item or callable function.

## Core Concepts

### What is a Pallet?

A pallet is a self-contained module of blockchain logic. Think of it like a plugin for your blockchain. Each pallet defines:

- **Storage**: On-chain state (maps, values, vectors)
- **Dispatchable calls**: Functions users can invoke via transactions
- **Events**: Notifications emitted when state changes
- **Errors**: Typed error conditions
- **Config trait**: Dependencies and configurable parameters

Substrate ships with 50+ pre-built pallets (balances, staking, governance, identity, etc.), and you compose them together with your custom pallets to form a complete runtime.

### FRAME: The Framework for Runtime Aggregation

FRAME (Framework for Runtime Aggregation of Modularized Entities) provides the macro system that makes pallet development ergonomic. The key macros:

| Macro | Purpose |
|-------|---------|
| `#[frame_support::pallet]` | Declares a pallet module |
| `#[pallet::config]` | Defines the pallet's configuration trait |
| `#[pallet::storage]` | Declares on-chain storage items |
| `#[pallet::call]` | Defines dispatchable (callable) functions |
| `#[pallet::event]` | Defines events the pallet can emit |
| `#[pallet::error]` | Defines error types |
| `#[pallet::hooks]` | Lifecycle hooks (on_initialize, on_finalize) |

### Writing Your First Pallet

Here's a complete pallet that implements a simple key-value store where users can set and get values:

```rust
// pallets/kv-store/src/lib.rs
// polkadot-sdk@1.7.0 (frame-support, frame-system, sp-runtime)

#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;

    /// Configuration trait — defines what this pallet needs from the runtime
    #[pallet::config]
    pub trait Config: frame_system::Config {
        /// The overarching event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Maximum length of a stored value
        #[pallet::constant]
        type MaxValueLength: Get<u32>;
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Storage: maps account -> key -> value
    /// Each user can store multiple key-value pairs
    #[pallet::storage]
    #[pallet::getter(fn stored_values)]
    pub type StoredValues<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        T::AccountId,        // First key: who stored it
        Blake2_128Concat,
        BoundedVec<u8, ConstU32<64>>,  // Second key: the key name
        BoundedVec<u8, T::MaxValueLength>,  // Value
        OptionQuery,
    >;

    /// Events emitted by this pallet
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// A value was stored. [who, key, value_length]
        ValueStored {
            who: T::AccountId,
            key: BoundedVec<u8, ConstU32<64>>,
            value_length: u32,
        },
        /// A value was removed. [who, key]
        ValueRemoved {
            who: T::AccountId,
            key: BoundedVec<u8, ConstU32<64>>,
        },
    }

    /// Errors that can occur in this pallet
    #[pallet::error]
    pub enum Error<T> {
        /// The key exceeds the maximum allowed length
        KeyTooLong,
        /// The value exceeds the maximum allowed length
        ValueTooLong,
        /// The key was not found in storage
        KeyNotFound,
    }

    /// Dispatchable calls — functions users can invoke via extrinsics
    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Store a value under a key for the calling account.
        /// Weight is proportional to value length.
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().writes(1) + Weight::from_parts(1_000 * value.len() as u64, 0))]
        pub fn set_value(
            origin: OriginFor<T>,
            key: BoundedVec<u8, ConstU32<64>>,
            value: BoundedVec<u8, T::MaxValueLength>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            let value_length = value.len() as u32;

            // Insert into double map: account -> key -> value
            StoredValues::<T>::insert(&who, &key, &value);

            // Emit event
            Self::deposit_event(Event::ValueStored {
                who,
                key,
                value_length,
            });

            Ok(())
        }

        /// Remove a value stored under a key.
        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().writes(1))]
        pub fn remove_value(
            origin: OriginFor<T>,
            key: BoundedVec<u8, ConstU32<64>>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Ensure the key exists before removing
            ensure!(
                StoredValues::<T>::contains_key(&who, &key),
                Error::<T>::KeyNotFound
            );

            StoredValues::<T>::remove(&who, &key);

            Self::deposit_event(Event::ValueRemoved { who, key });

            Ok(())
        }
    }
}
```

### Storage Types

Substrate provides several storage primitives:

```rust
// polkadot-sdk@1.7.0

use frame_support::pallet_prelude::*;

// Single value — one value for the entire chain
#[pallet::storage]
pub type TotalIssuance<T> = StorageValue<_, u128, ValueQuery>;

// Simple map — one key to one value
#[pallet::storage]
pub type Balances<T: Config> = StorageMap<
    _,
    Blake2_128Concat,  // Hasher (transparent, safe against prefix attacks)
    T::AccountId,      // Key
    u128,              // Value
    ValueQuery,        // Default to 0 if not found
>;

// Double map — two keys to one value (efficient prefix iteration)
#[pallet::storage]
pub type Approvals<T: Config> = StorageDoubleMap<
    _,
    Blake2_128Concat, T::AccountId,  // Owner
    Blake2_128Concat, T::AccountId,  // Spender
    u128,                             // Allowance
    ValueQuery,
>;

// Counted map — like StorageMap but tracks the count of entries
#[pallet::storage]
pub type Validators<T: Config> = CountedStorageMap<
    _,
    Blake2_128Concat,
    T::AccountId,
    ValidatorInfo,
    OptionQuery,
>;
```

### Testing Your Pallet

Substrate pallets are tested using a mock runtime:

```rust
// pallets/kv-store/src/tests.rs
// polkadot-sdk@1.7.0

use crate::{mock::*, Error, Event, StoredValues};
use frame_support::{assert_noop, assert_ok, BoundedVec};

#[test]
fn set_value_works() {
    new_test_ext().execute_with(|| {
        let key: BoundedVec<u8, ConstU32<64>> =
            b"my_key".to_vec().try_into().unwrap();
        let value: BoundedVec<u8, ConstU32<256>> =
            b"hello world".to_vec().try_into().unwrap();

        // Dispatch the set_value call from account 1
        assert_ok!(KvStore::set_value(
            RuntimeOrigin::signed(1),
            key.clone(),
            value.clone()
        ));

        // Verify storage was updated
        assert_eq!(StoredValues::<Test>::get(1, &key), Some(value.clone()));

        // Verify event was emitted
        System::assert_last_event(
            Event::ValueStored {
                who: 1,
                key,
                value_length: 11,
            }
            .into(),
        );
    });
}

#[test]
fn remove_nonexistent_key_fails() {
    new_test_ext().execute_with(|| {
        let key: BoundedVec<u8, ConstU32<64>> =
            b"missing".to_vec().try_into().unwrap();

        assert_noop!(
            KvStore::remove_value(RuntimeOrigin::signed(1), key),
            Error::<Test>::KeyNotFound
        );
    });
}
```

## Deployment

```shell
# Install Substrate development prerequisites (Ubuntu/Debian)
# Rust toolchain with nightly and wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup update nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
```

```
Expected output:
info: installing component 'rust-std' for 'wasm32-unknown-unknown'
```

```shell
# Create a new pallet using the Substrate template
# pop-cli@0.3.0 (Polkadot SDK tooling)
cargo install pop-cli@0.3.0
pop new pallet my-pallet
```

```
Expected output:
✅ Pallet created successfully at ./my-pallet
```

## Common Pitfalls

1. **Forgetting `#[pallet::call_index(N)]`** — Every dispatchable must have a unique call index. Without it, adding or reordering functions breaks transaction encoding for existing users. Always assign explicit indices.

2. **Using unbounded types in storage** — Never use `Vec<u8>` or `String` directly in storage. Always use `BoundedVec<u8, MaxLength>` to prevent state bloat attacks. The compiler won't stop you, but your chain will be vulnerable.

3. **Ignoring weight (fees)** — Every dispatchable needs accurate weight annotations. Underestimating weight means your chain can be DoS'd. Use benchmarking (`frame_benchmarking`) for production pallets instead of hardcoded values.

4. **Not testing with `assert_noop!`** — When testing error paths, use `assert_noop!` instead of `assert_err!`. `assert_noop!` verifies that storage was NOT modified when the call fails — catching bugs where partial state changes leak through on error.

## What to Learn Next

- [Runtime Configuration](./03-runtime-configuration.md) — Learn how to compose pallets into a complete blockchain runtime
- [Substrate Docs: FRAME Pallets](https://docs.substrate.io/reference/frame-pallets/) — Official reference for all built-in pallets
- [Polkadot SDK GitHub](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame) — Source code for all FRAME pallets
