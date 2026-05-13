# ERC-20 Standard: Building a Token from Scratch

**Track:** Beginner → Intermediate  
**Read time:** 14 min

---

## The Problem

You've seen ERC-20 tokens everywhere — USDC, LINK, UNI, WETH. You know they're "fungible tokens." But when you actually need to build one for a protocol — a governance token, a reward token, a stablecoin — you realize there's a lot more to it than just `transfer()` and `balanceOf()`.

What's the full ERC-20 interface and why does each function exist? What's the `permit` extension and why does every serious token implement it? How do you add minting, burning, and access control without introducing vulnerabilities? This blog builds a production-grade ERC-20 from scratch, explaining every design decision.

---

## Core Concepts

### The Full ERC-20 Interface

ERC-20 (EIP-20) defines a standard interface that all fungible tokens must implement. Here's the complete interface:

```solidity
interface IERC20 {
    // ── Required Functions ──────────────────────────────────────────────

    // Total tokens in existence
    function totalSupply() external view returns (uint256);

    // Token balance of an address
    function balanceOf(address account) external view returns (uint256);

    // Transfer tokens from caller to recipient
    function transfer(address to, uint256 amount) external returns (bool);

    // How many tokens `spender` is allowed to move on behalf of `owner`
    function allowance(address owner, address spender) external view returns (uint256);

    // Approve `spender` to move up to `amount` tokens on caller's behalf
    function approve(address spender, uint256 amount) external returns (bool);

    // Move `amount` tokens from `from` to `to` using caller's allowance
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    // ── Required Events ─────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
```

The `approve` + `transferFrom` pattern is how DeFi protocols interact with tokens. When you "approve" Uniswap to spend your USDC, you're calling `approve(uniswapRouter, amount)`. When the swap executes, Uniswap calls `transferFrom(you, pool, amount)`.

### The Approve/TransferFrom Race Condition

There's a known vulnerability in the `approve` function. If you have an existing allowance of 100 and want to change it to 50, an attacker watching the mempool can:

1. See your `approve(spender, 50)` transaction
2. Front-run it with `transferFrom(you, attacker, 100)` — uses the old allowance
3. Your `approve(spender, 50)` goes through
4. Attacker calls `transferFrom(you, attacker, 50)` again — uses the new allowance

Total stolen: 150 tokens instead of 50.

The fix: use `increaseAllowance` / `decreaseAllowance` instead of `approve` when changing an existing non-zero allowance. Or use EIP-2612 `permit` (covered below).

### EIP-2612: The Permit Extension

`permit` lets users approve token spending with an off-chain signature instead of an on-chain transaction. This enables:
- Gasless approvals (the protocol pays gas, not the user)
- Approve + action in a single transaction (no separate approval tx)

```
Traditional flow:
1. User sends approve() tx — pays gas
2. User sends swap() tx — pays gas
Total: 2 transactions, 2 gas payments

Permit flow:
1. User signs permit message off-chain — free
2. User sends swap() tx with permit signature — 1 gas payment
   (swap() calls permit() internally, then transferFrom())
Total: 1 transaction, 1 gas payment
```

---

## Code Walkthrough

Here's a production-grade ERC-20 with permit, roles, and proper security patterns:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProductionToken
 * @notice Production-grade ERC-20 with:
 *   - EIP-2612 permit (gasless approvals)
 *   - Role-based minting
 *   - Burnable
 *   - Pausable transfers
 */
contract ProductionToken {
    // ─── ERC-20 State ──────────────────────────────────────────────────────

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─── EIP-2612 Permit State ─────────────────────────────────────────────

    // EIP-712 domain separator — uniquely identifies this contract
    // Prevents signatures from being replayed on other contracts/chains
    bytes32 public immutable DOMAIN_SEPARATOR;

    // Permit typehash — identifies the permit struct for EIP-712
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // Nonces prevent permit signature replay attacks
    mapping(address => uint256) public nonces;

    // ─── Access Control ────────────────────────────────────────────────────

    address public owner;
    mapping(address => bool) public minters;
    bool public paused;

    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens

    // ─── Events ────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;

        // Build EIP-712 domain separator
        // This is hashed once at deployment and stored as immutable
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_name)),
                keccak256(bytes("1")),
                block.chainid,   // prevents cross-chain replay
                address(this)    // prevents cross-contract replay
            )
        );
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "Not minter");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Transfers paused");
        _;
    }

    // ─── ERC-20 Core ───────────────────────────────────────────────────────

    function transfer(address to, uint256 amount)
        external
        whenNotPaused
        returns (bool)
    {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Increase allowance atomically — avoids the approve race condition.
     */
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _approve(msg.sender, spender, allowance[msg.sender][spender] + addedValue);
        return true;
    }

    /**
     * @notice Decrease allowance atomically.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 current = allowance[msg.sender][spender];
        require(current >= subtractedValue, "Allowance below zero");
        _approve(msg.sender, spender, current - subtractedValue);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        whenNotPaused
        returns (bool)
    {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "Insufficient allowance");
            allowance[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, currentAllowance - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    // ─── EIP-2612 Permit ───────────────────────────────────────────────────

    /**
     * @notice Approve via off-chain signature — no separate approve tx needed.
     * @param owner Token owner who signed the permit
     * @param spender Address being approved
     * @param value Amount to approve
     * @param deadline Signature expiry timestamp
     * @param v, r, s ECDSA signature components
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "Permit expired");

        // Reconstruct the signed message hash
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline)
        );

        // EIP-712 encoding: "\x19\x01" + domainSeparator + structHash
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        // Recover the signer from the signature
        address recoveredSigner = ecrecover(digest, v, r, s);
        require(recoveredSigner != address(0) && recoveredSigner == owner, "Invalid signature");

        _approve(owner, spender, value);
    }

    // ─── Mint / Burn ───────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external onlyMinter {
        require(totalSupply + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        allowance[from][msg.sender] = currentAllowance - amount;
        emit Approval(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    function addMinter(address minter) external onlyOwner {
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "From zero address");
        require(to != address(0), "To zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "Approve from zero");
        require(spender != address(0), "Approve to zero");
        allowance[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Mint to zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
```

Here's how to use the permit function from a frontend:

```typescript
import { ethers } from "ethers";

async function permitAndSwap(
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
  signer: ethers.Signer
) {
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
  const signerAddress = await signer.getAddress();

  // Get current nonce for this address
  const nonce = await token.nonces(signerAddress);
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  // Build EIP-712 typed data matching the contract's DOMAIN_SEPARATOR
  const domain = {
    name: await token.name(),
    version: "1",
    chainId: (await signer.provider!.getNetwork()).chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    owner: signerAddress,
    spender: spenderAddress,
    value: amount,
    nonce: nonce,
    deadline: deadline,
  };

  // Sign off-chain — no gas, no transaction
  const signature = await signer.signTypedData(domain, types, value);
  const { v, r, s } = ethers.Signature.from(signature);

  // Now call the protocol function that uses permit internally
  // The protocol calls token.permit() then token.transferFrom() in one tx
  const protocol = new ethers.Contract(spenderAddress, PROTOCOL_ABI, signer);
  await protocol.depositWithPermit(tokenAddress, amount, deadline, v, r, s);
}
```

---

## Common Mistakes and Gotchas

**1. Not checking return values of `transfer` and `transferFrom`**  
The ERC-20 standard says these functions return `bool`. Some non-standard tokens (USDT on mainnet) don't return a value at all. If you call `token.transfer(to, amount)` and don't check the return value, a failed transfer silently succeeds from your contract's perspective. Use OpenZeppelin's `SafeERC20` library in production, which handles both cases.

**2. Infinite approvals without understanding the risk**  
`approve(spender, type(uint256).max)` is convenient but means the spender can drain your entire balance forever. If the spender contract is later exploited, you're fully exposed. Some protocols now use time-limited or amount-limited approvals. Consider your threat model.

**3. Forgetting to emit `Approval` in `transferFrom`**  
When `transferFrom` decrements the allowance, you should emit an `Approval` event with the new allowance value. Many implementations skip this. Block explorers and indexers use this event to track allowance state.

**4. Permit nonce replay**  
The nonce in `permit` is per-address and increments on each use. If you sign a permit and it's used, the same signature can't be used again. But if you sign a permit and it's NOT used before the deadline, someone can use it later. Don't sign permits with long deadlines for sensitive operations.

**5. Domain separator not including `chainId`**  
If your `DOMAIN_SEPARATOR` doesn't include `block.chainid`, a permit signature on mainnet can be replayed on a fork or testnet with the same contract address. Always include `chainId` in the domain.

---

## How This Connects to Production

USDC (Circle) is an ERC-20 with a blacklist feature — Circle can freeze addresses. WETH (Wrapped Ether) is an ERC-20 where `deposit()` mints tokens and `withdraw()` burns them. Uniswap's UNI token implements EIP-2612 permit, which is why Uniswap's interface can do approve + swap in one transaction. Aave's aTokens are ERC-20s that automatically accrue interest — `balanceOf` returns a value that increases over time without any transactions. The ERC-20 standard is a floor, not a ceiling — every serious token adds protocol-specific logic on top of it.

---

## What to Learn Next

- **ERC-721 Standard: Building an NFT from Scratch** — the non-fungible counterpart to ERC-20.
- **Access Control in Solidity: Ownable, Roles, and Multi-Sig** — go deeper on the role-based access control pattern used in the token above.
- **Token Vesting and Staking Contracts: Architecture and Patterns** — build on top of ERC-20 to create DeFi primitives.
