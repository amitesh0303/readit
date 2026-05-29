# NFT Metadata Standards: Schema, IPFS, and Frozen URIs

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

ERC-721 specifies that `tokenURI(tokenId)` returns a string. That's it. Everything you actually care about — the image, the name, the traits — lives in metadata that the standard doesn't define. Marketplaces (OpenSea, Blur, LooksRare) all converged on a *de facto* JSON schema, but the standard itself never enforced it. So when you ship an NFT with a typo in your trait name, or your image link goes 404, or OpenSea shows "untitled" because your JSON has a missing field — you're hitting the gap between what's defined and what works in practice.

This lesson is the practical metadata standard everyone actually uses, the failure modes, and how to ship NFT metadata that doesn't break in marketplaces' indexers.


---

## Core Concepts

### The metadata schema marketplaces actually parse

Every major marketplace expects:

```json
{
  "name": "Bored Ape #1234",
  "description": "A unique digital collectible with rare traits.",
  "image": "ipfs://bafy.../1234.png",
  "external_url": "https://mycollection.io/1234",
  "animation_url": "ipfs://bafy.../1234.mp4",
  "attributes": [
    { "trait_type": "Background", "value": "Blue" },
    { "trait_type": "Hat", "value": "Crown" },
    { "trait_type": "Level", "value": 42, "display_type": "number" }
  ]
}
```

Required for proper indexing:

- **`name`** — what the NFT is called.
- **`description`** — one or two paragraphs.
- **`image`** — the primary visual. PNG, JPEG, SVG all work; GIFs work but are slow to render.
- **`attributes`** — array of trait objects. Each must have `trait_type` and `value`. Optional `display_type` for numerics, dates, etc.

Optional but commonly used:

- **`animation_url`** — for animated/3D/audio NFTs. MP4, GLB, MP3, HTML.
- **`external_url`** — link to your project's page about this token.
- **`background_color`** — CSS hex (no `#`).
- **`youtube_url`** — embed link.

The biggest single mistake: **inconsistent trait_type capitalization**. "Background" and "background" are different traits to OpenSea's indexer. Pick a casing and stick with it across the entire collection.

### `display_type` and how marketplaces render numbers

For numeric traits, `display_type` controls the visualization:

```json
{ "trait_type": "Power", "value": 42, "display_type": "number" }
{ "trait_type": "Birthday", "value": 1640995200, "display_type": "date" }
{ "trait_type": "Stamina", "value": 80, "max_value": 100, "display_type": "boost_number" }
{ "trait_type": "Win Rate", "value": 65, "display_type": "boost_percentage" }
```

OpenSea renders these distinctly: `boost_number` shows as a meter, `date` formats as a calendar date, `boost_percentage` shows a circular progress indicator. If you skip `display_type`, marketplaces show the value as a string.

### Where to host: the four real options

**1. IPFS (with a paid pinning service)**
The mainstream choice for static collections. Upload the metadata files and images, get back a CID, mint with `tokenURI = ipfs://CID/N.json`. Reliability depends on you keeping the data pinned. Paid pinning at Pinata or Filebase costs ~$10-20/month for a typical collection.

**2. Arweave**
"Permaweb" — pay once, supposedly stored forever. The economics are subsidized by an endowment model. For collections that want a single-payment "permanent" guarantee, this is appealing. Used by major projects like Foundation and parts of Mirror.

**3. On-chain (storage in the contract)**
The image and metadata are stored in contract storage as bytes (often SVG strings). Maximally permanent — if the chain exists, the NFT exists. Limited to small images (gas costs blow up at >50 KB). Used for fully-on-chain projects (Loot, Nouns, Chain Runners).

**4. Centralized HTTPS**
`tokenURI` returns `https://api.example.com/nft/N.json`. Cheapest, easiest, *not actually decentralized*. The metadata can change at any time, the server can go down, the entire collection can disappear. Only use this if you want intentionally mutable metadata (and document that loudly).

### Frozen URIs and immutability

A "frozen" NFT has its `tokenURI` (and the metadata it points to) declared permanently unchangeable. There's no formal standard for this, but the convention is:

```solidity
function freezeTokenURI(uint256 tokenId) external onlyOwner {
    require(!frozen[tokenId], "already frozen");
    frozen[tokenId] = true;
    emit PermanentURI(tokenURIOf(tokenId), tokenId);
}
```

OpenSea and other marketplaces watch for the `PermanentURI(string, uint256)` event and stop allowing the project owner to update metadata for that token via their UI. Combined with `ipfs://` URIs, this gives buyers a real guarantee that the metadata won't change after they buy.

The trick: freezing only works if the underlying URI scheme is content-addressed (IPFS, Arweave). Freezing an `https://` URL is theater — the website can still serve different content tomorrow.

### Mutability (when you actually want it)

Some projects intentionally need mutable metadata:

- **Game NFTs**: stats change as the character levels up.
- **Dynamic art**: the artwork evolves with on-chain state (e.g. Async Art).
- **Pre-reveal**: the metadata is "mystery box" until the official reveal.

For these, use a custom `tokenURI` that returns content based on contract state:

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
    if (revealed) {
        return string.concat("ipfs://", revealedBaseCID, "/", tokenId.toString(), ".json");
    } else {
        return preRevealURI;
    }
}
```

After the reveal, all tokens point to the new IPFS folder. Before the reveal, they all point to a single placeholder.

---

## Code Walkthrough

A clean ERC-721 with proper metadata handling, freeze support, and a reveal flow:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

contract MyCollection is ERC721, Ownable {
    using Strings for uint256;

    bool public revealed;
    string private _preRevealURI;
    string private _revealedBaseURI;

    mapping(uint256 => bool) public frozen;
    event PermanentURI(string _value, uint256 indexed _id);

    constructor(string memory preRevealURI) ERC721("MyCollection", "MC") Ownable(msg.sender) {
        _preRevealURI = preRevealURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return _preRevealURI;
        return string.concat(_revealedBaseURI, tokenId.toString(), ".json");
    }

    /// One-shot reveal: set the IPFS base, can never change again
    function reveal(string calldata revealedBaseURI) external onlyOwner {
        require(!revealed, "already revealed");
        revealed = true;
        _revealedBaseURI = revealedBaseURI;
    }

    function freezeMetadata(uint256 tokenId) external onlyOwner {
        require(revealed, "freeze after reveal only");
        require(!frozen[tokenId], "already frozen");
        frozen[tokenId] = true;
        emit PermanentURI(tokenURI(tokenId), tokenId);
    }
}
```

A script that uploads a collection's metadata + images to IPFS in a structure marketplaces will index correctly:

```typescript
// scripts/upload-collection.ts
import { PinataSDK } from "pinata";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT! });

async function uploadCollection(collectionDir: string, traits: TraitMap) {
  // 1) Upload images as a directory — get one CID for all
  const imageFiles = (await readdir(`${collectionDir}/images`)).map((f) =>
    new File([fs.readFileSync(`${collectionDir}/images/${f}`)], f, { type: "image/png" })
  );
  const imageDir = await pinata.upload.fileArray(imageFiles);
  console.log(`Images: ipfs://${imageDir.IpfsHash}/`);

  // 2) Generate metadata files referencing the image CIDs
  await mkdir(`${collectionDir}/metadata`, { recursive: true });
  for (let i = 1; i <= 10000; i++) {
    const meta = {
      name: `MyCollection #${i}`,
      description: "A collection of unique digital collectibles.",
      image: `ipfs://${imageDir.IpfsHash}/${i}.png`,
      external_url: `https://mycollection.io/${i}`,
      attributes: traits[i].map((t) => ({ trait_type: t.type, value: t.value })),
    };
    await writeFile(`${collectionDir}/metadata/${i}.json`, JSON.stringify(meta));
  }

  // 3) Upload metadata as a directory
  const metaFiles = (await readdir(`${collectionDir}/metadata`)).map((f) =>
    new File([fs.readFileSync(`${collectionDir}/metadata/${f}`)], f, { type: "application/json" })
  );
  const metaDir = await pinata.upload.fileArray(metaFiles);
  console.log(`Metadata: ipfs://${metaDir.IpfsHash}/`);
  console.log(`Set baseURI to: ipfs://${metaDir.IpfsHash}/`);
}
```

After this runs, `tokenURI(N) = ipfs://<metaDir>/N.json` resolves to a JSON pointing to `ipfs://<imageDir>/N.png`. Both directories get pinned. Marketplaces can crawl the whole collection from one base URI.

---

## Common Mistakes and Gotchas

**1. Inconsistent trait casing**
"Background: Blue" and "background: blue" become two separate filterable traits in marketplaces. Lowercase your `trait_type` values consistently before generating metadata, or capitalize all of them. Pick one.

**2. Trailing/missing slashes in baseURI**
If `baseURI = "ipfs://CID"` (no slash) and you concatenate `tokenId.toString() + ".json"`, you get `ipfs://CID1.json` — a broken URL. Always end your base URI with `/` and don't put one at the start of your token suffix.

**3. Reveal that points to URIs that don't exist yet**
Calling `reveal()` before you actually upload the revealed metadata makes every `tokenURI(N)` 404. Upload first, then reveal. Better yet, test the reveal on testnet end-to-end including marketplace indexing.

**4. Putting the image as a base64 data URL inside the metadata JSON**
Tutorials sometimes show this. It bloats your metadata, makes it impossible to update the image without changing the metadata CID, and breaks lazy loading on marketplace UIs. Always store the image as a separate IPFS reference.

**5. Forgetting `external_url` and a `description`**
Marketplaces show "no description available" if you skip these. Looks unprofessional. Include them even with placeholder text — better than empty.

**6. Using `display_type` values that aren't standardized**
Stick to `number`, `boost_number`, `boost_percentage`, `date`. Made-up values are silently ignored or rendered as plain text.

**7. Not testing on multiple marketplaces**
OpenSea, Blur, LooksRare, and Magic Eden (for cross-chain) each have slightly different metadata expectations and refresh policies. A collection that looks great on OpenSea might show "Not available" on Blur because Blur doesn't follow as many redirects. Test all the major ones before launch.

**8. Skipping marketplace metadata refresh after a reveal**
OpenSea aggressively caches metadata. Even after your reveal works on-chain, the marketplace UI might show pre-reveal placeholders for hours. Hit the marketplace's refresh endpoint or wait — but warn your community in advance.

---

## How This Connects to Production

Every NFT you've heard of fights the metadata layer. CryptoPunks were on-chain because IPFS didn't exist; BAYC was on Cloudflare-fronted IPFS; Loot ships entirely on-chain SVG. Each made a choice about *where the image actually lives*, and that choice has played out over years. Some hosts disappeared (e.g. early Pinata free tiers); some upgraded to Filecoin-backed services; some discovered their "permanent" Arweave was actually expensive to maintain.

The takeaway for new projects: assume marketplaces will cache metadata aggressively, assume IPFS gateways will go down, assume URIs need to outlive your project's website. Use content addressing, pin redundantly, freeze when appropriate. Don't ship and forget — set up monitoring that pings every metadata URL monthly to catch silent failures before users notice.

---

## What to Learn Next

- **Building an NFT Marketplace: Listings, Bids, and Settlement** — once your tokens are minted, the next layer up.
- **EIP-2981 vs Royalty Registries** — how creator royalties are encoded in metadata and contracts.
- **Generative NFT Art: On-Chain SVGs and Reveal Mechanics** — the fully-on-chain alternative to IPFS-hosted images.
