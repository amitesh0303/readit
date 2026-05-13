# Your First Solidity Smart Contract: Hello World to Token in 30 Minutes

**Track:** Beginner  
**Read time:** 14 min

---

## The Problem

Every Solidity tutorial starts with a "Hello World" contract that stores a string. You deploy it, call `getString()`, and... now what? That contract does nothing useful and teaches you almost nothing about how real contracts work.

The jump from "Hello World" to "something real" is where most beginners get stuck. This blog skips the toy example and takes you directly to building a minimal ERC-20 token from scratch — not using OpenZeppelin, not copying from a template, but writing every line yourself so you understand what each piece does. By the end, you'll have a deployed, working token on Sepolia testnet.

---

## Core Concepts

### Solidity File Structure

Every Solidity file follows this structure:

```solidity
// 1. License identifier (required for compilation without warnings)
// SPDX-License-Identifier: MIT

// 2. Pragma — specifies compiler version
// ^ means "compatible with 0.8.20 up to (not including) 0.9.0"
pragma solidity ^0.8.20;

// 3. Imports (if any)
// import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 4. Contract definition
contract MyContract {
    // state variables, events, modifiers, functions
}
```

### State Variables and Types

State variables are stored permanently on-chain in the contract's storage. Every read/write costs gas.

```solidity
contract TypesDemo {
    // Unsigned integers — uint8 to uint256 (in steps of 8)
    uint256 public totalSupply;    // 0 to 2^256-1
    uint8 public decimals = 18;    // 0 to 255

    // Signed integers
    int256 public temperature;     // negative and positive

    // Address — 20-byte Ethereum address
    address public owner;

    // Boolean
    bool public paused;

    // Bytes — fixed size
    bytes32 public merkleRoot;

    // String — dynamic, expensive to store
    string public name;

    // Mapping — hash table, key → value
    mapping(address => uint256) public balances;

    // Nested mapping
    mapping(address => mapping(address => uint256)) public allowances;
}
```

### Functions and Visibility

```solidity
contract VisibilityDemo {
    uint256 private _value;

    // external — can only be called from outside the contract
    // public — can be called from outside AND inside
    // internal — only this contract and contracts that inherit it
    // private — only this contract

    // view — reads state, doesn't modify it (no gas when called off-chain)
    // pure — doesn't read OR modify state
    // payable — can receive ETH

    function setValue(uint256 val) external {
        _value = val;
    }

    function getValue() external view returns (uint256) {
        return _value;
    }

    function add(uint256 a, uint256 b) external pure returns (uint256) {
        return a + b; // pure: no state access
    }

    function deposit() external payable {
        // msg.value contains the ETH sent
    }
}
```

### Events

Events are the cheapest way to store data on-chain. They're not accessible from contracts (only from off-chain), but they're indexed and queryable. Frontends use them to react to state changes.

```solidity
// Declare event
event Transfer(address indexed from, address indexed to, uint256 value);

// Emit event
emit Transfer(msg.sender, recipient, amount);
```

`indexed` parameters can be filtered in log queries. You can have up to 3 indexed parameters per event.

### Modifiers

Modifiers are reusable function guards:

```solidity
modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _; // execution continues here after the check
}

function mint(address to, uint256 amount) external onlyOwner {
    // only owner can call this
}
```

---

## Code Walkthrough

Here's a complete, minimal ERC-20 token — every line commented:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MinimalToken
 * @notice A minimal ERC-20 token implementation from scratch.
 *         Implements the full ERC-20 interface without OpenZeppelin.
 */
contract MinimalToken {
    // ─── State Variables ───────────────────────────────────────────────────

    string public name;        // token name, e.g. "My Token"
    string public symbol;      // ticker, e.g. "MTK"
    uint8 public decimals;     // decimal places — 18 is standard (like ETH)
    uint256 public totalSupply;

    // balances[address] = how many tokens that address holds
    mapping(address => uint256) public balanceOf;

    // allowances[owner][spender] = how many tokens spender can move on owner's behalf
    // This is what approve() + transferFrom() uses
    mapping(address => mapping(address => uint256)) public allowance;

    // The address that deployed this contract — has minting rights
    address public owner;

    // ─── Events ────────────────────────────────────────────────────────────

    // ERC-20 standard requires these two events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply
    ) {
        name = _name;
        symbol = _symbol;
        decimals = 18; // standard: 1 token = 1e18 smallest units

        owner = msg.sender; // deployer becomes owner

        // Mint initial supply to deployer
        // _initialSupply is in "whole tokens" — multiply by 10^18 for wei-equivalent
        _mint(msg.sender, _initialSupply * 10 ** decimals);
    }

    // ─── ERC-20 Core Functions ─────────────────────────────────────────────

    /**
     * @notice Transfer tokens from caller to recipient.
     * @param to Recipient address
     * @param amount Amount in smallest units (wei-equivalent)
     * @return success Always true (reverts on failure)
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Approve spender to move tokens on caller's behalf.
     * @dev Common pattern: approve a DEX router to spend your tokens.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfer tokens from `from` to `to` using caller's allowance.
     * @dev Used by DEX routers, lending protocols, etc.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];

        // type(uint256).max is the "infinite approval" pattern
        // If allowance is max, don't decrement it (saves gas on repeated calls)
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "Insufficient allowance");
            allowance[from][msg.sender] = currentAllowance - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    // ─── Owner Functions ───────────────────────────────────────────────────

    /**
     * @notice Mint new tokens. Only callable by owner.
     */
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from caller's balance.
     */
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        // Burn = transfer to zero address by convention
        emit Transfer(msg.sender, address(0), amount);
    }

    // ─── Internal Functions ────────────────────────────────────────────────

    /**
     * @dev Internal transfer — shared by transfer() and transferFrom()
     */
    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "Transfer from zero address");
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    /**
     * @dev Internal mint — creates new tokens out of thin air
     */
    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Mint to zero address");

        totalSupply += amount;
        balanceOf[to] += amount;

        // ERC-20 convention: mint = transfer from zero address
        emit Transfer(address(0), to, amount);
    }
}
```

Now let's deploy and interact with it using a Hardhat script:

```typescript
// scripts/deploy-token.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  // Deploy with constructor args: name, symbol, initial supply (in whole tokens)
  const Token = await ethers.getContractFactory("MinimalToken");
  const token = await Token.deploy("My Token", "MTK", 1_000_000); // 1M tokens
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log("Token deployed to:", address);

  // Read initial state
  console.log("Name:", await token.name());
  console.log("Symbol:", await token.symbol());
  console.log("Total supply:", ethers.formatUnits(await token.totalSupply(), 18));
  console.log(
    "Deployer balance:",
    ethers.formatUnits(await token.balanceOf(deployer.address), 18)
  );

  // Transfer some tokens
  const recipient = "0xRecipientAddress";
  const amount = ethers.parseUnits("1000", 18); // 1000 tokens
  const tx = await token.transfer(recipient, amount);
  await tx.wait();
  console.log("Transferred 1000 MTK to", recipient);
}

main().catch(console.error);
```

---

## Common Mistakes and Gotchas

**1. Forgetting that `uint256` arithmetic doesn't overflow in Solidity 0.8+**  
Solidity 0.8.0 added built-in overflow/underflow protection. `uint256 x = 0; x -= 1;` will revert, not wrap around to `2^256 - 1`. This is good — but it means you need to check your logic carefully. If you intentionally want wrapping arithmetic (rare), use `unchecked { }` blocks.

**2. Using `transfer()` or `send()` for ETH transfers**  
`address.transfer(amount)` and `address.send(amount)` forward only 2300 gas — not enough for smart contract recipients that do anything in their `receive()` function. Always use `(bool success, ) = addr.call{value: amount}("")` and check `success`.

**3. Not emitting events**  
The ERC-20 standard requires `Transfer` and `Approval` events. If you skip them, your token won't show up correctly in wallets, block explorers, or indexers. Events are part of the interface contract, not optional.

**4. Approving exact amounts instead of using infinite approval**  
Many DeFi protocols ask users to approve `type(uint256).max` (infinite approval) to avoid repeated approval transactions. This is a UX convenience but a security risk — if the protocol is exploited, the attacker can drain your entire balance. Understand the tradeoff before implementing it.

**5. Deploying without testing**  
Even a simple token has edge cases: what happens if you transfer to `address(0)`? What if `amount` is 0? What if the recipient is the contract itself? Write tests for these before deploying. A bug in a token contract can make tokens permanently unrecoverable.

---

## How This Connects to Production

The token you just built is functionally identical to the core of USDC, WETH, or any ERC-20 on mainnet — the difference is in the surrounding infrastructure (access control, upgradeability, compliance features). Uniswap's liquidity pool tokens (UNI-V2 LP tokens) are ERC-20s. Aave's aTokens (interest-bearing deposit receipts) are ERC-20s. Compound's cTokens are ERC-20s. The ERC-20 standard is the atomic unit of DeFi composability — every protocol that handles tokens speaks this interface. Understanding it from scratch means you can read any token contract, spot non-standard behavior, and build protocols that interact with any token correctly.

---

## What to Learn Next

- **Solidity Data Types, Storage vs Memory vs Calldata — Deep Dive** — understand the memory model that determines gas costs and data lifetime.
- **ERC-20 Standard: Building a Token from Scratch** — go deeper with OpenZeppelin, permit (EIP-2612), and production-grade token patterns.
- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — learn the attack vectors before you deploy anything with real value.
