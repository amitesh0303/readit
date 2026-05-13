# Write and Publish Your First Sui Module

**Track:** Sui Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You understand Sui Move syntax in theory, but you haven't deployed anything to a live network. Publishing a package on Sui is different from deploying a contract on Ethereum — there's no constructor, no contract address in the traditional sense, and the published package becomes an immutable object. You need to write a complete module, test it locally, publish it to testnet, and interact with it via the CLI. Without doing this end-to-end, you won't understand how objects flow between transactions.

## Core Concepts

### Project Setup

Create a new package for a simple todo list application:

```shell
# Create the project — sui-cli@1.15.0
sui move new todo_list
cd todo_list
```

### Writing the Module

Create `sources/todo_list.move`:

```move
/// A simple on-chain todo list where each user owns their own list.
/// Demonstrates: object creation, owned objects, entry functions,
/// dynamic vector operations, and object destruction.
module todo_list::todo_list {
    use std::string::String;
    use std::vector;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;

    // ═══════════════════════════════════════════════════════════
    // Structs
    // ═══════════════════════════════════════════════════════════

    /// Each user owns their own TodoList object.
    /// Because it's owned (not shared), operations are fast-path.
    struct TodoList has key, store {
        id: UID,
        items: vector<String>,
        owner: address,
    }

    // ═══════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════

    struct TodoCreated has copy, drop {
        list_id: address,
        owner: address,
    }

    struct ItemAdded has copy, drop {
        list_id: address,
        item: String,
        position: u64,
    }

    struct ItemRemoved has copy, drop {
        list_id: address,
        item: String,
    }

    // ═══════════════════════════════════════════════════════════
    // Error codes
    // ═══════════════════════════════════════════════════════════

    const EIndexOutOfBounds: u64 = 0;
    const EEmptyList: u64 = 1;

    // ═══════════════════════════════════════════════════════════
    // Entry functions (callable from transactions)
    // ═══════════════════════════════════════════════════════════

    /// Create a new empty todo list owned by the sender.
    public entry fun create(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let list = TodoList {
            id: object::new(ctx),
            items: vector::empty<String>(),
            owner: sender,
        };

        event::emit(TodoCreated {
            list_id: object::uid_to_address(&list.id),
            owner: sender,
        });

        transfer::transfer(list, sender);
    }

    /// Add an item to the todo list.
    /// Only the owner can call this (enforced by Sui — owned object).
    public entry fun add_item(
        list: &mut TodoList,
        item: String,
    ) {
        let position = vector::length(&list.items);
        vector::push_back(&mut list.items, item);

        event::emit(ItemAdded {
            list_id: object::uid_to_address(&list.id),
            item,
            position,
        });
    }

    /// Remove an item by index.
    public entry fun remove_item(
        list: &mut TodoList,
        index: u64,
    ) {
        assert!(vector::length(&list.items) > 0, EEmptyList);
        assert!(index < vector::length(&list.items), EIndexOutOfBounds);

        let item = vector::remove(&mut list.items, index);

        event::emit(ItemRemoved {
            list_id: object::uid_to_address(&list.id),
            item,
        });
    }

    /// Delete the entire todo list and reclaim storage rebate.
    public entry fun delete(list: TodoList) {
        let TodoList { id, items: _, owner: _ } = list;
        object::delete(id);
    }

    // ═══════════════════════════════════════════════════════════
    // View functions
    // ═══════════════════════════════════════════════════════════

    /// Get the number of items in the list.
    public fun length(list: &TodoList): u64 {
        vector::length(&list.items)
    }

    /// Get an item by index.
    public fun get_item(list: &TodoList, index: u64): &String {
        assert!(index < vector::length(&list.items), EIndexOutOfBounds);
        vector::borrow(&list.items, index)
    }
}
```

### Writing Tests

Create `tests/todo_list_tests.move`:

```move
#[test_only]
module todo_list::todo_list_tests {
    use std::string;
    use sui::test_scenario;
    use todo_list::todo_list::{Self, TodoList};

    #[test]
    fun test_create_and_add_items() {
        let owner = @0xA;
        let mut scenario = test_scenario::begin(owner);

        // Transaction 1: Create the todo list
        test_scenario::next_tx(&mut scenario, owner);
        {
            todo_list::create(test_scenario::ctx(&mut scenario));
        };

        // Transaction 2: Add items
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut list = test_scenario::take_from_sender<TodoList>(&scenario);
            todo_list::add_item(&mut list, string::utf8(b"Buy groceries"));
            todo_list::add_item(&mut list, string::utf8(b"Write Move code"));
            assert!(todo_list::length(&list) == 2, 0);
            test_scenario::return_to_sender(&scenario, list);
        };

        // Transaction 3: Remove an item
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut list = test_scenario::take_from_sender<TodoList>(&scenario);
            todo_list::remove_item(&mut list, 0);
            assert!(todo_list::length(&list) == 1, 0);
            test_scenario::return_to_sender(&scenario, list);
        };

        test_scenario::end(scenario);
    }

    #[test]
    fun test_delete_list() {
        let owner = @0xA;
        let mut scenario = test_scenario::begin(owner);

        test_scenario::next_tx(&mut scenario, owner);
        {
            todo_list::create(test_scenario::ctx(&mut scenario));
        };

        test_scenario::next_tx(&mut scenario, owner);
        {
            let list = test_scenario::take_from_sender<TodoList>(&scenario);
            todo_list::delete(list);
        };

        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = todo_list::todo_list::EIndexOutOfBounds)]
    fun test_remove_out_of_bounds() {
        let owner = @0xA;
        let mut scenario = test_scenario::begin(owner);

        test_scenario::next_tx(&mut scenario, owner);
        {
            todo_list::create(test_scenario::ctx(&mut scenario));
        };

        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut list = test_scenario::take_from_sender<TodoList>(&scenario);
            todo_list::add_item(&mut list, string::utf8(b"Item 1"));
            todo_list::remove_item(&mut list, 5); // Should abort
            test_scenario::return_to_sender(&scenario, list);
        };

        test_scenario::end(scenario);
    }
}
```

### Running Tests Locally

```shell
# Run all tests — sui-cli@1.15.0
sui move test
```

```
Expected output:
BUILDING todo_list
Running Move unit tests
[ PASS    ] todo_list::todo_list_tests::test_create_and_add_items
[ PASS    ] todo_list::todo_list_tests::test_delete_list
[ PASS    ] todo_list::todo_list_tests::test_remove_out_of_bounds
Test result: OK. Total tests: 3; passed: 3; failed: 0
```

### Publishing to Testnet

Ensure you're on testnet and have SUI tokens:

```shell
# Verify environment and balance
sui client envs
sui client gas

# Publish the package — sui-cli@1.15.0
sui client publish --gas-budget 100000000
```

```
Expected output:
UPDATING GIT DEPENDENCY https://github.com/MystenLabs/sui.git
INCLUDING DEPENDENCY Sui
INCLUDING DEPENDENCY MoveStdlib
BUILDING todo_list
Successfully verified dependencies on-chain against source.

Transaction Digest: 7Ukrc8mH...
╭──────────────────────────────────────────────────────────────────────╮
│ Transaction Data                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Sender: 0x7d20dcdb...                                                │
│ Gas Budget: 100000000 MIST                                           │
│ Gas Price: 1000 MIST                                                 │
│ Gas Payment: [0x4a3c8f...]                                           │
├──────────────────────────────────────────────────────────────────────┤
│ Transaction Effects                                                   │
├──────────────────────────────────────────────────────────────────────┤
│ Status: Success                                                       │
│ Created Objects:                                                      │
│   PackageID: 0xabc123...                                             │
│   UpgradeCap: 0xdef456...                                            │
╰──────────────────────────────────────────────────────────────────────╯
```

Save the `PackageID` — you'll need it to call functions.

### Interacting with the Published Package

```shell
# Call the `create` function to make a new TodoList
sui client call \
  --package 0xabc123... \
  --module todo_list \
  --function create \
  --gas-budget 10000000
```

```
Expected output:
Transaction Digest: 9Xkjf2...
╭──────────────────────────────────────────────────────────────────────╮
│ Created Objects:                                                      │
│   TodoList: 0x789abc...                                              │
╰──────────────────────────────────────────────────────────────────────╯
```

```shell
# Add an item — pass the TodoList object ID and a string
sui client call \
  --package 0xabc123... \
  --module todo_list \
  --function add_item \
  --args 0x789abc... "Buy groceries" \
  --gas-budget 10000000
```

```shell
# View the object's current state
sui client object 0x789abc...
```

### Understanding Gas Costs

Publishing a package on Sui testnet typically costs:
- **Package publish**: ~0.01-0.05 SUI (depends on bytecode size)
- **Object creation**: ~0.001 SUI
- **Object mutation**: ~0.0005 SUI
- **Storage deposit**: Refundable when object is deleted

Faucet: https://docs.sui.io/guides/developer/getting-started/get-coins

## Common Pitfalls

1. **Setting gas budget too low** — If your gas budget is less than the transaction cost, it fails and you still pay gas. Start with `100000000` MIST (0.1 SUI) for publishes and `10000000` (0.01 SUI) for calls. You only pay what's actually consumed.

2. **Forgetting the UpgradeCap** — When you publish, Sui creates an `UpgradeCap` object. This is your key to upgrading the package later. If you lose or destroy it, the package is permanently immutable. Store it safely.

3. **Not handling the `entry` keyword correctly** — Functions without `entry` can't be called directly from transactions. They can only be called by other Move functions. If your CLI call fails with "function not found," check that it's marked `entry` or `public entry`.

4. **Passing wrong object IDs** — Every object has a unique ID. If you pass an ID that doesn't exist or isn't owned by you, the transaction aborts. Double-check IDs with `sui client objects` to list what you own.

## What to Learn Next

- [Token Standards](./05-token-standards.md) — Create fungible tokens and NFTs using Sui's Coin and Display standards
- [Sui Move Examples](https://github.com/MystenLabs/sui/tree/main/sui_programmability/examples) — Official example packages
- [Sui Explorer](https://suiscan.xyz/testnet) — View your published packages and objects on testnet
