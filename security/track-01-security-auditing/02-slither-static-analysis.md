# Slither: Automated Static Analysis for Solidity Contracts

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You've written a Solidity contract. Before you pay $100,000 for an audit, you want to catch the obvious issues yourself. Slither is the industry-standard static analysis tool for Solidity — it finds common vulnerabilities, code quality issues, and optimization opportunities automatically. But running `slither .` and getting 200 warnings is overwhelming. You need to know how to use it effectively.

---

## Core Concepts

### What Slither Does

Slither is a static analysis framework that:
- Parses Solidity source code into an AST (Abstract Syntax Tree)
- Runs ~100 built-in detectors for common vulnerability patterns
- Provides a Python API for writing custom detectors
- Generates call graphs, inheritance graphs, and function summaries

It finds things like:
- Reentrancy vulnerabilities
- Unprotected functions
- Integer overflow/underflow (pre-0.8)
- Incorrect ERC-20/721 implementations
- Unused return values
- Dangerous delegatecall patterns
- Timestamp dependence
- And ~90 more patterns

### What Slither Doesn't Do

Slither is static analysis — it doesn't execute code. It can't find:
- Logic errors (it doesn't understand your business logic)
- Economic attacks (flash loans, oracle manipulation)
- Vulnerabilities that require specific state conditions
- Issues in off-chain components

Think of Slither as a very thorough linter, not a security guarantee.

### Installation and Basic Usage

```bash
# Install Slither
pip3 install slither-analyzer

# Or with pipx (recommended)
pipx install slither-analyzer

# Run on a Hardhat project
slither .

# Run on a specific file
slither contracts/MyContract.sol

# Run with specific compiler version
slither . --solc-remaps "@openzeppelin=node_modules/@openzeppelin"

# Filter by severity
slither . --filter-paths "node_modules" --exclude-informational

# Output as JSON for CI integration
slither . --json slither-output.json
```

### Understanding Slither Output

```
INFO:Detectors:
MyContract.withdraw(uint256) (contracts/MyContract.sol#45-55) uses a dangerous strict equality:
        - require(bool,string)(balances[msg.sender] == amount,Wrong amount) (contracts/MyContract.sol#47)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#dangerous-strict-equalities

MyContract.setOwner(address) (contracts/MyContract.sol#20-22) should emit an event for:
        - owner = newOwner (contracts/MyContract.sol#21)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#missing-events-access-control

INFO:Slither:contracts/MyContract.sol analyzed (1 contracts with 98 detectors), 2 result(s) found
```

Each finding includes:
- The detector name and description
- The specific code location
- A reference to the documentation

---

## Code Walkthrough

Setting up Slither in a CI pipeline and writing custom detectors:

```yaml
# .github/workflows/slither.yml
name: Slither Analysis

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  slither:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Run Slither
        uses: crytic/slither-action@v0.3.0
        id: slither
        with:
          target: "."
          slither-args: >
            --filter-paths "node_modules,test"
            --exclude-informational
            --exclude-low
          fail-on: high
          sarif: results.sarif

      - name: Upload SARIF file
        uses: github/codeql-action/upload-sarif@v2
        if: always()
        with:
          sarif_file: results.sarif
```

```python
# slither.config.json — project-specific configuration
{
  "filter_paths": "node_modules,test,mock",
  "exclude_informational": true,
  "exclude_low": false,
  "detectors_to_exclude": [
    "naming-convention",  // we have our own naming conventions
    "solc-version"        // we pin our version explicitly
  ],
  "solc_remaps": [
    "@openzeppelin=node_modules/@openzeppelin"
  ]
}
```

Writing a custom Slither detector:

```python
# detectors/missing_deadline.py
"""
Custom Slither detector: finds functions that accept user-provided amounts
but don't have a deadline parameter (vulnerable to front-running).
"""

from slither.detectors.abstract_detector import AbstractDetector, DetectorClassification
from slither.core.declarations import Function
from slither.core.variables.local_variable import LocalVariable


class MissingDeadline(AbstractDetector):
    """
    Detect swap/trade functions missing deadline parameters.
    """

    ARGUMENT = "missing-deadline"
    HELP = "Swap functions should have deadline parameters"
    IMPACT = DetectorClassification.MEDIUM
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://your-docs.com/missing-deadline"
    WIKI_TITLE = "Missing Deadline"
    WIKI_DESCRIPTION = "Swap functions without deadlines can be front-run."
    WIKI_EXPLOIT_SCENARIO = """
    A user submits a swap transaction. The transaction sits in the mempool.
    Market conditions change. The transaction executes at a worse price.
    Without a deadline, the user can't prevent this.
    """
    WIKI_RECOMMENDATION = "Add a `deadline` parameter and check `block.timestamp <= deadline`."

    def _detect(self):
        results = []

        for contract in self.compilation_unit.contracts_derived:
            for function in contract.functions:
                # Look for functions with "swap" or "trade" in the name
                if not any(keyword in function.name.lower() for keyword in ["swap", "trade", "exchange"]):
                    continue

                # Check if function has a deadline parameter
                has_deadline = any(
                    "deadline" in param.name.lower()
                    for param in function.parameters
                )

                if not has_deadline:
                    info = [
                        function,
                        " is a swap/trade function without a deadline parameter.\n",
                    ]
                    results.append(self.generate_result(info))

        return results
```

```bash
# Run with custom detector
slither . --detect missing-deadline --custom-detectors detectors/
```

Interpreting and triaging Slither output:

```typescript
// scripts/triage-slither.ts — parse and prioritize Slither output
import * as fs from "fs";

interface SlitherFinding {
  check: string;
  impact: "High" | "Medium" | "Low" | "Informational" | "Optimization";
  confidence: "High" | "Medium" | "Low";
  description: string;
  elements: { name: string; source_mapping: { filename: string; lines: number[] } }[];
}

interface SlitherOutput {
  results: { detectors: SlitherFinding[] };
}

function triageSlitherOutput(outputPath: string) {
  const output: SlitherOutput = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const findings = output.results.detectors;

  // Group by impact
  const byImpact = {
    High: findings.filter((f) => f.impact === "High"),
    Medium: findings.filter((f) => f.impact === "Medium"),
    Low: findings.filter((f) => f.impact === "Low"),
    Informational: findings.filter((f) => f.impact === "Informational"),
  };

  console.log("=== Slither Triage Report ===\n");

  for (const [impact, items] of Object.entries(byImpact)) {
    if (items.length === 0) continue;
    console.log(`## ${impact} (${items.length} findings)`);

    items.forEach((finding) => {
      const location = finding.elements[0]?.source_mapping;
      console.log(`  - ${finding.check}`);
      if (location) {
        console.log(`    ${location.filename}:${location.lines[0]}`);
      }
    });
    console.log();
  }

  // Fail CI if high-severity findings exist
  if (byImpact.High.length > 0) {
    console.error(`FAIL: ${byImpact.High.length} high-severity findings`);
    process.exit(1);
  }
}

triageSlitherOutput("slither-output.json");
```

---

## Common Mistakes and Gotchas

**1. Running Slither on uncompiled code**  
Slither needs the compiled artifacts. Run `npx hardhat compile` or `forge build` before running Slither. If compilation fails, Slither can't analyze the code.

**2. Not filtering out test and mock contracts**  
Test contracts often have intentional vulnerabilities (for testing). Always filter them out: `--filter-paths "test,mock,node_modules"`.

**3. Treating all findings as equal**  
A "Low" finding about naming conventions is not the same as a "High" finding about reentrancy. Prioritize by impact and confidence. Fix High/Medium findings before Low/Informational.

**4. Ignoring false positives without documentation**  
Slither has false positives. When you decide a finding is a false positive, document why. Use `// slither-disable-next-line detector-name` with a comment explaining the reasoning. This makes it clear to future reviewers that the finding was considered.

**5. Not running Slither in CI**  
Slither should run on every PR. New code can introduce new vulnerabilities. A finding that passes in CI is much cheaper to fix than one found in an audit.

---

## How This Connects to Production

Trail of Bits created Slither and uses it as part of their audit workflow. OpenZeppelin runs Slither on all their contracts. Many protocols run Slither in CI as a first line of defense. The Slither detector library is open source — you can see exactly what patterns it detects and contribute new detectors. For protocols with custom logic, writing custom Slither detectors (like the `missing-deadline` example above) is a powerful way to enforce protocol-specific security invariants automatically.

---

## What to Learn Next

- **Echidna: Property-Based Fuzzing for Smart Contracts** — go beyond static analysis to dynamic testing.
- **Smart Contract Audit Process: What Auditors Actually Look For** — understand how Slither fits into the full audit workflow.
- **Top 10 Smart Contract Vulnerabilities and How to Prevent Them** — understand the vulnerabilities Slither detects.
