# Working with Auditors: Lessons from a Trail of Bits Collaboration

**Track:** Expert  
**Read time:** 10 min

---

## The Problem

You've hired an audit firm. The engagement starts in two weeks. You're not sure how to prepare, what to expect during the audit, or how to respond to findings. A poorly managed audit engagement wastes money and leaves vulnerabilities unfixed. A well-managed one makes your protocol significantly more secure.

This blog covers the full audit engagement lifecycle — from preparation to remediation — based on real experience working with top-tier security firms.

---

## Core Concepts

### The Audit Engagement Timeline

```
Week -2: Preparation
  - Code freeze (no new features)
  - Documentation complete
  - Tests passing
  - Slither/Echidna run

Week 0: Kickoff
  - Architecture walkthrough with auditors
  - Threat model discussion
  - Scope definition

Weeks 1-3: Active Audit
  - Auditors review code
  - Daily/weekly check-ins
  - Answer auditor questions promptly

Week 4: Report Delivery
  - Preliminary findings shared
  - Discussion of findings
  - Clarifications

Weeks 5-6: Remediation
  - Fix findings
  - Write remediation notes
  - Re-audit for critical fixes

Week 7: Final Report
  - Auditors review fixes
  - Final report published
```

### Preparing for the Kickoff

The kickoff meeting sets the tone for the entire engagement. Come prepared with:

**Architecture overview**: a diagram showing all contracts, their relationships, and the flow of funds. Auditors need to understand the system before they can find vulnerabilities.

**Threat model**: what are you protecting? Who are the actors? What are the attack vectors you're most concerned about? This helps auditors prioritize.

**Known issues**: be upfront about issues you're aware of. "We know the oracle can be manipulated in a flash loan attack but we've mitigated it by using a TWAP" is better than having auditors spend time on something you already know about.

**Test coverage report**: show auditors your test coverage. Areas with low coverage are higher risk.

**Previous audit reports**: if you've been audited before, share the reports. Auditors can check if previous findings were properly fixed.

### During the Audit

**Answer questions promptly**: auditors will have questions about your design decisions. Slow responses waste their time and your money. Designate a technical point of contact who can respond within hours.

**Don't make code changes during the audit**: unless fixing a critical issue, don't change the code while auditors are reviewing it. Changes invalidate their work. If you must make changes, communicate them immediately.

**Attend check-ins**: weekly check-ins let you hear preliminary findings and provide context. Don't skip them.

**Provide context for design decisions**: if you made an unusual design choice, explain why. "We use a TWAP instead of spot price because of flash loan risk" helps auditors understand your threat model.

### Responding to Findings

Every finding deserves a thoughtful response. The options:

**Fix**: implement the recommended fix. This is the right response for most findings.

**Acknowledge and mitigate**: you can't fix it directly, but you've added other mitigations. Explain what they are.

**Acknowledge and accept risk**: you understand the risk and have decided to accept it. Explain why (e.g., "this requires a 51% attack on Chainlink, which we consider acceptable risk").

**Dispute**: you believe the finding is incorrect. Provide a detailed technical explanation. Be respectful — auditors are usually right, but not always.

**Won't fix**: you've decided not to fix it. This is sometimes appropriate for low-severity findings, but requires justification.

---

## Code Walkthrough

Example audit finding and remediation:

```
FINDING: High Severity
Title: Reentrancy in withdraw() allows draining of vault

Description:
The withdraw() function in Vault.sol calls an external contract before
updating the user's balance. An attacker can exploit this to drain the vault.

Affected code:
Vault.sol#withdraw() (lines 45-60)

Proof of concept:
1. Attacker calls withdraw(100)
2. Vault sends 100 ETH to attacker's contract
3. Attacker's receive() calls withdraw(100) again
4. Vault checks balance: still 100 (not yet updated)
5. Vault sends another 100 ETH
6. Repeat until vault is drained

Recommendation:
Apply the checks-effects-interactions pattern:
1. Check conditions
2. Update state (set balance to 0)
3. Make external call
```

```solidity
// BEFORE (vulnerable)
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient");
    (bool success, ) = msg.sender.call{value: amount}(""); // external call first
    require(success, "Transfer failed");
    balances[msg.sender] -= amount; // state update after — VULNERABLE
}

// AFTER (fixed)
function withdraw(uint256 amount) external nonReentrant {
    require(balances[msg.sender] >= amount, "Insufficient");
    balances[msg.sender] -= amount; // state update first (CEI pattern)
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
}
```

Remediation response template:

```markdown
## Finding Response: High-01 Reentrancy in withdraw()

**Status**: Fixed

**Fix**: Applied the checks-effects-interactions pattern and added a nonReentrant modifier.

**Changes**:
- `contracts/Vault.sol`: Moved `balances[msg.sender] -= amount` before the external call
- `contracts/Vault.sol`: Added `nonReentrant` modifier from OpenZeppelin's ReentrancyGuard

**Commit**: abc123def456

**Test added**: `test/Vault.t.sol#test_reentrancy_protection` — verifies that a reentrant call reverts

**Notes**: We also reviewed all other functions with external calls and confirmed they follow CEI pattern.
```

Post-audit checklist:

```typescript
const POST_AUDIT_CHECKLIST = {
  findings_response: [
    "Every finding has a written response (fix/acknowledge/dispute)",
    "All Critical findings are fixed",
    "All High findings are fixed or have documented mitigations",
    "Medium findings are addressed or have documented risk acceptance",
    "Low/Informational findings are reviewed and triaged",
  ],

  code_changes: [
    "All fixes are in a separate branch/PR",
    "Each fix has a corresponding test",
    "No new features added during remediation",
    "Code freeze maintained until re-audit complete",
  ],

  re_audit: [
    "Critical and High fixes submitted for re-audit",
    "Re-audit scope clearly defined (only changed code)",
    "Re-audit timeline agreed with audit firm",
  ],

  publication: [
    "Final audit report received",
    "Report published on your website/GitHub",
    "Summary of findings and fixes published",
    "Deployment timeline communicated to community",
  ],

  post_deployment: [
    "Bug bounty program set up (Immunefi, HackerOne)",
    "Monitoring and alerting configured",
    "Incident response plan documented",
    "Emergency pause mechanism tested",
  ],
};
```

---

## Common Mistakes and Gotchas

**1. Changing scope mid-audit**  
Adding new contracts or features during an audit invalidates the auditors' work. If you must add something, communicate immediately and expect the timeline and cost to increase.

**2. Not providing a code freeze**  
If developers are still committing to the audited branch, auditors are reviewing a moving target. Freeze the code before the audit starts.

**3. Dismissing findings without engaging**  
"We don't think this is an issue" without a technical explanation is not a valid response. Engage with every finding seriously. Auditors have seen many protocols — their concerns are usually valid.

**4. Not publishing the audit report**  
Users and investors deserve to know the security status of protocols they use. Publish the full audit report, including all findings and your responses. Hiding findings destroys trust.

**5. Treating audit as the last step before deployment**  
Audit should be one step in an ongoing security process. Set up a bug bounty program, run continuous monitoring, and plan for regular re-audits as the protocol evolves.

---

## How This Connects to Production

Trail of Bits has audited Compound, MakerDAO, Uniswap, Ethereum itself, and hundreds of other protocols. Their audit reports are public and are a goldmine of real vulnerability patterns. OpenZeppelin's audit reports are similarly public. Reading through past audit reports is one of the best ways to learn what real vulnerabilities look like. Immunefi is the leading bug bounty platform for Web3 — protocols like Uniswap, Aave, and Compound have paid out millions in bounties for vulnerabilities found after audit. The audit + bug bounty combination is the industry standard for production security.

---

## What to Learn Next

- **Top 10 Smart Contract Vulnerabilities and How to Prevent Them** — understand the full vulnerability landscape.
- **Echidna: Property-Based Fuzzing for Smart Contracts** — automate finding the issues auditors look for.
- **Smart Contract Audit Process: What Auditors Actually Look For** — revisit the audit process with this deeper context.
