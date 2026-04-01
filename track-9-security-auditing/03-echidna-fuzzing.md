# Echidna: Property-Based Fuzzing for Smart Contracts

**Track:** Intermediate → Expert  
**Read time:** 12 min

---

## The Problem

You've written unit tests. They pass. You've run Slither. No high-severity findings. But your contract has complex math — a bonding curve, a liquidation formula, a reward distribution algorithm. Unit tests only check the cases you thought of. What about the cases you didn't think of?

Echidna is a property-based fuzzer for Solidity. Instead of testing specific inputs, you define properties that must always hold ("the total supply never exceeds MAX_SUPPLY"), and Echidna generates thousands of random inputs trying to break them. It finds the edge cases you didn't think of.

---

## Core Concepts

### Property-Based Testing vs Unit Testing

```
Unit test:
test("transfer 100 tokens", () => {
  token.transfer(alice, 100);
  assert(token.balanceOf(alice) == 100);
});
// Tests one specific case

Property test:
property("total supply never changes after transfer", () => {
  // Echidna generates random: sender, recipient, amount
  // Calls transfer with those values
  // Checks: totalSupply before == totalSupply after
});
// Tests thousands of random cases
```

Properties are invariants — statements that must be true regardless of the inputs. Good properties catch entire classes of bugs, not just specific cases.

### Types of Properties

**Invariants**: always true, regardless of state.
```solidity
// Total supply never exceeds max
function echidna_supply_invariant() public view returns (bool) {
    return token.totalSupply() <= MAX_SUPPLY;
}
```

**Post-conditions**: true after a specific action.
```solidity
// After transfer, balances sum correctly
function echidna_transfer_postcondition(address to, uint256 amount) public returns (bool) {
    uint256 balanceBefore = token.balanceOf(address(this));
    token.transfer(to, amount);
    return token.balanceOf(address(this)) == balanceBefore - amount;
}
```

**Stateful properties**: true across a sequence of actions.
```solidity
// Health factor never goes below 1 after a valid deposit
function echidna_health_factor_after_deposit(uint256 amount) public returns (bool) {
    lending.deposit(amount);
    return lending.healthFactor(address(this)) >= 1e18;
}
```

### How Echidna Works

Echidna uses a coverage-guided fuzzing approach:
1. Generate random sequences of function calls with random inputs
2. Execute them against your contract
3. Check if any property functions return `false`
4. If a property fails, minimize the input sequence (find the shortest sequence that triggers the failure)
5. Report the failing sequence

The "coverage-guided" part means Echidna tracks which code paths have been executed and prioritizes inputs that explore new paths. This makes it much more effective than pure random fuzzing.

---

## Code Walkthrough

Setting up Echidna for a DeFi protocol:

```solidity
// contracts/test/EchidnaTest.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Token.sol";
import "../LendingPool.sol";

/**
 * @title EchidnaTest
 * @notice Property-based tests for Token and LendingPool.
 * Run with: echidna contracts/test/EchidnaTest.sol --contract EchidnaTest --config echidna.yaml
 */
contract EchidnaTest {
    Token public token;
    LendingPool public pool;

    address constant USER1 = address(0x1);
    address constant USER2 = address(0x2);

    uint256 public constant INITIAL_SUPPLY = 1_000_000e18;

    constructor() {
        token = new Token("Test", "TST", INITIAL_SUPPLY);
        pool = new LendingPool(address(token));

        // Give test users some tokens
        token.transfer(USER1, 100_000e18);
        token.transfer(USER2, 100_000e18);
    }

    // ── Token Invariants ───────────────────────────────────────────────────

    /**
     * @notice Total supply must never exceed initial supply.
     * (No minting in this token)
     */
    function echidna_total_supply_constant() public view returns (bool) {
        return token.totalSupply() == INITIAL_SUPPLY;
    }

    /**
     * @notice Sum of all balances must equal total supply.
     * (Conservation of tokens)
     */
    function echidna_balance_sum_equals_supply() public view returns (bool) {
        uint256 sum = token.balanceOf(address(this))
            + token.balanceOf(USER1)
            + token.balanceOf(USER2)
            + token.balanceOf(address(pool));
        return sum == token.totalSupply();
    }

    /**
     * @notice No address can have more tokens than total supply.
     */
    function echidna_no_balance_exceeds_supply() public view returns (bool) {
        return token.balanceOf(address(this)) <= token.totalSupply()
            && token.balanceOf(USER1) <= token.totalSupply()
            && token.balanceOf(USER2) <= token.totalSupply();
    }

    // ── Lending Pool Invariants ────────────────────────────────────────────

    /**
     * @notice Pool's token balance must equal total deposits.
     */
    function echidna_pool_balance_matches_deposits() public view returns (bool) {
        return token.balanceOf(address(pool)) == pool.totalDeposits();
    }

    /**
     * @notice Total borrows must never exceed total deposits.
     */
    function echidna_borrows_never_exceed_deposits() public view returns (bool) {
        return pool.totalBorrows() <= pool.totalDeposits();
    }

    /**
     * @notice Utilization rate must be between 0 and 100%.
     */
    function echidna_utilization_rate_valid() public view returns (bool) {
        uint256 util = pool.utilizationRate();
        return util <= 1e18; // 100% in 1e18 precision
    }

    /**
     * @notice Interest rate must be positive and below maximum.
     */
    function echidna_interest_rate_valid() public view returns (bool) {
        uint256 rate = pool.borrowRate();
        return rate > 0 && rate <= 1e18; // between 0% and 100% APR
    }

    // ── Stateful Tests ─────────────────────────────────────────────────────

    /**
     * @notice After depositing and immediately withdrawing, balance should be restored.
     * (No fees on immediate withdrawal in this protocol)
     */
    function test_deposit_withdraw_roundtrip(uint256 amount) public {
        amount = amount % token.balanceOf(address(this)); // bound to available balance
        if (amount == 0) return;

        uint256 balanceBefore = token.balanceOf(address(this));

        token.approve(address(pool), amount);
        pool.deposit(amount);
        pool.withdraw(pool.sharesOf(address(this)));

        uint256 balanceAfter = token.balanceOf(address(this));

        // Balance should be restored (within rounding)
        assert(balanceAfter >= balanceBefore - 1); // allow 1 wei rounding
    }

    /**
     * @notice Health factor must be >= 1 after a valid borrow.
     */
    function test_borrow_health_factor(uint256 depositAmount, uint256 borrowAmount) public {
        depositAmount = (depositAmount % 10_000e18) + 1e18; // 1 to 10,000 tokens
        borrowAmount = borrowAmount % depositAmount; // borrow less than deposit

        if (token.balanceOf(address(this)) < depositAmount) return;

        token.approve(address(pool), depositAmount);
        pool.deposit(depositAmount);

        if (borrowAmount == 0) return;

        try pool.borrow(borrowAmount) {
            // If borrow succeeded, health factor must be >= 1
            assert(pool.healthFactor(address(this)) >= 1e18);
        } catch {
            // Borrow failed (e.g., insufficient collateral) — that's fine
        }
    }
}
```

Echidna configuration:

```yaml
# echidna.yaml
testMode: assertion  # use assert() for failures
testLimit: 50000     # number of test sequences to run
seqLen: 100          # max length of each sequence
shrinkLimit: 5000    # attempts to minimize failing sequences

# Contract to test
contract: EchidnaTest

# Corpus directory (saves interesting inputs for reuse)
corpusDir: echidna-corpus

# Coverage-guided fuzzing
coverage: true

# Gas limit per call
gasLimit: 12500000

# Addresses to use as senders
deployer: "0x30000"
sender:
  - "0x10000"
  - "0x20000"
  - "0x30000"

# Print coverage report
printMaximizerCoverage: true
```

Running Echidna:

```bash
# Install Echidna
# macOS: brew install echidna
# Or download from: https://github.com/crytic/echidna/releases

# Run basic fuzzing
echidna contracts/test/EchidnaTest.sol --contract EchidnaTest --config echidna.yaml

# Run with more iterations for thorough testing
echidna contracts/test/EchidnaTest.sol --contract EchidnaTest --test-limit 100000

# Run in assertion mode (uses assert() instead of property functions)
echidna contracts/test/EchidnaTest.sol --contract EchidnaTest --test-mode assertion

# Reproduce a specific failing sequence
echidna contracts/test/EchidnaTest.sol --contract EchidnaTest --replay echidna-corpus/reproducers/failing_sequence.txt
```

---

## Common Mistakes and Gotchas

**1. Writing properties that are too weak**  
`echidna_always_true() { return true; }` will always pass but tells you nothing. Properties must be meaningful invariants. Think about what can go wrong and write properties that would catch it.

**2. Not bounding inputs**  
Echidna generates random uint256 values, which can be astronomically large. If your contract doesn't handle large values gracefully, you'll get many false positives. Bound inputs to realistic ranges: `amount = amount % MAX_AMOUNT + 1`.

**3. Not using `try/catch` for expected reverts**  
If a function can legitimately revert (e.g., insufficient balance), wrap it in `try/catch`. Otherwise, Echidna will report the revert as a failure even when it's expected behavior.

**4. Running too few iterations**  
The default test limit might not be enough for complex contracts. For production-critical contracts, run with `--test-limit 1000000` or more. Echidna can run overnight on a CI server.

**5. Not saving the corpus**  
The corpus directory saves interesting inputs that Echidna discovered. Reuse it across runs to avoid re-discovering the same paths. Commit the corpus to your repository.

---

## How This Connects to Production

Trail of Bits uses Echidna as a core part of their audit workflow. They've found critical vulnerabilities in Compound, MakerDAO, and other major protocols using Echidna. The Uniswap V3 team used property-based testing extensively to verify their concentrated liquidity math. Aave's team runs Echidna as part of their CI pipeline. The combination of Slither (static analysis) + Echidna (fuzzing) + manual review is the gold standard for smart contract security. Echidna is particularly effective for finding arithmetic edge cases in DeFi math — the kind of bugs that unit tests miss because you didn't think to test that specific combination of inputs.

---

## What to Learn Next

- **Working with Auditors: Lessons from a Trail of Bits Collaboration** — understand how to work with security researchers.
- **Top 10 Smart Contract Vulnerabilities and How to Prevent Them** — understand the full vulnerability landscape.
- **Slither: Automated Static Analysis for Solidity Contracts** — combine with Echidna for comprehensive automated security testing.
