# Getting Started with Circom: Writing Your First ZK Circuit

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You understand ZK proofs conceptually. Now you need to write one. You open the Circom docs and immediately hit unfamiliar syntax: templates, signals, constraints, `<==`, `===`. It's not like any language you've used before.

Circom is the most widely used language for writing ZK circuits. It compiles to R1CS (Rank-1 Constraint System), which can then be proved with Groth16 or PLONK via snarkjs. This blog takes you from zero to a working circuit with tests.

---

## Core Concepts

### What a Circuit Is

A ZK circuit is a mathematical representation of a computation. Instead of "if/else" and "loops," you have constraints — equations that must hold for the proof to be valid.

```
Traditional program:
function multiply(a, b) {
  return a * b;
}

ZK circuit:
template Multiply() {
  signal input a;
  signal input b;
  signal output c;
  c <== a * b;  // constraint: c must equal a * b
}
```

The circuit doesn't "run" — it defines relationships between signals. The prover provides values for all signals that satisfy all constraints. The verifier checks that the constraints hold.

### Signals: The Variables of Circuits

Signals are the variables in Circom. Three types:

**`signal input`** — private inputs (the witness). Only the prover knows these.

**`signal output`** — public outputs. Both prover and verifier see these.

**`signal`** (intermediate) — internal signals used in computation. Private.

```circom
template Example() {
    signal input a;      // private: only prover knows
    signal input b;      // private: only prover knows
    signal output c;     // public: verifier sees this
    signal intermediate; // private intermediate value

    intermediate <== a * a;  // intermediate = a²
    c <== intermediate + b;  // c = a² + b
}
```

### Constraints: The Rules

Constraints are equations that must hold. Circom has two constraint operators:

**`<==`** — assign AND constrain. Sets the signal value AND adds a constraint.

**`===`** — constrain only. Adds a constraint without assigning.

**`<--`** — assign only (no constraint). DANGEROUS — use only when you add the constraint separately.

```circom
// Safe: assign and constrain in one step
c <== a * b;

// Equivalent but verbose:
c <-- a * b;  // assign (no constraint yet)
c === a * b;  // add constraint separately

// DANGEROUS: assign without constraint
// The prover can set c to anything — no constraint enforces correctness
c <-- a * b;  // missing constraint!
```

### The Constraint System Limitation

Circom circuits can only express quadratic constraints: `a * b = c`. You cannot directly express:
- Division (use multiplication: `a = b * c` means `a/b = c`)
- Comparison (use range checks and bit decomposition)
- Conditionals (use multiplexers)
- Loops with variable bounds (must unroll)

This is the fundamental challenge of circuit writing — expressing arbitrary computation as quadratic constraints.

### Templates and Components

Templates are reusable circuit components (like functions):

```circom
template IsZero() {
    signal input in;
    signal output out;
    signal inv;

    // If in == 0: out = 1
    // If in != 0: out = 0
    inv <-- in != 0 ? 1/in : 0;
    out <== -in * inv + 1;
    in * out === 0;
}

template Main() {
    signal input x;
    signal output result;

    // Use IsZero as a component
    component isZero = IsZero();
    isZero.in <== x;
    result <== isZero.out;
}
```

---

## Code Walkthrough

Building a complete circuit: age verification (prove you're over 18 without revealing your age):

```circom
// circuits/age_verification.circom
pragma circom 2.0.0;

// Include standard library components
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

/**
 * AgeVerification: Prove age >= minAge without revealing exact age.
 *
 * Private inputs:
 *   - age: the actual age (kept secret)
 *   - salt: random value for commitment
 *
 * Public inputs:
 *   - minAge: the minimum age threshold
 *   - commitment: hash(age, salt) — stored on-chain
 *
 * Proves:
 *   1. age >= minAge
 *   2. hash(age, salt) == commitment (age matches the on-chain commitment)
 */
template AgeVerification() {
    // Private inputs (witness)
    signal input age;
    signal input salt;

    // Public inputs
    signal input minAge;
    signal input commitment;

    // ── Constraint 1: age >= minAge ────────────────────────────────────────

    // GreaterEqThan(n) checks if in[0] >= in[1]
    // n = number of bits (must be large enough for your values)
    // For ages 0-150: 8 bits is enough
    component ageCheck = GreaterEqThan(8);
    ageCheck.in[0] <== age;
    ageCheck.in[1] <== minAge;

    // ageCheck.out must be 1 (true) — this is the constraint
    ageCheck.out === 1;

    // ── Constraint 2: hash(age, salt) == commitment ────────────────────────

    // Poseidon hash is ZK-friendly (much cheaper than Keccak256 in circuits)
    component hasher = Poseidon(2);
    hasher.inputs[0] <== age;
    hasher.inputs[1] <== salt;

    // The hash output must equal the public commitment
    hasher.out === commitment;
}

// Main component — this is the entry point
component main {public [minAge, commitment]} = AgeVerification();
```

```circom
// circuits/range_proof.circom — prove a value is in a range
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/**
 * RangeProof: Prove min <= value <= max without revealing value.
 */
template RangeProof(n) {
    signal input value;   // private
    signal input min;     // public
    signal input max;     // public

    // Check value >= min
    component geMin = GreaterEqThan(n);
    geMin.in[0] <== value;
    geMin.in[1] <== min;
    geMin.out === 1;

    // Check value <= max
    component leMax = LessEqThan(n);
    leMax.in[0] <== value;
    leMax.in[1] <== max;
    leMax.out === 1;
}

component main {public [min, max]} = RangeProof(32);
```

```circom
// circuits/merkle_membership.circom — prove membership in a Merkle tree
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";

/**
 * MerkleProof: Prove a leaf is in a Merkle tree without revealing which leaf.
 *
 * Private inputs:
 *   - leaf: the secret value
 *   - pathElements: sibling hashes along the path
 *   - pathIndices: 0 = left, 1 = right at each level
 *
 * Public inputs:
 *   - root: the Merkle root (stored on-chain)
 */
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input root;

    component hashers[levels];
    component mux[levels];

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Determine left/right order based on pathIndex
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== levelHashes[i];      // if index=0: current is left
        mux[i].c[0][1] <== pathElements[i];      // if index=0: sibling is right
        mux[i].c[1][0] <== pathElements[i];      // if index=1: sibling is left
        mux[i].c[1][1] <== levelHashes[i];       // if index=1: current is right
        mux[i].s <== pathIndices[i];

        // Hash the pair
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        levelHashes[i + 1] <== hashers[i].out;
    }

    // The computed root must match the public root
    root === levelHashes[levels];
}

component main {public [root]} = MerkleProof(20); // 20-level tree = 2^20 = 1M leaves
```

TypeScript: compile, setup, prove, and verify:

```typescript
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import * as fs from "fs";
import { execSync } from "child_process";

async function fullWorkflow() {
  // ── 1. Compile Circuit ─────────────────────────────────────────────────
  execSync("circom circuits/age_verification.circom --r1cs --wasm --sym -o build/");
  console.log("Circuit compiled");

  // ── 2. Trusted Setup (Powers of Tau) ──────────────────────────────────
  // In production: use an existing ceremony (Hermez Ignition)
  // For testing: generate locally
  await snarkjs.powersOfTau.newAccumulator(
    "bn128",
    12, // 2^12 = 4096 constraints max
    "build/pot12_0000.ptau"
  );
  await snarkjs.powersOfTau.contribute(
    "build/pot12_0000.ptau",
    "build/pot12_0001.ptau",
    "Contributor 1",
    "random entropy"
  );
  await snarkjs.powersOfTau.preparePhase2(
    "build/pot12_0001.ptau",
    "build/pot12_final.ptau"
  );

  // ── 3. Circuit-Specific Setup (Groth16) ───────────────────────────────
  await snarkjs.groth16.setup(
    "build/age_verification.r1cs",
    "build/pot12_final.ptau",
    "build/age_verification_0000.zkey"
  );
  await snarkjs.zKey.contribute(
    "build/age_verification_0000.zkey",
    "build/age_verification_final.zkey",
    "Circuit contributor",
    "more entropy"
  );

  // Export verification key
  const vKey = await snarkjs.zKey.exportVerificationKey("build/age_verification_final.zkey");
  fs.writeFileSync("build/verification_key.json", JSON.stringify(vKey));

  // ── 4. Generate Proof ──────────────────────────────────────────────────
  const poseidon = await buildPoseidon();

  const age = 25n;
  const salt = 12345678n;
  const minAge = 18n;

  // Compute commitment (what's stored on-chain)
  const commitment = poseidon.F.toString(poseidon([age, salt]));

  const input = {
    age: age.toString(),
    salt: salt.toString(),
    minAge: minAge.toString(),
    commitment: commitment,
  };

  console.time("Proof generation");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "build/age_verification_js/age_verification.wasm",
    "build/age_verification_final.zkey"
  );
  console.timeEnd("Proof generation");

  console.log("Public signals:", publicSignals); // [minAge, commitment]
  console.log("Proof size:", JSON.stringify(proof).length, "bytes");

  // ── 5. Verify Proof ────────────────────────────────────────────────────
  const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  console.log("Proof valid:", isValid); // true

  // ── 6. Generate Solidity Verifier ─────────────────────────────────────
  const solidityVerifier = await snarkjs.zKey.exportSolidityVerifier(
    "build/age_verification_final.zkey",
    {
      groth16: fs.readFileSync(
        "node_modules/snarkjs/templates/verifier_groth16.sol.ejs",
        "utf8"
      ),
    }
  );
  fs.writeFileSync("contracts/AgeVerifier.sol", solidityVerifier);
  console.log("Solidity verifier generated");

  // ── 7. Format Proof for Solidity ──────────────────────────────────────
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  console.log("Solidity calldata:", calldata);
  // Use this calldata to call the verifier contract
}

fullWorkflow().catch(console.error);
```

---

## Common Mistakes and Gotchas

**1. Using `<--` without adding a constraint**  
`c <-- a * b` assigns c but doesn't constrain it. A malicious prover can set c to any value. Always use `<==` or add `c === a * b` after `<--`. This is the most common circuit security bug.

**2. Assuming non-quadratic constraints work**  
Circom only supports quadratic constraints (degree ≤ 2). `a * b * c` is degree 3 and won't compile. Break it into: `temp <== a * b; result <== temp * c`.

**3. Integer overflow in the field**  
Circom operates over a prime field (BN128 prime ≈ 2^254). Values wrap around at the field prime. If your values can exceed the field size, you'll get incorrect results. Use bit decomposition to handle large numbers safely.

**4. Not testing with invalid inputs**  
Test that your circuit rejects invalid proofs. Try to generate a proof with `age = 15` when `minAge = 18` — it should fail. If it doesn't, your constraints are wrong.

**5. Forgetting to mark public signals**  
In `component main {public [minAge, commitment]} = AgeVerification()`, the `public` declaration tells snarkjs which signals are public. If you forget this, all signals are private and the verifier can't check the public inputs.

---

## How This Connects to Production

Tornado Cash's circuits are written in Circom — the deposit and withdrawal circuits are the canonical examples of Merkle proof circuits. Semaphore (identity protocol) uses Circom for its group membership proofs. Dark Forest (on-chain game) uses Circom to prove valid moves without revealing player positions. The circomlib library (used in the examples above) is the standard library of reusable circuit components — comparators, hash functions, bit operations. Understanding Circom is the entry point to the entire ZK application development ecosystem.

---

## What to Learn Next

- **SnarkJS and Trusted Setup Ceremonies: How They Work and Why They Matter** — understand the setup process your circuits depend on.
- **Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions** — understand why we use Poseidon in circuits.
- **On-Chain Proof Verification in Solidity: Gas Costs and Optimization** — deploy your verifier contract.
