# Hardhat vs Foundry: Which Testing Framework Should You Use?

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You're starting a new Solidity project. You open a browser tab, search "Solidity testing framework," and immediately find two camps: Hardhat evangelists and Foundry maximalists, each convinced the other is wrong. Both frameworks are actively maintained, both are used in production by major protocols, and both have real strengths.

The answer isn't "use X" — it's "understand what each does well and pick the right tool for your situation." This blog gives you a concrete comparison with real code so you can make that call.

---

## Core Concepts

### What Each Framework Is

**Hardhat** — a Node.js-based development environment. Tests are written in JavaScript/TypeScript. Comes with a built-in EVM (Hardhat Network), task runner, and plugin ecosystem. Mature, widely adopted, excellent for teams that want TypeScript throughout their stack.

**Foundry** — a Rust-based toolkit. Tests are written in Solidity. Extremely fast. Built-in fuzzing, gas snapshots, and cheatcodes. Preferred by security researchers and protocols that want to test in the same language as their contracts.

### The Key Difference: Test Language

This is the most important distinction.

**Hardhat tests (TypeScript):**
```typescript
it("should transfer tokens", async () => {
  const [owner, alice] = await ethers.getSigners();
  const token = await ethers.deployContract("Token", ["MyToken", "MTK", 1000000]);
  await token.transfer(alice.address, ethers.parseUnits("100", 18));
  expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("100", 18));
});
```

**Foundry tests (Solidity):**
```solidity
function test_Transfer() public {
    token.transfer(alice, 100e18);
    assertEq(token.balanceOf(alice), 100e18);
}
```

Writing tests in Solidity means:
- No ABI encoding/decoding overhead in tests
- Direct access to internal functions (with `--via-ir` or test helpers)
- Easier to test edge cases that are hard to set up from TypeScript
- Fuzzing is built-in and natural

Writing tests in TypeScript means:
- Full Node.js ecosystem available (database calls, API calls, complex setup)
- Easier integration with frontend code
- More familiar for full-stack developers
- Better for end-to-end tests that involve off-chain components

### Foundry's Killer Features

**Fuzzing** — Foundry automatically generates random inputs to find edge cases:

```solidity
// Foundry runs this with hundreds of random inputs automatically
function testFuzz_Transfer(address to, uint256 amount) public {
    vm.assume(to != address(0));           // filter invalid inputs
    vm.assume(amount <= token.totalSupply());

    uint256 balanceBefore = token.balanceOf(address(this));
    token.transfer(to, amount);
    assertEq(token.balanceOf(address(this)), balanceBefore - amount);
}
```

**Cheatcodes** — `vm.*` functions that manipulate EVM state:

```solidity
// Warp time forward
vm.warp(block.timestamp + 7 days);

// Set block number
vm.roll(block.number + 100);

// Impersonate any address
vm.prank(alice);
token.transfer(bob, 100e18); // executed as alice

// Expect a revert
vm.expectRevert("Insufficient balance");
token.transfer(alice, type(uint256).max);

// Expect an event
vm.expectEmit(true, true, false, true);
emit Transfer(address(this), alice, 100e18);
token.transfer(alice, 100e18);
```

**Gas snapshots** — track gas usage over time:

```bash
forge snapshot  # creates .gas-snapshot file
# Make changes, then:
forge snapshot --diff  # shows gas changes
```

**Invariant testing** — define properties that must always hold:

```solidity
// Invariant: total supply must always equal sum of all balances
function invariant_TotalSupplyMatchesBalances() public {
    assertEq(token.totalSupply(), sumOfAllBalances());
}
```

### Hardhat's Killer Features

**Plugin ecosystem** — hundreds of plugins for everything from gas reporting to contract verification:

```typescript
// hardhat.config.ts
import "@nomicfoundation/hardhat-toolbox"; // includes ethers, chai, gas reporter, coverage
import "hardhat-deploy";                   // deployment management
import "@openzeppelin/hardhat-upgrades";   // proxy upgrade helpers
```

**Console.log in Solidity** — invaluable for debugging:

```solidity
import "hardhat/console.sol";

function transfer(address to, uint256 amount) external {
    console.log("Transfer: from=%s to=%s amount=%s", msg.sender, to, amount);
    // ... transfer logic
}
```

**TypeScript integration** — test your contracts alongside your frontend code:

```typescript
// Test that involves both contract state and off-chain logic
it("should match frontend calculation", async () => {
  const contractResult = await pool.calculateOutput(amountIn);
  const frontendResult = calculateOutputOffChain(amountIn); // your JS math
  expect(contractResult).to.equal(frontendResult);
});
```

**Mainnet forking with impersonation** — easy to set up in config:

```typescript
// hardhat.config.ts
networks: {
  hardhat: {
    forking: { url: process.env.MAINNET_RPC!, blockNumber: 19500000 }
  }
}
```

---

## Code Walkthrough

The same test suite written in both frameworks:

**Foundry (test/Token.t.sol):**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Token.sol";

contract TokenTest is Test {
    Token token;
    address alice = makeAddr("alice"); // creates a labeled address
    address bob = makeAddr("bob");

    function setUp() public {
        // Runs before each test
        token = new Token("MyToken", "MTK", 1_000_000);
        // Give alice some tokens
        token.transfer(alice, 10_000e18);
    }

    function test_InitialState() public view {
        assertEq(token.name(), "MyToken");
        assertEq(token.symbol(), "MTK");
        assertEq(token.totalSupply(), 1_000_000e18);
    }

    function test_Transfer() public {
        vm.prank(alice); // next call is from alice
        token.transfer(bob, 1_000e18);

        assertEq(token.balanceOf(alice), 9_000e18);
        assertEq(token.balanceOf(bob), 1_000e18);
    }

    function test_RevertWhen_InsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        token.transfer(bob, 100_000e18); // alice only has 10,000
    }

    // Fuzz test — Foundry runs with 256 random inputs by default
    function testFuzz_TransferAmount(uint256 amount) public {
        vm.assume(amount > 0 && amount <= 10_000e18);

        vm.prank(alice);
        token.transfer(bob, amount);

        assertEq(token.balanceOf(alice), 10_000e18 - amount);
        assertEq(token.balanceOf(bob), amount);
    }

    // Invariant: total supply never changes (no mint/burn in this test)
    function invariant_TotalSupplyConstant() public view {
        assertEq(token.totalSupply(), 1_000_000e18);
    }

    function test_GasTransfer() public {
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        token.transfer(bob, 1_000e18);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for transfer", gasUsed);
        assertLt(gasUsed, 50_000); // assert transfer costs less than 50k gas
    }
}
```

**Hardhat (test/Token.ts):**

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { Token } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Token", () => {
  let token: Token;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    token = await ethers.deployContract("Token", ["MyToken", "MTK", 1_000_000]);
    await token.transfer(alice.address, ethers.parseUnits("10000", 18));
  });

  it("should have correct initial state", async () => {
    expect(await token.name()).to.equal("MyToken");
    expect(await token.symbol()).to.equal("MTK");
    expect(await token.totalSupply()).to.equal(ethers.parseUnits("1000000", 18));
  });

  it("should transfer tokens", async () => {
    await token.connect(alice).transfer(bob.address, ethers.parseUnits("1000", 18));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("9000", 18));
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseUnits("1000", 18));
  });

  it("should revert on insufficient balance", async () => {
    await expect(
      token.connect(alice).transfer(bob.address, ethers.parseUnits("100000", 18))
    ).to.be.revertedWith("Insufficient balance");
  });

  it("should emit Transfer event", async () => {
    await expect(token.connect(alice).transfer(bob.address, ethers.parseUnits("1000", 18)))
      .to.emit(token, "Transfer")
      .withArgs(alice.address, bob.address, ethers.parseUnits("1000", 18));
  });

  // Hardhat advantage: test with real mainnet state
  it("should interact with mainnet Uniswap", async () => {
    // This test only runs when forking mainnet
    const uniswapRouter = await ethers.getContractAt(
      "ISwapRouter",
      "0xE592427A0AEce92De3Edee1F18E0157C05861564"
    );
    // ... test your token's interaction with real Uniswap
  });
});
```

**Running tests:**

```bash
# Foundry
forge test                    # run all tests
forge test -vvv               # verbose output with traces
forge test --match-test Transfer  # run specific test
forge test --gas-report       # show gas usage
forge coverage                # code coverage

# Hardhat
npx hardhat test              # run all tests
npx hardhat test --grep "Transfer"  # run specific test
npx hardhat coverage          # code coverage (requires solidity-coverage)
REPORT_GAS=true npx hardhat test  # gas reporting
```

---

## Common Mistakes and Gotchas

**1. Not using `setUp` / `beforeEach` for test isolation**  
Each test should start from a clean state. If tests share state, a failure in one test can cause false failures in others. Always deploy fresh contracts in `setUp` (Foundry) or `beforeEach` (Hardhat).

**2. Foundry: forgetting `vm.prank` only applies to the next call**  
`vm.prank(alice)` makes the next call appear to come from alice. If you need multiple calls from alice, use `vm.startPrank(alice)` / `vm.stopPrank()`.

**3. Hardhat: not using TypeChain for type safety**  
Without TypeChain, you're calling contract functions as `any` — no autocomplete, no type checking. Always generate TypeChain types (`npx hardhat compile` with `@typechain/hardhat` plugin) and use them in tests.

**4. Testing only the happy path**  
Most bugs are in edge cases: zero amounts, max values, empty arrays, the same address as both sender and recipient. Foundry's fuzzing catches many of these automatically. In Hardhat, you need to write them manually.

**5. Not testing events**  
Events are part of your contract's interface. If you change an event signature, frontends and indexers break. Test that events are emitted with the correct arguments. Both frameworks support this — use `vm.expectEmit` in Foundry and `.to.emit().withArgs()` in Hardhat.

---

## How This Connects to Production

Uniswap V4 was developed with Foundry — their test suite uses extensive fuzzing to verify invariants across the entire AMM math. OpenZeppelin's contracts library uses Hardhat for its test suite, leveraging the TypeScript ecosystem for complex integration tests. Trail of Bits (one of the top smart contract audit firms) uses Foundry's fuzzing and Echidna (property-based fuzzer) as core parts of their audit workflow. Many production protocols use both: Foundry for unit tests and fuzzing, Hardhat for integration tests and deployment scripts. The choice isn't either/or — it's about using the right tool for each layer of your test suite.

---

## What to Learn Next

- **Echidna: Property-Based Fuzzing for Smart Contracts** — go deeper on fuzzing with a dedicated tool.
- **Smart Contract Audit Process: What Auditors Actually Look For** — understand how your test suite fits into the broader security workflow.
- **Gas Optimization Patterns Every Solidity Dev Should Know** — use Foundry's gas snapshots to measure and track optimization progress.
