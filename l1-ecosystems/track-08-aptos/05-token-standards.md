# Aptos Token Standards: Legacy Tokens and Digital Assets

**Track:** Aptos Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

Aptos has two token standards and it's confusing which one to use. The original "Aptos Token" (v1) standard is being superseded by the new "Digital Assets" framework built on the Fungible Asset (FA) standard. If you pick the wrong one, you'll build on deprecated infrastructure. This lesson explains both standards, when to use each, and how to create tokens with the current recommended approach.

---

## Core Concepts

### Token Standards Overview

| Feature | Aptos Token v1 (Legacy) | Digital Assets / FA (Current) |
|---------|------------------------|-------------------------------|
| Module location | `0x3::token` | `0x1::fungible_asset`, `0x4::token` |
| Storage model | Token stored in TokenStore | Object-based, stored as resources |
| Fungible tokens | Limited support | First-class via Fungible Asset |
| NFTs | Primary use case | Supported via Digital Assets |
| Composability | Limited | High (object model) |
| Recommended | No (legacy) | Yes (new projects) |

### Legacy Token Standard (v1) — Understanding Only

The v1 standard uses `TokenStore` and `Collection`:

```move
// DO NOT use for new projects — shown for understanding existing code
module 0x3::token {
    struct TokenStore has key {
        tokens: Table<TokenId, Token>,
    }

    struct Token has store {
        id: TokenId,
        amount: u64,
        token_properties: PropertyMap,
    }

    struct TokenId has store, copy, drop {
        token_data_id: TokenDataId,
        property_version: u64,
    }
}
```

If you encounter v1 tokens in existing projects, they use functions like:
- `token::create_collection()`
- `token::create_token_script()`
- `token::transfer()`

### Digital Assets Standard (Current — Use This)

The new standard is built on Aptos's Object model and separates concerns:
- **Objects** (`0x1::object`) — Addressable on-chain entities
- **Fungible Assets** (`0x1::fungible_asset`) — For fungible tokens (like ERC-20)
- **Digital Assets** (`0x4::token`, `0x4::collection`) — For NFTs (like ERC-721)

### Creating a Fungible Token (FA Standard)

```move
module my_addr::my_token {
    use std::string;
    use std::signer;
    use std::option;
    use aptos_framework::object::{Self, Object};
    use aptos_framework::fungible_asset::{Self, MintRef, TransferRef, BurnRef, Metadata};
    use aptos_framework::primary_fungible_store;

    /// Error codes
    const E_NOT_OWNER: u64 = 1;

    /// Store mint/burn/transfer capabilities
    struct ManagedFungibleAsset has key {
        mint_ref: MintRef,
        transfer_ref: TransferRef,
        burn_ref: BurnRef,
    }

    /// Initialize the fungible asset (call once during module publish)
    fun init_module(admin: &signer) {
        let constructor_ref = &object::create_named_object(admin, b"MY_TOKEN");

        // Configure the fungible asset metadata
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            constructor_ref,
            option::some(1_000_000_000_00000000), // max supply: 1B with 8 decimals
            string::utf8(b"My Token"),             // name
            string::utf8(b"MYT"),                  // symbol
            8,                                      // decimals
            string::utf8(b"https://example.com/icon.png"), // icon URI
            string::utf8(b"https://example.com"),          // project URI
        );

        // Store the capabilities for later use
        let mint_ref = fungible_asset::generate_mint_ref(constructor_ref);
        let transfer_ref = fungible_asset::generate_transfer_ref(constructor_ref);
        let burn_ref = fungible_asset::generate_burn_ref(constructor_ref);

        let metadata_signer = &object::generate_signer(constructor_ref);
        move_to(metadata_signer, ManagedFungibleAsset {
            mint_ref,
            transfer_ref,
            burn_ref,
        });
    }

    /// Mint tokens to a recipient
    public entry fun mint(
        admin: &signer,
        to: address,
        amount: u64
    ) acquires ManagedFungibleAsset {
        let admin_addr = signer::address_of(admin);
        // Only the module deployer can mint
        assert!(admin_addr == @my_addr, E_NOT_OWNER);

        let metadata = get_metadata();
        let managed = borrow_global<ManagedFungibleAsset>(object::object_address(&metadata));
        let to_wallet = primary_fungible_store::ensure_primary_store_exists(to, metadata);
        fungible_asset::mint_to(&managed.mint_ref, to_wallet, amount);
    }

    /// Burn tokens from the caller's account
    public entry fun burn(
        account: &signer,
        amount: u64
    ) acquires ManagedFungibleAsset {
        let metadata = get_metadata();
        let managed = borrow_global<ManagedFungibleAsset>(object::object_address(&metadata));
        let from_wallet = primary_fungible_store::primary_store(
            signer::address_of(account),
            metadata
        );
        fungible_asset::burn_from(&managed.burn_ref, from_wallet, amount);
    }

    /// Transfer tokens between accounts
    public entry fun transfer(
        from: &signer,
        to: address,
        amount: u64
    ) {
        let metadata = get_metadata();
        primary_fungible_store::transfer(from, metadata, to, amount);
    }

    /// View function: get balance
    #[view]
    public fun balance(account: address): u64 {
        let metadata = get_metadata();
        primary_fungible_store::balance(account, metadata)
    }

    /// Helper: get the metadata object
    fun get_metadata(): Object<Metadata> {
        let metadata_address = object::create_object_address(&@my_addr, b"MY_TOKEN");
        object::address_to_object<Metadata>(metadata_address)
    }
}
```

### Creating an NFT Collection (Digital Assets)

```move
module my_addr::my_nft {
    use std::string::{Self, String};
    use std::signer;
    use std::option;
    use aptos_framework::object;
    use aptos_token_objects::collection;
    use aptos_token_objects::token::{Self, Token};
    use aptos_token_objects::royalty;

    /// Error codes
    const E_NOT_OWNER: u64 = 1;
    const E_COLLECTION_NOT_FOUND: u64 = 2;

    const COLLECTION_NAME: vector<u8> = b"My NFT Collection";

    /// Create the NFT collection (call once)
    public entry fun create_collection(creator: &signer) {
        let royalty = royalty::create(5, 100, signer::address_of(creator)); // 5% royalty

        collection::create_unlimited_collection(
            creator,
            string::utf8(b"A collection of unique digital assets on Aptos"),
            string::utf8(COLLECTION_NAME),
            option::some(royalty),
            string::utf8(b"https://example.com/collection-metadata.json"),
        );
    }

    /// Mint a new NFT
    public entry fun mint_nft(
        creator: &signer,
        token_name: String,
        token_description: String,
        token_uri: String,
    ) {
        let constructor_ref = token::create_named_token(
            creator,
            string::utf8(COLLECTION_NAME),
            token_description,
            token_name,
            option::none(), // no royalty override (uses collection royalty)
            token_uri,
        );

        // The token is automatically stored in the creator's account
        // Transfer to recipient if needed:
        // let token_signer = object::generate_signer(&constructor_ref);
        // object::transfer(creator, object::object_from_constructor_ref(&constructor_ref), recipient);
        let _ = constructor_ref;
    }

    /// Transfer an NFT to another address
    public entry fun transfer_nft(
        owner: &signer,
        token_obj: object::Object<Token>,
        to: address,
    ) {
        object::transfer(owner, token_obj, to);
    }

    /// View: get collection supply
    #[view]
    public fun collection_supply(creator: address): option::Option<u64> {
        let collection_addr = collection::create_collection_address(
            &creator,
            &string::utf8(COLLECTION_NAME)
        );
        let collection_obj = object::address_to_object<collection::Collection>(collection_addr);
        collection::count(collection_obj)
    }
}
```

### Deploying Your Token

```shell
# Fund account for deployment
aptos account fund-with-faucet --account default --amount 200000000
```

Faucet: https://aptos.dev/en/network/faucet

```shell
# Compile
aptos move compile --named-addresses my_addr=default

# Publish
aptos move publish --named-addresses my_addr=default --assume-yes
```

```
Expected output:
{
  "Result": {
    "transaction_hash": "0x...",
    "gas_used": 2156,
    "success": true,
    "vm_status": "Executed successfully"
  }
}
```

```shell
# Mint tokens to yourself
aptos move run \
  --function-id default::my_token::mint \
  --args address:default u64:100000000000 \
  --assume-yes

# Check balance
aptos move view \
  --function-id default::my_token::balance \
  --args address:<your-address>
```

```
Expected output:
{
  "Result": [
    "100000000000"
  ]
}
```

---

## Common Pitfalls

1. **Using the legacy Token v1 standard for new projects** — The v1 standard (`0x3::token`) is deprecated. All new fungible tokens should use the Fungible Asset standard (`0x1::fungible_asset`) and NFTs should use Digital Assets (`0x4::token`). Existing v1 tokens still work but won't receive new features.

2. **Forgetting `primary_fungible_store::create_primary_store_enabled_fungible_asset`** — If you use `fungible_asset::add_fungibility` directly without enabling primary stores, users won't be able to receive tokens without first creating a store manually. Always use the primary store variant for user-facing tokens.

3. **Not storing MintRef/BurnRef/TransferRef** — These capability references are generated during `init_module` and cannot be recreated later. If you don't store them in a resource, you permanently lose the ability to mint, burn, or force-transfer tokens. Store them in a resource at the metadata object's address.

4. **Confusing object addresses with account addresses** — In the Digital Assets standard, tokens and collections are objects with their own addresses (derived deterministically). When querying, you need the object address, not the creator's address. Use `object::create_object_address()` to compute it.

5. **Setting wrong decimals** — Aptos convention is 8 decimals for fungible tokens (matching APT itself). If you set 18 decimals (Ethereum convention), your token amounts will look strange in Aptos wallets and explorers that expect 8 decimals.

---

## What to Learn Next

- [Move Advanced Patterns](./06-move-advanced-patterns.md) — Resource accounts, generics, events, and advanced Move patterns
- [Aptos Fungible Asset Standard](https://aptos.dev/en/build/smart-contracts/fungible-asset) — Official FA documentation
- [Aptos Digital Assets](https://github.com/aptos-labs/aptos-core/tree/main/aptos-move/framework/aptos-token-objects) — Token objects framework source

