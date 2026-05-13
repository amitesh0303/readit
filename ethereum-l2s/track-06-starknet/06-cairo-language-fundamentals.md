# Cairo Language Fundamentals: Syntax, Types, and Ownership

**Track:** Starknet Development
**Level:** Intermediate → Advanced
**Read time:** 16 min

---

## The Problem

You want to write smart contracts for Starknet, but Cairo isn't Solidity. It's a Rust-inspired language with ownership semantics, no garbage collection, and a type system designed around provability. You can't just translate Solidity patterns line-by-line — Cairo has different primitives (`felt252` vs `uint256`), different control flow (no traditional loops without bounds), and a component-based contract architecture. This lesson covers the language fundamentals you need before writing your first real contract.

## Core Concepts

### Basic Types and Variables

```cairo
// Cairo basic types and variable declarations
fn basic_types() {
    // felt252 — the native field element (0 to P-1, where P ≈ 2^251)
    let a: felt252 = 42;
    let b: felt252 = 0x2a; // Hex literal

    // Unsigned integers — checked arithmetic (panic on overflow)
    let x: u8 = 255;
    let y: u16 = 65535;
    let z: u32 = 4294967295;
    let w: u64 = 18446744073709551615;
    let v: u128 = 340282366920938463463374607431768211455;
    let big: u256 = 1000000000000000000_u256; // 1e18

    // Boolean
    let flag: bool = true;

    // ByteArray (dynamic string)
    let name: ByteArray = "Starknet Token";

    // ContractAddress (special type for addresses)
    let addr: starknet::ContractAddress = starknet::contract_address_const::<0x1234>();

    // Tuples
    let pair: (u32, bool) = (100, true);
    let (value, active) = pair; // Destructuring
}
```

### Ownership and the `Drop` / `Copy` Traits

Cairo uses an ownership model similar to Rust. Values are moved by default:

```cairo
// Ownership — values are MOVED, not copied (unless type implements Copy)
#[derive(Drop)]
struct Token {
    name: ByteArray,
    supply: u256,
}

fn ownership_demo() {
    let token = Token { name: "MyToken", supply: 1000_u256 };

    // This MOVES token into the function — token is no longer usable here
    consume_token(token);

    // ERROR: token was moved
    // let name = token.name; // ← Compile error!
}

fn consume_token(token: Token) {
    // token is owned here and dropped at end of scope
    println!("Token: {}", token.name);
}

// Types that implement Copy can be duplicated (like integers)
fn copy_demo() {
    let x: u32 = 42;
    let y = x;     // x is COPIED, not moved
    let z = x + y; // x is still valid — z = 84
}

// For custom types, derive Copy if all fields are Copy
#[derive(Drop, Copy)]
struct Point {
    x: u32,
    y: u32,
}
```

### References and Snapshots

```cairo
// Snapshots (@) — immutable view of a value (like & in Rust)
fn read_balance(token: @Token) -> u256 {
    // Can read but not modify
    *token.supply // Desnap with * to get the value
}

// Mutable references (ref) — allows modification
fn increase_supply(ref token: Token, amount: u256) {
    token.supply = token.supply + amount;
}

fn reference_demo() {
    let mut token = Token { name: "MyToken", supply: 1000_u256 };

    // Pass snapshot (read-only)
    let balance = read_balance(@token);

    // Pass mutable reference
    increase_supply(ref token, 500_u256);
    // token.supply is now 1500
}
```

### Enums and Pattern Matching

```cairo
// Enums — algebraic data types (like Rust enums)
#[derive(Drop, Copy)]
enum OrderStatus {
    Pending,
    Filled: u256,      // Variant with data
    Cancelled: felt252, // Reason code
}

fn process_order(status: OrderStatus) -> ByteArray {
    // Pattern matching — must be exhaustive
    match status {
        OrderStatus::Pending => "Waiting for fill",
        OrderStatus::Filled(amount) => {
            // amount is available here
            "Order filled"
        },
        OrderStatus::Cancelled(_reason) => "Order was cancelled",
    }
}

// Option<T> — Cairo's null safety (no null/nil/None pointer)
fn safe_divide(a: u256, b: u256) -> Option<u256> {
    if b == 0 {
        Option::None
    } else {
        Option::Some(a / b)
    }
}

fn use_option() {
    let result = safe_divide(100_u256, 0_u256);
    match result {
        Option::Some(value) => println!("Result: {}", value),
        Option::None => println!("Division by zero!"),
    }
}
```

### Arrays and Dictionaries

```cairo
use core::array::ArrayTrait;
use core::dict::Felt252DictTrait;

fn collections_demo() {
    // Array — append-only, no random access modification
    let mut arr: Array<u32> = ArrayTrait::new();
    arr.append(10);
    arr.append(20);
    arr.append(30);

    let length = arr.len();        // 3
    let first = *arr.at(0);        // 10 (panics if out of bounds)
    let maybe = arr.get(5);        // Option::None (safe access)

    // Pop from front (consumes element)
    let front = arr.pop_front();   // Option::Some(10)

    // Span — immutable view of an array (like a slice)
    let span: Span<u32> = arr.span();

    // Felt252Dict — mutable key-value store (keys are felt252)
    let mut balances: Felt252Dict<u128> = Default::default();
    balances.insert(1, 1000);      // key=1, value=1000
    balances.insert(2, 2000);

    let bal = balances.get(1);     // 1000
}
```

### Traits and Implementations

```cairo
// Traits define shared behavior (like interfaces)
trait IVault<T> {
    fn deposit(ref self: T, amount: u256);
    fn withdraw(ref self: T, amount: u256) -> u256;
    fn get_balance(self: @T) -> u256;
}

#[derive(Drop)]
struct SimpleVault {
    balance: u256,
    owner: starknet::ContractAddress,
}

// Implement the trait for a specific type
impl SimpleVaultImpl of IVault<SimpleVault> {
    fn deposit(ref self: SimpleVault, amount: u256) {
        self.balance = self.balance + amount;
    }

    fn withdraw(ref self: SimpleVault, amount: u256) -> u256 {
        assert(amount <= self.balance, 'Insufficient balance');
        self.balance = self.balance - amount;
        amount
    }

    fn get_balance(self: @SimpleVault) -> u256 {
        *self.balance
    }
}
```

### Contract Structure and Components

```cairo
// Starknet contract structure
// Contracts use #[starknet::contract] attribute

#[starknet::interface]
trait ICounter<TState> {
    fn get_count(self: @TState) -> u256;
    fn increment(ref self: TState);
    fn increment_by(ref self: TState, amount: u256);
}

#[starknet::contract]
mod Counter {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        count: u256,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CountIncremented: CountIncremented,
    }

    #[derive(Drop, starknet::Event)]
    struct CountIncremented {
        #[key]
        by: ContractAddress,
        new_value: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.count.write(0);
    }

    #[abi(embed_v0)]
    impl CounterImpl of super::ICounter<ContractState> {
        fn get_count(self: @ContractState) -> u256 {
            self.count.read()
        }

        fn increment(ref self: ContractState) {
            let current = self.count.read();
            self.count.write(current + 1);
            self.emit(CountIncremented {
                by: get_caller_address(),
                new_value: current + 1,
            });
        }

        fn increment_by(ref self: ContractState, amount: u256) {
            assert(amount > 0, 'Amount must be > 0');
            let current = self.count.read();
            self.count.write(current + amount);
            self.emit(CountIncremented {
                by: get_caller_address(),
                new_value: current + amount,
            });
        }
    }
}
```

### Error Handling

```cairo
// Cairo uses assert and panic for error handling
// No try/catch — failed assertions revert the transaction

#[starknet::contract]
mod SafeTransfer {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::Map;

    #[storage]
    struct Storage {
        balances: Map::<ContractAddress, u256>,
    }

    #[external(v0)]
    fn transfer(ref self: ContractState, to: ContractAddress, amount: u256) {
        let caller = get_caller_address();

        // Short-string error messages (must fit in felt252 — max 31 chars)
        assert(amount > 0, 'Amount must be positive');

        let sender_balance = self.balances.read(caller);
        assert(sender_balance >= amount, 'Insufficient balance');

        // Check for zero address
        let zero_addr: ContractAddress = 0.try_into().unwrap();
        assert(to != zero_addr, 'Cannot send to zero addr');

        // Execute transfer
        self.balances.write(caller, sender_balance - amount);
        self.balances.write(to, self.balances.read(to) + amount);
    }
}

// Using Result<T, E> for recoverable errors in library code
#[derive(Drop)]
enum MathError {
    DivisionByZero,
    Overflow,
}

fn safe_div(a: u256, b: u256) -> Result<u256, MathError> {
    if b == 0 {
        Result::Err(MathError::DivisionByZero)
    } else {
        Result::Ok(a / b)
    }
}
```

### Compilation Workflow

```shell
# Full compilation pipeline:
# 1. Write Cairo code (.cairo files)
# 2. Scarb compiles to Sierra (safe intermediate representation)
# 3. Sierra compiles to CASM (Cairo Assembly)
# 4. CASM executes on Cairo VM and generates provable traces

# Build command
scarb build

# Run tests
snforge test

# Format code
scarb fmt

# Check without building
scarb check
```

```
Expected output (scarb build):
   Compiling my_contract v0.1.0 (/path/to/project/Scarb.toml)
    Finished `dev` profile target(s) in 2 secs

Expected output (snforge test):
Collected 5 test(s) from my_contract package
Running 5 test(s) from src/
[PASS] my_contract::tests::test_constructor (gas: ~280)
[PASS] my_contract::tests::test_increment (gas: ~450)
[PASS] my_contract::tests::test_increment_by (gas: ~460)
[PASS] my_contract::tests::test_get_count (gas: ~180)
[PASS] my_contract::tests::test_unauthorized (gas: ~320)
Tests: 5 passed, 0 failed, 0 skipped
```

## Common Pitfalls

1. **Using felt252 for arithmetic without understanding modular behavior** — `felt252` wraps around the prime field without panicking. `P - 1 + 2 = 1` (not overflow error). Always use `u256`, `u128`, or `u64` for financial calculations where overflow should panic.

2. **Forgetting `Drop` trait on custom types** — Every value in Cairo must be explicitly handled. If a type doesn't implement `Drop`, you must consume it (pass to a function, destructure, etc.). Forgetting `#[derive(Drop)]` causes "variable not dropped" compile errors.

3. **String length limits in assert messages** — Assert messages are `felt252` short strings, limited to 31 ASCII characters. Longer messages cause compile errors. Keep error messages concise: `'Insufficient balance'` not `'The user does not have enough balance to complete this transfer'`.

4. **Mutating arrays** — Cairo arrays are append-only. You cannot modify an element at index `i`. If you need random-access mutation, use `Felt252Dict`. If you need ordered mutation, rebuild the array.

5. **Ignoring the ownership model** — Coming from Solidity where all values are implicitly copyable, Cairo's move semantics catch developers off guard. If you pass a struct to a function, it's gone from the caller's scope unless the type implements `Copy` or you pass a snapshot (`@`).

## What to Learn Next

- [Cairo Advanced Patterns](./07-cairo-advanced-patterns.md) — Components, testing, and production patterns
- [The Cairo Book](https://book.cairo-lang.org/) — Comprehensive language reference
- [Cairo by Example](https://cairo-by-example.com/) — Practical code examples
- [Starknet Foundry Book](https://foundry-rs.github.io/starknet-foundry/) — Testing framework documentation
- [Cairo GitHub Repository](https://github.com/starkware-libs/cairo) — Language source code and examples
