# Sui Move Advanced Patterns

**Track:** Sui Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

You can write basic Sui Move modules, but real applications need more sophisticated patterns. How do you store unbounded collections on an object without hitting size limits? How do you compose multiple operations atomically? How do you build shared state that multiple users interact with concurrently? Sui provides dynamic fields for extensible storage, shared objects for collaborative state, and Programmable Transaction Blocks (PTBs) for composing multiple actions in a single transaction. Without these patterns, your contracts will be limited to toy examples.

## Core Concepts

### Dynamic Fields

Regular struct fields are fixed at compile time. Dynamic fields let you attach arbitrary key-value pairs to any object at runtime — like a HashMap on-chain:

```move
module advanced::dynamic_storage {
    use std::string::String;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::dynamic_field;

    /// A registry that can store unlimited key-value pairs.
    /// Without dynamic fields, you'd need a vector (bounded by gas).
    struct Registry has key {
        id: UID,
        entry_count: u64,
    }

    /// A value type stored in dynamic fields.
    struct Entry has store, drop {
        value: String,
        created_at: u64,
    }

    public entry fun create_registry(ctx: &mut TxContext) {
        let registry = Registry {
            id: object::new(ctx),
            entry_count: 0,
        };
        transfer::share_object(registry);
    }

    /// Add a dynamic field to the registry.
    /// Key type: String, Value type: Entry
    public entry fun add_entry(
        registry: &mut Registry,
        key: String,
        value: String,
        ctx: &TxContext,
    ) {
        let entry = Entry {
            value,
            created_at: tx_context::epoch(ctx),
        };
        // Attach the entry to the registry object
        dynamic_field::add(&mut registry.id, key, entry);
        registry.entry_count = registry.entry_count + 1;
    }

    /// Read a dynamic field value.
    public fun get_entry(registry: &Registry, key: String): &Entry {
        dynamic_field::borrow<String, Entry>(&registry.id, key)
    }

    /// Update an existing dynamic field.
    public entry fun update_entry(
        registry: &mut Registry,
        key: String,
        new_value: String,
        ctx: &TxContext,
    ) {
        let entry = dynamic_field::borrow_mut<String, Entry>(
            &mut registry.id,
            key,
        );
        entry.value = new_value;
        entry.created_at = tx_context::epoch(ctx);
    }

    /// Remove a dynamic field and get the value back.
    public entry fun remove_entry(
        registry: &mut Registry,
        key: String,
    ) {
        let _entry: Entry = dynamic_field::remove(&mut registry.id, key);
        registry.entry_count = registry.entry_count - 1;
        // Entry has `drop`, so it's automatically discarded
    }
}
```

### Dynamic Object Fields

Dynamic **object** fields store child objects that retain their own ID and can be queried independently:

```move
module advanced::dynamic_objects {
    use std::string::String;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::dynamic_object_field;

    struct Warehouse has key {
        id: UID,
    }

    struct StoredItem has key, store {
        id: UID,
        name: String,
        quantity: u64,
    }

    public entry fun create_warehouse(ctx: &mut TxContext) {
        let warehouse = Warehouse { id: object::new(ctx) };
        transfer::share_object(warehouse);
    }

    /// Store an item as a dynamic object field.
    /// The item retains its own UID and is queryable by ID.
    public entry fun store_item(
        warehouse: &mut Warehouse,
        name: String,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        let item = StoredItem {
            id: object::new(ctx),
            name,
            quantity,
        };
        // Use the item's name as the key
        dynamic_object_field::add(&mut warehouse.id, name, item);
    }

    /// Retrieve and remove an item from the warehouse.
    public fun take_item(
        warehouse: &mut Warehouse,
        name: String,
    ): StoredItem {
        dynamic_object_field::remove(&mut warehouse.id, name)
    }
}
```

**When to use which:**
- `dynamic_field` — For simple values (numbers, strings, structs with `store + drop`)
- `dynamic_object_field` — For child objects that need their own ID (queryable, transferable)

### Shared Objects and Concurrency

Shared objects are the backbone of DeFi on Sui. Multiple users can interact with them, but transactions are ordered through consensus:

```move
module advanced::shared_pool {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;

    /// A shared liquidity pool that anyone can deposit to or withdraw from.
    struct Pool has key {
        id: UID,
        balance: Balance<SUI>,
        total_shares: u64,
    }

    struct ShareToken has key, store {
        id: UID,
        shares: u64,
    }

    struct Deposited has copy, drop {
        depositor: address,
        amount: u64,
        shares_minted: u64,
    }

    const EInsufficientBalance: u64 = 0;
    const EZeroAmount: u64 = 1;

    /// Create the pool as a shared object.
    public entry fun create_pool(ctx: &mut TxContext) {
        let pool = Pool {
            id: object::new(ctx),
            balance: balance::zero<SUI>(),
            total_shares: 0,
        };
        // share_object makes it accessible to everyone
        transfer::share_object(pool);
    }

    /// Deposit SUI into the pool and receive share tokens.
    /// `pool` is `&mut` — Sui consensus orders concurrent deposits.
    public entry fun deposit(
        pool: &mut Pool,
        payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);

        // Calculate shares: if pool is empty, 1:1; otherwise proportional
        let shares = if (pool.total_shares == 0) {
            amount
        } else {
            (amount * pool.total_shares) / balance::value(&pool.balance)
        };

        // Add funds to pool
        let payment_balance = coin::into_balance(payment);
        balance::join(&mut pool.balance, payment_balance);
        pool.total_shares = pool.total_shares + shares;

        // Mint share token to depositor
        let share_token = ShareToken {
            id: object::new(ctx),
            shares,
        };

        let sender = tx_context::sender(ctx);
        event::emit(Deposited {
            depositor: sender,
            amount,
            shares_minted: shares,
        });

        transfer::transfer(share_token, sender);
    }

    /// Withdraw SUI by burning share tokens.
    public entry fun withdraw(
        pool: &mut Pool,
        share_token: ShareToken,
        ctx: &mut TxContext,
    ) {
        let ShareToken { id, shares } = share_token;
        object::delete(id);

        // Calculate withdrawal amount proportional to shares
        let amount = (shares * balance::value(&pool.balance)) / pool.total_shares;
        assert!(amount > 0, EInsufficientBalance);

        pool.total_shares = pool.total_shares - shares;

        // Extract and send funds
        let withdrawn = coin::from_balance(
            balance::split(&mut pool.balance, amount),
            ctx,
        );
        transfer::public_transfer(withdrawn, tx_context::sender(ctx));
    }
}
```

### Programmable Transaction Blocks (PTBs)

PTBs let you compose multiple Move calls into a single atomic transaction. This is Sui's equivalent of Ethereum's multicall, but built into the protocol:

```shell
# PTB example: Create a pool and deposit in one transaction — sui-cli@1.15.0
sui client ptb \
  --move-call 0x<package>::shared_pool::create_pool \
  --split-coins gas "[1000000000]" \
  --assign deposit_coin \
  --move-call 0x<package>::shared_pool::deposit @0x<pool_id> deposit_coin \
  --gas-budget 50000000
```

PTBs in TypeScript using @mysten/sui.js@0.50.0:

```typescript
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient } from '@mysten/sui.js/client';

// @mysten/sui.js@0.50.0
const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

const tx = new TransactionBlock();

// Step 1: Split 1 SUI from gas coin for deposit
const [depositCoin] = tx.splitCoins(tx.gas, [1_000_000_000]);

// Step 2: Call deposit function with the split coin
tx.moveCall({
  target: `0x<package_id>::shared_pool::deposit`,
  arguments: [
    tx.object('0x<pool_object_id>'),  // shared pool
    depositCoin,                        // coin from step 1
  ],
});

// Step 3: Transfer remaining split to another address (optional)
const [giftCoin] = tx.splitCoins(tx.gas, [500_000_000]);
tx.transferObjects([giftCoin], '0x<recipient_address>');

// All three steps execute atomically — if any fails, all revert
const result = await client.signAndExecuteTransactionBlock({
  transactionBlock: tx,
  signer: keypair,
  options: { showEffects: true, showEvents: true },
});

console.log('Digest:', result.digest);
console.log('Status:', result.effects?.status);
```

**PTB capabilities:**
- Up to 1024 commands per transaction block
- Commands can reference outputs of previous commands
- Atomic: all succeed or all fail
- Single gas payment for the entire block
- No smart contract needed for composition

### Hot Potato Pattern

A "hot potato" is a struct with no abilities — it must be consumed in the same transaction it's created. This enforces multi-step protocols:

```move
module advanced::flash_loan {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;

    struct LendingPool has key {
        id: UID,
        balance: Balance<SUI>,
        fee_bps: u64,  // Fee in basis points (100 = 1%)
    }

    /// Hot potato — NO abilities! Must be returned in the same PTB.
    /// If the borrower doesn't call `repay`, the transaction aborts.
    struct FlashLoanReceipt {
        amount: u64,
        fee: u64,
    }

    const EInsufficientRepayment: u64 = 0;

    /// Borrow funds — returns coins AND a receipt (hot potato).
    public fun borrow(
        pool: &mut LendingPool,
        amount: u64,
        ctx: &mut TxContext,
    ): (Coin<SUI>, FlashLoanReceipt) {
        let fee = (amount * pool.fee_bps) / 10000;
        let loan = coin::from_balance(
            balance::split(&mut pool.balance, amount),
            ctx,
        );
        let receipt = FlashLoanReceipt { amount, fee };
        (loan, receipt)
    }

    /// Repay the loan — consumes the hot potato receipt.
    /// Must be called in the same PTB as `borrow`.
    public fun repay(
        pool: &mut LendingPool,
        receipt: FlashLoanReceipt,
        payment: Coin<SUI>,
    ) {
        let FlashLoanReceipt { amount, fee } = receipt;
        let repay_amount = coin::value(&payment);
        assert!(repay_amount >= amount + fee, EInsufficientRepayment);
        balance::join(&mut pool.balance, coin::into_balance(payment));
    }
}
```

The borrower must call both `borrow` and `repay` in the same PTB. If they don't call `repay`, the `FlashLoanReceipt` has no `drop` ability, so the transaction can't complete — it aborts.

## Common Pitfalls

1. **Using dynamic fields for small, fixed collections** — Dynamic fields have per-access gas overhead. If you know your collection is small and bounded (e.g., 5 attributes), use a regular struct field or vector. Reserve dynamic fields for unbounded or sparse data.

2. **Not understanding shared object ordering** — Two transactions that both mutate the same shared object are sequenced by consensus. If your app has a hot shared object (like a popular AMM pool), throughput is limited by consensus latency (~2-3s per transaction on that object). Design to minimize shared object contention.

3. **Forgetting PTB atomicity guarantees** — If any command in a PTB fails, the entire block reverts. This is powerful for safety (flash loans) but means a single bad command kills the whole transaction. Test each step independently before composing.

4. **Not consuming hot potatoes** — If you create a struct with no abilities and don't consume it in the same transaction, the Move verifier rejects the code at compile time. This is intentional — it's how you enforce protocol invariants.

5. **Overusing shared objects** — Every shared object access goes through consensus. If your design has users frequently writing to the same shared object, consider splitting state into per-user owned objects where possible. Only share what truly needs global coordination.

## What to Learn Next

- [Frontend Integration](./07-frontend-integration.md) — Connect a web app to Sui using @mysten/sui.js and wallet adapters
- [Sui Dynamic Fields Docs](https://docs.sui.io/concepts/dynamic-fields) — Official dynamic fields reference
- [PTB Documentation](https://docs.sui.io/concepts/transactions/prog-txn-blocks) — Programmable Transaction Blocks guide
