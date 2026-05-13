# Token Standards on Sui

**Track:** Sui Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

You want to create fungible tokens and NFTs on Sui, but there's no ERC-20 or ERC-721 equivalent to copy-paste. Sui uses a fundamentally different approach: fungible tokens are `Coin<T>` objects backed by a `TreasuryCap`, NFTs are unique objects with a `Display` standard for metadata rendering, and marketplaces use the `Kiosk` framework for trading. Without understanding these patterns, you'll build tokens that wallets can't display and NFTs that marketplaces can't list.

## Core Concepts

### Fungible Tokens: The Coin Standard

On Sui, fungible tokens use the built-in `sui::coin` module. You don't write your own transfer logic — the framework handles it:

```move
/// Create a custom fungible token called OCEAN.
/// The module name MUST match the witness type name (lowercase).
module ocean::ocean {
    use std::option;
    use sui::coin::{Self, TreasuryCap, Coin};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::url;

    /// One-Time Witness — must match module name in UPPERCASE.
    /// Has only `drop` ability — used once to prove module identity.
    struct OCEAN has drop {}

    /// Module initializer — called exactly once when the package is published.
    /// This is where you create the currency.
    fun init(witness: OCEAN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency<OCEAN>(
            witness,
            9,                                          // decimals (like SUI)
            b"OCEAN",                                   // symbol
            b"Ocean Token",                             // name
            b"A governance token for ocean protocols",  // description
            option::some(url::new_unsafe_from_bytes(
                b"https://example.com/ocean-icon.png"
            )),                                         // icon URL
            ctx,
        );

        // Freeze metadata — makes it immutable and publicly readable
        transfer::public_freeze_object(metadata);

        // Transfer TreasuryCap to deployer — controls minting
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
    }

    /// Mint new tokens. Only the TreasuryCap holder can call this.
    public entry fun mint(
        treasury_cap: &mut TreasuryCap<OCEAN>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let coin = coin::mint(treasury_cap, amount, ctx);
        transfer::public_transfer(coin, recipient);
    }

    /// Burn tokens — permanently removes them from circulation.
    public entry fun burn(
        treasury_cap: &mut TreasuryCap<OCEAN>,
        coin: Coin<OCEAN>,
    ) {
        coin::burn(treasury_cap, coin);
    }
}
```

Key differences from ERC-20:
- No `approve`/`transferFrom` — tokens are objects you pass directly
- No balance mapping — each `Coin<T>` object holds its own balance
- Coins can be split and merged: `coin::split()`, `coin::join()`
- The `TreasuryCap` is the mint authority — whoever holds it can mint

### One-Time Witness Pattern

The `OCEAN has drop {}` struct is a **One-Time Witness (OTW)**. Sui guarantees:
1. It's created exactly once (in the `init` function)
2. It has only the `drop` ability
3. Its name matches the module name in uppercase
4. It proves the caller is the module publisher

This prevents anyone else from creating a fake `OCEAN` currency.

### NFTs: Objects with Display

On Sui, NFTs are just objects. The `Display` standard tells wallets and explorers how to render them:

```move
module nft_collection::warrior_nft {
    use std::string::{Self, String};
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::display;
    use sui::package;
    use sui::event;

    /// One-Time Witness for the NFT package
    struct WARRIOR_NFT has drop {}

    /// The NFT struct — each instance is a unique on-chain object.
    struct WarriorNFT has key, store {
        id: UID,
        name: String,
        description: String,
        image_url: String,
        level: u64,
        power: u64,
    }

    struct NFTMinted has copy, drop {
        object_id: address,
        creator: address,
        name: String,
    }

    /// Initialize the Display template on publish.
    fun init(otw: WARRIOR_NFT, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);

        // Define how wallets/explorers render this NFT type
        let mut display = display::new_with_fields<WarriorNFT>(
            &publisher,
            vector[
                string::utf8(b"name"),
                string::utf8(b"description"),
                string::utf8(b"image_url"),
                string::utf8(b"project_url"),
            ],
            vector[
                // Use {field_name} for template interpolation
                string::utf8(b"{name}"),
                string::utf8(b"{description}"),
                string::utf8(b"{image_url}"),
                string::utf8(b"https://warrior-game.example.com"),
            ],
            ctx,
        );

        display::update_version(&mut display);
        transfer::public_transfer(publisher, tx_context::sender(ctx));
        transfer::public_transfer(display, tx_context::sender(ctx));
    }

    /// Mint a new warrior NFT.
    public entry fun mint(
        name: String,
        description: String,
        image_url: String,
        level: u64,
        power: u64,
        ctx: &mut TxContext,
    ) {
        let nft = WarriorNFT {
            id: object::new(ctx),
            name,
            description,
            image_url,
            level,
            power,
        };

        let sender = tx_context::sender(ctx);

        event::emit(NFTMinted {
            object_id: object::uid_to_address(&nft.id),
            creator: sender,
            name: nft.name,
        });

        transfer::public_transfer(nft, sender);
    }

    /// Level up a warrior (only owner can call — owned object).
    public entry fun level_up(nft: &mut WarriorNFT) {
        nft.level = nft.level + 1;
        nft.power = nft.power + 10;
    }

    /// Burn the NFT.
    public entry fun burn(nft: WarriorNFT) {
        let WarriorNFT { id, name: _, description: _, image_url: _, level: _, power: _ } = nft;
        object::delete(id);
    }
}
```

### The Kiosk Framework

Sui's `Kiosk` is a built-in marketplace primitive for trading NFTs with enforced royalties:

```move
module marketplace::trading {
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::package::Publisher;

    use nft_collection::warrior_nft::WarriorNFT;

    /// Create a kiosk (personal storefront) for the sender.
    public entry fun create_kiosk(ctx: &mut TxContext) {
        let (kiosk, kiosk_cap) = kiosk::new(ctx);
        transfer::public_share_object(kiosk);
        transfer::public_transfer(kiosk_cap, tx_context::sender(ctx));
    }

    /// List an NFT for sale in your kiosk.
    public entry fun list_nft(
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        nft_id: object::ID,
        price: u64,
    ) {
        kiosk::list<WarriorNFT>(kiosk, kiosk_cap, nft_id, price);
    }

    /// Create a transfer policy with royalty rules.
    /// Only the Publisher (package deployer) can create policies.
    public entry fun create_policy(
        publisher: &Publisher,
        ctx: &mut TxContext,
    ) {
        let (policy, policy_cap) = transfer_policy::new<WarriorNFT>(
            publisher,
            ctx,
        );
        transfer::public_share_object(policy);
        transfer::public_transfer(policy_cap, tx_context::sender(ctx));
    }
}
```

The Kiosk framework ensures:
- Creators can enforce royalties on secondary sales
- NFTs can only leave a Kiosk if the transfer policy rules are satisfied
- No one can bypass royalties by direct `transfer::transfer`

### Publishing a Token to Testnet

```shell
# Create the token package — sui-cli@1.15.0
sui move new ocean_token
cd ocean_token

# After writing the module in sources/ocean.move:
sui move build
sui move test

# Publish to testnet
sui client publish --gas-budget 100000000
```

```
Expected output:
Transaction Digest: Abc123...
╭──────────────────────────────────────────────────────────────────────╮
│ Created Objects:                                                      │
│   Package: 0x<package_id>                                            │
│   TreasuryCap<OCEAN>: 0x<treasury_cap_id>                            │
│   CoinMetadata<OCEAN>: 0x<metadata_id>                               │
╰──────────────────────────────────────────────────────────────────────╯
```

```shell
# Mint 1000 OCEAN tokens (with 9 decimals: 1000 * 10^9)
sui client call \
  --package 0x<package_id> \
  --module ocean \
  --function mint \
  --args 0x<treasury_cap_id> 1000000000000 0x<recipient_address> \
  --gas-budget 10000000
```

Faucet for testnet SUI: https://docs.sui.io/guides/developer/getting-started/get-coins

## Common Pitfalls

1. **Module name doesn't match witness type** — If your module is `ocean` but your witness is `MYTOKEN`, the `init` function won't receive the witness. The OTW type name must be the module name in uppercase: module `ocean` → witness `OCEAN`.

2. **Forgetting to freeze CoinMetadata** — If you don't freeze or share the metadata object, wallets can't look up your token's name, symbol, and decimals. Always call `transfer::public_freeze_object(metadata)` in `init`.

3. **Not setting up Display for NFTs** — Without a `Display` object, wallets show your NFT as a raw object with hex fields. Users won't see the name, image, or description. Always create and configure `Display` in your `init` function.

4. **Losing the TreasuryCap** — The `TreasuryCap` controls minting. If you transfer it to a wrong address or destroy it, no one can ever mint more tokens. Consider using a multi-sig address or a governance module to hold it.

## What to Learn Next

- [Sui Move Advanced](./06-sui-move-advanced.md) — Dynamic fields, shared objects, and Programmable Transaction Blocks
- [Sui Coin Standard Docs](https://docs.sui.io/standards/coin) — Official coin standard reference
- [Sui Kiosk Documentation](https://docs.sui.io/standards/kiosk) — Complete Kiosk framework guide
