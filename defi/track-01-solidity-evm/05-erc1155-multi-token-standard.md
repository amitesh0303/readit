# ERC-1155: Multi-Token Standard and When to Use It

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You're building a blockchain game. Players have swords (unique NFTs), gold coins (fungible), and potions (semi-fungible — 100 identical "Health Potion" items). With ERC-20 and ERC-721, you'd need a separate contract for each token type. That's dozens of contracts, dozens of deployments, and a nightmare for gas costs when players trade items.

ERC-1155 solves this. One contract, unlimited token types — fungible, non-fungible, and everything in between. But it's not just for games. Understanding when ERC-1155 is the right choice (and when it isn't) is what this blog is about.

---

## Core Concepts

### The Core Insight: Token ID as Type

In ERC-721, each `tokenId` is a unique instance. In ERC-1155, each `tokenId` is a token type, and each address can hold multiple units of that type.

```
ERC-721:
tokenId 1 → owned by Alice (unique)
tokenId 2 → owned by Bob (unique)

ERC-1155:
tokenId 1 (Gold Coin) → Alice has 500, Bob has 200
tokenId 2 (Sword #42) → Alice has 1, Bob has 0
tokenId 3 (Health Potion) → Alice has 10, Bob has 5
```

The balance mapping changes from `mapping(address => uint256)` to `mapping(uint256 => mapping(address => uint256))` — balance per token type per address.

### Batch Operations: The Gas Saver

ERC-1155's killer feature is batch transfers. Instead of 10 separate `transfer` calls (10 transactions, 10 gas payments), you do one `safeBatchTransferFrom` call.

```
ERC-721 trade (10 items):
10 × transferFrom = 10 transactions = ~210,000 gas

ERC-1155 trade (10 items):
1 × safeBatchTransferFrom = 1 transaction = ~80,000 gas
```

This matters enormously for games, marketplaces, and any protocol that moves multiple token types together.

### Semi-Fungibility

ERC-1155 enables semi-fungible tokens — tokens that start fungible and become non-fungible (or vice versa). Example: event tickets. Before the event, all "Section A Row 5" tickets are identical (fungible). After the event, each ticket becomes a unique collectible (non-fungible). You can model this by minting many units of a token ID initially, then burning and re-minting as unique IDs.

### The Full Interface

```solidity
interface IERC1155 {
    // Balance of a specific token type for an address
    function balanceOf(address account, uint256 id) external view returns (uint256);

    // Batch balance query — get multiple balances in one call
    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory);

    // Approve an operator to manage ALL tokens of the caller
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address account, address operator) external view returns (bool);

    // Transfer a specific amount of a specific token type
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external;

    // Transfer multiple token types in one call
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
}

// Contracts receiving ERC-1155 must implement this
interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4);
}
```

---

## Code Walkthrough

A complete ERC-1155 game item contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GameItems
 * @notice ERC-1155 multi-token contract for a game item system.
 *         Demonstrates: fungible tokens, NFTs, and semi-fungible tokens
 *         all in a single contract.
 */
contract GameItems {
    // ─── Token ID Constants ────────────────────────────────────────────────
    // Fungible tokens: IDs 1-999
    uint256 public constant GOLD = 1;
    uint256 public constant MANA_CRYSTAL = 2;
    uint256 public constant HEALTH_POTION = 3;

    // Non-fungible tokens: IDs 1000+
    // Each unique sword gets its own ID starting at SWORD_BASE
    uint256 public constant SWORD_BASE = 1000;
    uint256 private _nextSwordId = SWORD_BASE;

    // ─── State ─────────────────────────────────────────────────────────────

    // id → account → balance
    mapping(uint256 => mapping(address => uint256)) private _balances;

    // account → operator → approved
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // id → URI (for per-token metadata)
    mapping(uint256 => string) private _tokenURIs;

    // Base URI for fungible tokens (same metadata for all units)
    string private _baseURI;

    address public owner;

    // Sword metadata (for NFT-like tokens)
    struct SwordData {
        uint8 attack;
        uint8 defense;
        string name;
    }
    mapping(uint256 => SwordData) public swordData;

    // ─── Events ────────────────────────────────────────────────────────────

    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 value
    );
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(string memory baseURI) {
        owner = msg.sender;
        _baseURI = baseURI;

        // Mint initial fungible tokens to deployer
        _mint(msg.sender, GOLD, 10_000, "");
        _mint(msg.sender, MANA_CRYSTAL, 5_000, "");
        _mint(msg.sender, HEALTH_POTION, 1_000, "");
    }

    // ─── ERC-1155 Core ─────────────────────────────────────────────────────

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        require(account != address(0), "Zero address");
        return _balances[id][account];
    }

    /**
     * @notice Batch balance query — get multiple balances in one RPC call.
     * @dev accounts[i] and ids[i] are paired — must be same length.
     */
    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory balances) {
        require(accounts.length == ids.length, "Length mismatch");
        balances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            balances[i] = balanceOf(accounts[i], ids[i]);
        }
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "Self approval");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /**
     * @notice Transfer a specific amount of a token type.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external {
        require(
            from == msg.sender || isApprovedForAll(from, msg.sender),
            "Not approved"
        );
        _transfer(from, to, id, amount);
        emit TransferSingle(msg.sender, from, to, id, amount);
        _checkOnERC1155Received(msg.sender, from, to, id, amount, data);
    }

    /**
     * @notice Batch transfer — the gas-saving superpower of ERC-1155.
     * @dev Transfer multiple token types in a single transaction.
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        require(
            from == msg.sender || isApprovedForAll(from, msg.sender),
            "Not approved"
        );
        require(ids.length == amounts.length, "Length mismatch");
        require(to != address(0), "Transfer to zero");

        for (uint256 i = 0; i < ids.length; i++) {
            _transfer(from, to, ids[i], amounts[i]);
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);
        _checkOnERC1155BatchReceived(msg.sender, from, to, ids, amounts, data);
    }

    // ─── Metadata ──────────────────────────────────────────────────────────

    /**
     * @notice Returns metadata URI for a token ID.
     * @dev For fungible tokens: baseURI + id + ".json"
     *      For NFT swords: per-token URI stored in _tokenURIs
     */
    function uri(uint256 id) external view returns (string memory) {
        if (bytes(_tokenURIs[id]).length > 0) {
            return _tokenURIs[id]; // per-token URI (for NFTs)
        }
        return string(abi.encodePacked(_baseURI, _toString(id), ".json"));
    }

    // ─── Game-Specific Functions ───────────────────────────────────────────

    /**
     * @notice Mint a unique sword NFT with custom stats.
     * @dev Each sword gets a unique ID — supply of 1 makes it non-fungible.
     */
    function forgeSword(
        address to,
        uint8 attack,
        uint8 defense,
        string calldata swordName,
        string calldata metadataURI
    ) external returns (uint256 swordId) {
        require(msg.sender == owner, "Not owner");

        swordId = _nextSwordId++;
        swordData[swordId] = SwordData(attack, defense, swordName);
        _tokenURIs[swordId] = metadataURI;

        // Mint exactly 1 — this makes it non-fungible in practice
        _mint(to, swordId, 1, "");
    }

    /**
     * @notice Craft: burn ingredients to mint a new item.
     * @dev Example: burn 5 MANA_CRYSTAL to get 1 HEALTH_POTION
     */
    function craftPotion(uint256 quantity) external {
        uint256 crystalsNeeded = quantity * 5;
        require(_balances[MANA_CRYSTAL][msg.sender] >= crystalsNeeded, "Not enough crystals");

        // Burn crystals
        _balances[MANA_CRYSTAL][msg.sender] -= crystalsNeeded;
        emit TransferSingle(msg.sender, msg.sender, address(0), MANA_CRYSTAL, crystalsNeeded);

        // Mint potions
        _mint(msg.sender, HEALTH_POTION, quantity, "");
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 id, uint256 amount) internal {
        require(to != address(0), "Transfer to zero");
        require(_balances[id][from] >= amount, "Insufficient balance");
        _balances[id][from] -= amount;
        _balances[id][to] += amount;
    }

    function _mint(address to, uint256 id, uint256 amount, bytes memory data) internal {
        require(to != address(0), "Mint to zero");
        _balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
        _checkOnERC1155Received(msg.sender, address(0), to, id, amount, data);
    }

    function _checkOnERC1155Received(
        address operator, address from, address to,
        uint256 id, uint256 amount, bytes memory data
    ) internal {
        if (to.code.length > 0) {
            try IERC1155Receiver(to).onERC1155Received(operator, from, id, amount, data)
                returns (bytes4 retval)
            {
                require(retval == 0xf23a6e61, "ERC1155: non-receiver");
            } catch { revert("ERC1155: non-receiver"); }
        }
    }

    function _checkOnERC1155BatchReceived(
        address operator, address from, address to,
        uint256[] memory ids, uint256[] memory amounts, bytes memory data
    ) internal {
        if (to.code.length > 0) {
            try IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, amounts, data)
                returns (bytes4 retval)
            {
                require(retval == 0xbc197c81, "ERC1155: non-batch-receiver");
            } catch { revert("ERC1155: non-batch-receiver"); }
        }
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(buffer);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0xd9b67a26 || // ERC-1155
               interfaceId == 0x0e89341c || // ERC-1155 Metadata URI
               interfaceId == 0x01ffc9a7;   // ERC-165
    }
}

interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4);
}
```

---

## Common Mistakes and Gotchas

**1. Confusing ERC-1155 NFTs with ERC-721 NFTs**  
An ERC-1155 token with supply=1 is functionally non-fungible, but it's not the same as ERC-721. Some marketplaces and protocols only support ERC-721 for NFTs. Check compatibility before choosing ERC-1155 for unique assets.

**2. Not handling the URI standard correctly**  
ERC-1155 defines a URI substitution pattern: `{id}` in the URI should be replaced with the hex-encoded token ID. Many implementations ignore this and just concatenate the decimal ID. OpenSea supports both, but other tools may not. Check the EIP-1155 metadata spec.

**3. Forgetting that `balanceOfBatch` is the efficient way to read multiple balances**  
Making 10 separate `balanceOf` calls is 10 RPC requests. `balanceOfBatch` is 1 RPC request. Always use batch reads when you need multiple balances.

**4. Using ERC-1155 when you only have one token type**  
If you're building a simple fungible token, use ERC-20. If you're building a simple NFT collection, use ERC-721. ERC-1155 adds complexity that's only worth it when you genuinely have multiple token types in one contract.

**5. Not emitting `URI` events when metadata changes**  
If you update a token's URI, emit the `URI(newUri, tokenId)` event. Indexers and marketplaces listen to this event to refresh metadata. Without it, they'll keep showing stale data.

---

## How This Connects to Production

Enjin pioneered ERC-1155 for gaming and it's now the standard for blockchain games. Gods Unchained uses ERC-1155 for its card game — each card type is a token ID, and players can hold multiple copies. OpenSea supports ERC-1155 natively. Rarible uses ERC-1155 for its "lazy minting" feature — creators mint off-chain and the token is only minted on-chain when first purchased. The batch transfer capability is also used in DeFi: some protocols use ERC-1155 to represent multiple positions in a single contract, reducing deployment costs and enabling batch operations.

---

## What to Learn Next

- **Access Control in Solidity: Ownable, Roles, and Multi-Sig** — secure your multi-token contract's admin functions properly.
- **Events and Logs: How Frontends Listen to Smart Contracts** — understand how marketplaces index ERC-1155 Transfer events.
- **ERC-721 Standard: Building an NFT from Scratch** — if you haven't already, understand the NFT standard that ERC-1155 extends.
