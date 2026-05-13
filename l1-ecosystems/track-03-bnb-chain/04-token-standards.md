# BEP-20, BEP-721, and BEP-1155 Token Standards

**Track:** BNB Chain Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've deployed a basic BEP-20 token, but real-world applications need more than fungible tokens. You need NFTs for digital collectibles (BEP-721), multi-token contracts for gaming inventories (BEP-1155), and you need to understand how these standards interact with BSC's ecosystem — DEX listings, marketplace compatibility, and wallet display. Using the wrong standard or missing required extensions means your tokens won't work with PancakeSwap, NFT marketplaces, or popular wallets.

## Core Concepts

### BEP-20: Fungible Tokens

BEP-20 is the BSC equivalent of ERC-20. Every DeFi protocol on BSC (PancakeSwap, Venus, Alpaca Finance) expects this interface:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.0/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title ProductionBEP20
 * @dev A production-ready BEP-20 token with permit (gasless approvals),
 * capped supply, and owner-only minting.
 */
contract ProductionBEP20 is ERC20, ERC20Permit, Ownable {
    uint256 public immutable cap;

    error CapExceeded(uint256 requested, uint256 remaining);
    error ZeroAddress();

    constructor(
        string memory name,
        string memory symbol,
        uint256 _cap,
        uint256 initialMint
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        if (_cap == 0) revert CapExceeded(0, 0);
        cap = _cap;
        if (initialMint > 0) {
            _mint(msg.sender, initialMint);
        }
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (totalSupply() + amount > cap) {
            revert CapExceeded(amount, cap - totalSupply());
        }
        _mint(to, amount);
    }
}
```

Key extensions for BSC DeFi compatibility:
- **ERC20Permit** — Enables gasless approvals via EIP-2612 signatures (PancakeSwap V3 uses this)
- **Capped supply** — Required for tokenomics transparency on BSC token listings
- **Custom errors** — Gas-efficient reverts (saves ~200 gas vs `require` strings on BSC)

### BEP-721: Non-Fungible Tokens (NFTs)

BEP-721 is identical to ERC-721. Use it for unique digital assets — art, game characters, domain names:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.0/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title BNBCollectible
 * @dev A BEP-721 NFT collection with enumeration and URI storage.
 * Compatible with Element Market, tofuNFT, and other BSC NFT marketplaces.
 */
contract BNBCollectible is ERC721, ERC721URIStorage, ERC721Enumerable, Ownable {
    uint256 private _nextTokenId;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public mintPrice = 0.01 ether; // 0.01 BNB

    error MaxSupplyReached();
    error InsufficientPayment(uint256 sent, uint256 required);

    constructor() ERC721("BNB Collectible", "BNBC") Ownable(msg.sender) {}

    function mint(string memory uri) external payable {
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyReached();
        if (msg.value < mintPrice) {
            revert InsufficientPayment(msg.value, mintPrice);
        }

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    // Required overrides for multiple inheritance
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, ERC721Enumerable) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable) returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
```

### BEP-1155: Multi-Token Standard

BEP-1155 combines fungible and non-fungible tokens in a single contract. Ideal for gaming (swords, potions, unique legendaries all in one contract):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.0/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC1155/extensions/ERC1155Supply.sol";

/**
 * @title GameItems
 * @dev A BEP-1155 multi-token for a BSC game.
 * Token IDs 0-99: fungible items (potions, gold)
 * Token IDs 100+: unique items (legendary weapons)
 */
contract GameItems is ERC1155, Ownable, ERC1155Supply {
    // Fungible item IDs
    uint256 public constant GOLD = 0;
    uint256 public constant HEALTH_POTION = 1;
    uint256 public constant MANA_POTION = 2;

    // Non-fungible threshold
    uint256 public constant NFT_THRESHOLD = 100;
    uint256 private _nextNftId = NFT_THRESHOLD;

    mapping(uint256 => uint256) public maxSupply;

    error SupplyExceeded(uint256 tokenId, uint256 maxAllowed);

    constructor(string memory baseUri) ERC1155(baseUri) Ownable(msg.sender) {
        // Set max supplies for fungible items
        maxSupply[GOLD] = 1_000_000_000 * 10 ** 18;
        maxSupply[HEALTH_POTION] = 1_000_000;
        maxSupply[MANA_POTION] = 1_000_000;
    }

    function mintFungible(
        address to,
        uint256 id,
        uint256 amount
    ) external onlyOwner {
        if (id >= NFT_THRESHOLD) revert("Use mintNFT for unique items");
        if (totalSupply(id) + amount > maxSupply[id]) {
            revert SupplyExceeded(id, maxSupply[id]);
        }
        _mint(to, id, amount, "");
    }

    function mintNFT(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextNftId++;
        _mint(to, tokenId, 1, "");
        return tokenId;
    }

    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts
    ) external onlyOwner {
        _mintBatch(to, ids, amounts, "");
    }

    // Required override
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}
```

### Deploying and Verifying Token Contracts

```shell
# Deploy the BEP-721 NFT contract
npx hardhat run scripts/deployNFT.js --network bscTestnet
```

```
Expected output:
Deploying BNBCollectible...
BNBCollectible deployed to: 0xabcdef1234567890abcdef1234567890abcdef12
View on BscScan: https://testnet.bscscan.com/address/0xabcdef1234567890abcdef1234567890abcdef12
```

```shell
# Verify the contract
npx hardhat verify --network bscTestnet 0xYOUR_NFT_ADDRESS
```

```
Expected output:
Successfully verified contract BNBCollectible on the block explorer.
https://testnet.bscscan.com/address/0xYOUR_NFT_ADDRESS#code
```

### Standard Comparison

| Feature | BEP-20 | BEP-721 | BEP-1155 |
|---------|--------|---------|----------|
| Fungibility | Fungible | Non-fungible | Both |
| Batch transfers | No (one at a time) | No | Yes |
| Gas per transfer | ~65,000 | ~85,000 | ~50,000 (batch) |
| Use case | Currencies, governance | Art, collectibles | Gaming, mixed assets |
| DEX compatible | PancakeSwap | Element Market | Custom marketplaces |

## Common Pitfalls

1. **Missing `supportsInterface` override in BEP-721** — If you inherit from multiple ERC-721 extensions (URIStorage + Enumerable), you must override `supportsInterface`. Without it, marketplaces can't detect your NFT's capabilities and won't display metadata.

2. **Using BEP-721 for fungible game items** — Deploying 1 million identical sword NFTs wastes gas. Use BEP-1155 with a fungible token ID for stackable items. Reserve BEP-721 for truly unique assets.

3. **Hardcoding mint price without a setter** — BNB price fluctuates. A 0.01 BNB mint price might be $3 today and $10 next month. Add an owner-only `setMintPrice()` function or use a Chainlink price feed for USD-denominated pricing.

4. **Not implementing `_update` overrides in OpenZeppelin v5** — OpenZeppelin 5.x changed the hook system. If you inherit from both ERC721 and ERC721Enumerable, you must override `_update` and `_increaseBalance` or compilation fails.

## What to Learn Next

- [Frontend Integration with BSC](./05-frontend-integration.md) — Connect MetaMask to BSC and interact with your deployed tokens
- [OpenZeppelin ERC-20 Source](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.0.0/contracts/token/ERC20) — Audited implementation reference
- [BNB Chain Token Standards](https://docs.bnbchain.org/docs/learn/intro#token-standards) — Official documentation on BEP standards
