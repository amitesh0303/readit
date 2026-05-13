# What is a Smart Contract? A Plain English Guide

**Track:** Beginner  
**Read time:** 9 min

---

## The Problem

"Smart contract" is one of those terms that gets thrown around constantly but rarely explained well. The usual definition — "code that runs on the blockchain" — is technically correct but tells you nothing useful. It doesn't explain why smart contracts matter, what makes them different from a regular API, or why they're hard to get right.

If you're about to write your first Solidity contract, or you're trying to explain to a non-technical stakeholder why your protocol needs one, you need a better mental model. This blog gives you that — starting from first principles, ending with a clear picture of what smart contracts can and can't do.

---

## Core Concepts

### The Vending Machine Analogy (and Why It Falls Short)

The classic analogy: a smart contract is like a vending machine. You put in money, press a button, get a snack. No human intermediary needed. The rules are encoded in the machine.

That's a decent starting point, but it misses the key property: a vending machine is owned by someone who can restock it, repair it, or take it away. A smart contract deployed on Ethereum is owned by no one (unless you code in an owner) and can't be changed (unless you code in upgradeability). The rules are enforced by thousands of nodes simultaneously, not by a company's server.

A better analogy: imagine a vending machine that's bolted to the floor of a public square, its source code is printed on the side for anyone to read, and it will keep running exactly as programmed for as long as Ethereum exists — regardless of whether the company that built it goes bankrupt, gets acquired, or disappears.

That's the actual value proposition.

### What a Smart Contract Is, Technically

A smart contract is a program stored at an address on the blockchain. It has:

- **Code** — the compiled bytecode that defines its behavior (immutable once deployed, unless using a proxy pattern)
- **Storage** — persistent key-value state that lives on-chain
- **Balance** — it can hold ETH (or other tokens)
- **Address** — a unique identifier, just like a user wallet

When you call a smart contract function, you're sending a transaction to its address with encoded function call data. The EVM executes the bytecode, reads/writes storage, and either succeeds (state changes committed) or reverts (state changes rolled back, gas still consumed).

```
User sends tx to contract address
    ↓
EVM loads contract bytecode
    ↓
EVM executes function with provided arguments
    ↓
Contract reads/writes its storage
    ↓
If success: state changes are permanent
If revert: state changes are discarded, gas is consumed
```

### The Key Properties That Make Smart Contracts Useful

**Trustlessness** — you don't need to trust the operator. The code is the operator. If the contract says "send 1 ETH to whoever calls this function with the right password," it will do exactly that, every time, for anyone.

**Transparency** — the bytecode is public. Anyone can read it (or decompile it). Better yet, if the source code is verified on Etherscan, anyone can read the Solidity. There are no hidden terms.

**Composability** — contracts can call other contracts. This is how DeFi works: Uniswap is a contract, Aave is a contract, your protocol can call both in a single transaction. This "money lego" property is unique to smart contract platforms.

**Determinism** — given the same inputs and state, a contract always produces the same output. Every node in the network runs the same code and gets the same result. This is what makes consensus possible.

**Immutability** — once deployed, the code can't be changed (by default). This is a feature (no one can rug the rules) and a bug (you can't fix vulnerabilities without a proxy pattern).

### What Smart Contracts Can't Do (Without Help)

Smart contracts are isolated. They can't:

- Make HTTP requests
- Read from APIs or databases
- Access the current time reliably (they can read `block.timestamp` but it's manipulable by validators within ~15 seconds)
- Generate true randomness (everything on-chain is deterministic and predictable)
- Access data from other blockchains

This is why oracles exist. Chainlink, Pyth, and others are services that bring off-chain data on-chain in a trust-minimized way. If your contract needs the ETH/USD price, it reads from a Chainlink price feed — a contract that Chainlink's node network updates regularly.

### The Lifecycle of a Smart Contract

```
1. Write — Solidity source code
2. Compile — solc produces ABI + bytecode
3. Deploy — send a transaction with bytecode as data, no `to` address
4. Address assigned — contract lives at a deterministic address
5. Interact — users/other contracts call functions
6. (Optional) Upgrade — via proxy pattern, if designed for it
7. (Optional) Self-destruct — SELFDESTRUCT opcode (deprecated in EIP-6049)
```

The ABI (Application Binary Interface) is the contract's public interface — a JSON file describing its functions, parameters, and return types. Your frontend uses the ABI to encode function calls and decode return values.

---

## Code Walkthrough

Here's a minimal but complete smart contract that demonstrates the core concepts — state, functions, events, and access control:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SimpleEscrow
 * @notice Holds ETH in escrow between a depositor and a recipient.
 *         Demonstrates: state, payable functions, events, access control, and transfer.
 */
contract SimpleEscrow {
    // --- State Variables ---
    // These are stored permanently on-chain in the contract's storage

    address public depositor;   // who deposited the funds
    address public recipient;   // who can claim the funds
    address public arbiter;     // trusted third party who approves release
    uint256 public amount;      // amount deposited (in wei)
    bool public isApproved;     // has the arbiter approved release?

    // --- Events ---
    // Emitted when state changes — frontends listen to these
    event Deposited(address indexed depositor, uint256 amount);
    event Approved(address indexed arbiter);
    event Released(address indexed recipient, uint256 amount);

    // --- Constructor ---
    // Runs once at deployment. Sets up the escrow parties.
    constructor(address _recipient, address _arbiter) {
        depositor = msg.sender;   // whoever deploys is the depositor
        recipient = _recipient;
        arbiter = _arbiter;
    }

    // --- Functions ---

    /**
     * @notice Deposit ETH into escrow.
     * @dev payable means this function can receive ETH.
     *      msg.value is the ETH sent with the transaction.
     */
    function deposit() external payable {
        require(msg.sender == depositor, "Only depositor can deposit");
        require(amount == 0, "Already deposited");
        require(msg.value > 0, "Must send ETH");

        amount = msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Arbiter approves release of funds to recipient.
     */
    function approve() external {
        require(msg.sender == arbiter, "Only arbiter can approve");
        require(amount > 0, "Nothing to approve");
        require(!isApproved, "Already approved");

        isApproved = true;
        emit Approved(msg.sender);
    }

    /**
     * @notice Recipient claims funds after approval.
     * @dev Uses the checks-effects-interactions pattern to prevent re-entrancy:
     *      1. Check conditions
     *      2. Update state (set amount to 0 BEFORE transferring)
     *      3. Interact with external address (transfer ETH)
     */
    function release() external {
        require(msg.sender == recipient, "Only recipient can claim");
        require(isApproved, "Not yet approved");
        require(amount > 0, "Nothing to release");

        uint256 payout = amount;
        amount = 0; // update state BEFORE external call — prevents re-entrancy

        emit Released(recipient, payout);

        // Transfer ETH to recipient
        // Using call instead of transfer — transfer has a 2300 gas stipend
        // that can fail with smart contract recipients
        (bool success, ) = recipient.call{value: payout}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Returns the current ETH balance held by this contract.
     * @dev address(this) refers to this contract's own address
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
```

This contract demonstrates:
- State variables that persist between calls
- `payable` functions that receive ETH
- `require` statements for input validation
- Events for frontend communication
- The checks-effects-interactions pattern (critical for security)
- `msg.sender` and `msg.value` — the two most important global variables

---

## Common Mistakes and Gotchas

**1. Thinking "deployed" means "running"**  
A smart contract doesn't run continuously. It only executes when someone sends a transaction to it. There's no background process, no cron job, no event loop. If you need something to happen automatically (like liquidating undercollateralized positions), you need an off-chain keeper bot to trigger the on-chain function.

**2. Assuming immutability is always good**  
Immutability means you can't fix bugs. The DAO hack in 2016 drained $60M from an immutable contract. The only recovery was a controversial hard fork. If you're building anything serious, you need a proxy upgrade pattern — but that introduces its own trust assumptions (whoever controls the upgrade key can change the rules).

**3. Confusing `view` and `pure` with "free"**  
`view` and `pure` functions don't cost gas when called off-chain (via `eth_call`). But if another contract calls them as part of a transaction, they do cost gas. This trips up developers who assume all reads are free.

**4. Not understanding that `require` reverts consume gas**  
A failed `require` reverts the transaction but still charges gas for the work done up to that point. If you have expensive operations before a `require` check, you're charging users for failed transactions. Put cheap checks first.

**5. Treating the contract address as permanent**  
If you're using a proxy pattern, the implementation contract address changes on upgrade. Always interact with the proxy address, not the implementation. Store the proxy address in your frontend config, not the implementation address.

---

## How This Connects to Production

Every DeFi protocol you've heard of is a system of smart contracts. Uniswap V3 is a factory contract that deploys pool contracts, which hold liquidity and execute swaps. Aave is a lending pool contract that tracks deposits, borrows, and health factors. Compound's governance is a smart contract that executes proposals automatically when they pass a vote threshold — no human can block or delay execution. The "code is law" property is what makes these protocols trustworthy enough to hold billions of dollars. It's also what makes bugs so catastrophic — there's no customer support line, no refund policy, no way to reverse a transaction once it's final.

---

## What to Learn Next

- **Your First Solidity Smart Contract: Hello World to Token in 30 Minutes** — write and deploy your first contract.
- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — understand the attack vectors before you deploy anything real.
- **Events and Logs: How Frontends Listen to Smart Contracts** — learn how your frontend stays in sync with on-chain state.
