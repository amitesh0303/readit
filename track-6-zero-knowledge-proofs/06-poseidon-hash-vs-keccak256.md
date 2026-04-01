# Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions

**Track:** Intermediate  
**Read time:** 9 min

---

## The Problem

You're writing a Circom circuit that needs to hash some values. You reach for keccak256 — it's the standard Ethereum hash function, it's secure, you know it. Then you discover that keccak256 in a ZK circuit costs ~100,000 constraints. Your entire circuit budget is blown on one hash.

Poseidon costs ~200 constraints for the same operation. That's a 500x difference. This blog explains why, and when to use each.

---

## Core Concepts

### Why Hash Functions Matter in ZK Circuits

ZK circuits operate over finite fields — they can only do addition and multiplication. Every operation in your circuit must be expressed as field arithmetic.

Keccak256 is designed for hardware efficiency — it uses bitwise operations (XOR, AND, rotations). These are cheap on CPUs but extremely expensive in field arithmetic. Each bitwise operation requires many field multiplications to simulate.

Poseidon is designed for field arithmetic efficiency — it uses only additions and multiplications over the field. This maps directly to ZK circuit constraints.

```
Keccak256 in a ZK circuit:
- ~100,000 constraints per hash
- Designed for CPU/hardware, not field arithmetic
- Expensive to prove

Poseidon in a ZK circuit:
- ~200-300 constraints per hash
- Designed specifically for ZK circuits
- Cheap to prove

SHA256 in a ZK circuit:
- ~25,000 constraints per hash
- Better than Keccak256 but still expensive
```

### How Poseidon Works

Poseidon is a sponge construction (like Keccak) but uses a permutation designed for field arithmetic:

```
Poseidon permutation:
1. Add round constants (field additions — cheap)
2. Apply S-box: x → x^5 (field multiplication — cheap)
3. Apply MDS matrix (linear layer — field multiplications)
4. Repeat for R rounds

Total: ~200 field multiplications per hash
```

The security of Poseidon comes from the algebraic structure of the permutation, not from bitwise complexity. It's been analyzed by cryptographers and is considered secure for ZK applications.

### When to Use Each

**Use Poseidon when:**
- Inside ZK circuits (Circom, Cairo, Noir)
- Computing Merkle tree hashes in circuits
- Commitment schemes in circuits
- Any hash that needs to be verified in a ZK proof

**Use Keccak256 when:**
- On-chain Solidity code (native EVM opcode, very cheap)
- Off-chain TypeScript/JavaScript
- Anywhere outside a ZK circuit
- When you need Ethereum compatibility (e.g., EIP-712 signatures)

**The hybrid pattern:**
```
Off-chain: compute Poseidon hash (for ZK circuit)
On-chain: store the hash, verify ZK proof
On-chain: use Keccak256 for other purposes (event IDs, mapping keys)
```

### Poseidon Parameters

Poseidon has configurable parameters:
- **t**: state size (number of field elements). Poseidon(2) hashes 2 inputs, Poseidon(3) hashes 3, etc.
- **α**: S-box exponent (usually 5 for BN128 field)
- **R_F, R_P**: number of full and partial rounds

The circomlib library provides pre-configured Poseidon templates for common use cases.

---

## Code Walkthrough

Using Poseidon in Circom and computing matching hashes in TypeScript:

```circom
// circuits/commitment.circom
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

/**
 * Demonstrates Poseidon hashing in a circuit.
 * Proves: hash(secret, nonce) == commitment
 */
template CommitmentVerifier() {
    signal input secret;      // private
    signal input nonce;       // private
    signal input commitment;  // public (stored on-chain)

    // Poseidon(2) hashes 2 inputs
    component hasher = Poseidon(2);
    hasher.inputs[0] <== secret;
    hasher.inputs[1] <== nonce;

    // The hash must equal the public commitment
    hasher.out === commitment;
}

// Merkle tree with Poseidon hashing
template PoseidonMerkleTree(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input root;

    component hashers[levels];
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);

        // Order inputs based on path index (left/right)
        if (pathIndices[i] == 0) {
            hashers[i].inputs[0] <== levelHashes[i];
            hashers[i].inputs[1] <== pathElements[i];
        } else {
            hashers[i].inputs[0] <== pathElements[i];
            hashers[i].inputs[1] <== levelHashes[i];
        }

        levelHashes[i + 1] <== hashers[i].out;
    }

    root === levelHashes[levels];
}

component main {public [commitment]} = CommitmentVerifier();
```

```typescript
// TypeScript: compute Poseidon hashes to match circuit
import { buildPoseidon } from "circomlibjs";
import { ethers } from "ethers";

async function poseidonExample() {
  const poseidon = await buildPoseidon();

  // Hash two values — matches Poseidon(2) in Circom
  const secret = 12345n;
  const nonce = 67890n;

  // poseidon() returns a field element (Uint8Array)
  const hashResult = poseidon([secret, nonce]);
  const commitment = poseidon.F.toString(hashResult);

  console.log("Poseidon hash:", commitment);
  // This matches what the circuit computes for the same inputs

  // Compare with Keccak256 (different result, different use case)
  const keccakHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [secret, nonce]
    )
  );
  console.log("Keccak256 hash:", keccakHash);
  // Different value — can't use keccak256 in a circuit expecting Poseidon
}

// Merkle tree using Poseidon
async function buildPoseidonMerkleTree(leaves: bigint[]): Promise<{
  root: string;
  tree: string[][];
}> {
  const poseidon = await buildPoseidon();

  // Pad to power of 2
  const size = Math.pow(2, Math.ceil(Math.log2(leaves.length)));
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < size) {
    paddedLeaves.push(0n); // zero padding
  }

  const tree: string[][] = [];
  let currentLevel = paddedLeaves.map((leaf) =>
    poseidon.F.toString(poseidon([leaf]))
  );
  tree.push(currentLevel);

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = BigInt(currentLevel[i]);
      const right = BigInt(currentLevel[i + 1]);
      const parent = poseidon.F.toString(poseidon([left, right]));
      nextLevel.push(parent);
    }
    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0],
    tree,
  };
}

// Generate Merkle proof for a leaf
async function getMerkleProof(
  tree: string[][],
  leafIndex: number
): Promise<{ pathElements: string[]; pathIndices: number[] }> {
  const pathElements: string[] = [];
  const pathIndices: number[] = [];

  let index = leafIndex;
  for (let level = 0; level < tree.length - 1; level++) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    pathElements.push(tree[level][siblingIndex] ?? "0");
    pathIndices.push(isRight ? 1 : 0);

    index = Math.floor(index / 2);
  }

  return { pathElements, pathIndices };
}
```

---

## Common Mistakes and Gotchas

**1. Using Keccak256 in a Circom circuit**  
It works (circomlib has a Keccak256 template) but costs ~100,000 constraints. For a circuit with a 2^20 constraint budget, one Keccak256 hash uses 10% of your budget. Use Poseidon unless you specifically need Keccak256 compatibility.

**2. Mismatching hash functions between circuit and off-chain code**  
If your circuit uses Poseidon but your TypeScript computes Keccak256 for the commitment, the proof will always fail. The hash function must match exactly — same algorithm, same parameters, same input encoding.

**3. Wrong Poseidon parameter selection**  
`Poseidon(2)` hashes 2 inputs. `Poseidon(3)` hashes 3 inputs. Using the wrong template gives a different hash. Make sure your circuit and off-chain code use the same number of inputs.

**4. Field element encoding**  
Poseidon operates on field elements (integers mod the BN128 prime). When hashing strings or bytes, you must encode them as field elements first. The encoding must be consistent between circuit and off-chain code.

**5. Not using Poseidon for on-chain Merkle trees**  
If your Merkle tree is verified in a ZK circuit, use Poseidon for the tree hashing. If you use Keccak256 for the tree but Poseidon in the circuit, you'll need to recompute the tree with Poseidon — or use Keccak256 in the circuit (expensive).

---

## How This Connects to Production

Tornado Cash uses Poseidon for its Merkle tree (the deposit tree). Semaphore uses Poseidon for identity commitments. Aztec Protocol uses Pedersen hash (another ZK-friendly hash) for its note commitments. The choice of hash function is a fundamental architectural decision — it affects circuit size, proof generation time, and compatibility with other systems. The trend is toward Poseidon for ZK-native applications and Keccak256 for Ethereum-compatible applications.

---

## What to Learn Next

- **Incremental Merkle Trees: The Data Structure Powering Privacy Protocols** — build a Poseidon-based Merkle tree.
- **Building a Privacy Mixer: Deposit, Withdraw, and Note Management** — use Poseidon in a complete privacy protocol.
- **Getting Started with Circom: Writing Your First ZK Circuit** — apply Poseidon in your circuits.
