# Move Language Fundamentals

**Track:** Aptos Development
**Level:** Beginner → Intermediate
**Read time:** 15 min

---

## The Problem

You're ready to write Move code but the language feels alien. Move isn't Solidity, Rust, or any language you've used before. It has unique concepts like abilities, resources, and a module system that enforces ownership at the type level. Without understanding these fundamentals, you'll fight the compiler on every line. This lesson teaches you Move's core syntax and type system so you can write idiomatic Aptos modules.

---

## Core Concepts

### Module Structure

Every Move program is organized into modules. A module is deployed at a specific address and contains struct definitions, functions, and constants:

```move
/// A simple counter module demonstrating basic Move structure.
/// Deployed at the address specified in Move.toml
module my_addr::counter {
    use std::signer;

    /// Error codes (convention: use constants for abort codes)
    const E_NOT_INITIALIZED: u64 = 1;
    const E_OVERFLOW: u64 = 2;

    /// A counter resource stored in a user's account
    struct Counter has key {
        value: u64,
    }

    /// Initialize a counter for the calling account
    public entry fun initialize(account: &signer) {
        let addr = signer::address_of(account);
        assert!(!exists<Counter>(addr), E_NOT_INITIALIZED);
        move_to(account, Counter { value: 0 });
    }

    /// Increment the counter
    public entry fun increment(account: &signer) acquires Counter {
        let addr = signer::address_of(account);
        let counter = borrow_global_mut<Counter>(addr);
        counter.value = counter.value + 1;
    }

    /// Read the counter value (view function)
    #[view]
    public fun get_count(addr: address): u64 acquires Counter {
        borrow_global<Counter>(addr).value
    }
}
```

Key observations:
- `module address::name` — modules are namespaced by address
- `use` imports from other modules (like Rust)
- `public entry fun` — callable directly via transactions
- `#[view]` — read-only function callable without a transaction
- `acquires` — must declare which resources a function accesses

### Primitive Types

```move
module my_addr::types_demo {
    fun primitives() {
        // Integers (unsigned only)
        let a: u8 = 255;
        let b: u16 = 65535;
        let c: u32 = 4294967295;
        let d: u64 = 18446744073709551615;
        let e: u128 = 340282366920938463463374607431768211455;
        let f: u256 = 0; // 256-bit unsigned integer

        // Boolean
        let flag: bool = true;

        // Address (32 bytes)
        let addr: address = @0x1;

        // Vectors (dynamic arrays)
        let v: vector<u8> = vector[1, 2, 3];
        let empty: vector<u64> = vector::empty<u64>();

        // Strings (stored as vector<u8>)
        let s: vector<u8> = b"hello";

        // No floating point types — use fixed-point math libraries
    }
}
```

### Abilities: The Type System's Core

Every struct in Move has zero or more abilities that control what you can do with it:

| Ability | Meaning | Example Use |
|---------|---------|-------------|
| `copy` | Value can be duplicated | Primitive wrappers, config structs |
| `drop` | Value can be discarded | Temporary computation results |
| `store` | Value can be stored inside other structs | Nested data, collection elements |
| `key` | Value can be stored at top-level in global storage | Account resources |

```move
module my_addr::abilities_demo {
    /// Has all abilities — behaves like a normal value
    struct Config has copy, drop, store, key {
        max_supply: u64,
    }

    /// Has key + store — a resource that lives in accounts
    /// Cannot be copied or dropped (prevents duplication/loss)
    struct Vault has key, store {
        balance: u64,
    }

    /// Has store only — can be nested inside other resources
    /// but cannot exist at top-level in an account
    struct TokenInfo has store {
        name: vector<u8>,
        decimals: u8,
    }

    /// Has drop + copy — ephemeral value for computation
    struct Receipt has copy, drop {
        amount: u64,
        timestamp: u64,
    }

    /// No abilities — a "hot potato" that MUST be consumed
    /// Cannot be copied, dropped, stored, or placed in global storage
    struct FlashLoanReceipt {
        amount: u64,
        fee: u64,
    }
}
```

The "hot potato" pattern (no abilities) is powerful for enforcing protocols:

```move
module my_addr::flash_loan {
    struct FlashLoanReceipt {
        pool_addr: address,
        amount: u64,
        fee: u64,
    }

    /// Borrow returns a receipt that MUST be passed to repay()
    /// If the caller doesn't call repay(), the transaction aborts
    /// because the receipt cannot be dropped or stored
    public fun borrow(pool: address, amount: u64): (u64, FlashLoanReceipt) {
        // ... withdraw from pool ...
        let receipt = FlashLoanReceipt { pool_addr: pool, amount, fee: amount / 100 };
        (amount, receipt)
    }

    /// Repay consumes the receipt (moves it into this function)
    public fun repay(receipt: FlashLoanReceipt, repayment: u64) {
        let FlashLoanReceipt { pool_addr: _, amount, fee } = receipt;
        assert!(repayment >= amount + fee, 1);
        // ... deposit back to pool ...
    }
}
```

### Global Storage Operations

Move has five built-in operations for global storage:

```move
module my_addr::storage_ops {
    use std::signer;

    struct MyResource has key {
        data: u64,
    }

    /// move_to: Store a resource in an account (requires &signer)
    public fun create(account: &signer) {
        move_to(account, MyResource { data: 42 });
    }

    /// move_from: Remove a resource from an account (returns ownership)
    public fun destroy(account: &signer): u64 acquires MyResource {
        let addr = signer::address_of(account);
        let MyResource { data } = move_from<MyResource>(addr);
        data
    }

    /// borrow_global: Immutable reference to a resource
    public fun read(addr: address): u64 acquires MyResource {
        let ref = borrow_global<MyResource>(addr);
        ref.data
    }

    /// borrow_global_mut: Mutable reference to a resource
    public fun update(account: &signer, new_data: u64) acquires MyResource {
        let addr = signer::address_of(account);
        let ref = borrow_global_mut<MyResource>(addr);
        ref.data = new_data;
    }

    /// exists: Check if a resource exists at an address
    public fun has_resource(addr: address): bool {
        exists<MyResource>(addr)
    }
}
```

### References and Borrowing

Move uses a borrow checker similar to Rust:

```move
module my_addr::references {
    struct Wallet has key {
        coins: u64,
    }

    fun demo(account: &signer) acquires Wallet {
        let addr = std::signer::address_of(account);

        // Immutable reference — can read but not modify
        let wallet_ref: &Wallet = borrow_global<Wallet>(addr);
        let balance = wallet_ref.coins; // OK: reading

        // Mutable reference — can read and modify
        let wallet_mut: &mut Wallet = borrow_global_mut<Wallet>(addr);
        wallet_mut.coins = wallet_mut.coins + 100; // OK: writing

        // Cannot have both &mut and & to the same resource simultaneously
        // This is enforced at compile time (like Rust's borrow checker)
    }
}
```

### Control Flow

```move
module my_addr::control_flow {
    fun examples(x: u64): u64 {
        // If-else (is an expression — returns a value)
        let result = if (x > 10) {
            x * 2
        } else if (x > 5) {
            x + 10
        } else {
            0
        };

        // While loop
        let i = 0;
        while (i < 10) {
            i = i + 1;
        };

        // Loop with break
        let j = 0;
        loop {
            if (j >= 100) break;
            j = j + 1;
        };

        // Abort (like revert in Solidity)
        if (result == 0) {
            abort 42 // Abort with error code 42
        };

        // Assert (abort with code if condition is false)
        assert!(result > 0, 99);

        result
    }
}
```

### Unit Testing

Move has built-in test support:

```move
module my_addr::counter {
    struct Counter has key { value: u64 }

    public entry fun initialize(account: &signer) {
        move_to(account, Counter { value: 0 });
    }

    public entry fun increment(account: &signer) acquires Counter {
        let counter = borrow_global_mut<Counter>(std::signer::address_of(account));
        counter.value = counter.value + 1;
    }

    #[view]
    public fun get_count(addr: address): u64 acquires Counter {
        borrow_global<Counter>(addr).value
    }

    // ===== Tests =====

    #[test(account = @0x42)]
    fun test_initialize(account: &signer) acquires Counter {
        initialize(account);
        assert!(get_count(@0x42) == 0, 1);
    }

    #[test(account = @0x42)]
    fun test_increment(account: &signer) acquires Counter {
        initialize(account);
        increment(account);
        increment(account);
        assert!(get_count(@0x42) == 2, 1);
    }

    #[test(account = @0x42)]
    #[expected_failure(abort_code = 1)]
    fun test_double_initialize(account: &signer) {
        initialize(account);
        initialize(account); // Should abort
    }
}
```

```shell
# Run tests
aptos move test --named-addresses my_addr=0x42
```

```
Expected output:
Running Move unit tests
[ PASS ] 0x42::counter::test_initialize
[ PASS ] 0x42::counter::test_increment
[ PASS ] 0x42::counter::test_double_initialize
Test result: OK. Total tests: 3; passed: 3; failed: 0
```

---

## Common Pitfalls

1. **Forgetting the `acquires` annotation** — Any function that calls `borrow_global`, `borrow_global_mut`, or `move_from` must declare `acquires ResourceType` in its signature. The compiler enforces this transitively — if function A calls function B which acquires a resource, A must also declare it. Missing this causes a compile error.

2. **Trying to copy a resource** — Structs without the `copy` ability cannot be duplicated. Writing `let x = resource; let y = resource;` moves the resource on the first assignment, making the second invalid. Use references (`&` or `&mut`) when you need to read without consuming.

3. **Misunderstanding `key` vs `store`** — A struct with only `store` can be nested inside other resources but cannot be placed directly in global storage. You need `key` for top-level account storage. A common pattern is a `key` wrapper around `store` inner types.

4. **Not handling the `signer` requirement** — `move_to` requires a `&signer` reference, meaning only the account owner can store resources in their own account. You cannot store a resource in someone else's account without their signature. This is a security feature, not a bug.

5. **Using `abort` without meaningful error codes** — Move uses numeric error codes (u64) for aborts. Define constants like `const E_NOT_FOUND: u64 = 1;` at the top of your module. Without named constants, debugging failed transactions becomes guesswork.

---

## What to Learn Next

- [First Move Module](./04-first-move-module.md) — Write and deploy a complete Move module to Aptos testnet
- [Move Language Reference](https://aptos.dev/en/build/smart-contracts/book) — Official Move book
- [Aptos Move Examples](https://github.com/aptos-labs/aptos-core/tree/main/aptos-move/move-examples) — Official example modules

