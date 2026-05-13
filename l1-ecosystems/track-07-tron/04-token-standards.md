# Token Standards: TRC-20, TRC-721, and TRC-1155

**Track:** Tron Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've deployed a basic TRC-20 token, but Tron supports multiple token standards for different use cases. TRC-721 handles NFTs, TRC-1155 handles multi-token collections, and there are Tron-specific nuances around energy costs and storage that affect which standard you choose. This lesson covers all three standards with deployment-ready implementations and explains when to use each one.

---

## Core Concepts

### Token Standards Comparison

| Feature | TRC-20 | TRC-721 | TRC-1155 |
|---------|--------|---------|----------|
| Token type | Fungible | Non-fungible | Multi-token |
| Use case | Currencies, stablecoins | Unique assets, art | Gaming items, mixed collections |
| EVM equivalent | ERC-20 | ERC-721 | ERC-1155 |
| Transfer energy | ~30,000-65,000 | ~50,000-100,000 | ~40,000-80,000 |
| Storage per token | Low (balance mapping) | Medium (ownership + metadata) | Medium (balance per ID) |
| Batch operations | No | No | Yes (native) |

### TRC-20: Fungible Tokens

TRC-20 is the most widely used standard on Tron. USDT, USDC, and most DeFi tokens use TRC-20.

Key implementation considerations for Tron:

```solidity
// contracts/TRC20Token.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TRC20Token
 * @dev Production-ready TRC-20 with burn and pause functionality
 */
contract TRC20Token {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    address public owner;
    bool public paused;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Paused(address account);
    event Unpaused(address account);

    modifier onlyOwner() {
        require(msg.sender == owner, "TRC20: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "TRC20: paused");
        _;
    }

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        _mint(msg.sender, _initialSupply * (10 ** uint256(decimals)));
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external whenNotPaused returns (bool) {
        require(spender != address(0), "TRC20: approve to zero");
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address _owner, address spender) external view returns (uint256) {
        return _allowances[_owner][spender];
    }

    function transferFrom(address from, address to, uint256 amount) external whenNotPaused returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "TRC20: insufficient allowance");
        _allowances[from][msg.sender] = currentAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external {
        require(_balances[msg.sender] >= amount, "TRC20: burn exceeds balance");
        _balances[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "TRC20: transfer from zero");
        require(to != address(0), "TRC20: transfer to zero");
        require(_balances[from] >= amount, "TRC20: insufficient balance");

        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "TRC20: mint to zero");
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
```

### TRC-721: Non-Fungible Tokens

TRC-721 follows the ERC-721 standard for unique tokens. Each token has a distinct ID and owner:

```solidity
// contracts/TRC721NFT.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TRC721NFT
 * @dev TRC-721 NFT with metadata URI and minting
 */
contract TRC721NFT {
    string public name;
    string public symbol;
    address public owner;
    uint256 private _tokenIdCounter;

    // Token ownership
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => string) private _tokenURIs;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "TRC721: not owner");
        _;
    }

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
    }

    function balanceOf(address _owner) external view returns (uint256) {
        require(_owner != address(0), "TRC721: zero address");
        return _balances[_owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "TRC721: nonexistent token");
        return tokenOwner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "TRC721: nonexistent token");
        return _tokenURIs[tokenId];
    }

    function mint(address to, string calldata uri) external onlyOwner returns (uint256) {
        require(to != address(0), "TRC721: mint to zero");

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        _balances[to]++;
        _owners[tokenId] = to;
        _tokenURIs[tokenId] = uri;

        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }

    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(msg.sender == tokenOwner || _operatorApprovals[tokenOwner][msg.sender],
            "TRC721: not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "TRC721: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(_isApprovedOrOwner(msg.sender, tokenId), "TRC721: not authorized");
        require(ownerOf(tokenId) == from, "TRC721: wrong owner");
        require(to != address(0), "TRC721: transfer to zero");

        // Clear approval
        _tokenApprovals[tokenId] = address(0);

        _balances[from]--;
        _balances[to]++;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return (spender == tokenOwner ||
                _tokenApprovals[tokenId] == spender ||
                _operatorApprovals[tokenOwner][spender]);
    }
}
```

### TRC-1155: Multi-Token Standard

TRC-1155 is ideal for gaming and collections where you need both fungible and non-fungible tokens in a single contract:

```solidity
// contracts/TRC1155Collection.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TRC1155Collection
 * @dev Multi-token standard with batch operations
 * @notice Ideal for gaming items, mixed collections
 */
contract TRC1155Collection {
    address public owner;
    string private _uri;

    // id => account => balance
    mapping(uint256 => mapping(address => uint256)) private _balances;
    // account => operator => approved
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    // id => total supply
    mapping(uint256 => uint256) private _totalSupply;

    event TransferSingle(
        address indexed operator, address indexed from,
        address indexed to, uint256 id, uint256 value
    );
    event TransferBatch(
        address indexed operator, address indexed from,
        address indexed to, uint256[] ids, uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);

    modifier onlyOwner() {
        require(msg.sender == owner, "TRC1155: not owner");
        _;
    }

    constructor(string memory baseUri) {
        owner = msg.sender;
        _uri = baseUri;
    }

    function uri(uint256) external view returns (string memory) {
        return _uri;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        require(account != address(0), "TRC1155: zero address");
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory)
    {
        require(accounts.length == ids.length, "TRC1155: length mismatch");
        uint256[] memory batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            batchBalances[i] = _balances[ids[i]][accounts[i]];
        }
        return batchBalances;
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "TRC1155: self approval");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function safeTransferFrom(
        address from, address to, uint256 id, uint256 amount, bytes calldata
    ) external {
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "TRC1155: not authorized");
        require(to != address(0), "TRC1155: transfer to zero");

        uint256 fromBalance = _balances[id][from];
        require(fromBalance >= amount, "TRC1155: insufficient balance");

        _balances[id][from] = fromBalance - amount;
        _balances[id][to] += amount;

        emit TransferSingle(msg.sender, from, to, id, amount);
    }

    function safeBatchTransferFrom(
        address from, address to,
        uint256[] calldata ids, uint256[] calldata amounts, bytes calldata
    ) external {
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "TRC1155: not authorized");
        require(to != address(0), "TRC1155: transfer to zero");
        require(ids.length == amounts.length, "TRC1155: length mismatch");

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            uint256 amount = amounts[i];
            uint256 fromBalance = _balances[id][from];
            require(fromBalance >= amount, "TRC1155: insufficient balance");
            _balances[id][from] = fromBalance - amount;
            _balances[id][to] += amount;
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);
    }

    // Minting functions
    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        require(to != address(0), "TRC1155: mint to zero");
        _balances[id][to] += amount;
        _totalSupply[id] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
    }

    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts)
        external onlyOwner
    {
        require(to != address(0), "TRC1155: mint to zero");
        require(ids.length == amounts.length, "TRC1155: length mismatch");

        for (uint256 i = 0; i < ids.length; i++) {
            _balances[ids[i]][to] += amounts[i];
            _totalSupply[ids[i]] += amounts[i];
        }

        emit TransferBatch(msg.sender, address(0), to, ids, amounts);
    }

    function totalSupply(uint256 id) external view returns (uint256) {
        return _totalSupply[id];
    }
}
```

### Energy Cost Comparison

Understanding energy costs helps you choose the right standard:

```javascript
// Energy costs on Tron (approximate, January 2025):
//
// TRC-20 transfer:        ~30,000 - 65,000 energy
// TRC-20 approve:         ~25,000 - 30,000 energy
// TRC-20 transferFrom:    ~35,000 - 70,000 energy
//
// TRC-721 mint:           ~80,000 - 150,000 energy
// TRC-721 transfer:       ~50,000 - 100,000 energy
//
// TRC-1155 mint:          ~60,000 - 100,000 energy
// TRC-1155 batch mint:    ~40,000 + 20,000 per item
// TRC-1155 transfer:      ~40,000 - 80,000 energy
// TRC-1155 batch transfer: ~35,000 + 15,000 per item
//
// At 420 sun/energy:
// 65,000 energy = 27,300,000 sun = 27.3 TRX (~$2.70)
// 150,000 energy = 63,000,000 sun = 63 TRX (~$6.30)
```

### Choosing the Right Standard

```
Decision tree:
┌─ Are all tokens identical (fungible)?
│  └─ YES → TRC-20
│     (currencies, stablecoins, governance tokens)
│
├─ Is each token unique?
│  └─ YES → TRC-721
│     (art NFTs, domain names, unique collectibles)
│
└─ Do you need both fungible AND non-fungible in one contract?
   └─ YES → TRC-1155
      (gaming: 1000 gold coins + 1 legendary sword)
      (collections: editions of 100 + 1-of-1 pieces)
```

---

## Common Pitfalls

1. **Using TRC-721 for large collections with editions** — If you're minting 10,000 copies of the same item (like game currency), TRC-721 creates 10,000 separate token IDs with individual ownership records. TRC-1155 handles this with a single ID and a balance, saving massive amounts of energy and storage. Use TRC-1155 for any collection with fungible sub-items.

2. **Not implementing `supportsInterface` for marketplace compatibility** — Tron NFT marketplaces (like APENFT) check for interface support via ERC-165's `supportsInterface`. If your TRC-721 or TRC-1155 contract doesn't implement this, marketplaces won't recognize it. Add the standard interface IDs: `0x80ac58cd` (TRC-721), `0xd9b67a26` (TRC-1155).

3. **Forgetting batch operations save energy** — TRC-1155's `safeBatchTransferFrom` is significantly cheaper than calling `safeTransferFrom` multiple times. Each individual call has ~35,000 energy overhead. Batching 10 transfers saves approximately 300,000 energy compared to 10 individual calls.

4. **Hardcoding metadata URIs on-chain** — Storing full metadata JSON on-chain is extremely expensive on Tron (storage staking costs). Use IPFS or Arweave for metadata and store only the base URI on-chain. The `uri(uint256)` function in TRC-1155 should return a template URL where the client substitutes the token ID.

5. **Not handling the receiver hook for safe transfers** — `safeTransferFrom` in TRC-721 and TRC-1155 should check if the receiver is a contract and call `onERC721Received` or `onERC1155Received`. Skipping this check means tokens can be permanently locked in contracts that don't know how to handle them.

---

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect TronLink wallet and interact with your tokens using TronWeb
- [APENFT Marketplace](https://apenft.io/) — Tron's primary NFT marketplace for TRC-721 and TRC-1155 tokens
