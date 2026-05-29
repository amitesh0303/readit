# Soulbound Tokens and ERC-5192 Non-Transferable NFTs

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

Most things you'd encode as on-chain identity *shouldn't* be transferable. Your KYC verification, your event attendance, your contributor history, your educational credentials, your DAO membership badges — these are about *you*, and being able to sell them defeats the purpose. Your medical license is meaningless if anyone can buy it.

But ERC-721 makes everything transferable by default. "Soulbound" tokens (a Vitalik coinage from 2022) are NFTs that intentionally can't move. ERC-5192 standardized the marker so marketplaces can show them correctly. This lesson covers when to use them, the design choices around partial transferability, and how to implement them without footguns.


---

## Core Concepts

### ERC-5192: just a marker

ERC-5192 is one of the smallest standards in the ecosystem. It adds two functions:

```solidity
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}
```

That's the entire spec. A "locked" token is non-transferable; an "unlocked" one behaves normally. The standard doesn't dictate *how* you enforce the lock — just that you advertise it via the function and event so marketplaces can hide the "Sell" button on locked tokens.

The actual enforcement is in your contract's transfer hook:

```solidity
function _update(address to, uint256 tokenId, address auth)
    internal override returns (address)
{
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0)) {
        // Block all transfers if locked
        require(!_locked[tokenId], "soulbound");
    }
    return super._update(to, tokenId, auth);
}
```

The `from != address(0) && to != address(0)` check is important: it allows minting (`from == 0`) and burning (`to == 0`) to still work. The token can be issued and revoked; it just can't move sideways.

### Why not ERC-1238?

ERC-1238 ("badges") was an earlier non-transferable token spec. It diverged enough from ERC-721 that wallets and marketplaces couldn't treat it as an NFT. ERC-5192 is the pragmatic compromise: keep all the ERC-721 surface that wallets understand, just *advertise* the lock. Almost all production soulbound implementations use ERC-5192 (or just custom contracts that extend ERC-721 with non-transferability) rather than ERC-1238.

### The revocation problem

Soulbound tokens raise a question the standard punts on: *who can revoke the token?*

If the issuer can burn at will, the token isn't really "yours" — it's a license the issuer can rescind. That's fine for some use cases (revoking a fired employee's access badge) and wrong for others (revoking a graduate's diploma).

Common revocation models:

- **Issuer-revocable**: only the issuer can burn.
- **User-revocable**: only the holder can burn (e.g. they're rejecting a credential they don't want).
- **Both-revocable**: either side can burn.
- **Time-bounded**: the token has an expiry and is automatically invalid after a date.
- **Non-revocable**: nobody can burn — the on-chain history is permanent.

Each model has trade-offs. Document yours clearly. Most real implementations are issuer-revocable with a time bound (e.g. "this attestation expires in 1 year unless renewed").

### Account-bound vs token-bound

A subtle distinction that comes up:

- **Account-bound**: the token is bound to one address. Even within the issuer's authority, it can't move to another address. If the user loses their key, the token is gone.
- **Token-bound** (with delegation): the token's *control* can be moved via attestation flows or recovery mechanisms, but the on-chain balance stays put. Used in identity systems where you don't want a single key loss to nuke a person's lifetime credentials.

Production identity systems (Worldcoin's PoH, Gitcoin Passport's stamps, the various KYC providers) lean toward delegation models. They issue tokens to a user's "soul" address and let recovery flows update which key controls that soul address — without changing the token's `ownerOf`.

### Pairing with attestations

Soulbound tokens are often *summaries* of underlying attestations. The granular data — "Alice attended ETH Denver 2025" — is signed by the issuer as an EAS (Ethereum Attestation Service) attestation. The token is a thin on-chain marker pointing at that attestation, with the attestation providing the rich detail.

This split lets you put cheap on-chain markers on user accounts (one transfer-blocked NFT per credential) while keeping the verifiable data off-chain (the attestation). It scales better than putting full credential data in storage.

---

## Code Walkthrough

A complete attestation/credential token with revocation, time-bound expiry, and ERC-5192:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

contract Credential is ERC721, IERC5192, Ownable {
    struct CredentialData {
        uint64 issuedAt;
        uint64 expiresAt;
        bool revoked;
        bytes32 attestationUID; // pointer to off-chain attestation
    }

    mapping(uint256 => CredentialData) public credentials;
    uint256 public nextId;

    constructor() ERC721("Credential", "CRED") Ownable(msg.sender) {}

    function issue(address to, uint64 expiresAt, bytes32 attestationUID)
        external onlyOwner returns (uint256)
    {
        uint256 id = ++nextId;
        credentials[id] = CredentialData({
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false,
            attestationUID: attestationUID
        });
        _mint(to, id);
        emit Locked(id);
        return id;
    }

    function revoke(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "no token");
        credentials[tokenId].revoked = true;
        _burn(tokenId);
    }

    function locked(uint256) public pure override returns (bool) {
        return true; // every credential is non-transferable
    }

    /// Block transfers; allow mint and burn
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert("soulbound");
        return super._update(to, tokenId, auth);
    }

    /// A credential is "valid" if it exists, isn't revoked, and isn't expired
    function isValid(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        CredentialData memory c = credentials[tokenId];
        if (c.revoked) return false;
        if (c.expiresAt > 0 && block.timestamp > c.expiresAt) return false;
        return true;
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == type(IERC5192).interfaceId || super.supportsInterface(id);
    }
}
```

The complete pattern: every token is locked from creation, only the issuer can burn, and a separate `isValid()` view layers expiry and revocation on top of "the token still exists." Apps that gate access on a credential should call `isValid` (not just `balanceOf > 0`).

---

## Common Mistakes and Gotchas

**1. Using `transferFrom` denial as the only block**
Some implementations only revert in `transferFrom` but leave `_safeMint` and direct internal hooks unchecked. The clean way is to override `_update` (or `_beforeTokenTransfer` in older OZ versions) once, in one place.

**2. Marketplaces showing soulbound tokens as listable**
If you don't implement ERC-5192's `locked()` and emit `Locked` events, OpenSea and other marketplaces won't know to hide the "Sell" button. Users see a sell flow that always reverts. Always implement the marker.

**3. Forgetting to handle approvals**
`approve` and `setApprovalForAll` shouldn't even succeed for soulbound tokens — there's no transfer to approve. Override them to revert, or at minimum to be no-ops.

**4. Allowing minting to a contract that doesn't expect them**
`_safeMint` calls `onERC721Received` on the recipient, which is fine for most contracts. But if you're issuing credentials to user-controlled addresses, prefer `_mint` (no callback) — it avoids edge cases with smart contract wallets that don't implement the receiver hook.

**5. Storing credential PII on-chain**
Don't put names, emails, or any personal data on-chain. Even hashed PII is increasingly considered personal data under various privacy regimes. Use the EAS attestation pointer pattern: the on-chain token references an off-chain (or encrypted) attestation.

**6. No expiry on long-lived credentials**
A KYC verification from 2020 is meaningless in 2026. Either set explicit expiry or make renewal part of the protocol. Forever-credentials become forever-stale.

**7. Revocation that doesn't propagate**
If your app caches credential validity (e.g. "Alice has the verified-account NFT"), revocation only changes on-chain state. The app's cache will keep returning "valid" until refreshed. Build cache invalidation into your event-driven layer.

**8. Mass-issuing soulbound tokens to users who didn't ask**
Forced airdrops of soulbound tokens are particularly annoying — the user can't even sell them away. Some chains have anti-spam mechanisms; respect user choice and have an opt-in flow.

---

## How This Connects to Production

Production uses of ERC-5192 / soulbound include: Gitcoin Passport (stamps as soulbound credentials), POAP (event attendance, technically transferable but spiritually soulbound), Lens Protocol's profiles (originally transferable, partially soulbound now), Friend.tech-style social tokens with restrictions, and most "verified human" flows from Worldcoin and similar.

The Ethereum Attestation Service (EAS) has emerged as the layer you should reach for *before* deploying a custom soulbound NFT. EAS gives you signed attestations with revocation and expiry built-in, no contract deployment required. For most credential use cases, an EAS attestation is enough; the soulbound NFT is for cases where you need an on-chain "you have it" check that's cheap to read in smart contracts.

Choose accordingly: EAS for off-chain proof, soulbound NFT for on-chain gating.

---

## What to Learn Next

- **Generative NFT Art: On-Chain SVGs and Reveal Mechanics** — the opposite end of the NFT spectrum: art that lives entirely in the contract.
- **The Graph & Subgraph Development** (separate track) — indexing soulbound credential issuance and revocation across many issuers.
- **Account Abstraction & Smart Wallets** (separate track) — soulbound tokens pair powerfully with smart accounts: a credential bound to your AA wallet survives owner-key rotation.
