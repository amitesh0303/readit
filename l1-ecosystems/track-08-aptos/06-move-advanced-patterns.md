# Move Advanced Patterns: Resource Accounts, Generics, and Events

**Track:** Aptos Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You can write basic Move modules, but real-world Aptos applications require advanced patterns. How do you create autonomous accounts that own resources without a private key? How do you write generic modules that work with any token type? How do you emit and index events for your frontend? This lesson covers the patterns that separate toy examples from production Move code.

---

## Core Concepts

### Resource Accounts

A resource account is an account without a private key — it's controlled entirely by the module that created it. This is essential for DeFi protocols where a contract needs to hold funds autonomously.

```move
module my_addr::vault {
    use std::signer;
    use aptos_framework::account;
    use aptos_framework::resource_account;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;

    /// Store the resource account's signer capability
    struct VaultConfig has key {
        signer_cap: account::SignerCapability,
        total_deposited: u64,
    }

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_INSUFFICIENT_BALANCE: u64 = 2;

    /// Initialize the vault (called during resource account creation)
    /// The resource account is created via CLI:
    /// aptos move create-resource-account-and-publish-package \
    ///   --seed "vault_v1" --named-addresses my_addr=default
    fun init_module(resource_signer: &signer) {
        let signer_cap = resource_account::retrieve_resource_account_cap(
            resource_signer,
            @my_addr
        );

        // Register the resource account to hold APT
        coin::register<AptosCoin>(resource_signer);

        move_to(resource_signer, VaultConfig {
            signer_cap,
            total_deposited: 0,
        });
    }

    /// Deposit APT into the vault
    public entry fun deposit(
        user: &signer,
        amount: u64
    ) acquires VaultConfig {
        let vault_addr = get_vault_address();
        let config = borrow_global_mut<VaultConfig>(vault_addr);

        // Transfer APT from user to the resource account
        coin::transfer<AptosCoin>(user, vault_addr, amount);
        config.total_deposited = config.total_deposited + amount;
    }

    /// Withdraw APT from the vault (admin only for this example)
    public entry fun withdraw(
        admin: &signer,
        to: address,
        amount: u64
    ) acquires VaultConfig {
        assert!(signer::address_of(admin) == @my_addr, E_NOT_ADMIN);

        let vault_addr = get_vault_address();
        let config = borrow_global<VaultConfig>(vault_addr);

        // Create a signer for the resource account using the stored capability
        let vault_signer = account::create_signer_with_capability(&config.signer_cap);

        // Transfer from resource account to recipient
        coin::transfer<AptosCoin>(&vault_signer, to, amount);
    }

    /// Get the vault's resource account address
    fun get_vault_address(): address {
        account::create_resource_address(&@my_addr, b"vault_v1")
    }

    #[view]
    public fun get_total_deposited(): u64 acquires VaultConfig {
        let vault_addr = get_vault_address();
        borrow_global<VaultConfig>(vault_addr).total_deposited
    }
}
```

Deploy with resource account:

```shell
# Create resource account and publish in one step
aptos move create-resource-account-and-publish-package \
  --seed "vault_v1" \
  --named-addresses my_addr=default \
  --assume-yes
```

```
Expected output:
{
  "Result": {
    "transaction_hash": "0x...",
    "gas_used": 3421,
    "success": true,
    "resource_account": "0x<resource-account-address>"
  }
}
```

### Generics and Type Parameters

Generics let you write modules that work with any coin or resource type:

```move
module my_addr::generic_pool {
    use std::signer;
    use aptos_framework::coin::{Self, Coin};

    /// A generic liquidity pool that works with any two coin types
    struct Pool<phantom CoinA, phantom CoinB> has key {
        reserve_a: Coin<CoinA>,
        reserve_b: Coin<CoinB>,
        lp_supply: u64,
    }

    /// Error codes
    const E_POOL_EXISTS: u64 = 1;
    const E_POOL_NOT_FOUND: u64 = 2;
    const E_ZERO_AMOUNT: u64 = 3;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 4;

    /// Create a new pool for any two coin types
    public entry fun create_pool<CoinA, CoinB>(admin: &signer) {
        let addr = signer::address_of(admin);
        assert!(!exists<Pool<CoinA, CoinB>>(addr), E_POOL_EXISTS);

        move_to(admin, Pool<CoinA, CoinB> {
            reserve_a: coin::zero<CoinA>(),
            reserve_b: coin::zero<CoinB>(),
            lp_supply: 0,
        });
    }

    /// Add liquidity to the pool
    public entry fun add_liquidity<CoinA, CoinB>(
        provider: &signer,
        amount_a: u64,
        amount_b: u64,
        pool_owner: address,
    ) acquires Pool {
        assert!(amount_a > 0 && amount_b > 0, E_ZERO_AMOUNT);
        assert!(exists<Pool<CoinA, CoinB>>(pool_owner), E_POOL_NOT_FOUND);

        let pool = borrow_global_mut<Pool<CoinA, CoinB>>(pool_owner);

        // Withdraw coins from provider
        let coin_a = coin::withdraw<CoinA>(provider, amount_a);
        let coin_b = coin::withdraw<CoinB>(provider, amount_b);

        // Add to reserves
        coin::merge(&mut pool.reserve_a, coin_a);
        coin::merge(&mut pool.reserve_b, coin_b);
        pool.lp_supply = pool.lp_supply + amount_a; // simplified LP calc
    }

    /// Swap CoinA for CoinB (constant product formula)
    public fun swap_a_for_b<CoinA, CoinB>(
        trader: &signer,
        amount_in: u64,
        pool_owner: address,
    ): u64 acquires Pool {
        assert!(amount_in > 0, E_ZERO_AMOUNT);

        let pool = borrow_global_mut<Pool<CoinA, CoinB>>(pool_owner);
        let reserve_a = coin::value(&pool.reserve_a);
        let reserve_b = coin::value(&pool.reserve_b);

        // x * y = k (constant product)
        // amount_out = (reserve_b * amount_in) / (reserve_a + amount_in)
        let amount_out = (reserve_b * amount_in) / (reserve_a + amount_in);
        assert!(amount_out > 0, E_INSUFFICIENT_LIQUIDITY);

        // Execute swap
        let coin_in = coin::withdraw<CoinA>(trader, amount_in);
        coin::merge(&mut pool.reserve_a, coin_in);

        let coin_out = coin::extract(&mut pool.reserve_b, amount_out);
        coin::deposit(signer::address_of(trader), coin_out);

        amount_out
    }

    /// View: get reserves
    #[view]
    public fun get_reserves<CoinA, CoinB>(pool_owner: address): (u64, u64) acquires Pool {
        let pool = borrow_global<Pool<CoinA, CoinB>>(pool_owner);
        (coin::value(&pool.reserve_a), coin::value(&pool.reserve_b))
    }
}
```

The `phantom` keyword means the type parameter is only used for type-checking, not stored directly. This prevents the compiler from requiring abilities on the type parameter.

### Events

Aptos uses a module-level event system. Events are emitted during transactions and indexed by fullnodes for frontend consumption:

```move
module my_addr::marketplace {
    use std::string::String;
    use std::signer;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_framework::object::Object;
    use aptos_token_objects::token::Token;

    /// Event structs (emitted, never stored)
    #[event]
    struct ListingCreated has drop, store {
        seller: address,
        token_address: address,
        price: u64,
        listed_at: u64,
    }

    #[event]
    struct ListingPurchased has drop, store {
        buyer: address,
        seller: address,
        token_address: address,
        price: u64,
        purchased_at: u64,
    }

    #[event]
    struct ListingCancelled has drop, store {
        seller: address,
        token_address: address,
        cancelled_at: u64,
    }

    struct Listing has key {
        seller: address,
        price: u64,
        token: Object<Token>,
    }

    /// List an NFT for sale
    public entry fun create_listing(
        seller: &signer,
        token: Object<Token>,
        price: u64,
    ) {
        let seller_addr = signer::address_of(seller);

        // Emit event for indexers
        event::emit(ListingCreated {
            seller: seller_addr,
            token_address: object::object_address(&token),
            price,
            listed_at: timestamp::now_seconds(),
        });

        // ... store listing logic ...
    }

    /// Purchase a listed NFT
    public entry fun purchase(
        buyer: &signer,
        listing_addr: address,
    ) acquires Listing {
        let buyer_addr = signer::address_of(buyer);
        let listing = move_from<Listing>(listing_addr);

        event::emit(ListingPurchased {
            buyer: buyer_addr,
            seller: listing.seller,
            token_address: object::object_address(&listing.token),
            price: listing.price,
            purchased_at: timestamp::now_seconds(),
        });

        // ... transfer token and payment logic ...
        let Listing { seller: _, price: _, token: _ } = listing;
    }
}
```

Query events via the Aptos Indexer API:

```shell
# Query events using the Aptos Indexer GraphQL API
curl -X POST https://indexer-testnet.staging.gcp.aptosdev.com/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { events(where: {type: {_eq: \"0x<your-addr>::marketplace::ListingCreated\"}}, order_by: {transaction_version: desc}, limit: 10) { data transaction_version } }"
  }'
```

### Access Control Patterns

```move
module my_addr::access_control {
    use std::signer;
    use std::vector;

    /// Role-based access control
    struct AdminRegistry has key {
        admins: vector<address>,
        owner: address,
    }

    const E_NOT_OWNER: u64 = 1;
    const E_NOT_ADMIN: u64 = 2;
    const E_ALREADY_ADMIN: u64 = 3;

    /// Initialize with deployer as owner
    fun init_module(deployer: &signer) {
        let owner = signer::address_of(deployer);
        move_to(deployer, AdminRegistry {
            admins: vector[owner],
            owner,
        });
    }

    /// Only owner can add admins
    public entry fun add_admin(
        owner: &signer,
        new_admin: address
    ) acquires AdminRegistry {
        let registry = borrow_global_mut<AdminRegistry>(@my_addr);
        assert!(signer::address_of(owner) == registry.owner, E_NOT_OWNER);
        assert!(!vector::contains(&registry.admins, &new_admin), E_ALREADY_ADMIN);
        vector::push_back(&mut registry.admins, new_admin);
    }

    /// Check if an address is an admin (reusable guard)
    public fun assert_is_admin(addr: address) acquires AdminRegistry {
        let registry = borrow_global<AdminRegistry>(@my_addr);
        assert!(vector::contains(&registry.admins, &addr), E_NOT_ADMIN);
    }

    /// Protected function example
    public entry fun admin_only_action(caller: &signer) acquires AdminRegistry {
        assert_is_admin(signer::address_of(caller));
        // ... privileged logic ...
    }
}
```

### Module Upgrades

Aptos supports module upgrades with compatibility checks:

```move
module my_addr::upgradeable {
    use std::signer;

    /// V1: Original struct
    struct Config has key {
        value: u64,
        // V2 addition: new fields must have default values
        // or be wrapped in Option
    }

    /// Upgrade policy is set at publish time:
    /// - "compatible": new version must be backward-compatible
    ///   (can add functions/structs, cannot remove or change signatures)
    /// - "immutable": no upgrades allowed (default)
    ///
    /// Publish with upgrade support:
    /// aptos move publish --upgrade-policy compatible
}
```

```shell
# First publish (enable upgrades)
aptos move publish \
  --named-addresses my_addr=default \
  --upgrade-policy compatible \
  --assume-yes

# Later: publish an upgraded version
aptos move publish \
  --named-addresses my_addr=default \
  --assume-yes
```

```
Expected output:
{
  "Result": {
    "transaction_hash": "0x...",
    "gas_used": 1876,
    "success": true,
    "vm_status": "Executed successfully"
  }
}
```

Compatibility rules for upgrades:
- Can add new functions, structs, and constants
- Cannot remove existing public functions
- Cannot change function signatures
- Cannot remove or rename struct fields
- Can add new fields to structs (with care)

---

## Common Pitfalls

1. **Losing the SignerCapability** — When creating a resource account, the `SignerCapability` is generated once. If you don't store it in a resource immediately, it's gone forever and the resource account becomes permanently inaccessible. Always store it in `init_module` or the creation function.

2. **Forgetting `phantom` on unused type parameters** — If a generic struct has a type parameter that doesn't appear in any field, you must mark it `phantom`. Without it, the compiler requires the type to have all the struct's abilities, which is usually too restrictive. Example: `struct Pool<phantom CoinType> has key { ... }`.

3. **Not indexing events properly** — Events are emitted but not queryable on-chain. You need the Aptos Indexer (GraphQL API) to query historical events. If your frontend relies on event history, ensure you're querying the indexer, not the fullnode REST API which only returns current state.

4. **Breaking compatibility on module upgrades** — If you publish with `--upgrade-policy compatible` and then try to remove a public function or change a struct layout, the upgrade transaction will abort. Plan your module's public API carefully before the first publish. Internal (`fun`, not `public fun`) functions can be changed freely.

5. **Using `move_to` without checking `exists`** — Calling `move_to` when a resource already exists at that address aborts the transaction. Always guard with `assert!(!exists<MyResource>(addr), E_ALREADY_EXISTS)` before `move_to`. Similarly, `move_from` aborts if the resource doesn't exist.

---

## What to Learn Next

- [Frontend Integration](./07-frontend-integration.md) — Connect your Move modules to a web frontend using the Aptos TypeScript SDK
- [Aptos Object Model](https://aptos.dev/en/build/smart-contracts/objects) — Deep dive into the object framework
- [Aptos Move Framework Source](https://github.com/aptos-labs/aptos-core/tree/main/aptos-move/framework) — Read the framework modules

