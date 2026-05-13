# FunC Language Fundamentals

**Track:** TON Development
**Level:** Beginner → Intermediate
**Read time:** 15 min

---

## The Problem

You're ready to write smart contracts on TON but FunC looks nothing like Solidity, Rust, or any language you've used before. It has C-like syntax but operates on cells and slices, uses a stack-based compilation target (Fift), and requires explicit serialization of all data. Without understanding FunC's core syntax and the cell-based data model, you'll struggle with even basic contract logic. This lesson teaches you FunC from the ground up so you can write idiomatic TON contracts.

---

## Core Concepts

### FunC Overview

FunC (Functional C) is TON's primary smart contract language. It compiles to Fift assembly, which then compiles to TVM bytecode:

```
FunC (.fc) → Fift assembler (.fif) → TVM bytecode (deployed on-chain)
```

Key characteristics:
- C-like syntax with functional programming features
- Statically typed with type inference
- All data stored as cells (tree of cells)
- Explicit message handling (recv_internal, recv_external)
- No classes, objects, or inheritance — purely procedural

### Basic Types and Variables

```func
;; FunC basic types and variable declarations

() basic_types() {
    ;; Integer types (257-bit signed by default)
    int x = 42;
    int negative = -100;
    int large = 1000000000000;

    ;; Cells — the fundamental data container
    cell empty_cell = begin_cell().end_cell();

    ;; Slices — read-only view into a cell
    slice s = empty_cell.begin_parse();

    ;; Builders — used to construct cells
    builder b = begin_cell();

    ;; Tuples — fixed-size heterogeneous collections
    (int, int) pair = (10, 20);
    (int, slice, cell) triple = (1, s, empty_cell);

    ;; Type inference with var
    var y = 100;  ;; inferred as int
}
```

### Functions

```func
;; Function declarations in FunC

;; Basic function with explicit return type
int add(int a, int b) {
    return a + b;
}

;; Multiple return values (tuples)
(int, int) swap(int a, int b) {
    return (b, a);
}

;; Inline function (always inlined at call site — saves gas for small functions)
int inline_max(int a, int b) inline {
    return a > b ? a : b;
}

;; Method-style function (called with . syntax on first argument)
;; The ~ prefix means it modifies the first argument in place
(slice, int) ~load_uint_safe(slice s, int bits) {
    if (s.slice_bits() < bits) {
        return (s, 0);
    }
    return s.load_uint(bits);
}

;; Impure function — has side effects (sends messages, modifies storage)
() send_ton(slice to_address, int amount) impure {
    cell msg = begin_cell()
        .store_uint(0x18, 6)          ;; bounceable internal message
        .store_slice(to_address)       ;; destination
        .store_coins(amount)           ;; value in nanoTON
        .store_uint(0, 107)            ;; default message parameters
        .end_cell();
    send_raw_message(msg, 64);         ;; mode 64: carry remaining value
}
```

### Cell Serialization and Deserialization

All data in TON is stored as cells. You must explicitly serialize (store) and deserialize (load) data:

```func
;; Storing data into a cell (serialization)
cell pack_user_data(int user_id, int balance, slice name) {
    return begin_cell()
        .store_uint(user_id, 32)       ;; 32-bit unsigned integer
        .store_coins(balance)           ;; variable-length coin amount
        .store_uint(name.slice_bits() / 8, 8)  ;; name length in bytes
        .store_slice(name)             ;; raw name data
        .end_cell();
}

;; Reading data from a cell (deserialization)
(int, int, slice) unpack_user_data(cell data) {
    slice ds = data.begin_parse();
    int user_id = ds~load_uint(32);
    int balance = ds~load_coins();
    int name_len = ds~load_uint(8);
    slice name = ds~load_bits(name_len * 8);
    ds.end_parse();                    ;; assert nothing left (safety check)
    return (user_id, balance, name);
}
```

### Contract Storage (Persistent State)

Every TON contract has persistent storage accessed via `get_data()` and `set_data()`:

```func
;; Global storage layout for a counter contract
;; Storage cell: [counter:uint64][owner:address]

;; Load contract state from persistent storage
(int, slice) load_data() {
    slice ds = get_data().begin_parse();
    int counter = ds~load_uint(64);
    slice owner = ds~load_msg_addr();
    ds.end_parse();
    return (counter, owner);
}

;; Save contract state to persistent storage
() save_data(int counter, slice owner) impure {
    set_data(
        begin_cell()
            .store_uint(counter, 64)
            .store_slice(owner)
            .end_cell()
    );
}
```

### Message Handling

TON contracts have two entry points for receiving messages:

```func
#include "imports/stdlib.fc";

;; recv_internal — handles messages from other contracts (most common)
() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    ;; Parse the incoming message
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);

    ;; Ignore bounced messages (bit 0 of flags)
    if (flags & 1) {
        return ();
    }

    ;; Get sender address
    slice sender_address = cs~load_msg_addr();

    ;; Parse operation code from message body
    if (in_msg_body.slice_empty?()) {
        return ();  ;; Empty message — just accept TON
    }

    int op = in_msg_body~load_uint(32);

    ;; Route to handler based on op code
    if (op == 1) {  ;; op::increment
        handle_increment(sender_address);
        return ();
    }

    if (op == 2) {  ;; op::reset
        handle_reset(sender_address);
        return ();
    }

    throw(0xffff);  ;; Unknown operation
}

;; recv_external — handles messages from outside the blockchain (rare)
() recv_external(slice in_msg) impure {
    ;; Used for wallet contracts to accept signed external messages
    ;; Most application contracts don't implement this
    throw(0xffff);
}
```

### Control Flow

```func
;; If-else
int abs(int x) {
    if (x < 0) {
        return -x;
    } else {
        return x;
    }
}

;; Ternary operator
int max(int a, int b) {
    return a > b ? a : b;
}

;; While loop
int sum_to(int n) {
    int result = 0;
    int i = 1;
    while (i <= n) {
        result += i;
        i += 1;
    }
    return result;
}

;; Repeat loop (fixed iteration count — more gas efficient)
int power_of_two(int n) {
    int result = 1;
    repeat (n) {
        result *= 2;
    }
    return result;
}

;; Do-until loop
int find_first_set_bit(int x) {
    int pos = 0;
    do {
        pos += 1;
    } until (x & (1 << pos));
    return pos;
}
```

### Error Handling

```func
;; Throwing exceptions (abort execution)
() require_owner(slice sender, slice owner) impure {
    throw_unless(401, equal_slices(sender, owner));
    ;; 401 = unauthorized error code
}

;; Custom error codes (convention)
const int error::unauthorized = 401;
const int error::insufficient_funds = 402;
const int error::invalid_op = 0xffff;

;; Try-catch (available in FunC v0.4.4+)
() safe_operation() impure {
    try {
        ;; risky operation
        int result = dangerous_calculation();
    } catch (_, exit_code) {
        ;; handle error — exit_code contains the throw value
        ;; Note: state changes in try block are NOT rolled back
    }
}
```

### Get Methods (Read-Only Queries)

```func
;; Get methods are called off-chain to read contract state
;; They don't cost gas and don't modify state

int get_counter() method_id {
    (int counter, _) = load_data();
    return counter;
}

slice get_owner() method_id {
    (_, slice owner) = load_data();
    return owner;
}

;; method_id assigns a numeric ID for RPC calls
;; You can specify it explicitly: method_id(12345)
```

---

## Common Pitfalls

1. **Forgetting `impure` on functions with side effects** — Functions that call `send_raw_message`, `set_data`, or other state-modifying operations must be marked `impure`. Without it, the compiler may optimize away the function call entirely, and your messages won't be sent or storage won't be updated.

2. **Not calling `end_parse()` after reading a slice** — While not strictly required, omitting `end_parse()` means you won't catch serialization bugs where extra unexpected data exists in a cell. Always call it after loading all expected fields to assert the slice is fully consumed.

3. **Mixing up `~` method calls and regular calls** — The `~` prefix means the method modifies its first argument in place and returns the remaining value. `ds~load_uint(32)` advances the slice `ds` forward and returns the loaded integer. Without `~`, the slice isn't advanced: `ds.load_uint(32)` returns the value but `ds` still points to the same position.

4. **Exceeding cell bit/ref limits** — A single cell holds at most 1023 bits and 4 references. If your data exceeds this, you must split it across multiple cells linked by references. The compiler won't warn you — you'll get a runtime error (exit code 8: cell overflow) during serialization.

5. **Not handling the `op` code 0** — By convention, messages with `op = 0` are simple TON transfers with a text comment. If your contract throws on unknown ops without checking for op 0, users won't be able to send TON to your contract with wallet apps that attach comments.

---

## What to Learn Next

- [First FunC Contract](./04-first-func-contract.md) — Write and deploy a complete counter contract to TON testnet
- [FunC Documentation](https://docs.ton.org/develop/func/overview) — Official FunC language reference
- [FunC Standard Library](https://github.com/ton-blockchain/ton/blob/master/crypto/smartcont/stdlib.fc) — Built-in functions source code
