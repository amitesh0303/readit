# ERC-721 Standard: Building an NFT from Scratch

**Track:** Beginner → Intermediate  
**Read time:** 13 min

---

## The Problem

NFTs went from "digital art JPEGs" to the backbone of on-chain identity, gaming assets, and protocol positions. Uniswap V3 represents liquidity positions as NFTs. ENS domains are NFTs. Nouns DAO governance is built around NFTs. But most developers who "build NFTs" just copy an OpenZeppelin template and change the name.

When something breaks — a transfer fails, a marketplace can't read your metadata, a contract can't receive your NFT — you have no idea why. This blog builds ERC-721 from scratch so you understand every function, every callback, and every edge case that trips up real projects.

---

## Core Concepts

### What Makes a Token Non-Fungible

ERC-20 tokens are fungible: 1 USDC is identical to any other 1 USDC. ERC-721 tokens are non-fungible: each token has a unique `tokenId` and can have different properties, metadata, and ownership history.

The key difference in the data model:

```
ERC-20:
mapping(address => uint256) balanceOf  // how many tokens each address has

ERC-721:
mapping(uint256 => address) ownerOf    // who owns each specific token ID
mapping(address => uint256) balanceOf  // how many tokens each address has (count only)
```

### The Full ERC-721 Interface

```solidity
interface IERC721 {
    // ── Ownership ───────────────────────────────────────────────────────────
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);

    // ── Transfers ───────────────────────────────────────────────────────────
    // safeTransferFrom checks if recipient can handle ERC-721 (if it's a contract)
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    // transferFrom does NOT check — use only when you know recipient can handle NFTs
    function transferFrom(address from, address to, uint256 tokenId) external;

    // ── Approvals ───────────────────────────────────────────────────────────
    // Approve a single address to transfer a specific token
    function approve(address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    // Approve an operator to manage ALL tokens of the caller
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);

    // ── Events ──────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
}

// Contracts that want to receive NFTs via safeTransferFrom must implement this
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}
```

### The `safeTransferFrom` Safety Check

This is the most important design decision in ERC-721. If you send an NFT to a contract that doesn't know how to handle it, the NFT is permanently locked — there's no way to recover it.

`safeTransferFrom` prevents this by calling `onERC721Received` on the recipient contract. If the contract doesn't implement the function (or returns the wrong value), the transfer reverts. This is why NFTs sent to the wrong contract address are often lost — people use `transferFrom` instead of `safeTransferFrom`.

### Token URI and Metadata

ERC-721 has an optional metadata extension:

```solidity
interface IERC721Metadata {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    // Returns a URI pointing to JSON metadata for this token
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
```

The `tokenURI` returns a URL (HTTPS or IPFS) pointing to a JSON file:

```json
{
  "name": "Token #42",
  "description": "A unique token",
  "image": "ipfs://QmHash.../42.png",
  "attributes": [
    { "trait_type": "Background", "value": "Blue" },
    { "trait_type": "Rarity", "value": "Rare" }
  ]
}
```

OpenSea, Blur, and other marketplaces read this JSON to display your NFT. If your `tokenURI` is wrong or the JSON is malformed, your NFT won't display correctly.

---

## Code Walkthrough

A complete ERC-721 implementation with minting, metadata, and enumeration:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MinimalNFT
 * @notice ERC-721 implementation from scratch with:
 *   - Safe transfer with receiver check
 *   - Operator approvals
 *   - On-chain base URI for metadata
 *   - Sequential token IDs
 *   - Mint limit per wallet
 */
contract MinimalNFT {
    // ─── State ─────────────────────────────────────────────────────────────

    string public name;
    string public symbol;
    string private _baseTokenURI;

    uint256 public totalSupply;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_PER_WALLET = 5;
    uint256 public constant MINT_PRICE = 0.05 ether;

    address public owner;
    bool public mintActive;

    // tokenId → owner address
    mapping(uint256 => address) private _owners;

    // owner → token count
    mapping(address => uint256) private _balances;

    // tokenId → approved address (single token approval)
    mapping(uint256 => address) private _tokenApprovals;

    // owner → operator → approved (all tokens approval)
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // owner → mint count (for per-wallet limit)
    mapping(address => uint256) public mintCount;

    // ─── Events ────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(string memory _name, string memory _symbol, string memory baseURI) {
        name = _name;
        symbol = _symbol;
        _baseTokenURI = baseURI;
        owner = msg.sender;
    }

    // ─── ERC-721 Core ──────────────────────────────────────────────────────

    function balanceOf(address tokenOwner) external view returns (uint256) {
        require(tokenOwner != address(0), "Zero address");
        return _balances[tokenOwner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "Token doesn't exist");
        return tokenOwner;
    }

    /**
     * @notice Approve a single address to transfer a specific token.
     * @dev Only the token owner or an approved operator can call this.
     */
    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(
            msg.sender == tokenOwner || isApprovedForAll(tokenOwner, msg.sender),
            "Not owner or operator"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "Token doesn't exist");
        return _tokenApprovals[tokenId];
    }

    /**
     * @notice Approve an operator to manage ALL your tokens.
     * @dev Used by marketplaces — you approve OpenSea once, they can list any of your NFTs.
     */
    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "Approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address tokenOwner, address operator) public view returns (bool) {
        return _operatorApprovals[tokenOwner][operator];
    }

    /**
     * @notice Transfer without safety check.
     * @dev Use only when you know the recipient can handle ERC-721.
     *      Sending to a contract that doesn't implement onERC721Received
     *      will permanently lock the NFT.
     */
    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not approved");
        _transfer(from, to, tokenId);
    }

    /**
     * @notice Safe transfer — checks if recipient contract can handle NFTs.
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not approved");
        _transfer(from, to, tokenId);
        // If recipient is a contract, verify it can handle ERC-721
        _checkOnERC721Received(from, to, tokenId, data);
    }

    // ─── Metadata ──────────────────────────────────────────────────────────

    /**
     * @notice Returns the metadata URI for a token.
     * @dev Returns baseURI + tokenId + ".json"
     *      e.g. "ipfs://QmHash.../42.json"
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token doesn't exist");
        return string(abi.encodePacked(_baseTokenURI, _toString(tokenId), ".json"));
    }

    // ─── Minting ───────────────────────────────────────────────────────────

    /**
     * @notice Public mint function.
     * @param quantity Number of tokens to mint (1-5)
     */
    function mint(uint256 quantity) external payable {
        require(mintActive, "Mint not active");
        require(quantity > 0 && quantity <= MAX_PER_WALLET, "Invalid quantity");
        require(mintCount[msg.sender] + quantity <= MAX_PER_WALLET, "Exceeds wallet limit");
        require(totalSupply + quantity <= MAX_SUPPLY, "Exceeds max supply");
        require(msg.value == MINT_PRICE * quantity, "Wrong ETH amount");

        mintCount[msg.sender] += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalSupply + 1; // start IDs at 1
            totalSupply++;
            _mint(msg.sender, tokenId);
        }
    }

    /**
     * @notice Owner can mint for free (for team, giveaways, etc.)
     */
    function ownerMint(address to, uint256 quantity) external {
        require(msg.sender == owner, "Not owner");
        require(totalSupply + quantity <= MAX_SUPPLY, "Exceeds max supply");

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalSupply + 1;
            totalSupply++;
            _mint(to, tokenId);
        }
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    function setMintActive(bool active) external {
        require(msg.sender == owner, "Not owner");
        mintActive = active;
    }

    function setBaseURI(string calldata baseURI) external {
        require(msg.sender == owner, "Not owner");
        _baseTokenURI = baseURI;
    }

    function withdraw() external {
        require(msg.sender == owner, "Not owner");
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    function _mint(address to, uint256 tokenId) internal {
        require(to != address(0), "Mint to zero");
        require(_owners[tokenId] == address(0), "Already minted");

        _balances[to]++;
        _owners[tokenId] = to;

        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "Wrong owner");
        require(to != address(0), "Transfer to zero");

        // Clear single-token approval on transfer
        delete _tokenApprovals[tokenId];

        _balances[from]--;
        _balances[to]++;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return (
            spender == tokenOwner ||
            isApprovedForAll(tokenOwner, spender) ||
            getApproved(tokenId) == spender
        );
    }

    /**
     * @dev Calls onERC721Received on contract recipients.
     *      Reverts if the contract doesn't return the correct magic value.
     */
    function _checkOnERC721Received(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) internal {
        if (to.code.length > 0) { // check if `to` is a contract
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
                returns (bytes4 retval)
            {
                // Magic value: bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))
                require(retval == 0x150b7a02, "ERC721: transfer to non-receiver");
            } catch {
                revert("ERC721: transfer to non-receiver");
            }
        }
    }

    /**
     * @dev Converts uint256 to string — needed for tokenURI construction.
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    // ─── ERC-165 Interface Detection ───────────────────────────────────────

    /**
     * @dev ERC-165: lets other contracts check if this contract supports an interface.
     *      Marketplaces use this to verify ERC-721 compliance.
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f || // ERC-721 Metadata
            interfaceId == 0x01ffc9a7;   // ERC-165
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}
```

---

## Common Mistakes and Gotchas

**1. Using `transferFrom` instead of `safeTransferFrom` in your protocol**  
If your protocol transfers NFTs to user-provided addresses, use `safeTransferFrom`. If the user provides a contract address that can't receive NFTs, `transferFrom` will silently lock the NFT. `safeTransferFrom` reverts instead, which is the correct behavior.

**2. Not clearing token approvals on transfer**  
When a token is transferred, the single-token approval (`_tokenApprovals[tokenId]`) must be cleared. If you forget this, the previous approved address can still transfer the token after it's been sold. This is a real vulnerability.

**3. Centralized metadata (HTTPS URIs)**  
If your `tokenURI` returns `https://yourapi.com/token/42`, you control the metadata. You can change the image, attributes, or take the server down. This is a rug vector. Use IPFS or Arweave for immutable metadata. If you need mutable metadata (for evolving game assets), be transparent about it.

**4. Starting token IDs at 0**  
`ownerOf(0)` returns `address(0)` for unminted tokens. If you start IDs at 0, you can't distinguish "token 0 doesn't exist" from "token 0 is owned by the zero address." Start IDs at 1, or use a separate `_exists` mapping.

**5. Not implementing ERC-165**  
Marketplaces and protocols use `supportsInterface` to check if a contract is ERC-721 compliant. If you don't implement it, your NFT may not show up correctly on OpenSea or be usable in protocols that check for ERC-721 support.

---

## How This Connects to Production

Uniswap V3 uses ERC-721 to represent liquidity positions — each position is a unique NFT with specific tick ranges and fee tiers. This lets positions be transferred, sold, and used as collateral in lending protocols. ENS (Ethereum Name Service) domains are ERC-721 tokens — owning `vitalik.eth` means owning a specific NFT. Nouns DAO auctions one NFT per day, and each NFT is a governance vote. Blur and OpenSea are essentially ERC-721 marketplaces — they use `setApprovalForAll` to get permission to transfer your NFTs when a sale executes. The ERC-721 standard is the foundation of on-chain ownership for unique assets.

---

## What to Learn Next

- **ERC-1155: Multi-Token Standard and When to Use It** — the evolution of ERC-721 that handles both fungible and non-fungible tokens.
- **Events and Logs: How Frontends Listen to Smart Contracts** — learn how marketplaces index Transfer events to track NFT ownership.
- **Access Control in Solidity: Ownable, Roles, and Multi-Sig** — harden your NFT contract's admin functions.
