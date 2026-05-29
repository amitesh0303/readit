# Generative NFT Art: On-Chain SVGs and Reveal Mechanics

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Most NFT collections are pictures sitting on IPFS. Pretty, but the picture is one HTTP request away from being unreachable. "Fully on-chain" NFTs put the artwork itself in contract storage — when you call `tokenURI(id)`, the contract *generates* the image and metadata in real time, returning a base64-encoded data URI that browsers render directly. CryptoPunks (eventually), Loot, Nouns, Chain Runners — all on-chain.

This lesson covers the why and the how: when on-chain art makes sense, the gas math, generative art techniques in Solidity, and how reveal mechanics work for both on-chain and off-chain collections.


---

## Core Concepts

### Why on-chain at all

Trade-offs are real:

**On-chain pros:**
- Zero external dependencies. As long as the chain exists, the art exists.
- The art is reproducible from the contract bytecode forever.
- Composability: another contract can read your `tokenURI` and use the rendered SVG.
- The art is part of the collectible, not a pointer.

**On-chain cons:**
- Gas cost to deploy is high (the more art assets, the more it costs).
- Render gas is non-trivial; calling `tokenURI` in a transaction costs much more than off-chain.
- Hard size limits (24KB contract size cap on Ethereum, larger on L2s).
- Iterating on art is harder — every change requires a new contract deployment.

For most collections, IPFS is the right answer. For collections where *the on-chainness is the point* — historic significance, fully self-contained art, programmable visuals that depend on contract state — on-chain is the right answer.

### The data URI pattern

Browsers can render images and JSON directly from data URIs:

```
data:image/svg+xml;base64,PHN2ZyB...
data:application/json;base64,eyJuYW1...
```

The contract returns:

```
data:application/json;base64,<base64 of {
  "name": "Token #42",
  "description": "...",
  "image": "data:image/svg+xml;base64,<base64 of <svg ...></svg>>",
  "attributes": [...]
}>
```

When OpenSea calls `tokenURI(42)`, it gets back this data URI. It decodes the JSON, finds the `image` field, decodes that. Your contract assembled the entire NFT, image and all, in one function call. No IPFS, no HTTP.

### SVG generation in Solidity

SVG is just XML. You can build it from string concatenation:

```solidity
function renderSvg(uint256 seed) internal pure returns (string memory) {
    uint256 hue = seed % 360;
    return string.concat(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
            '<rect width="100" height="100" fill="hsl(', toString(hue), ',70%,50%)"/>',
            '<circle cx="50" cy="50" r="', toString((seed % 30) + 10), '" fill="white"/>',
        '</svg>'
    );
}
```

For more complex art, you store template fragments in storage or constants and select-and-combine based on the seed:

```solidity
string[5] private backgrounds;
string[20] private bodies;
string[10] private hats;

function renderSvg(uint256 tokenId) internal view returns (string memory) {
    uint256 seed = uint256(keccak256(abi.encode(tokenId)));
    return string.concat(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        backgrounds[seed % 5],
        bodies[(seed >> 8) % 20],
        hats[(seed >> 16) % 10],
        '</svg>'
    );
}
```

This generates 5 × 20 × 10 = 1,000 unique combinations from constant-size storage. That's the generative trick: on-chain trait pools, deterministic per-token assembly.

### Reveal mechanics for off-chain art

Most non-on-chain collections do a "reveal" — pre-mint, every token shows a placeholder; post-mint, the real metadata is unveiled. The simple version:

```solidity
string private preRevealURI;
string private postRevealBaseURI;
bool public revealed;

function tokenURI(uint256 id) public view override returns (string memory) {
    return revealed
        ? string.concat(postRevealBaseURI, id.toString(), ".json")
        : preRevealURI;
}

function reveal(string calldata baseURI) external onlyOwner {
    require(!revealed, "already revealed");
    revealed = true;
    postRevealBaseURI = baseURI;
}
```

The naive issue with this: the team can game the reveal. They can see who minted which IDs, look at what traits are at which IDs, and reveal in a way that benefits them (e.g. shifting the offset to give themselves the rare ones).

### Provably fair reveal: the offset trick

The fair reveal pattern: at mint time, you commit to the metadata folder via its IPFS CID. At reveal, you publish a *random offset* derived from a public unbiased source (Chainlink VRF, future block hashes). Each token's metadata is then `metadata[(tokenId + offset) % supply]`.

```solidity
uint256 public revealOffset;
bytes32 public metadataCommitment; // keccak256 of the folder CID

function commit(bytes32 commitment) external onlyOwner {
    metadataCommitment = commitment; // before mint, lock in the metadata
}

function reveal(string calldata folderCID, uint256 offset) external onlyOwner {
    require(keccak256(bytes(folderCID)) == metadataCommitment, "wrong folder");
    revealOffset = offset; // sourced from VRF or block hash
}

function tokenURI(uint256 id) public view override returns (string memory) {
    if (!revealed) return preRevealURI;
    uint256 metadataIndex = (id + revealOffset) % totalSupply;
    return string.concat(postRevealBaseURI, metadataIndex.toString(), ".json");
}
```

Because `metadataCommitment` was set before the offset, you can't pick metadata to favor specific tokens — you committed before you knew what was rare where. Because `revealOffset` is from a random source, you can't pick a specific tokenId to favor.

Fair, public, verifiable. This is the standard for serious collections.

### Render-time interactivity

On-chain art opens patterns that off-chain art can't do:

- **State-dependent art**: the SVG changes based on `block.timestamp`, the user's other holdings, or game state. Nouns famously change traits dynamically.
- **Composable rendering**: one NFT's `tokenURI` calls another's. NFTs that wear NFTs.
- **Programmatic randomness in render**: `keccak256(blockhash(N), tokenId)` injects entropy at render time.

These are only possible because the rendering happens in your contract, not on a remote server.

---

## Code Walkthrough

A complete on-chain generative collection — abstract circles in randomized colors:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

contract OnChainCircles is ERC721 {
    using Strings for uint256;
    uint256 public totalSupply;

    constructor() ERC721("OnChainCircles", "OCC") {}

    function mint() external {
        _mint(msg.sender, ++totalSupply);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        bytes memory svg = _svg(id);
        bytes memory traits = _traits(id);

        bytes memory json = abi.encodePacked(
            '{"name":"OCC #', id.toString(),
            '","description":"100% on-chain generative art.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg), '",',
            '"attributes":', traits, '}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(json)
        );
    }

    function _svg(uint256 id) internal pure returns (bytes memory) {
        uint256 seed = uint256(keccak256(abi.encode(id, "render")));
        uint256 hue = seed % 360;
        uint256 r = (seed >> 8) % 30 + 10;
        uint256 cx = (seed >> 16) % 60 + 20;
        uint256 cy = (seed >> 24) % 60 + 20;

        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
            '<rect width="100" height="100" fill="hsl(', hue.toString(), ',70%,15%)"/>',
            '<circle cx="', cx.toString(),
            '" cy="', cy.toString(),
            '" r="', r.toString(),
            '" fill="hsl(', ((hue + 180) % 360).toString(), ',70%,60%)"/>',
            '</svg>'
        );
    }

    function _traits(uint256 id) internal pure returns (bytes memory) {
        uint256 seed = uint256(keccak256(abi.encode(id, "render")));
        uint256 hue = seed % 360;
        uint256 r = (seed >> 8) % 30 + 10;

        return abi.encodePacked(
            '[',
            '{"trait_type":"Hue","value":', hue.toString(), ',"display_type":"number"},',
            '{"trait_type":"Radius","value":', r.toString(), ',"display_type":"number"},',
            '{"trait_type":"Size","value":"', _sizeBucket(r), '"}',
            ']'
        );
    }

    function _sizeBucket(uint256 r) internal pure returns (string memory) {
        if (r >= 35) return "Large";
        if (r >= 20) return "Medium";
        return "Small";
    }
}
```

Mint a token, paste the result of `tokenURI(1)` into a browser, and the browser renders the SVG directly from the data URI. No IPFS, no HTTP, no fetch — the entire NFT is a string returned by a contract call.

The whole contract is under 100 lines. Generative art doesn't require a giant codebase; it requires careful reuse of `keccak256` as a deterministic randomness source per token.

---

## Common Mistakes and Gotchas

**1. Building SVG with naive concatenation that runs out of gas**
String concat in Solidity is expensive, and `tokenURI` is called by marketplace indexers, not just users. If your render takes 5M gas, every refresh hits the gas limit. Use `abi.encodePacked` (much cheaper than `string.concat` on huge strings), pre-compute static parts as constants, and minimize the size of dynamic parts.

**2. Storing trait pools in `string` storage instead of `bytes`**
`string` and `bytes` cost the same to store, but pre-encoded `bytes` is cheaper to concatenate at read time. Many fully-on-chain collections store SVG fragments as `bytes` constants compiled into the bytecode.

**3. Off-by-one in the reveal offset**
If `revealOffset = 0`, the offset doesn't randomize anything — token N renders metadata N. Make sure your offset is meaningfully large (at least `> 0`, ideally derived properly from VRF/blockhash).

**4. Using `block.timestamp` as randomness for the reveal**
Validators can manipulate `block.timestamp` within a small window. For low-stakes collections it's fine; for collections where rarity matters in dollars, use Chainlink VRF or commit-reveal with a future block hash.

**5. Quoting in JSON breaking with special characters in trait values**
If your trait value contains a `"` or `\`, the resulting JSON is malformed. Either restrict allowable characters or escape carefully. Marketplaces silently fail on malformed JSON.

**6. Marketplace caching after a metadata change**
On-chain metadata can change (state-dependent art). Marketplaces cache aggressively and may not pick up the change for hours. Use the marketplace's "refresh metadata" endpoint or accept the lag.

**7. Bytecode size limit**
Ethereum's 24KB contract size cap (EIP-170) is real. Large trait pools eat into it fast. Solutions: use SSTORE2 (cheaper byte storage in contract bytecode), split traits across multiple library contracts, or use chains with looser size limits (most L2s allow more).

**8. Over-promising "fully on-chain"**
If your contract calls out to `OpenSea's metadata refresh` or relies on a hosted gateway for ANY render path, you're not fully on-chain. Be precise in your marketing — collectors care.

---

## How This Connects to Production

Nouns DAO is the canonical full-on-chain example: every Nouns NFT renders deterministically from contract state, no IPFS involved. The art parts are stored efficiently and assembled per-token. Loot did the same with text descriptions of fantasy gear. Anchor by Anchor Block, Chain Runners, and dozens of art-focused projects use the on-chain SVG pattern.

The reveal-offset pattern is in basically every fixed-supply collection now: BAYC, Doodles, Pudgy Penguins. It's the de facto "we're not cheating you" guarantee.

The bigger trend in 2025-2026: **partially on-chain** collections that store the static art on-chain (so it can never disappear) but use IPFS for high-resolution variants. You get the permanence guarantee without the gas cost of putting 1MB of pixel data in storage.

---

## What to Learn Next

- **The Graph & Subgraph Development** (separate track) — indexing on-chain art collections has its own twists, especially when render output changes with state.
- **Web3 Frontend Engineering** (separate track) — rendering data-URI SVGs in a Next.js app and handling image fallbacks.
- **NFT Metadata Standards** (lesson 1 of this track) — the off-chain metadata foundation, since most collections still live there.
