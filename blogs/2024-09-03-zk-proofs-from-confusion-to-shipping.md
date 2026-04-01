---
title: "ZK Proofs: From Complete Confusion to Actually Shipping Something"
date: 2024-09-03
tags: [zk, circom, snarkjs, privacy, ethereum]
---

I've been trying to understand zero-knowledge proofs for about eight months. For the first five of those months, I understood them conceptually but couldn't actually build anything with them. The gap between "I understand what a ZK proof is" and "I can write a circuit and verify a proof on-chain" was larger than I expected.

This post is about crossing that gap.

## Where I started

I understood the high-level concept: you can prove you know something without revealing what you know. I'd read the explainers, watched the talks, understood the Sudoku analogy.

What I didn't understand: how you actually express a computation as a circuit, what constraints are, why you can't just use regular if/else logic, what the trusted setup is and why it matters, how snarkjs fits together with Circom.

The documentation exists but it assumes you're either a cryptographer (in which case you don't need it) or you're following a specific tutorial (in which case you can't generalize). I was neither.

## The thing that finally made circuits click

Circuits are not programs. They don't execute. They define relationships between values.

When you write `c <== a * b` in Circom, you're not saying "multiply a by b and store the result in c." You're saying "c must equal a times b." The prover provides values for a, b, and c that satisfy this constraint. The verifier checks that the constraint holds.

This means you can't write:
```
if (x > 0) {
    y = x;
} else {
    y = -x;
}
```

Because "if/else" is not a constraint. You have to express it as arithmetic:
```circom
// Absolute value using a multiplexer
// isPositive is 1 if x >= 0, 0 otherwise
signal isPositive;
signal absX;

// This is a simplification — real implementation needs range checks
absX <== isPositive * x + (1 - isPositive) * (-x);
```

Once I understood that circuits are constraint systems, not programs, everything else made more sense.

## The first circuit I actually shipped

I built an age verification circuit. Users prove they're over 18 without revealing their actual age. The circuit checks:

1. `age >= 18` (the claim)
2. `Poseidon(age, salt) == commitment` (the age matches what's stored on-chain)

```circom
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

template AgeVerification() {
    signal input age;        // private
    signal input salt;       // private
    signal input minAge;     // public
    signal input commitment; // public

    // Check age >= minAge
    component ageCheck = GreaterEqThan(8);
    ageCheck.in[0] <== age;
    ageCheck.in[1] <== minAge;
    ageCheck.out === 1;

    // Check commitment matches
    component hasher = Poseidon(2);
    hasher.inputs[0] <== age;
    hasher.inputs[1] <== salt;
    hasher.out === commitment;
}

component main {public [minAge, commitment]} = AgeVerification();
```

This is about 20 lines of Circom. It took me three days to write correctly.

The mistakes I made:
- Used `keccak256` instead of Poseidon initially (keccak256 costs ~100,000 constraints; Poseidon costs ~200)
- Forgot to mark `minAge` and `commitment` as public inputs
- Got the constraint direction wrong on the age check

## The trusted setup confusion

The trusted setup is the part that confused me most. You need to run a ceremony to generate cryptographic parameters before you can generate proofs. If the ceremony is compromised, fake proofs can be generated.

For development, you can run a local ceremony with a single participant (yourself). For production, you should use an existing ceremony (Hermez Ignition is the standard).

The workflow:
```bash
# 1. Compile the circuit
circom age_verification.circom --r1cs --wasm --sym

# 2. Download Hermez Ignition (for production)
# Or generate locally for development:
snarkjs powersoftau new bn128 12 pot12_0000.ptau
snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau
snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau

# 3. Circuit-specific setup
snarkjs groth16 setup age_verification.r1cs pot12_final.ptau age_verification_0000.zkey
snarkjs zkey contribute age_verification_0000.zkey age_verification_final.zkey

# 4. Export verification key
snarkjs zkey export verificationkey age_verification_final.zkey verification_key.json

# 5. Generate Solidity verifier
snarkjs zkey export solidityverifier age_verification_final.zkey AgeVerifier.sol
```

The Solidity verifier is auto-generated. You deploy it, and it can verify proofs on-chain for ~200,000 gas.

## The on-chain integration

The verifier contract is straightforward to use:

```solidity
interface IAgeVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[2] calldata pubSignals
    ) external view returns (bool);
}

contract AgeGate {
    IAgeVerifier public verifier;
    mapping(address => bytes32) public commitments;

    function verifyAge(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC
    ) external {
        bytes32 commitment = commitments[msg.sender];
        require(commitment != bytes32(0), "No commitment");

        uint[2] memory pubSignals = [
            18, // minAge
            uint256(commitment)
        ];

        require(verifier.verifyProof(pA, pB, pC, pubSignals), "Invalid proof");
        // User has proven they're 18+
    }
}
```

The tricky part: the proof format from snarkjs doesn't directly match what Solidity expects. The `pi_b` field needs to be transposed:

```typescript
// snarkjs output → Solidity format
const pA = [proof.pi_a[0], proof.pi_a[1]];
const pB = [
  [proof.pi_b[0][1], proof.pi_b[0][0]], // transposed!
  [proof.pi_b[1][1], proof.pi_b[1][0]], // transposed!
];
const pC = [proof.pi_c[0], proof.pi_c[1]];
```

I spent two hours debugging "invalid proof" errors before I found this in a GitHub issue. It's not in the main documentation.

## What I'd tell myself eight months ago

**Start with circomlib.** Don't write your own hash functions or comparators. The circomlib library has audited implementations of everything you need. Use them.

**Poseidon, not Keccak256.** For anything inside a circuit, use Poseidon. It's designed for ZK circuits and costs 500x less in constraints.

**The proof format transposition is a gotcha.** Document it, test it, don't assume it works.

**Proof generation is slow.** For a simple circuit like mine, proof generation takes ~500ms in the browser. For complex circuits (zkEVMs), it takes minutes. Design your UX around this.

**The trusted setup matters for production.** For a toy project, a local ceremony is fine. For anything with real users, use Hermez Ignition or run a proper multi-party ceremony.

## What I'm building next

I want to build a more complex privacy application — something closer to a Tornado Cash-style mixer, but for a different use case. The incremental Merkle tree pattern (deposit → commitment in tree → ZK proof of membership → withdraw) is the canonical ZK application and I want to understand it deeply.

The circuit complexity is significantly higher than age verification. I'm expecting it to take a few months to get right.

---

*The age verification demo is live on Sepolia if you want to try it. The circuit code and contracts are on GitHub. I kept the code simple on purpose — it's meant to be readable, not production-ready.*
