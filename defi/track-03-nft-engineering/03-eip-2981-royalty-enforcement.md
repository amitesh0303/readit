# EIP-2981 vs Royalty Registries: Enforcing Creator Royalties

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

Royalties were the implicit promise of NFTs: "secondary sales pay the artist forever." For 2017-2022, marketplaces honored that — first informally, then via EIP-2981. Then in late 2022, Blur and Sudoswap broke the model by treating royalties as optional. OpenSea responded by trying to enforce them via blocklists. Then OpenSea also caved. By 2024, royalties on most marketplaces were genuinely optional (buyers could opt out), and most buyers chose to.

The technical problem isn't actually technical. EIP-2981 works fine. The problem is enforcement: an open market can't compel a participant who doesn't want to pay. This lesson covers the standards (EIP-2981, ERC-7572 for collection metadata, the various transfer-blocking schemes) and the political reality of how royalties actually flow in 2026.


---

## Core Concepts

### What EIP-2981 actually does

EIP-2981 standardized one function:

```solidity
interface IERC2981 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external view
        returns (address receiver, uint256 royaltyAmount);
}
```

A marketplace passes the sale price; the contract returns who should be paid and how much. That's it. EIP-2981 is purely *informational* — the standard explicitly does not require enforcement. The marketplace is free to ignore the response.

A typical implementation:

```solidity
contract MyNFT is ERC721, IERC2981 {
    address public royaltyReceiver;
    uint96 public royaltyBps = 500; // 5%

    function royaltyInfo(uint256, uint256 salePrice)
        external view returns (address, uint256)
    {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
```

Per-token overrides are allowed (different royalties for different token IDs), and you can split the royalty across multiple receivers off-chain (a payment splitter contract is a common destination).

### The royalty registry pattern

Most older NFTs (2017-2020 collections) don't implement EIP-2981. To support them, marketplaces queried a separate **royalty registry** — typically Manifold's `RoyaltyEngineV1` — which maintained an off-chain mapping of "this NFT contract → this royalty config" submitted by creators.

The registry becomes the marketplace's source of truth. It's a centralized fix for a missing standard. Manifold's registry is the closest thing to canonical, used by Reservoir, OpenSea, and others as a fallback when EIP-2981 isn't available.

### Transfer-restricted (operator filter) approach

The most aggressive enforcement attempt was OpenSea's **Operator Filter Registry** (early 2023). The idea: NFT contracts could maintain a list of marketplace contracts they'd allow `transferFrom` from. Any marketplace that didn't honor royalties got added to a blocklist; their `transferFrom` calls would revert.

Technically, this works. Politically, it failed:

- It required centralized governance of "which marketplaces are good."
- Sophisticated users routed trades through proxy contracts to bypass the filter.
- OpenSea itself eventually dropped the filter as enforcement (2024) and made royalties optional.

By 2026, very few new collections deploy with operator filters. The exception: top-tier collections with high-volume secondary sales where royalty income is meaningful.

### What actually happens at trade time in 2026

The current state on most marketplaces:

- **EIP-2981** is queried and the suggested royalty is the *default*.
- The buyer (or marketplace UI) can choose to pay 0%, the suggested amount, or anything in between.
- Marketplace fee (typically 0.5-2.5%) is *not* optional — that's the business.
- Some marketplaces have "creator-first" modes that always honor royalties, but these are opt-in lanes.

For new launches that want to enforce royalties, the most practical patterns in 2026:

- **List on royalty-honoring marketplaces only**: Foundation, SuperRare, and certain curated marketplaces still honor full royalties. You document that this is where to trade.
- **Closed/permissioned marketplaces**: include your contract in a curated registry that filters specific malicious operators.
- **Off-chain enforcement via tax-on-airdrop**: only addresses that paid royalties on previous trades qualify for future airdrops or utility. This is the most-aligned-with-incentives approach and is what's quietly common in 2026.

### Splitter contracts for multi-recipient royalties

Real collections often have multiple royalty recipients: the artist, a producer, a charity, an investor. EIP-2981 returns a single `receiver`. The standard solution: that receiver is a **payment splitter contract** that fans out incoming ETH/ERC-20 according to a fixed schedule.

```solidity
// 60% to artist, 30% to producer, 10% to charity
PaymentSplitter splitter = new PaymentSplitter(
    [artist, producer, charity],
    [60, 30, 10]
);
nft.setRoyaltyReceiver(address(splitter));
```

OpenZeppelin's `PaymentSplitter` works for ETH and ERC-20s. For more sophisticated splits (e.g. different splits for primary vs secondary, or a vesting schedule), 0xSplits is the standard third-party contract used in production.

### ERC-7572: collection metadata

Adjacent but worth knowing: ERC-7572 standardizes a `contractURI()` function that returns *collection-level* metadata — collection name, description, banner image, royalty defaults. Marketplaces use this for the collection page (not the individual NFT page). Implementing it correctly means your collection looks polished on first sight in any marketplace, instead of relying on each marketplace to re-enter the data through their own backend.

```solidity
function contractURI() external view returns (string memory) {
    return "ipfs://bafy.../collection.json";
}
```

---

## Code Walkthrough

A complete NFT with EIP-2981, contractURI, and a payment splitter set up correctly:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {PaymentSplitter} from "openzeppelin-contracts/contracts/finance/PaymentSplitter.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract MyCollection is ERC721, ERC2981, Ownable {
    string public contractURIValue;

    constructor(
        address[] memory royaltyRecipients,
        uint256[] memory shares,
        uint96 defaultRoyaltyBps
    ) ERC721("MyCollection", "MC") Ownable(msg.sender) {
        // Deploy a splitter as the royalty receiver
        PaymentSplitter splitter = new PaymentSplitter(royaltyRecipients, shares);
        _setDefaultRoyalty(address(splitter), defaultRoyaltyBps);
    }

    /// Per-token override
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 bps) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, bps);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        contractURIValue = uri;
    }

    function contractURI() external view returns (string memory) {
        return contractURIValue;
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}
```

When OpenSea's indexer crawls this contract:

1. It calls `contractURI()` → fetches collection-level JSON (name, description, banner, default royalty).
2. For each tokenId, it calls `tokenURI(N)` → fetches per-token metadata.
3. On a sale, it calls `royaltyInfo(N, price)` → splits royalty to the PaymentSplitter, which fans out to recipients.

You set everything up once at deploy. Later, individual artists in your splitter list can call `release(token)` to claim their accumulated share.

---

## Common Mistakes and Gotchas

**1. Setting royaltyBps too high**
Anything over 10% is heavily filtered by marketplaces or ignored. Buyers also avoid collections with high royalties. The de facto cap in 2026 is 5-7.5%.

**2. Forgetting `supportsInterface(IERC2981)`**
Marketplaces check `supportsInterface(0x2a55205a)` (the EIP-2981 interface ID) before calling `royaltyInfo`. If you don't return `true`, they assume you don't implement it and fall back to a registry or no royalty.

**3. Royalty recipient is an EOA that gets lost**
The recipient is set at deploy. If it's an EOA whose key is later lost, royalties accumulate at an inaccessible address forever. Use a multisig or splitter contract instead.

**4. Royalty receiver that can't receive ETH**
Some contracts revert on `receive()` (e.g. older proxies). If the marketplace sends royalty as ETH and the receiver reverts, the entire trade can fail. Use a battle-tested splitter or a known-payable receiver.

**5. Per-token royalties that aren't documented**
You can override royalties per token. If you do (e.g. token #1 has a 10% artist cut, the rest 5%), document it publicly. Buyers expect uniform behavior unless told otherwise.

**6. Trusting that marketplaces will enforce**
They won't, in most cases. If your business model depends on royalties from secondary sales, plan accordingly: front-load primary mint pricing, build utility that requires verified ownership history (not just current ownership), or use platforms that enforce.

**7. Mistaking `bps` as percent**
Royalty values are in basis points: 250 = 2.5%, 500 = 5%, 1000 = 10%. Off-by-100 errors here are real. Always test the math.

---

## How This Connects to Production

The royalty story is a useful case study in protocol vs. market: a clean technical standard (EIP-2981) failed to enforce a business norm because the underlying market was permissionless. The 2022-2024 royalty wars produced real dollar transfers — billions of dollars in royalty income that creators *would have received* under the older norms went elsewhere.

What's working in 2026: hybrid approaches. EIP-2981 sets the suggested royalty. Marketplaces that brand themselves as "creator-friendly" honor it. Collections that want enforcement layer additional protection: closed marketplaces, off-chain reputation-gated airdrops, or platforms that bundle royalty into the trade fee structure.

If you're shipping a new NFT, the realistic playbook is: implement EIP-2981 properly, set a reasonable rate, route through a splitter, accept that some volume will trade royalty-free, and build utility that incentivizes royalty-paying buyers in other ways.

---

## What to Learn Next

- **Lazy Minting: Off-Chain Signatures, On-Chain Settlement** — applying signed-order patterns to mints, not just trades.
- **ERC-4907 Rentable NFTs and Other Useful Extensions** — extensions that add real utility to NFTs beyond ownership.
- **Building an NFT Marketplace** (previous lesson) — the marketplace side of this royalty conversation.
