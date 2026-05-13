# Your First NEAR Smart Contract in Rust

**Track:** NEAR Protocol Development
**Level:** Beginner → Intermediate
**Read time:** 12 min

---

## The Problem

You've set up your environment and understand NEAR's architecture. Now you need to write an actual contract. NEAR contracts are written in Rust using `near-sdk@5.0.0`, compiled to WebAssembly, and deployed to accounts. The programming model is different from Solidity — there's no constructor, state is managed through struct serialization, and cross-contract calls are asynchronous. This lesson walks you through a complete contract from scratch, including testing and testnet deployment.

---

## Core Concepts

### Contract Structure

Every NEAR contract is a Rust struct annotated with `#[near(contract_state)]` (previously `#[near_bindgen]`). The struct holds all persistent state:

```rust
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Messages,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GuestBook {
    messages: LookupMap<AccountId, String>,
    total_messages: u32,
    owner: AccountId,
}
```

Key differences from Solidity:
- No constructor — you define an `init` method explicitly
- State is serialized/deserialized on every call (Borsh format)
- Collections (`LookupMap`, `Vector`, `UnorderedMap`) are lazy-loaded from storage
- `env::predecessor_account_id()` is equivalent to `msg.sender`

### Initialization

```rust
#[near]
impl GuestBook {
    /// Initialize the contract. Can only be called once.
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            messages: LookupMap::new(StorageKey::Messages),
            total_messages: 0,
            owner,
        }
    }
}
```

The `#[init]` attribute marks this as the initialization function. Unlike Solidity constructors, this is called as a separate transaction after deployment. The contract account must call this before any other method works (due to `PanicOnDefault`).

### View vs Change Methods

NEAR distinguishes between methods that read state (free, no gas) and methods that modify state (require gas):

```rust
#[near]
impl GuestBook {
    /// Change method — modifies state, costs gas
    pub fn add_message(&mut self, message: String) {
        let sender = env::predecessor_account_id();

        // Validate input
        require!(
            message.len() <= 500,
            "Message too long (max 500 characters)"
        );
        require!(
            !message.is_empty(),
            "Message cannot be empty"
        );

        // Store the message
        self.messages.set(sender.clone(), Some(message));
        self.total_messages += 1;

        // Log an event
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep297\",\"version\":\"1.0.0\",\"event\":\"add_message\",\"data\":{{\"sender\":\"{}\",\"total\":{}}}}}", 
            sender, self.total_messages
        ));
    }

    /// View method — reads state, free to call (no gas)
    pub fn get_message(&self, account_id: AccountId) -> Option<&String> {
        self.messages.get(&account_id)
    }

    /// View method — returns total message count
    pub fn get_total_messages(&self) -> u32 {
        self.total_messages
    }

    /// Change method — only owner can clear messages
    pub fn clear_message(&mut self, account_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only owner can clear messages"
        );
        self.messages.remove(&account_id);
    }
}
```

### Payable Methods and Attached Deposits

Methods that accept NEAR tokens must be marked `#[payable]`:

```rust
#[near]
impl GuestBook {
    /// Payable method — accepts NEAR tokens as tips
    #[payable]
    pub fn add_message_with_tip(&mut self, message: String) {
        let sender = env::predecessor_account_id();
        let deposit = env::attached_deposit();

        require!(
            deposit >= NearToken::from_millinear(10), // minimum 0.01 NEAR
            "Minimum tip is 0.01 NEAR"
        );
        require!(message.len() <= 500, "Message too long");

        self.messages.set(sender, Some(message));
        self.total_messages += 1;

        // Transfer tip to owner
        near_sdk::Promise::new(self.owner.clone()).transfer(deposit);
    }
}
```

### Complete Contract File

Here's the full `src/lib.rs`:

```rust
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Messages,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GuestBook {
    messages: LookupMap<AccountId, String>,
    total_messages: u32,
    owner: AccountId,
}

#[near]
impl GuestBook {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            messages: LookupMap::new(StorageKey::Messages),
            total_messages: 0,
            owner,
        }
    }

    pub fn add_message(&mut self, message: String) {
        let sender = env::predecessor_account_id();
        require!(message.len() <= 500, "Message too long (max 500 characters)");
        require!(!message.is_empty(), "Message cannot be empty");

        self.messages.set(sender.clone(), Some(message));
        self.total_messages += 1;

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep297\",\"version\":\"1.0.0\",\"event\":\"add_message\",\"data\":{{\"sender\":\"{}\",\"total\":{}}}}}",
            sender, self.total_messages
        ));
    }

    #[payable]
    pub fn add_message_with_tip(&mut self, message: String) {
        let sender = env::predecessor_account_id();
        let deposit = env::attached_deposit();

        require!(deposit >= NearToken::from_millinear(10), "Minimum tip is 0.01 NEAR");
        require!(message.len() <= 500, "Message too long");
        require!(!message.is_empty(), "Message cannot be empty");

        self.messages.set(sender.clone(), Some(message));
        self.total_messages += 1;

        Promise::new(self.owner.clone()).transfer(deposit);
    }

    pub fn get_message(&self, account_id: AccountId) -> Option<&String> {
        self.messages.get(&account_id)
    }

    pub fn get_total_messages(&self) -> u32 {
        self.total_messages
    }

    pub fn clear_message(&mut self, account_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only owner can clear messages"
        );
        self.messages.remove(&account_id);
    }
}
```

### Building and Deploying to Testnet

```shell
# Build the contract
cargo near build

# Deploy to your testnet account
near contract deploy guestbook.testnet use-file ./target/near/guest_book.wasm without-init-call network-config testnet sign-with-keychain send
```

```
Expected output:
Contract deployed successfully to "guestbook.testnet"
Transaction ID: 8xM...
```

```shell
# Initialize the contract
near contract call-function as-transaction guestbook.testnet new json-args '{"owner": "guestbook.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as guestbook.testnet network-config testnet sign-with-keychain send
```

```
Expected output:
Transaction sent successfully.
Transaction ID: 3kP...
```

```shell
# Call a change method
near contract call-function as-transaction guestbook.testnet add_message json-args '{"message": "Hello NEAR!"}' prepaid-gas '10 Tgas' attached-deposit '0 NEAR' sign-as alice.testnet network-config testnet sign-with-keychain send
```

```
Expected output:
Log: EVENT_JSON:{"standard":"nep297","version":"1.0.0","event":"add_message","data":{"sender":"alice.testnet","total":1}}
Transaction ID: 9fR...
```

```shell
# Call a view method (free, no gas needed)
near contract call-function as-read-only guestbook.testnet get_message json-args '{"account_id": "alice.testnet"}' network-config testnet now
```

```
Expected output:
"Hello NEAR!"
```

### Unit Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(predecessor);
        builder
    }

    #[test]
    fn test_new() {
        let owner: AccountId = "owner.testnet".parse().unwrap();
        let context = get_context(owner.clone());
        testing_env!(context.build());

        let contract = GuestBook::new(owner.clone());
        assert_eq!(contract.get_total_messages(), 0);
    }

    #[test]
    fn test_add_message() {
        let owner: AccountId = "owner.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = get_context(owner.clone());
        testing_env!(context.build());
        let mut contract = GuestBook::new(owner);

        // Switch to alice as caller
        let context = get_context(alice.clone());
        testing_env!(context.build());

        contract.add_message("Hello!".to_string());
        assert_eq!(contract.get_message(alice), Some(&"Hello!".to_string()));
        assert_eq!(contract.get_total_messages(), 1);
    }

    #[test]
    #[should_panic(expected = "Message cannot be empty")]
    fn test_empty_message_panics() {
        let owner: AccountId = "owner.testnet".parse().unwrap();
        let context = get_context(owner.clone());
        testing_env!(context.build());
        let mut contract = GuestBook::new(owner);

        contract.add_message("".to_string());
    }
}
```

```shell
# Run unit tests
cargo test
```

```
Expected output:
running 3 tests
test tests::test_new ... ok
test tests::test_add_message ... ok
test tests::test_empty_message_panics ... ok

test result: ok. 3 passed; 0 failed
```

---

## Common Pitfalls

1. **Forgetting `#[init]` and `PanicOnDefault`** — If you derive `Default` instead of `PanicOnDefault`, anyone can call your contract before initialization and get a zeroed-out state. Always use `PanicOnDefault` and require explicit initialization via an `#[init]` method.

2. **Using `HashMap` instead of `LookupMap`** — Standard Rust `HashMap` loads ALL entries into memory on every contract call. For contracts with many entries, this exceeds gas limits. Use `near_sdk::store::LookupMap` (or `UnorderedMap` if you need iteration) which loads entries lazily from storage.

3. **Not marking payable methods with `#[payable]`** — If a method doesn't have `#[payable]` and a user attaches a deposit, the transaction panics. This is a safety feature — it prevents accidental token loss. Always add `#[payable]` to methods that should accept NEAR.

4. **Ignoring the 4MB contract size limit** — Compiled Wasm binaries must be under 4MB. Heavy use of generics, large dependencies, or debug symbols can bloat the binary. Use `cargo near build` (which optimizes for size) rather than `cargo build --release`.

5. **Not handling cross-contract call failures** — When you make a `Promise` call to another contract, it might fail. If you don't attach a callback (`.then()`), you won't know it failed and your state might be inconsistent. Always handle the callback for state-changing cross-contract calls.

---

## What to Learn Next

- [NEP Token Standards](./04-token-standards.md) — Implement fungible tokens (NEP-141) and NFTs (NEP-171) on NEAR
- [near-sdk Rust reference](https://docs.near.org/sdk/rust/introduction) — Full SDK documentation
- [NEAR Examples GitHub](https://github.com/near-examples) — Official example contracts
