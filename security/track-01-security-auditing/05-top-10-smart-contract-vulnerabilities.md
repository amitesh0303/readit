# Top 10 Smart Contract Vulnerabilities and How to Prevent Them

**Track:** Intermediate → Expert  
**Read time:** 14 min

---

## The Problem

Smart contract exploits have drained billions of dollars. The same vulnerability classes appear again and again — reentrancy, oracle manipulation, access control failures. Understanding these patterns deeply is the difference between writing secure code and writing code that gets exploited.

This blog covers the 10 most critical vulnerability classes with real exploit examples, vulnerable code, and production-grade fixes.

---

## The Top 10

### 1. Reentrancy

**What it is**: an external call allows the callee to re-enter the calling contract before state is updated.

**Real exploit**: The DAO hack (2016, $60M), Euler Finance (2023, $197M via a variant).

```solidity
// VULNERABLE
function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool success, ) = msg.sender.call{value: amount}(""); // re-entry point
    require(success);
    balances[msg.sender] = 0; // too late
}

// FIXED: CEI pattern + nonReentrant
function withdraw() external nonReentrant {
    uint256 amount = balances[msg.sender];
    balances[msg.sender] = 0; // update state first
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success);
}
```

**Prevention**: Always follow Checks-Effects-Interactions. Add `nonReentrant` modifier as a backup. Be especially careful with cross-function reentrancy (re-entering a different function).

---

### 2. Oracle Manipulation

**What it is**: using a manipulable price source (DEX spot price) for financial calculations.

**Real exploit**: Mango Markets (2022, $114M), bZx (2020, $8M).

```solidity
// VULNERABLE: uses DEX spot price
function getPrice() external view returns (uint256) {
    (uint112 reserve0, uint112 reserve1, ) = uniswapPair.getReserves();
    return (reserve1 * 1e18) / reserve0; // manipulable via flash loan
}

// FIXED: use Chainlink or TWAP
function getPrice() external view returns (uint256) {
    (, int256 price, , uint256 updatedAt, ) = chainlinkFeed.latestRoundData();
    require(block.timestamp - updatedAt <= 3600, "Stale price");
    require(price > 0, "Invalid price");
    return uint256(price);
}
```

**Prevention**: Use Chainlink price feeds or time-weighted average prices (TWAPs) with sufficient windows. Never use DEX spot prices for financial calculations.

---

### 3. Access Control Failures

**What it is**: critical functions callable by unauthorized addresses.

**Real exploit**: Poly Network (2021, $611M — admin function callable by anyone), Ronin Bridge (2022, $625M — validator key compromise).

```solidity
// VULNERABLE: no access control
function setFeeRecipient(address newRecipient) external {
    feeRecipient = newRecipient; // anyone can call this!
}

// FIXED: role-based access control
bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

function setFeeRecipient(address newRecipient) external {
    require(hasRole(FEE_MANAGER_ROLE, msg.sender), "Not fee manager");
    require(newRecipient != address(0), "Zero address");
    feeRecipient = newRecipient;
}
```

**Prevention**: Use OpenZeppelin's `AccessControl` or `Ownable`. Apply the principle of least privilege. Use timelocks for sensitive admin functions.

---

### 4. Integer Overflow/Underflow

**What it is**: arithmetic wraps around at type boundaries.

**Real exploit**: BEC token (2018, $900M in tokens created from nothing — pre-0.8 Solidity).

```solidity
// VULNERABLE (pre-Solidity 0.8)
function transfer(address to, uint256 amount) external {
    balances[msg.sender] -= amount; // underflows if amount > balance
    balances[to] += amount;
}

// FIXED: Solidity 0.8+ reverts on overflow/underflow automatically
// But be careful with unchecked blocks:
function transfer(address to, uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient");
    unchecked {
        balances[msg.sender] -= amount; // safe: checked above
        balances[to] += amount;         // safe: total supply is bounded
    }
}
```

**Prevention**: Use Solidity 0.8+. Be careful with `unchecked` blocks — only use them when you've verified overflow is impossible.

---

### 5. Flash Loan Attacks

**What it is**: using flash loans to amplify capital for price manipulation or governance attacks.

**Real exploit**: Cream Finance (2021, $130M), Beanstalk (2022, $182M via governance).

```solidity
// VULNERABLE: governance allows same-block voting
function vote(uint256 proposalId, bool support) external {
    uint256 votes = token.balanceOf(msg.sender); // flash-loanable!
    _castVote(proposalId, support, votes);
}

// FIXED: use snapshot-based voting
function vote(uint256 proposalId, bool support) external {
    uint256 snapshotBlock = proposals[proposalId].snapshotBlock;
    uint256 votes = token.getPastVotes(msg.sender, snapshotBlock); // historical balance
    _castVote(proposalId, support, votes);
}
```

**Prevention**: Use snapshot-based governance (ERC-20Votes). Use TWAPs for price-sensitive calculations. Add time delays between proposal creation and voting.

---

### 6. Signature Replay Attacks

**What it is**: a valid signature is reused in a different context.

**Real exploit**: Multiple bridge exploits where signed messages were replayed.

```solidity
// VULNERABLE: no nonce, no chain ID
function executeWithSig(address to, uint256 amount, bytes calldata sig) external {
    bytes32 hash = keccak256(abi.encodePacked(to, amount));
    address signer = ECDSA.recover(hash, sig);
    require(signer == owner, "Invalid sig");
    _execute(to, amount);
    // Same sig can be replayed!
}

// FIXED: include nonce and chain ID
mapping(address => uint256) public nonces;

function executeWithSig(
    address to,
    uint256 amount,
    uint256 nonce,
    uint256 deadline,
    bytes calldata sig
) external {
    require(block.timestamp <= deadline, "Expired");
    require(nonces[msg.sender] == nonce, "Invalid nonce");

    bytes32 hash = keccak256(abi.encodePacked(
        to, amount, nonce, deadline, block.chainid, address(this)
    ));
    address signer = ECDSA.recover(hash, sig);
    require(signer == owner, "Invalid sig");

    nonces[msg.sender]++;
    _execute(to, amount);
}
```

**Prevention**: Always include nonce, chain ID, and contract address in signed messages. Use EIP-712 for structured data signing.

---

### 7. Denial of Service (DoS)

**What it is**: an attacker prevents the protocol from functioning.

**Real exploit**: GovernMental (2016) — a contract that iterated over an unbounded array, eventually running out of gas.

```solidity
// VULNERABLE: unbounded loop
function distributeRewards() external {
    for (uint256 i = 0; i < users.length; i++) { // users.length can be huge
        token.transfer(users[i], rewards[users[i]]);
    }
}

// FIXED: pull-over-push pattern
mapping(address => uint256) public pendingRewards;

function claimReward() external {
    uint256 reward = pendingRewards[msg.sender];
    require(reward > 0, "No reward");
    pendingRewards[msg.sender] = 0;
    token.transfer(msg.sender, reward);
}
```

**Prevention**: Use pull-over-push for payments. Avoid unbounded loops. Set maximum array sizes. Don't rely on external calls succeeding.

---

### 8. Incorrect ERC-20 Handling

**What it is**: assuming all ERC-20 tokens behave identically.

**Real exploit**: Multiple protocols that didn't handle fee-on-transfer tokens or tokens that return false instead of reverting.

```solidity
// VULNERABLE: assumes transfer always succeeds and transfers exact amount
function deposit(address token, uint256 amount) external {
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    balances[msg.sender] += amount; // wrong if token has transfer fee!
}

// FIXED: check actual received amount
function deposit(address token, uint256 amount) external {
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));
    SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), amount);
    uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
    balances[msg.sender] += received; // use actual received amount
}
```

**Prevention**: Use OpenZeppelin's `SafeERC20`. Check actual received amounts for fee-on-transfer tokens. Test with non-standard tokens (USDT, USDC, fee-on-transfer tokens).

---

### 9. Uninitialized Storage Pointers

**What it is**: a storage pointer that points to slot 0 by default, overwriting critical state.

```solidity
// VULNERABLE (Solidity < 0.5 — historical but instructive)
function createUser(string memory name) external {
    User storage user; // uninitialized! points to slot 0
    user.name = name;  // overwrites slot 0 (often the owner address!)
}

// FIXED: always initialize storage pointers
function createUser(string memory name) external {
    users.push(); // create new element
    User storage user = users[users.length - 1]; // point to new element
    user.name = name;
}
```

**Prevention**: Modern Solidity (0.5+) prevents uninitialized storage pointers. Always initialize storage variables. Use `push()` to create new array elements.

---

### 10. Timestamp Manipulation

**What it is**: using `block.timestamp` for security-critical decisions that can be manipulated by validators.

```solidity
// VULNERABLE: validator can manipulate timestamp by ~15 seconds
function isExpired(uint256 deadline) external view returns (bool) {
    return block.timestamp > deadline;
}

// For deadlines measured in minutes/hours: acceptable
// For deadlines measured in seconds: vulnerable

// VULNERABLE: using timestamp for randomness
function random() external view returns (uint256) {
    return uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender)));
    // Validator can choose timestamp to get favorable random number
}

// FIXED: use Chainlink VRF for randomness
// For deadlines: use block.timestamp but with reasonable windows (>15 seconds)
```

**Prevention**: Don't use `block.timestamp` for randomness. For deadlines, use windows of at least 15 seconds. For randomness, use Chainlink VRF or commit-reveal schemes.

---

## Prevention Summary

```solidity
// Security checklist for every contract:

// 1. Reentrancy
modifier nonReentrant() { ... }
// Always: CEI pattern + nonReentrant on external-call functions

// 2. Oracle
// Always: Chainlink or TWAP, never DEX spot price

// 3. Access control
// Always: onlyOwner/onlyRole on admin functions

// 4. Arithmetic
// Always: Solidity 0.8+, careful with unchecked

// 5. Flash loans
// Always: snapshot voting, TWAP prices

// 6. Signatures
// Always: nonce + chainId + address in signed data

// 7. DoS
// Always: pull-over-push, bounded loops

// 8. ERC-20
// Always: SafeERC20, check received amounts

// 9. Storage
// Always: initialize storage pointers

// 10. Timestamp
// Always: reasonable windows, no randomness
```

---

## How This Connects to Production

Every major DeFi exploit maps to one of these categories. The DAO: reentrancy. Mango Markets: oracle manipulation. Poly Network: access control. Beanstalk: flash loan governance attack. Nomad: signature replay. Understanding these patterns deeply means you can spot them in code reviews, write tests that catch them, and design protocols that are resistant to them from the start. The best security is built in from the beginning, not bolted on after an audit.

---

## What to Learn Next

- **Smart Contract Audit Process: What Auditors Actually Look For** — understand how auditors systematically find these vulnerabilities.
- **Slither: Automated Static Analysis for Solidity Contracts** — automate detection of many of these patterns.
- **Echidna: Property-Based Fuzzing for Smart Contracts** — find edge cases that unit tests miss.
