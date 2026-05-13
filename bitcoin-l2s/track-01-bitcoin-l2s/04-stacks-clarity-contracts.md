# Stacks and Clarity: Smart Contracts Anchored to Bitcoin

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 4 of 8
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You want to build smart contracts that settle on Bitcoin — not Ethereum, not a separate chain with its own security assumptions. Stacks is a layer that anchors its state to Bitcoin blocks using Proof of Transfer (PoX). Its smart contract language, Clarity, is deliberately non-Turing-complete and interpreted (not compiled), meaning you can read exactly what a contract does before executing it. But Clarity's syntax is Lisp-like and unfamiliar to most developers. You need to understand how to write, test, and deploy Clarity contracts.

## Core Concepts

### Why Clarity is Different

Clarity makes three radical design choices:

1. **Decidable** — You can always determine what a contract will do by reading it. No unbounded loops, no reentrancy.
2. **Interpreted** — The source code IS the on-chain code. No compilation step means no compiler bugs and what you audit is what runs.
3. **No reentrancy by design** — Contract calls are atomic. A called contract cannot call back into the caller.

### Your First Clarity Contract

Clarity uses a Lisp-like syntax with prefix notation. Here's a simple counter contract:

```clarity
;; counter.clar
;; A simple counter contract demonstrating Clarity basics
;; Deploy with: clarinet@2.4.0

;; Define a data variable (persistent storage)
(define-data-var counter uint u0)

;; Define a read-only function (no state changes, no gas cost to call)
(define-read-only (get-counter)
  (ok (var-get counter))
)

;; Define a public function (can modify state)
(define-public (increment)
  (begin
    (var-set counter (+ (var-get counter) u1))
    (ok (var-get counter))
  )
)

;; Define a public function with input validation
(define-public (add (value uint))
  (begin
    (asserts! (> value u0) (err u100))
    (var-set counter (+ (var-get counter) value))
    (ok (var-get counter))
  )
)

;; Define a public function restricted to contract deployer
(define-public (reset)
  (begin
    (asserts! (is-eq tx-sender contract-caller) (err u101))
    (var-set counter u0)
    (ok u0)
  )
)
```

### Setting Up the Development Environment

Clarinet is the official Stacks development toolkit:

```shell
# Install Clarinet (stacks development CLI) - clarinet@2.4.0
# macOS/Linux
curl -L https://github.com/hirosystems/clarinet/releases/download/v2.4.0/clarinet-linux-x64.tar.gz | tar xz
sudo mv clarinet /usr/local/bin/

# Create a new Clarity project
clarinet new my-bitcoin-app
cd my-bitcoin-app

# Generate a new contract
clarinet contract new counter
```

```
Expected output:
Created directory my-bitcoin-app
Created directory my-bitcoin-app/contracts
Created directory my-bitcoin-app/tests
Created file my-bitcoin-app/Clarinet.toml
Created file my-bitcoin-app/settings/Devnet.toml
Contract created: contracts/counter.clar
Test created: tests/counter_test.ts
```

### A Token Contract (SIP-010 Fungible Token)

SIP-010 is the Stacks equivalent of ERC-20. Here's a complete fungible token implementation:

```clarity
;; sip010-token.clar
;; A SIP-010 compliant fungible token on Stacks
;; Standard: https://github.com/stacksgov/sips/blob/main/sips/sip-010

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; Define the token
(define-fungible-token my-token u1000000000)

;; Token metadata
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-insufficient-balance (err u101))
(define-constant err-invalid-amount (err u102))

;; SIP-010 required functions

(define-read-only (get-name)
  (ok "My Bitcoin Token")
)

(define-read-only (get-symbol)
  (ok "MBT")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance my-token account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply my-token))
)

(define-read-only (get-token-uri)
  (ok (some u"https://example.com/token-metadata.json"))
)

;; Transfer tokens between accounts
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err u103))
    (asserts! (> amount u0) err-invalid-amount)
    (try! (ft-transfer? my-token amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

;; Mint tokens (owner only)
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (> amount u0) err-invalid-amount)
    (ft-mint? my-token amount recipient)
  )
)
```

### Testing with Clarinet

Clarinet includes a testing framework using TypeScript and the Simnet (simulated network):

```typescript
// tests/counter_test.ts
// clarinet@2.4.0 test framework
import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

describe("counter contract", () => {
  it("starts at zero", () => {
    const result = simnet.callReadOnlyFn(
      "counter",
      "get-counter",
      [],
      simnet.deployer
    );
    expect(result.result).toBeOk(Cl.uint(0));
  });

  it("increments by one", () => {
    const result = simnet.callPublicFn(
      "counter",
      "increment",
      [],
      simnet.deployer
    );
    expect(result.result).toBeOk(Cl.uint(1));
  });

  it("rejects add with zero value", () => {
    const result = simnet.callPublicFn(
      "counter",
      "add",
      [Cl.uint(0)],
      simnet.deployer
    );
    expect(result.result).toBeErr(Cl.uint(100));
  });
});
```

```shell
# Run tests
clarinet test

# Check contract syntax
clarinet check
```

```
Expected output:
✓ counter contract > starts at zero (2ms)
✓ counter contract > increments by one (1ms)
✓ counter contract > rejects add with zero value (1ms)

3 tests passed
```

### Deploying to Stacks Testnet

```shell
# Deploy to Stacks testnet
# First, get testnet STX from faucet: https://explorer.hiro.so/sandbox/faucet?chain=testnet
clarinet deployments apply -p deployments/default.testnet-plan.yaml --no-dashboard

# Verify deployment on explorer
# https://explorer.hiro.so/txid/<tx-id>?chain=testnet
```

## Common Pitfalls

1. **Using `contract-caller` when you mean `tx-sender`** — `tx-sender` is the original transaction signer. `contract-caller` is the immediate caller (could be another contract). For access control, decide which you need: `tx-sender` for user-level auth, `contract-caller` for contract-level auth.

2. **Forgetting Clarity has no loops** — You cannot iterate over unbounded data. Use `map`, `fold`, and `filter` on fixed-size lists (max 128,000 elements). If you need to process variable-length data, design your contract to handle items one at a time across multiple transactions.

3. **Not understanding the post-conditions system** — Stacks transactions include post-conditions that assert what assets can be transferred. If your contract transfers tokens, callers must include appropriate post-conditions or the transaction will be rejected. This is a security feature, not a bug.

4. **Ignoring the 1 MB contract size limit** — Clarity contracts have a maximum size. Complex contracts should be split into multiple contracts that call each other via `contract-call?`.

## What to Learn Next

- [Stacks Advanced Patterns](./05-stacks-advanced-patterns.md) — Maps, traits, multi-contract architectures, and PoX integration
- [Clarity Language Reference](https://docs.stacks.co/clarity/language-overview) — Official Clarity documentation
- [Hiro Platform GitHub](https://github.com/hirosystems) — Stacks development tools and SDKs
