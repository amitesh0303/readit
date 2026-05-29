# Building an NFT Marketplace: Listings, Bids, and Settlement

**Track:** Intermediate
**Read time:** 10 min

---

## The Problem

You can build an NFT marketplace in two ways. The naive way: every listing is an on-chain transaction, every bid is an on-chain transaction. This works, but every action costs gas. Listing 100 NFTs costs 100 gas fees. Updating a price means a new tx. Cancelling a bid is another tx. The user economics fall apart fast.

The way every real marketplace (OpenSea's Seaport, Blur, LooksRare, Reservoir) actually works: **listings and bids are off-chain signed messages**. Only the final trade — the settlement — touches the chain. That's why you can list an NFT for free and only pay gas when it actually sells. This lesson is how that pattern works under the hood.


---

## Core Concepts

### The off-chain order, on-chain settlement model

The pattern:

1. **Seller** signs a message: "I'll sell tokenId T for price P, valid until time E."
2. The signed order goes to a centralized orderbook (the marketplace's API), where buyers can browse it.
3. **Buyer** sees the listing, calls a contract function with: the order data + the seller's signature + their own payment.
4. **Contract** verifies the signature, transfers the NFT from seller to buyer, transfers ETH/USDC from buyer to seller, takes fees and royalties.

The key insight: the seller never paid gas. Their signature is the only artifact. The marketplace contract has been pre-approved by the seller (one-time `setApprovalForAll`) so it can move their NFT when settling.

### EIP-712 typed signatures

You don't sign raw JSON. You sign an **EIP-712 typed structured message** — a typed schema that wallets can render in plain English. The wallet shows:

```
You are signing a Listing for:
  Token: 0xBAYC #1234
  Price: 50 ETH
  Expires: Jan 15, 2026 5:00 PM
```

Not a hex blob. This is critical for security — users actually understand what they're signing.

The typed schema:

```typescript
const domain = {
  name: "MyMarketplace",
  version: "1",
  chainId: 1,
  verifyingContract: MARKETPLACE_ADDRESS,
};

const types = {
  Listing: [
    { name: "seller", type: "address" },
    { name: "nft", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "currency", type: "address" }, // address(0) for native
    { name: "deadline", type: "uint256" },
    { name: "salt", type: "uint256" },
  ],
};
```

The `salt` is a per-listing nonce — it makes order hashes unique even if you list the same token at the same price twice.

### The order hash and replay prevention

Each listing has a unique hash derived from its fields plus the EIP-712 domain. The marketplace contract maintains a `mapping(bytes32 => bool)` of cancelled or filled order hashes. Once an order hash is in that mapping, it can't be filled again.

```solidity
mapping(bytes32 => bool) public orderFilled;
mapping(bytes32 => bool) public orderCancelled;

function fulfill(Listing calldata l, bytes calldata sig) external payable {
    bytes32 orderHash = _hashListing(l);
    require(!orderFilled[orderHash], "filled");
    require(!orderCancelled[orderHash], "cancelled");
    require(block.timestamp <= l.deadline, "expired");
    require(_recover(orderHash, sig) == l.seller, "bad sig");
    orderFilled[orderHash] = true;
    // ... transfer NFT, transfer payment ...
}
```

Cancellation is a separate function the seller calls to mark an order hash as cancelled — a small on-chain action only when needed.

### Bids: same pattern, reversed

Bids are listings in reverse:

- The **buyer** signs: "I'll buy tokenId T for P USDC, valid until E."
- The bid sits in the orderbook.
- The **seller** sees a bid they like, calls `fulfillBid(bid, sig)` with the signature.
- Contract pulls USDC from buyer, transfers NFT from seller.

This requires the buyer to have pre-approved the marketplace contract for USDC (`approve(marketplace, MAX_UINT)`), so it can pull funds when settling. Same `setApprovalForAll` pattern as the seller side, just for the payment token.

**Collection-wide bids** ("I'll pay 30 ETH for any BAYC under #1000") are common. The buyer signs an order that doesn't specify a tokenId — instead it specifies a constraint (e.g. "any tokenId from this collection in range [0, 1000]"). The seller picks which of their tokens to sell against the bid. This adds a `tokenId` parameter to the fulfillment call that the buyer doesn't pre-commit.

### Royalties and fees during settlement

The settlement step does the math:

```
buyerPays = listing.price
sellerReceives = listing.price - (price * marketplaceFee / 10000) - (price * royaltyBps / 10000)
marketplace.balance += marketplaceFee
royaltyRecipient.balance += royaltyAmount
seller.balance += sellerReceives
```

For royalties, the marketplace queries the NFT contract via EIP-2981's `royaltyInfo(tokenId, salePrice)`, which returns `(receiver, amount)`. If the contract doesn't implement EIP-2981 (older NFTs), the marketplace falls back to its own royalty registry or pays no royalty.

We cover EIP-2981 in detail in the next lesson.

### Bulk operations

Power users want to list 50 NFTs in one click. Two approaches:

**1. One signature per listing**: the wallet signs 50 separate EIP-712 messages. Slow UX (50 wallet popups) but always supported.

**2. Merkle-tree listings**: the user signs one message containing the merkle root of all 50 listings. Each listing fills with a merkle proof showing it was part of the signed root. One signature, 50 fillable orders. This is what Seaport's "advanced" orders enable.

Same trick for cancellation: cancel a whole tree of orders by incrementing a per-user nonce, invalidating all signatures bound to it.

---

## Code Walkthrough

A minimal marketplace contract with EIP-712 listings, royalty support, and cancellation:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "openzeppelin-contracts/contracts/interfaces/IERC2981.sol";

contract Marketplace is EIP712 {
    using ECDSA for bytes32;

    struct Listing {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 price;       // wei
        uint256 deadline;
        uint256 salt;
    }

    bytes32 private constant LISTING_TYPEHASH = keccak256(
        "Listing(address seller,address nft,uint256 tokenId,uint256 price,uint256 deadline,uint256 salt)"
    );

    address public feeRecipient;
    uint16 public feeBps = 250;

    mapping(bytes32 => bool) public consumed;

    event Sold(bytes32 indexed orderHash, address seller, address buyer, uint256 price);
    event Cancelled(bytes32 indexed orderHash);

    constructor(address _fee) EIP712("Marketplace", "1") {
        feeRecipient = _fee;
    }

    function fulfill(Listing calldata l, bytes calldata sig) external payable {
        require(msg.value == l.price, "wrong amount");
        require(block.timestamp <= l.deadline, "expired");

        bytes32 orderHash = _orderHash(l);
        require(!consumed[orderHash], "consumed");
        consumed[orderHash] = true;

        require(_hashTypedDataV4(orderHash).recover(sig) == l.seller, "bad sig");

        // Calculate fees and royalties
        uint256 marketplaceFee = (l.price * feeBps) / 10000;
        (address royaltyRecipient, uint256 royaltyAmount) =
            _getRoyalty(l.nft, l.tokenId, l.price);

        uint256 sellerProceeds = l.price - marketplaceFee - royaltyAmount;

        // Distribute funds
        (bool ok1, ) = feeRecipient.call{value: marketplaceFee}("");
        require(ok1, "fee xfer failed");
        if (royaltyAmount > 0) {
            (bool ok2, ) = royaltyRecipient.call{value: royaltyAmount}("");
            require(ok2, "royalty xfer failed");
        }
        (bool ok3, ) = l.seller.call{value: sellerProceeds}("");
        require(ok3, "seller xfer failed");

        // Transfer NFT (requires seller to have pre-approved this contract)
        IERC721(l.nft).transferFrom(l.seller, msg.sender, l.tokenId);

        emit Sold(orderHash, l.seller, msg.sender, l.price);
    }

    function cancel(Listing calldata l) external {
        require(msg.sender == l.seller, "not seller");
        bytes32 orderHash = _orderHash(l);
        consumed[orderHash] = true;
        emit Cancelled(orderHash);
    }

    function _orderHash(Listing calldata l) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            LISTING_TYPEHASH, l.seller, l.nft, l.tokenId, l.price, l.deadline, l.salt
        ));
    }

    function _getRoyalty(address nft, uint256 tokenId, uint256 price)
        internal view returns (address, uint256)
    {
        try IERC2981(nft).royaltyInfo(tokenId, price) returns (address r, uint256 a) {
            return (r, a);
        } catch {
            return (address(0), 0);
        }
    }
}
```

Frontend with viem to sign a listing:

```typescript
import { createWalletClient, custom } from "viem";

async function listNFT(nft: string, tokenId: bigint, priceWei: bigint) {
  const client = createWalletClient({ transport: custom(window.ethereum!) });
  const [seller] = await client.requestAddresses();

  const listing = {
    seller,
    nft,
    tokenId,
    price: priceWei,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600),
    salt: BigInt(`0x${crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`),
  };

  const signature = await client.signTypedData({
    account: seller,
    domain: {
      name: "Marketplace",
      version: "1",
      chainId: 1,
      verifyingContract: MARKETPLACE_ADDRESS,
    },
    types: {
      Listing: [
        { name: "seller", type: "address" },
        { name: "nft", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "price", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "salt", type: "uint256" },
      ],
    },
    primaryType: "Listing",
    message: listing,
  });

  // POST to your marketplace API to publish in the orderbook
  await fetch("/api/listings", {
    method: "POST",
    body: JSON.stringify({ listing, signature }),
  });
}
```

The user signs once (with a Face ID-style typed-data popup, no gas) and the listing goes live. They can change their mind any time by either signing a cancellation (in some marketplaces) or just incrementing a nonce that invalidates pending signatures.

---

## Common Mistakes and Gotchas

**1. Missing chainId in the EIP-712 domain**
Without chainId, a signature valid on testnet is also valid on mainnet. Real attacks have happened from this. Always include chainId in the domain.

**2. Trusting the orderbook to enforce expiry**
Your contract must check `block.timestamp <= deadline`. Don't rely on the marketplace API hiding expired orders — anyone can submit an old signed order to your contract directly.

**3. Forgetting `setApprovalForAll` UX**
Users must approve the marketplace contract before listing. If you don't surface this clearly in your UI, they sign listings that can never settle. Show "approve marketplace" as an explicit pre-step with a clear explanation.

**4. Not handling royalty calls that revert**
Some NFT contracts have buggy `royaltyInfo` that reverts. Your settlement function must `try/catch` so a malformed royalty doesn't brick the trade. Either skip royalties or fall back to a registry.

**5. Reentrancy on settlement**
You're transferring ETH to seller, royaltyRecipient, and feeRecipient. Each is a `.call` to an arbitrary address. Mark `consumed[orderHash] = true` BEFORE the external calls (CEI pattern). Better yet, use `nonReentrant`.

**6. Bid on a token that the seller already moved**
The seller signed a bid for tokenId T. Between bid and fulfill, they sold T elsewhere. Your fulfill should fail gracefully when `transferFrom` reverts; the order hash should NOT be marked consumed (so the seller can fulfill once they re-acquire). Or accept that consumed-but-failed leaves the order dead — depends on your design.

**7. Front-running listings**
A new low listing appears in the orderbook. Bots fill it instantly. Mitigations: require the marketplace API to authenticate the buyer before serving the order, use private mempool submissions for high-value fills, accept that this is a structural property of public orderbooks.

**8. Price precision**
Prices in `uint256` are wei. UI displays in ETH. Off-by-18-decimals bugs are real. Always test with edge values (very small, very large, with cents).

---

## How This Connects to Production

Seaport (OpenSea), Reservoir (cross-marketplace aggregator), Blur, LooksRare V2, Sudoswap (for AMM-style NFT pools), Magic Eden (for cross-chain) — all use variants of the off-chain order pattern. The differences are in: how merkle-tree orders are encoded, how royalty enforcement is handled (most are now optional), what private mempool integrations exist, and how cross-collection orders are constructed.

The single biggest architectural takeaway: **gas-less listings are the user expectation**. Any marketplace that charges to list is structurally disadvantaged. The infrastructure to make this work — orderbook APIs, EIP-712 schemas, settlement contracts — is the entire engineering effort. The "trade" itself is a few lines of code.

---

## What to Learn Next

- **EIP-2981 vs Royalty Registries** — how royalty enforcement actually works (or doesn't) in 2026.
- **Lazy Minting: Off-Chain Signatures, On-Chain Settlement** — applying the same off-chain-signed pattern to mints, not just trades.
- **Web3 Backend Engineering** (separate track) — what an orderbook API looks like in production.
