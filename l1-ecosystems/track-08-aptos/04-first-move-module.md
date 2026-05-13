# Write and Deploy Your First Move Module

**Track:** Aptos Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You understand Move syntax but haven't deployed anything to a live network. The gap between writing code locally and having a working module on testnet involves compilation, publishing, and transaction submission — each with its own gotchas. This lesson walks you through building a complete todo-list module, testing it locally, and deploying it to Aptos testnet using the Aptos CLI.

---

## Core Concepts

### Project Setup

```shell
# Create a new project
mkdir aptos-todo && cd aptos-todo
aptos move init --name todo_list
```

Update `Move.toml` to set your address:

```toml
[package]
name = "todo_list"
version = "1.0.0"
authors = []

[addresses]
todo_list = "_"

[dev-addresses]
todo_list = "0x42"

[dependencies.AptosFramework]
git = "https://github.com/aptos-labs/aptos-core.git"
rev = "mainnet"
subdir = "aptos-move/framework/aptos-framework"
```

### Writing the Todo List Module

Create `sources/todo_list.move`:

```move
module todo_list::todo {
    use std::string::String;
    use std::vector;
    use std::signer;
    use aptos_framework::event;
    use aptos_framework::timestamp;

    /// Error codes
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_TASK_NOT_FOUND: u64 = 3;
    const E_TASK_ALREADY_COMPLETED: u64 = 4;

    /// A single todo task
    struct Task has store, drop, copy {
        id: u64,
        content: String,
        completed: bool,
        created_at: u64,
    }

    /// The todo list resource stored in a user's account
    struct TodoList has key {
        tasks: vector<Task>,
        next_id: u64,
    }

    /// Events
    #[event]
    struct TaskCreated has drop, store {
        owner: address,
        task_id: u64,
        content: String,
    }

    #[event]
    struct TaskCompleted has drop, store {
        owner: address,
        task_id: u64,
    }

    /// Initialize a todo list for the calling account
    public entry fun create_list(account: &signer) {
        let addr = signer::address_of(account);
        assert!(!exists<TodoList>(addr), E_ALREADY_INITIALIZED);
        move_to(account, TodoList {
            tasks: vector::empty<Task>(),
            next_id: 1,
        });
    }

    /// Add a new task to the caller's todo list
    public entry fun add_task(
        account: &signer,
        content: String
    ) acquires TodoList {
        let addr = signer::address_of(account);
        assert!(exists<TodoList>(addr), E_NOT_INITIALIZED);

        let todo_list = borrow_global_mut<TodoList>(addr);
        let task_id = todo_list.next_id;

        let task = Task {
            id: task_id,
            content,
            completed: false,
            created_at: timestamp::now_seconds(),
        };

        vector::push_back(&mut todo_list.tasks, task);
        todo_list.next_id = task_id + 1;

        event::emit(TaskCreated {
            owner: addr,
            task_id,
            content: task.content,
        });
    }

    /// Mark a task as completed
    public entry fun complete_task(
        account: &signer,
        task_id: u64
    ) acquires TodoList {
        let addr = signer::address_of(account);
        assert!(exists<TodoList>(addr), E_NOT_INITIALIZED);

        let todo_list = borrow_global_mut<TodoList>(addr);
        let tasks_len = vector::length(&todo_list.tasks);
        let i = 0;
        let found = false;

        while (i < tasks_len) {
            let task = vector::borrow_mut(&mut todo_list.tasks, i);
            if (task.id == task_id) {
                assert!(!task.completed, E_TASK_ALREADY_COMPLETED);
                task.completed = true;
                found = true;
                break
            };
            i = i + 1;
        };

        assert!(found, E_TASK_NOT_FOUND);

        event::emit(TaskCompleted {
            owner: addr,
            task_id,
        });
    }

    /// View function: get all tasks for an address
    #[view]
    public fun get_tasks(addr: address): vector<Task> acquires TodoList {
        assert!(exists<TodoList>(addr), E_NOT_INITIALIZED);
        borrow_global<TodoList>(addr).tasks
    }

    /// View function: get task count
    #[view]
    public fun get_task_count(addr: address): u64 acquires TodoList {
        assert!(exists<TodoList>(addr), E_NOT_INITIALIZED);
        vector::length(&borrow_global<TodoList>(addr).tasks)
    }
}
```

### Writing Tests

Create `tests/todo_test.move`:

```move
#[test_only]
module todo_list::todo_tests {
    use std::string;
    use todo_list::todo;
    use aptos_framework::timestamp;
    use aptos_framework::account;

    #[test(admin = @0x1, user = @0x42)]
    fun test_full_workflow(admin: &signer, user: &signer) acquires todo::TodoList {
        // Setup: initialize timestamp for testing
        timestamp::set_time_has_started_for_testing(admin);
        account::create_account_for_test(@0x42);

        // Create a todo list
        todo::create_list(user);

        // Add tasks
        todo::add_task(user, string::utf8(b"Learn Move"));
        todo::add_task(user, string::utf8(b"Deploy to testnet"));

        // Verify task count
        assert!(todo::get_task_count(@0x42) == 2, 1);

        // Complete a task
        todo::complete_task(user, 1);

        // Verify tasks
        let tasks = todo::get_tasks(@0x42);
        let first_task = std::vector::borrow(&tasks, 0);
        assert!(first_task.completed == true, 2);
    }

    #[test(user = @0x42)]
    #[expected_failure(abort_code = 2)]
    fun test_double_init(user: &signer) {
        todo::create_list(user);
        todo::create_list(user); // Should fail
    }

    #[test(admin = @0x1, user = @0x42)]
    #[expected_failure(abort_code = 3)]
    fun test_complete_nonexistent(admin: &signer, user: &signer) {
        timestamp::set_time_has_started_for_testing(admin);
        todo::create_list(user);
        todo::complete_task(user, 999); // Task doesn't exist
    }
}
```

### Running Tests Locally

```shell
# Run all tests
aptos move test --named-addresses todo_list=0x42
```

```
Expected output:
Running Move unit tests
[ PASS ] 0x42::todo_tests::test_full_workflow
[ PASS ] 0x42::todo_tests::test_double_init
[ PASS ] 0x42::todo_tests::test_complete_nonexistent
Test result: OK. Total tests: 3; passed: 3; failed: 0
```

### Compiling for Deployment

```shell
# Compile with your testnet address
aptos move compile --named-addresses todo_list=default
```

```
Expected output:
Compiling, may take a little while to download git dependencies...
INCLUDING DEPENDENCY AptosFramework
INCLUDING DEPENDENCY AptosStdlib
INCLUDING DEPENDENCY MoveStdlib
BUILDING todo_list
{
  "Result": [
    "0x<your-address>::todo"
  ]
}
```

### Deploying to Testnet

```shell
# Ensure your account is funded
aptos account fund-with-faucet --account default --amount 200000000
```

Faucet URL: https://aptos.dev/en/network/faucet

```shell
# Publish the module to testnet
aptos move publish --named-addresses todo_list=default --assume-yes
```

```
Expected output:
Compiling, may take a little while to download git dependencies...
INCLUDING DEPENDENCY AptosFramework
INCLUDING DEPENDENCY AptosStdlib
INCLUDING DEPENDENCY MoveStdlib
BUILDING todo_list
package size 2847 bytes
{
  "Result": {
    "transaction_hash": "0x<tx-hash>",
    "gas_used": 1294,
    "gas_unit_price": 100,
    "sender": "0x<your-address>",
    "success": true,
    "version": 123456789,
    "vm_status": "Executed successfully"
  }
}
```

### Interacting with Your Deployed Module

```shell
# Create a todo list
aptos move run \
  --function-id default::todo::create_list \
  --assume-yes
```

```
Expected output:
{
  "Result": {
    "transaction_hash": "0x...",
    "gas_used": 7,
    "success": true,
    "vm_status": "Executed successfully"
  }
}
```

```shell
# Add a task
aptos move run \
  --function-id default::todo::add_task \
  --args 'string:Learn Aptos Move' \
  --assume-yes
```

```shell
# View your tasks
aptos move view \
  --function-id default::todo::get_task_count \
  --args address:default
```

```
Expected output:
{
  "Result": [
    "1"
  ]
}
```

### Verifying on Explorer

After deployment, view your module on the Aptos Explorer:
```
https://explorer.aptoslabs.com/account/<your-address>/modules?network=testnet
```

You can also interact with your module directly through the Explorer's "Run" tab.

---

## Common Pitfalls

1. **Insufficient gas for publishing** — Module publishing costs more gas than regular transactions (typically 1000-5000 gas units). If you get an `OUT_OF_GAS` error, fund your account with more APT. The `--max-gas` flag lets you set a higher limit: `aptos move publish --max-gas 10000`.

2. **Module already published at address** — Once a module is published, you cannot republish it with the same name unless you use the `--upgrade-policy` flag. By default, modules are immutable after first publish. Use `aptos move publish --upgrade-policy compatible` during development to allow upgrades.

3. **Named address mismatch between compile and publish** — If you compile with `--named-addresses todo_list=0xABC` but publish from account `0xDEF`, the deployment fails. Always use `default` (which resolves to your CLI profile's address) for both compilation and publishing.

4. **Forgetting to initialize timestamp in tests** — If your module uses `timestamp::now_seconds()`, tests will abort unless you call `timestamp::set_time_has_started_for_testing(admin)` with a `@0x1` signer first. The `@0x1` address is the framework address that controls the timestamp module.

5. **Not handling the `acquires` chain** — If your entry function calls a helper that acquires a resource, both functions need the `acquires` annotation. The compiler error message tells you exactly which resource is missing, but it can be confusing when the chain is deep.

---

## What to Learn Next

- [Token Standards](./05-token-standards.md) — Learn about Aptos Token (legacy) and the new Digital Assets / Fungible Asset standard
- [Aptos Move Tutorial](https://aptos.dev/en/build/smart-contracts) — Official smart contract development guide
- [Aptos Move Examples](https://github.com/aptos-labs/aptos-core/tree/main/aptos-move/move-examples) — More example modules

