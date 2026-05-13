# Smart Contract Audit Process: What Auditors Actually Look For

**Track:** Intermediate → Expert  
**Read time:** 12 min

---

## The Problem

You've built a DeFi protocol. You've written tests, run Slither, and reviewed the code yourself. Now you need an audit. But you're not sure what auditors actually do, what they'll find, how to prepare, or how to respond to their findings. You've heard audits cost $50,000-$500,000 and take weeks. What are you paying for?

This blog explains the audit process from the inside — what auditors look for, how they work, and how to get the most value from an audit.

---

## Core Concepts

### What an Audit Is (and Isn't)

An audit is a systematic security review of your smart contract code by independent security researchers. It is:
- A thorough manual code review
- Automated tool analysis (Slither, Echidna, Mythril)
- Threat modeling and attack scenario analysis
- A written report with findings and recommendations

An audit is NOT:
- A guarantee of security ("audited" ≠ "safe")
- A complete test suite
- A formal verification
- Insurance against exploits

The DAO hack, Euler Finance, Nomad — all were audited. Audits reduce risk significantly but don't eliminate it.

### Audit Firms and Their Approaches

**Trail of Bits**: known for deep technical analysis, formal verification, custom tooling. Expensive ($500K+). Used by major protocols.

**OpenZeppelin**: strong reputation, particularly for ERC standards and access control. Used by Compound, Aave.

**Certik**: high volume, automated + manual. More accessible pricing. Variable quality.

**Spearbit**: marketplace model — independent researchers bid on audits. High quality, flexible.

**Code4rena / Sherlock**: competitive audit platforms. Many researchers review simultaneously. Good for finding edge cases.

### Finding Severity Levels

Auditors classify findings by severity:

**Critical**: can lead to direct loss of funds or complete protocol compromise. Must be fixed before deployment.

**High**: significant risk of fund loss or protocol disruption under specific conditions.

**Medium**: potential for fund loss or disruption under unlikely conditions, or significant logic errors.

**Low**: minor issues, best practices violations, or theoretical risks.

**Informational**: code quality, gas optimization, documentation issues.

### What Auditors Actually Look For

**Access control**: who can call what? Are admin functions properly protected? Can the owner rug users?

**Reentrancy**: does any function make external calls before updating state?

**Integer arithmetic**: overflow/underflow, precision loss, rounding errors.

**Oracle manipulation**: can prices be manipulated via flash loans or sandwich attacks?

**Logic errors**: does the code do what the spec says? Are there edge cases in the math?

**Front-running**: can transactions be front-run for profit or to harm users?

**Denial of service**: can an attacker prevent the protocol from functioning?

**Upgrade risks**: if the contract is upgradeable, can the upgrade mechanism be exploited?

**Economic attacks**: flash loans, governance attacks, liquidity manipulation.

---

## Code Walkthrough

Common audit findings with examples:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ── Finding 1: Missing Access Control ─────────────────────────────────────

// VULNERABLE: anyone can call setFee
contract VulnerableProtocol {
    uint256 public fee;

    function setFee(uint256 newFee) external {
        fee = newFee; // no access control!
    }
}

// FIXED: only owner can set fee
contract FixedProtocol {
    uint256 public fee;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Fee too high"); // also add bounds check
        fee = newFee;
    }
}

// ── Finding 2: Reentrancy ──────────────────────────────────────────────────

// VULNERABLE: state updated after external call
contract VulnerableVault {
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount);
        (bool success, ) = msg.sender.call{value: amount}(""); // external call first!
        require(success);
        balances[msg.sender] -= amount; // state update after — VULNERABLE
    }
}

// FIXED: CEI pattern
contract FixedVault {
    mapping(address => uint256) public balances;
    uint256 private _status = 1;

    modifier nonReentrant() {
        require(_status == 1, "Reentrant");
        _status = 2;
        _;
        _status = 1;
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount; // state update first
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success);
    }
}

// ── Finding 3: Precision Loss ──────────────────────────────────────────────

// VULNERABLE: division before multiplication loses precision
contract VulnerableRewards {
    function calculateReward(uint256 amount, uint256 rate) external pure returns (uint256) {
        return amount / 100 * rate; // divides first, loses precision
        // Example: amount=99, rate=2 → 99/100=0, 0*2=0 (should be ~1.98)
    }
}

// FIXED: multiply before divide
contract FixedRewards {
    function calculateReward(uint256 amount, uint256 rate) external pure returns (uint256) {
        return amount * rate / 100; // multiply first, then divide
        // Example: amount=99, rate=2 → 99*2=198, 198/100=1 (correct)
    }
}

// ── Finding 4: Unsafe Casting ──────────────────────────────────────────────

// VULNERABLE: silent truncation
contract VulnerableToken {
    function processAmount(uint256 largeAmount) external {
        uint128 truncated = uint128(largeAmount); // silently truncates if > 2^128
        // If largeAmount = 2^128 + 1, truncated = 1 (wrong!)
    }
}

// FIXED: explicit bounds check
contract FixedToken {
    function processAmount(uint256 largeAmount) external {
        require(largeAmount <= type(uint128).max, "Amount too large");
        uint128 safe = uint128(largeAmount);
    }
}

// ── Finding 5: Incorrect Event Emission ───────────────────────────────────

// VULNERABLE: event emitted with wrong data
contract VulnerableEvent {
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function transfer(address to, uint256 amount) external {
        // ... transfer logic ...
        emit Transfer(to, msg.sender, amount); // from and to are swapped!
    }
}

// ── Finding 6: Missing Zero Address Check ─────────────────────────────────

// VULNERABLE: can set owner to zero address (permanently locks admin)
contract VulnerableOwnable {
    address public owner;

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner);
        owner = newOwner; // no zero address check!
    }
}

// FIXED
contract FixedOwnable {
    address public owner;

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner);
        require(newOwner != address(0), "Zero address"); // check added
        owner = newOwner;
    }
}
```

Audit preparation checklist:

```typescript
// audit-prep-checklist.ts — run before submitting for audit

const AUDIT_CHECKLIST = {
  documentation: [
    "README with protocol overview and architecture",
    "NatSpec comments on all public/external functions",
    "Inline comments explaining non-obvious logic",
    "Threat model document (what are the assets? who are the actors? what are the attack vectors?)",
    "Known issues document (issues you're aware of but haven't fixed yet)",
  ],

  testing: [
    "Unit tests for all functions (aim for >90% coverage)",
    "Integration tests for complex interactions",
    "Fuzz tests for arithmetic-heavy functions",
    "Invariant tests (properties that must always hold)",
    "Tests for edge cases (zero amounts, max values, empty arrays)",
    "Tests for access control (unauthorized callers should fail)",
  ],

  tooling: [
    "Slither analysis run and findings reviewed",
    "Mythril or Manticore analysis for complex contracts",
    "Gas optimization review",
    "Solidity compiler warnings resolved",
  ],

  code_quality: [
    "No TODO comments in production code",
    "No console.log or debug statements",
    "Consistent naming conventions",
    "No dead code",
    "All imports used",
  ],

  security_review: [
    "All external calls reviewed for reentrancy",
    "All arithmetic reviewed for overflow/underflow",
    "All access control reviewed",
    "All oracle integrations reviewed",
    "All upgrade mechanisms reviewed",
    "Economic attack scenarios considered",
  ],
};

function printChecklist() {
  for (const [category, items] of Object.entries(AUDIT_CHECKLIST)) {
    console.log(`\n## ${category.toUpperCase()}`);
    items.forEach((item) => console.log(`  [ ] ${item}`));
  }
}

printChecklist();
```

---

## Common Mistakes and Gotchas

**1. Submitting code that's not ready for audit**  
Auditors charge by time. If your code has obvious issues (missing tests, TODO comments, known bugs), you're paying auditors to find things you already know about. Fix the obvious issues first, then audit.

**2. Not providing a threat model**  
Auditors need to understand what you're trying to protect and from whom. A threat model document (what are the assets? who are the actors? what are the attack vectors?) helps auditors focus on the right things.

**3. Dismissing findings without proper analysis**  
Every finding deserves a thoughtful response. "Won't fix" is sometimes the right answer, but it must be justified. Auditors have seen many protocols — if they flag something, there's usually a reason.

**4. Deploying immediately after audit**  
After receiving the audit report, you need time to fix findings, re-test, and potentially get a re-audit for critical fixes. Budget 2-4 weeks between receiving the report and deployment.

**5. Treating audit as a one-time event**  
Protocols evolve. Every significant code change should be reviewed. Many protocols have ongoing security relationships with audit firms — not just one-time audits.

---

## How This Connects to Production

Uniswap V3 was audited by Trail of Bits and ABDK before launch. Aave V3 was audited by Trail of Bits, OpenZeppelin, and SigmaPrime. Compound has been audited multiple times by OpenZeppelin. The Euler Finance hack ($197M) happened despite multiple audits — the vulnerability was in a feature added after the last audit. This is why continuous security review matters. Code4rena and Sherlock have democratized auditing — protocols can get hundreds of researchers reviewing their code simultaneously, often finding issues that single-firm audits miss.

---

## What to Learn Next

- **Slither: Automated Static Analysis for Solidity Contracts** — run automated analysis before your audit.
- **Echidna: Property-Based Fuzzing for Smart Contracts** — find edge cases with fuzzing.
- **Top 10 Smart Contract Vulnerabilities and How to Prevent Them** — understand the full vulnerability landscape.
