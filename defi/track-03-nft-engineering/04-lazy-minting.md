# Lazy Minting: Off-Chain Signatures, On-Chain Settlement

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

A 10,000-piece NFT collection deployed the traditional way: artist mints all 10,000 tokens up-front, paying gas for each. At even modest gas prices that's hundreds of dollars (or thousands during congestion), and most of the tokens never sell. The artist eats the gas for 9,000 unsold pieces.

Lazy minting flips it: the NFT *exists* (cryptographically) before being minted on-chain. The artist signs a permission slip ("user X may mint tokenId Y for price Z"). The mint only happens when a buyer actually pays — and they pay the gas. The artist's upfront cost is zero. This is how every modern open-edition mint, allowlist drop, and platform like OpenSea Studio actually works.


---

## Core Concepts

### The voucher pattern

The artist signs an EIP-712 typed message — a "voucher" — describing a token that doesn't exist on-chain yet:

```
Voucher {
    tokenId: 4231,
    uri: "ipfs://bafy.../4231.json",
    minPrice: 0.05 ether,
    royaltyBps: 500,
    expiresAt: 1733000000
}
```

This voucher is signed by the artist (or a designated minter address) and stored off-chain — on IPFS, on the project's website, in a database. The token doesn't exist on the contract yet.

When a buyer wants to mint:

1. They pay `≥ minPrice` to the contract.
2. They submit the voucher and its signature.
3. The contract verifies: signature is from the authorized minter, voucher hasn't been used, isn't expired.
4. The contract mints the token to the buyer using the voucher's `tokenId` and `uri`.

The first time the token exists on-chain is the moment it's bought. The artist paid no gas for the un-bought tokens.

### Allowlists as a special case

An allowlist mint is lazy minting where the voucher specifies *which buyer* may use it:

```
AllowlistVoucher {
    minter: 0xAlice,
    quantity: 2,
    pricePerToken: 0.05 ether,
    expiresAt: 1733000000
}
```

The contract verifies `msg.sender == voucher.minter` before minting. Now Alice has a personalized "you can buy 2 at 0.05 ETH each" pass. Anyone else's signature submission fails.

For large allowlists (10,000+ addresses), per-address signatures are wasteful — the artist would have to generate thousands of signatures. The solution: **merkle-tree allowlists**. The artist publishes a merkle root of all eligible (address, quantity, price) tuples. Each user submits a merkle proof that their tuple is in the tree. One signed root, infinite eligible vouchers, all verifiable on-chain in O(log N) gas.

### Per-token URIs without storing them

A naive lazy-mint contract storing 10,000 URIs in storage is expensive — each `string` is multiple slots. Trick: don't store the URI at all. Store the *base* URI; derive each token's URI as `baseURI + tokenId + ".json"`. The contract only needs to verify the voucher's `uri` matches the deterministic format.

For collections where each token has truly unique metadata (not just `1.json` style), include the URI in the voucher and emit it as an event when minted; index off-chain. Or use Manifold's pattern where the URI lives in `tokenURI` overrides set per-token after mint, paid for by the buyer.

### Open editions

The newer "open edition" pattern (popularized by Manifold and Zora in 2023-24) is lazy minting at maximum extremity: there's no `tokenId` upfront, no fixed supply. Anyone can mint a copy of the same token during the mint window. Each mint costs the gas of one mint + a small fee, and the buyer gets a unique tokenId of an otherwise-identical asset.

Open editions are technically simpler than fixed-supply lazy minting (no allowlist, no merkle, no per-token URI). They're a great pattern for "free claim" or low-cost commemorative drops where rarity isn't the point.

```solidity
function openEditionMint() external payable {
    require(block.timestamp <= mintEndsAt, "ended");
    require(msg.value >= mintPrice, "underpriced");
    uint256 newId = ++totalSupply;
    _mint(msg.sender, newId);
    emit Minted(newId, msg.sender);
}

function tokenURI(uint256) public view override returns (string memory) {
    return commonURI; // every token returns the same URI
}
```

### Voucher signing key management

The contract needs to know which signer's signatures are valid for vouchers. The simplest pattern:

```solidity
address public voucherSigner; // set by owner, can be rotated

function _verifyVoucher(Voucher v, bytes calldata sig) internal view {
    bytes32 hash = _hashVoucher(v);
    require(hash.recover(sig) == voucherSigner, "bad sig");
}
```

The `voucherSigner` address can be:
- The artist's EOA (simple, but if the key is leaked the whole drop is at risk).
- A backend signer key managed by the platform (KMS-backed, easier to rotate).
- A multisig (most secure, but adds latency to issuing new vouchers).

If you allow the contract owner to rotate `voucherSigner`, signatures issued by the old signer are *immediately* invalidated — including ones already shown to users. Plan for this: either don't rotate during a live drop, or implement a per-signer-version scheme.

---

## Code Walkthrough

A full voucher-based lazy-mint contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721URIStorage, ERC721} from "openzeppelin-contracts/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract LazyMintNFT is ERC721URIStorage, EIP712, Ownable {
    using ECDSA for bytes32;

    struct Voucher {
        uint256 tokenId;
        uint256 minPrice;
        string uri;
        uint256 deadline;
    }

    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(uint256 tokenId,uint256 minPrice,string uri,uint256 deadline)"
    );

    address public voucherSigner;
    mapping(uint256 => bool) public minted;

    constructor(address signer)
        ERC721("LazyCollection", "LC")
        EIP712("LazyMintNFT", "1")
        Ownable(msg.sender)
    {
        voucherSigner = signer;
    }

    function mint(Voucher calldata v, bytes calldata sig) external payable {
        require(block.timestamp <= v.deadline, "expired");
        require(msg.value >= v.minPrice, "underpriced");
        require(!minted[v.tokenId], "already minted");

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            v.tokenId,
            v.minPrice,
            keccak256(bytes(v.uri)),
            v.deadline
        )));
        require(digest.recover(sig) == voucherSigner, "bad sig");

        minted[v.tokenId] = true;
        _safeMint(msg.sender, v.tokenId);
        _setTokenURI(v.tokenId, v.uri);

        // Forward payment to artist (could be a splitter)
        (bool ok, ) = owner().call{value: msg.value}("");
        require(ok, "payout failed");
    }

    function setSigner(address s) external onlyOwner {
        voucherSigner = s;
    }
}
```

A merkle-tree allowlist variant:

```solidity
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleAllowlistMint is ERC721 {
    bytes32 public allowlistRoot;
    mapping(address => uint256) public minted;

    function mint(uint256 quantity, uint256 maxQuantity, uint256 price, bytes32[] calldata proof)
        external payable
    {
        require(msg.value >= price * quantity, "underpriced");
        require(minted[msg.sender] + quantity <= maxQuantity, "exceeds cap");

        // Each leaf encodes the eligible (address, maxQuantity, price)
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, maxQuantity, price));
        require(MerkleProof.verify(proof, allowlistRoot, leaf), "not on allowlist");

        for (uint256 i; i < quantity; ++i) {
            _mint(msg.sender, ++totalSupply);
        }
        minted[msg.sender] += quantity;
    }

    function setRoot(bytes32 root) external onlyOwner { allowlistRoot = root; }
}
```

Off-chain helper (Node.js) to build the merkle tree:

```typescript
import { MerkleTree } from "merkletreejs";
import { keccak256, encodePacked } from "viem";

const allowlist = [
  { address: "0xAlice", maxQuantity: 2, price: parseEther("0.05") },
  { address: "0xBob", maxQuantity: 5, price: parseEther("0.04") },
  // ...
];

const leaves = allowlist.map((e) =>
  Buffer.from(keccak256(encodePacked(["address", "uint256", "uint256"], [e.address, e.maxQuantity, e.price])).slice(2), "hex")
);
const tree = new MerkleTree(leaves, (b: Buffer) => Buffer.from(keccak256(b).slice(2), "hex"), { sortPairs: true });
const root = "0x" + tree.getRoot().toString("hex");

// For Alice, generate the proof:
const aliceProof = tree.getHexProof(leaves[0]);
// publish: { aliceProof, maxQuantity: 2, price: 0.05 ETH }
```

---

## Common Mistakes and Gotchas

**1. Voucher signing key leak**
Whoever has the signer key can mint anything. Treat it like a wallet seed. Use a backend KMS, rotate periodically, and only have the key online during signing operations.

**2. Reusing the same `tokenId` across vouchers**
If you sign two vouchers for tokenId 42 with different prices, only the first to land mints. The second silently fails. Either ensure unique tokenIds per voucher (off-chain bookkeeping) or accept that voucher #2 becomes a backup.

**3. Missing `deadline`**
A voucher without expiry is forever-redeemable. The artist might want to take the drop down a year later but can't — old signatures still work. Always set a reasonable deadline.

**4. Over-minting via re-entrancy or signature reuse**
The "already minted" check prevents replay for a fixed tokenId. But if you accept "any of N tokenIds in this drop" via merkle, you need a per-voucher consumed flag. Use a `mapping(bytes32 => bool) usedVoucherHash`.

**5. Skipping `chainId` in the EIP-712 domain**
A voucher signed for testnet works on mainnet without `chainId` in the domain. Always include it.

**6. Allowing 0-price mints when the contract holds ETH**
A voucher with `minPrice = 0` lets anyone mint for free. If your contract previously received funds (e.g. from past mints), an attacker can mint a token AND drain the balance via the post-mint payout if you forward everything. Sanity-check minPrice and isolate funds.

**7. Generating signatures slower than the public can mint**
Allowlist drops where each user pre-receives a signed voucher: fine. Public drops where people queue up at mint time: signing 1000 vouchers per second with a single backend instance is hard. Use merkle trees for high-throughput cases.

**8. Forgetting that vouchers leak the URI**
Anyone with a voucher can read the URI without minting. If the URI points to private content, that content is now public. For privacy-sensitive collections, the URI should be derivable post-mint, not pre-mint.

---

## How This Connects to Production

OpenSea Studio, Manifold, Zora, Foundation — all use voucher-based lazy minting. The artist signs one approval and configures parameters; the platform handles signing and serving vouchers when buyers arrive. The result: artists can launch collections of any size with no upfront gas cost, and most launch traffic actually goes through these platforms now rather than custom contracts.

For protocol-level launches (drops where the team wants to control the contract directly), the merkle-allowlist pattern is the workhorse. Every credible drop in 2024-2026 has used it for at least one tier (early supporters, partner teams, OG holders). The pattern is well-tested, well-audited (OpenZeppelin's MerkleProof has been hammered for years), and gas-efficient.

---

## What to Learn Next

- **ERC-4907 Rentable NFTs and Other Useful Extensions** — extending the basic ERC-721 with utility primitives.
- **Soulbound Tokens and ERC-5192 Non-Transferable NFTs** — tokens that intentionally don't trade.
- **Web3 Backend Engineering** (separate track) — the backend infrastructure for serving vouchers, signing on demand, and managing keys safely.
