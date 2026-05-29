# ERC-4907 Rentable NFTs and Other Useful Extensions

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

ERC-721 has one notion of "ownership": one address holds the token. That's enough for basic collectibles, but real applications want more nuance. A landlord owns the building; the renter has the keys for a year. A guild owns the in-game weapon; a player wields it for a tournament. A founder owns the membership pass; a delegate votes with it. None of these fit cleanly into "the address that holds the token."

ERC-4907 (rentable NFTs) and a handful of related extensions — ERC-5006 for ERC-1155 rentals, ERC-6551 token-bound accounts, ERC-7160 multi-metadata — solve specific facets of this. They're all small, additive standards on top of ERC-721. This lesson covers when to use which and what they look like in code.


---

## Core Concepts

### ERC-4907: dual-role NFTs

ERC-4907 adds a second role to ERC-721: alongside the **owner**, there's a **user**. The user is a separate address that has a time-bounded role on the token, controlled by the owner.

```solidity
interface IERC4907 {
    event UpdateUser(uint256 indexed tokenId, address indexed user, uint64 expires);
    function setUser(uint256 tokenId, address user, uint64 expires) external;
    function userOf(uint256 tokenId) external view returns (address);
    function userExpires(uint256 tokenId) external view returns (uint256);
}
```

When the expiry timestamp passes, `userOf(tokenId)` returns `address(0)` again. The user role auto-resets without anyone needing to call a function.

This is the right abstraction for:

- **Game item rentals**: I own the legendary sword (the NFT), I rent it to you for a week (you're the `user`).
- **Membership pass delegation**: I own a Premium NFT pass, I delegate `user` rights to my partner.
- **Domain leasing**: I own the ENS-like NFT for the next 10 years, I sublet for the next month.

The contract's app logic checks `userOf(tokenId)` instead of `ownerOf(tokenId)` for "who can use this right now." Ownership transfer (selling the NFT) is unaffected — the new owner inherits any active `user` assignment until it expires.

### Implementation

```solidity
contract ERC4907NFT is ERC721, IERC4907 {
    struct UserInfo {
        address user;
        uint64 expires;
    }
    mapping(uint256 => UserInfo) internal _users;

    function setUser(uint256 tokenId, address user, uint64 expires) external override {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        _users[tokenId] = UserInfo(user, expires);
        emit UpdateUser(tokenId, user, expires);
    }

    function userOf(uint256 tokenId) public view override returns (address) {
        UserInfo memory info = _users[tokenId];
        if (info.expires < block.timestamp) return address(0);
        return info.user;
    }

    function userExpires(uint256 tokenId) public view override returns (uint256) {
        return _users[tokenId].expires;
    }

    /// Reset the user role on transfer (or carry it through, depending on intent)
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = super._update(to, tokenId, auth);
        if (from != to && _users[tokenId].user != address(0)) {
            delete _users[tokenId];
            emit UpdateUser(tokenId, address(0), 0);
        }
        return from;
    }
}
```

The decision to clear `_users` on transfer vs. preserve it is a design choice. Clearing is the spec-suggested default — prevents the renter from being surprised by a new owner who doesn't honor the rental. Preserving makes the rental a proper encumbrance that survives sale.

### ERC-6551: token-bound accounts

A different problem: NFTs that *own things*. A character NFT in a game should be able to hold the sword NFT, the shield NFT, and a balance of the in-game token. Without something like ERC-6551, you'd have to track this off-chain.

ERC-6551 standardizes a registry that lets you compute a smart-account address for any (chain, contract, tokenId) tuple:

```
account = registry.account(implementation, chainId, tokenAddress, tokenId, salt)
```

That account is a smart contract account — controlled by whoever currently owns the NFT. The character NFT's account can hold ERC-20s, ERC-721s, anything. When the character is sold, control of the account transfers automatically to the new NFT owner because the account's `executeCall` checks `ownerOf(tokenId) == msg.sender`.

```solidity
contract TokenBoundAccount {
    function executeCall(address to, uint256 value, bytes calldata data)
        external returns (bytes memory)
    {
        require(_isOwner(msg.sender), "not authorized");
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        require(ok, "call failed");
        return ret;
    }

    function _isOwner(address who) internal view returns (bool) {
        // Decode (chainId, tokenAddress, tokenId) from the deployed bytecode
        (, address tokenContract, uint256 tokenId) = _context();
        return IERC721(tokenContract).ownerOf(tokenId) == who;
    }
}
```

Used in production for: gaming inventories (Open Wonders, Treasure DAO), memberships that accumulate sub-assets, NFTs as autonomous wallets (Privy's character profiles).

### ERC-7160: multi-metadata NFTs

A standard for NFTs that have multiple metadata URIs and can switch between them. Use case: a collectible that has different "skins" or that adapts to context.

```solidity
interface IERC7160 {
    function tokenURIs(uint256 tokenId) external view returns (uint256 index, string[] memory uris);
    function setActiveURI(uint256 tokenId, uint256 index) external;
}
```

The owner picks which metadata is "active" — that's what marketplaces show as `tokenURI`. But all the alternates are stored alongside, so a buyer knows the full set of skins available.

### ERC-2309: batch transfers

Not a new role, but a mint optimization. ERC-721 emits one `Transfer` event per token. For mass mints, that's expensive in gas (10k tokens = 10k events). ERC-2309 adds a `ConsecutiveTransfer(fromTokenId, toTokenId, from, to)` event that represents a range. Indexers update accordingly.

ERC-721A (Azuki's gas-optimized variant) effectively shipped this pattern years ago and is still common. ERC-2309 is the formalized standard. If you're doing a 10k-supply launch with sequential IDs, this saves real money.

---

## Code Walkthrough

A complete game item using ERC-4907 + ERC-6551, illustrating the two extensions composing:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC4907} from "./interfaces/IERC4907.sol";

contract GameItem is ERC721, IERC4907 {
    struct UserInfo { address user; uint64 expires; }
    mapping(uint256 => UserInfo) internal _users;

    constructor() ERC721("GameItem", "GI") {}

    function mint(address to, uint256 id) external { _mint(to, id); }

    function setUser(uint256 tokenId, address user, uint64 expires) external override {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        _users[tokenId] = UserInfo(user, expires);
        emit UpdateUser(tokenId, user, expires);
    }

    function userOf(uint256 tokenId) public view override returns (address) {
        UserInfo memory u = _users[tokenId];
        return u.expires >= block.timestamp ? u.user : address(0);
    }

    function userExpires(uint256 tokenId) public view override returns (uint256) {
        return _users[tokenId].expires;
    }
}

/// In-game contract that uses the rentable NFT
contract Tournament {
    GameItem public item;

    function attack(uint256 itemId, address target) external {
        // Use the active "user" (renter or owner)
        address wielder = item.userOf(itemId);
        if (wielder == address(0)) wielder = item.ownerOf(itemId);
        require(wielder == msg.sender, "not your item");
        // ... apply attack with this item's stats ...
    }
}
```

Now Alice can rent her sword to Bob for 24h:

```solidity
gameItem.setUser(swordId, bob, uint64(block.timestamp + 24 hours));
```

Bob can use the sword in the tournament. After 24h, control reverts to Alice automatically — no transaction needed.

---

## Common Mistakes and Gotchas

**1. App logic checking `ownerOf` when it should check `userOf`**
This is the #1 ERC-4907 bug. The whole point is that the *user*, not the owner, is the active party. Audit every place in your app contract that reads `ownerOf(tokenId)` for permission checks. If it's about "who can use this right now," it should be `userOf(tokenId)`.

**2. Forgetting to clear the user role on transfer**
If you carry the `_users` info through `_update`, a buyer of the NFT inherits a renter — possibly without realizing it. Either clear the user on transfer (default) or document the encumbrance loudly.

**3. Trusting `userExpires` for important state changes**
The expiry is enforced *only when read*. There's no on-chain event for "user expired." If your app needs to do something at expiry (refund a deposit, reset stats), schedule it off-chain — via your indexer or a keeper bot.

**4. ERC-6551 ownership confusion**
The token-bound account is owned by whoever currently holds the NFT. Selling the NFT transfers ownership of the account *and everything in it*. This is intentional — but not what every user expects. Document clearly that selling the parent NFT sells the contents.

**5. Token-bound accounts holding malicious approvals**
If the NFT's account previously approved some address to spend its tokens, that approval persists across NFT transfers. The new NFT owner inherits the approvals. Always revoke approvals before transferring an NFT whose account holds value.

**6. Mixing ERC-2309 and ERC-721 events on a single contract**
Indexers (subgraphs, OpenSea, Moralis) handle one event style consistently. If your contract emits both `Transfer` events and `ConsecutiveTransfer` events for different mints, some indexers will mis-track. Pick one style per contract.

**7. Using rentable NFTs without enforcement at the marketplace level**
Marketplaces don't always know about ERC-4907. A renter might list and sell the *NFT itself*, not realizing the lease was supposed to encumber it. If your model needs the lease to survive sale, your contract must clear `_users` on listing approval, or your marketplace must respect the lease.

---

## How This Connects to Production

ERC-4907 has real adoption: Double Protocol, reNFT, IQ Protocol all built rental marketplaces on top of it. Apes Renting (a BAYC-focused service) used it for short-term rentals tied to airdrops. Game-specific rentals (Yield Guild Games' scholar/owner split, Axie Infinity's rental model) all rely on the role-split idea, even when the implementation differs from the formal spec.

ERC-6551 has gone from spec to widely-deployed in 2024-2026. Token-bound accounts power the inventory model in most modern onchain games. They're also being used for "smart NFTs" — pictures that earn yield, characters that vote, pass NFTs that hold premium content keys.

The takeaway: ERC-721 is the floor. The interesting product surface is in extensions like these, which add real composability to NFTs without breaking compatibility.

---

## What to Learn Next

- **Soulbound Tokens and ERC-5192 Non-Transferable NFTs** — the opposite design direction: NFTs that *can't* move.
- **Generative NFT Art: On-Chain SVGs and Reveal Mechanics** — fully-on-chain art and the contracts that generate it.
- **Web3 Frontend Engineering** (separate track) — how to render and interact with these extended NFTs in your dApp UI.
