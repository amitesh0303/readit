# Sui Move Fundamentals

**Track:** Sui Development
**Level:** Beginner → Intermediate
**Read time:** 15 min

---

## The Problem

You know Solidity or another smart contract language, but Sui uses Move — a language originally designed for the Diem blockchain. Worse, Sui Move is a fork that diverges significantly from Aptos Move. The object model, ownership semantics, and standard library are all different. You need to understand Sui Move's unique concepts — objects with UIDs, abilities, ownership transfer, and the `TxContext` — before you can write anything meaningful. Porting mental models from Solidity or even Aptos Move will lead to broken code.

## Core Concepts

### Sui Move vs Aptos Move

Both derive from the original Diem Move, but they've diverged significantly:

| Feature | Sui Move | Aptos Move |
|---------|----------|------------|
| State model | Object-centric (UID per object) | Global storage (move_to/move_from) |
| Object creation | `object::new(ctx)` | `move_to(signer, resource)` |
| Transfer | `transfer::transfer(obj, recipient)` | `move_to` / account resources |
| Shared state | `transfer::share_object(obj)` | Global resources |
| Entry functions | `entry fun` or `public fun` | `entry fun` with `signer` |
| Standard library | `sui::*` modules | `aptos_framework::*` |
| Package publishing | Immutable on-chain objects | Upgradeable modules |

**Key difference**: In Aptos Move, resources live "inside" accounts via global storage operators (`move_to`, `borrow_global`). In Sui Move, objects are independent entities with unique IDs that exist outside any account — they're transferred between addresses explicitly.

### Abilities: The Type System Foundation

Move uses four abilities to control what you can do with a type:

```move
module examples::abilities {
    use sui::object::UID;

    /// `key` — Can be stored as a top-level object (has a UID field)
    /// `store` — Can be stored inside other objects
    /// `copy` — Can be duplicated (value types like u64 have this)
    /// `drop` — Can be discarded without explicit destruction

    // A Sui object MUST have `key` and a `id: UID` field
    struct MyObject has key, store {
        id: UID,
        value: u64,
    }

    // A struct with `store` but no `key` — can live inside objects
    // but cannot be a standalone on-chain object
    struct Metadata has store, copy, drop {
        name: vector<u8>,
        version: u64,
    }

    // A struct with only `drop` — temporary computation value
    struct Receipt has drop {
        amount: u64,
    }

    // A struct with NO abilities — must be explicitly unpacked/destroyed
    // This is the "hot potato" pattern for enforcing function call sequences
    struct FlashLoanReceipt {
        amount: u64,
        fee: u64,
    }
}
```

### Objects and UID

Every Sui object must have the `key` ability and a `id: UID` field as its first field:

```move
module examples::basic_object {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::transfer;

    struct Sword has key, store {
        id: UID,
        damage: u64,
        durability: u64,
    }

    /// Create a new Sword and transfer it to the caller.
    /// `entry` means this can be called directly in a transaction.
    public entry fun forge_sword(
        damage: u64,
        durability: u64,
        ctx: &mut TxContext,
    ) {
        let sword = Sword {
            id: object::new(ctx),  // Generate a globally unique ID
            damage,
            durability,
        };
        // Transfer ownership to the transaction sender
        transfer::transfer(sword, tx_context::sender(ctx));
    }

    /// Transfer a sword to another address.
    /// Only the current owner can call this (enforced by Sui runtime).
    public entry fun transfer_sword(
        sword: Sword,
        recipient: address,
    ) {
        transfer::transfer(sword, recipient);
    }

    /// Destroy a sword and reclaim storage rebate.
    public entry fun destroy_sword(sword: Sword) {
        let Sword { id, damage: _, durability: _ } = sword;
        object::delete(id);
    }
}
```

### Ownership and Transfer

Sui has three transfer modes that determine object accessibility:

```move
module examples::transfer_modes {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    struct Item has key, store {
        id: UID,
        data: u64,
    }

    /// 1. OWNED: Only the owner address can use this object.
    /// Transactions on owned objects use the fast path (no consensus).
    public entry fun create_owned(ctx: &mut TxContext) {
        let item = Item { id: object::new(ctx), data: 42 };
        transfer::transfer(item, tx_context::sender(ctx));
    }

    /// 2. SHARED: Anyone can read and mutate this object.
    /// Transactions on shared objects require consensus ordering.
    public entry fun create_shared(ctx: &mut TxContext) {
        let item = Item { id: object::new(ctx), data: 0 };
        transfer::share_object(item);
    }

    /// 3. IMMUTABLE: Frozen forever. Anyone can read, no one can write.
    /// Zero coordination cost — ideal for configs and metadata.
    public entry fun create_immutable(ctx: &mut TxContext) {
        let item = Item { id: object::new(ctx), data: 999 };
        transfer::freeze_object(item);
    }

    /// Mutating a shared object — requires `&mut` reference.
    /// Sui runtime ensures only one transaction mutates at a time.
    public entry fun increment_shared(item: &mut Item) {
        item.data = item.data + 1;
    }
}
```

### Entry Functions and TxContext

Entry functions are the public API of your module — they can be called directly in transactions:

```move
module examples::entry_functions {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::Coin;
    use sui::sui::SUI;

    struct Profile has key {
        id: UID,
        name: vector<u8>,
        score: u64,
    }

    /// `entry` functions can be called directly from transactions.
    /// `ctx` provides: sender address, fresh UIDs, epoch number.
    public entry fun create_profile(
        name: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let profile = Profile {
            id: object::new(ctx),
            name,
            score: 0,
        };
        transfer::transfer(profile, tx_context::sender(ctx));
    }

    /// Accept a payment (Coin object) and update score.
    /// The Coin is an owned object that the caller must pass in.
    public entry fun boost_score(
        profile: &mut Profile,
        payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        profile.score = profile.score + amount;
        // Transfer payment to module deployer or burn it
        transfer::public_transfer(payment, tx_context::sender(ctx));
    }
}
```

### Generics and Type Safety

Move's generics provide compile-time type safety for assets:

```move
module examples::generic_vault {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::transfer;
    use sui::coin::Coin;

    /// A vault that holds any coin type — type parameter T ensures
    /// you can't accidentally mix USDC and SUI in the same vault.
    struct Vault<phantom T> has key {
        id: UID,
        balance: u64,
    }

    /// `phantom` means T is only used for type-checking,
    /// not stored in the struct's runtime representation.
    public fun create_vault<T>(ctx: &mut TxContext): Vault<T> {
        Vault<T> {
            id: object::new(ctx),
            balance: 0,
        }
    }
}
```

## Common Pitfalls

1. **Forgetting the `id: UID` field** — Every struct with the `key` ability must have `id: UID` as its first field. The compiler will reject your code otherwise. This is how Sui tracks objects on-chain.

2. **Using `transfer::transfer` for objects with only `key`** — If your struct has `key` but not `store`, you must use `transfer::transfer` (module-internal). For objects with both `key` and `store`, use `transfer::public_transfer` to allow transfers from outside the defining module.

3. **Treating shared objects like owned objects** — You can't transfer a shared object to an address. Once shared, always shared. Design your object ownership model upfront — changing it later requires creating new objects.

4. **Not destroying objects properly** — Objects without `drop` ability must be explicitly destructured. If your function creates a temporary object and doesn't return, transfer, or destroy it, the compiler will error with "unused value without drop."

5. **Assuming global storage exists** — There's no `borrow_global<T>(address)` in Sui Move. You can't look up arbitrary objects by address. Objects must be passed as function arguments — the runtime resolves them by ID.

## What to Learn Next

- [First Sui Module](./04-first-sui-module.md) — Write and publish a complete Sui Move package to testnet
- [Sui Move Book](https://move-book.com/) — Comprehensive Move language reference
- [Sui Framework Source](https://github.com/MystenLabs/sui/tree/main/crates/sui-framework) — Standard library implementation
