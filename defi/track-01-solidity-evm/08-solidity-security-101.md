# Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running

**Track:** Intermediate  
**Read time:** 14 min

---

## The Problem

The DAO hack: $60M drained via re-entrancy. Poly Network: $611M stolen via access control bug. Euler Finance: $197M via flash loan attack. Nomad Bridge: $190M via a single-line logic error. These aren't theoretical vulnerabilities — they're production exploits that happened to audited, well-funded protocols.

Smart contract security is different from traditional software security. There's no patch, no rollback, no customer support. When funds are drained, they're gone. This blog covers the three most critical vulnerability classes every Solidity developer must understand before deploying anything with real value.

---

## Core Concepts

### Vulnerability 1: Re-entrancy

Re-entrancy is the most famous smart contract vulnerability. It's what took down The DAO in 2016 and has been exploited dozens of times since.

**How it works:**

When your contract sends ETH to an external address, that address can be a contract with a `receive()` or `fallback()` function. That function can call back into your contract before your original function finishes executing. If your contract's state hasn't been updated yet, the attacker can exploit the inconsistent state.

```
Victim.withdraw() called by Attacker
    ↓
Victim checks: attacker has 1 ETH balance ✓
    ↓
Victim sends 1 ETH to Attacker
    ↓
Attacker.receive() is triggered
    ↓
Attacker calls Victim.withdraw() AGAIN (re-enters)
    ↓
Victim checks: attacker still has 1 ETH balance ✓ (state not updated yet!)
    ↓
Victim sends 1 ETH AGAIN
    ↓
... repeats until Victim is drained
```

**Vulnerable code:**

```solidity
// VULNERABLE — DO NOT USE
contract VulnerableBank {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        // BUG: We send ETH BEFORE updating state
        // The attacker's receive() can call withdraw() again
        // before balances[msg.sender] is set to 0
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        balances[msg.sender] = 0; // too late — attacker already re-entered
    }
}
```

**The fix — Checks-Effects-Interactions (CEI) pattern:**

```solidity
// SAFE — Checks-Effects-Interactions pattern
contract SafeBank {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        // 1. CHECKS — validate conditions
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        // 2. EFFECTS — update state BEFORE external calls
        balances[msg.sender] = 0; // state updated first

        // 3. INTERACTIONS — external calls last
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        // Even if attacker re-enters here, balances[msg.sender] is already 0
    }
}
```

**Re-entrancy guard (belt and suspenders):**

```solidity
// Additional protection: mutex lock
contract ReentrancyGuarded {
    uint256 private _status = 1; // 1 = not entered, 2 = entered

    modifier nonReentrant() {
        require(_status == 1, "Reentrant call");
        _status = 2; // lock
        _;
        _status = 1; // unlock
    }

    function withdraw() external nonReentrant {
        // Even if CEI is violated, the mutex prevents re-entry
    }
}
```

**Cross-function re-entrancy** is subtler — the attacker re-enters a different function, not the same one:

```solidity
// VULNERABLE — cross-function re-entrancy
contract CrossFunctionVulnerable {
    mapping(address => uint256) public balances;
    mapping(address => bool) public hasWithdrawn;

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        (bool success, ) = msg.sender.call{value: amount}(""); // attacker re-enters claimBonus()
        require(success);
        balances[msg.sender] = 0;
    }

    function claimBonus() external {
        require(!hasWithdrawn[msg.sender], "Already claimed");
        // At this point, balances[msg.sender] is still non-zero (withdraw hasn't finished)
        // Attacker can claim bonus based on stale balance
        hasWithdrawn[msg.sender] = true;
        // ... send bonus based on balances[msg.sender]
    }
}
```

### Vulnerability 2: Integer Overflow/Underflow

Before Solidity 0.8.0, arithmetic operations silently wrapped around on overflow/underflow. `uint8 x = 255; x += 1;` would give `x = 0`. This was exploited in the BEC token hack ($900M in tokens created from nothing).

Solidity 0.8.0+ reverts on overflow/underflow by default. But there are still gotchas:

```solidity
// Safe in Solidity 0.8+ — reverts on overflow
uint256 a = type(uint256).max;
uint256 b = a + 1; // REVERTS

// But unchecked blocks bypass the protection
unchecked {
    uint256 c = a + 1; // wraps to 0 — no revert
}
```

`unchecked` blocks are used intentionally for gas optimization (loop counters, etc.) but must be used carefully:

```solidity
// Safe use of unchecked — loop counter can't overflow in practice
for (uint256 i = 0; i < length; ) {
    // ... loop body ...
    unchecked { i++; } // saves ~30 gas per iteration, safe because i < length
}

// DANGEROUS use of unchecked — user-controlled arithmetic
function calculateFee(uint256 amount, uint256 feeRate) external pure returns (uint256) {
    unchecked {
        return amount * feeRate / 10000; // could overflow if amount and feeRate are large
    }
}
```

**Casting vulnerabilities** — downcasting can silently truncate:

```solidity
// VULNERABLE — silent truncation
function processAmount(uint256 largeAmount) external {
    uint128 truncated = uint128(largeAmount); // silently drops upper 128 bits
    // If largeAmount > type(uint128).max, truncated is wrong
}

// SAFE — explicit check before casting
function processAmountSafe(uint256 largeAmount) external {
    require(largeAmount <= type(uint128).max, "Amount too large");
    uint128 safe = uint128(largeAmount);
}
```

### Vulnerability 3: Front-Running (MEV)

Front-running exploits the fact that transactions are visible in the mempool before they're included in a block. Miners/validators (and MEV bots) can reorder, insert, or censor transactions.

**Types of front-running:**

**Sandwich attack** — the most common DeFi attack:
1. Victim submits a swap: buy 100 ETH worth of TOKEN
2. Attacker sees it in mempool
3. Attacker front-runs: buys TOKEN first (price goes up)
4. Victim's swap executes at worse price
5. Attacker back-runs: sells TOKEN at higher price

**Displacement** — attacker replaces your transaction with theirs (same nonce, higher gas).

**Suppression** — attacker fills blocks to delay your transaction.

**Mitigations:**

```solidity
// 1. Slippage protection — reject if price moved too much
function swap(
    address tokenIn,
    uint256 amountIn,
    uint256 minAmountOut  // user specifies minimum acceptable output
) external {
    uint256 amountOut = _calculateOutput(tokenIn, amountIn);
    require(amountOut >= minAmountOut, "Slippage too high");
    // ... execute swap
}

// 2. Commit-reveal scheme — hide your action until it's too late to front-run
contract CommitReveal {
    mapping(address => bytes32) public commitments;
    mapping(address => uint256) public commitBlock;

    // Phase 1: commit a hash of your action (hidden)
    function commit(bytes32 commitment) external {
        commitments[msg.sender] = commitment;
        commitBlock[msg.sender] = block.number;
    }

    // Phase 2: reveal after enough blocks have passed
    function reveal(uint256 amount, bytes32 salt) external {
        require(block.number >= commitBlock[msg.sender] + 2, "Too early");
        require(block.number <= commitBlock[msg.sender] + 10, "Too late");

        // Verify the commitment matches
        bytes32 expected = keccak256(abi.encodePacked(msg.sender, amount, salt));
        require(commitments[msg.sender] == expected, "Invalid reveal");

        // Execute the action — too late to front-run
        _executeAction(amount);
    }
}

// 3. Deadline parameter — transaction expires if not included quickly
function swap(
    address tokenIn,
    uint256 amountIn,
    uint256 minAmountOut,
    uint256 deadline  // transaction reverts if included after this timestamp
) external {
    require(block.timestamp <= deadline, "Transaction expired");
    // ...
}
```

---

## Code Walkthrough

A secure vault contract demonstrating all three protections:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SecureVault
 * @notice Demonstrates security best practices:
 *   - CEI pattern for re-entrancy protection
 *   - nonReentrant guard as backup
 *   - Safe arithmetic (0.8+ default)
 *   - Slippage/deadline protection
 */
contract SecureVault {
    mapping(address => uint256) public deposits;
    uint256 private _status = 1;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    modifier nonReentrant() {
        require(_status == 1, "Reentrant");
        _status = 2;
        _;
        _status = 1;
    }

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        // Safe: 0.8+ reverts on overflow
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw with CEI pattern + nonReentrant guard.
     * @param amount Amount to withdraw in wei
     * @param deadline Transaction must be included before this timestamp
     */
    function withdraw(uint256 amount, uint256 deadline) external nonReentrant {
        // CHECKS
        require(block.timestamp <= deadline, "Expired");
        require(amount > 0, "Zero amount");
        require(deposits[msg.sender] >= amount, "Insufficient balance");

        // EFFECTS — update state before external call
        deposits[msg.sender] -= amount; // safe: checked above

        // INTERACTIONS — external call last
        emit Withdrawn(msg.sender, amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Batch withdraw for multiple users — demonstrates safe iteration.
     */
    function batchWithdraw(address[] calldata users) external nonReentrant {
        for (uint256 i = 0; i < users.length; ) {
            address user = users[i];
            uint256 amount = deposits[user];

            if (amount > 0) {
                deposits[user] = 0; // EFFECTS before INTERACTIONS
                (bool success, ) = user.call{value: amount}("");
                // Don't revert on individual failure — continue batch
                if (!success) {
                    deposits[user] = amount; // restore on failure
                }
            }

            unchecked { i++; } // safe: i < users.length
        }
    }
}
```

---

## Common Mistakes and Gotchas

**1. Using `transfer()` thinking it prevents re-entrancy**  
`address.transfer()` forwards only 2300 gas, which was historically not enough for re-entrant calls. But EIP-1884 increased the cost of some opcodes, and future EIPs may change gas costs again. Don't rely on gas stipends for security. Use CEI + nonReentrant instead.

**2. Forgetting read-only re-entrancy**  
Some protocols use `view` functions to read state from other contracts. If that state is being modified mid-execution (during a re-entrant call), the `view` function returns inconsistent data. Curve Finance was exploited via read-only re-entrancy — an attacker manipulated Curve's pool state mid-transaction, causing a protocol that read Curve's price to use a manipulated value.

**3. Assuming `block.timestamp` is safe for deadlines**  
Validators can manipulate `block.timestamp` by up to ~15 seconds. For deadlines measured in minutes or hours, this is fine. For deadlines measured in seconds, it's a problem. Don't use `block.timestamp` for anything that needs second-level precision.

**4. Not protecting against price oracle manipulation**  
Using a DEX spot price as an oracle is dangerous — it can be manipulated in a single transaction via flash loans. Always use time-weighted average prices (TWAPs) or Chainlink price feeds for anything that affects financial calculations.

**5. Ignoring the `tx.origin` phishing vector**  
If your contract uses `tx.origin` for authorization, an attacker can trick a user into calling a malicious contract, which then calls your contract. `tx.origin` is the original user, so the check passes. Always use `msg.sender`.

---

## How This Connects to Production

The Euler Finance hack ($197M, March 2023) combined a donation attack with a re-entrancy-like vulnerability in their liquidation logic. The Reentrancy Guard wasn't enough because the vulnerability was in the interaction between two functions, not a single function. Curve Finance's read-only re-entrancy vulnerability affected multiple protocols that used Curve's LP token price as an oracle. Uniswap V2 uses a TWAP oracle specifically to prevent flash loan price manipulation. Every serious protocol goes through multiple audits specifically looking for these vulnerability classes — and they still get found post-audit. Understanding them deeply is the baseline for writing production-safe Solidity.

---

## What to Learn Next

- **Gas Optimization Patterns Every Solidity Dev Should Know** — security and optimization often conflict; learn how to balance them.
- **Smart Contract Audit Process: What Auditors Actually Look For** — understand the full audit workflow and what comes after fixing these bugs.
- **Slither: Automated Static Analysis for Solidity Contracts** — automate detection of these vulnerability patterns in your codebase.
