# Incremental Merkle Trees: The Data Structure Powering Privacy Protocols

**Track:** Intermediate → Expert  
**Read time:** 12 min

---

## The Problem

You're building a privacy protocol. Users deposit tokens and later withdraw them using ZK proofs. The proof must show that the deposit exists in the set of all deposits — without revealing which deposit it is.

A Merkle tree is the standard data structure for this. But a naive Merkle tree requires recomputing the entire tree on every insertion — O(n) operations. With 100,000 deposits, that's 100,000 hash operations per deposit. You need an incremental Merkle tree that updates in O(log n) time.

This blog explains incremental Merkle trees from scratch and implements one in both Solidity and TypeScript.

---

## Core Concepts

### What a Merkle Tree Is

A Merkle tree is a binary tree where:
- Leaves contain data (or hashes of data)
- Each internal node is the hash of its two children
- The root is a single hash that commits to all leaves

```
         Root
        /    \
      H01    H23
     /   \  /   \
    H0   H1 H2  H3
    |    |  |   |
   L0   L1 L2  L3
```

To prove L2 is in the tree, you provide: L2, H3, H01. The verifier computes:
- H23 = hash(H2, H3) where H2 = hash(L2)
- Root = hash(H01, H23)
- If computed root == stored root: proof is valid

This is a Merkle proof — O(log n) elements, O(log n) verification.

### The Incremental Merkle Tree

A standard Merkle tree requires storing all leaves and recomputing the tree on every insertion. An incremental Merkle tree maintains only the "frontier" — the minimum information needed to compute the root after any insertion.

Key insight: when you insert a leaf at position `n`, only the path from that leaf to the root changes. All other paths remain the same.

```
Tree with 4 leaves (positions 0-3):
         Root
        /    \
      H01    H23
     /   \  /   \
    H0   H1 H2  H3

Insert leaf at position 4:
         Root'
        /    \
      H01    H45
     /   \  /   \
    H0   H1 H4  Z  (Z = zero hash for empty leaf)

Only H45 and Root' changed. H01 is unchanged.
```

The frontier stores the left sibling at each level — the hash that won't change when you insert the next leaf.

### The Frontier Algorithm

```
frontier[i] = the hash of the left subtree at level i
              (only valid when the next insertion is at an odd position at level i)

On insertion at position n:
1. Start with the new leaf hash
2. For each level i from 0 to depth:
   - If bit i of n is 0: store current hash in frontier[i], use zero hash as right sibling
   - If bit i of n is 1: use frontier[i] as left sibling, hash together
3. The final hash is the new root
```

This runs in O(depth) = O(log n) time and uses O(depth) storage.

---

## Code Walkthrough

Incremental Merkle tree in Solidity:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IncrementalMerkleTree
 * @notice O(log n) insertion Merkle tree using Poseidon hash.
 * Used in privacy protocols for deposit tracking.
 */
contract IncrementalMerkleTree {
    uint256 public constant DEPTH = 20; // 2^20 = 1,048,576 leaves
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Zero hashes: zeros[i] = hash of a subtree of depth i with all zero leaves
    // Precomputed to save gas
    uint256[DEPTH] public zeros;

    // Frontier: left sibling hashes at each level
    uint256[DEPTH] public filledSubtrees;

    // Current root
    bytes32 public root;

    // Root history (for proof validity window)
    uint256 public constant ROOT_HISTORY_SIZE = 100;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex;

    // Next leaf index
    uint32 public nextIndex;

    event LeafInserted(uint32 indexed index, bytes32 leaf, bytes32 newRoot);

    constructor() {
        // Precompute zero hashes using Poseidon
        // zeros[0] = Poseidon(0) = hash of empty leaf
        // zeros[i] = Poseidon(zeros[i-1], zeros[i-1]) = hash of empty subtree at level i
        zeros[0] = uint256(keccak256(abi.encodePacked("tornado"))) % FIELD_SIZE;
        for (uint256 i = 1; i < DEPTH; i++) {
            zeros[i] = _hashLeftRight(zeros[i-1], zeros[i-1]);
        }

        // Initialize frontier with zero hashes
        for (uint256 i = 0; i < DEPTH; i++) {
            filledSubtrees[i] = zeros[i];
        }

        // Initial root = hash of all-zero tree
        roots[0] = bytes32(_hashLeftRight(zeros[DEPTH-1], zeros[DEPTH-1]));
        root = roots[0];
    }

    /**
     * @notice Insert a leaf into the tree.
     * @param leaf The leaf value to insert
     * @return index The position of the inserted leaf
     */
    function insert(bytes32 leaf) internal returns (uint32 index) {
        index = nextIndex;
        require(index < 2**DEPTH, "Tree is full");

        uint32 currentIndex = index;
        uint256 currentLevelHash = uint256(leaf);
        uint256 left;
        uint256 right;

        for (uint256 i = 0; i < DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                // Current node is a left child
                // Store it in frontier, use zero hash as right sibling
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                // Current node is a right child
                // Use stored frontier as left sibling
                left = filledSubtrees[i];
                right = currentLevelHash;
            }

            currentLevelHash = _hashLeftRight(left, right);
            currentIndex /= 2;
        }

        // Update root
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = bytes32(currentLevelHash);
        root = bytes32(currentLevelHash);
        nextIndex++;

        emit LeafInserted(index, leaf, root);
    }

    /**
     * @notice Check if a root is in the recent history.
     * @dev Allows proofs generated against recent (but not current) roots.
     *      This handles the case where a new deposit happens between
     *      proof generation and proof submission.
     */
    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == bytes32(0)) return false;

        uint32 i = currentRootIndex;
        do {
            if (_root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE - 1;
            else i--;
        } while (i != currentRootIndex);

        return false;
    }

    /**
     * @dev Hash two field elements using Poseidon.
     * In production: use a proper Poseidon implementation.
     * Here: simplified with keccak256 for illustration.
     */
    function _hashLeftRight(uint256 left, uint256 right) internal pure returns (uint256) {
        // Production: use Poseidon(2) precompile or inline implementation
        return uint256(keccak256(abi.encodePacked(left, right))) % FIELD_SIZE;
    }
}
```

TypeScript: incremental Merkle tree with Poseidon:

```typescript
import { buildPoseidon } from "circomlibjs";

type PoseidonFn = ReturnType<typeof buildPoseidon> extends Promise<infer T> ? T : never;

class IncrementalMerkleTree {
  private depth: number;
  private zeros: bigint[];
  private filledSubtrees: bigint[];
  private leaves: bigint[];
  private poseidon: PoseidonFn;

  constructor(poseidon: PoseidonFn, depth: number = 20) {
    this.poseidon = poseidon;
    this.depth = depth;
    this.leaves = [];

    // Compute zero hashes
    this.zeros = new Array(depth);
    this.zeros[0] = BigInt(
      poseidon.F.toString(poseidon([BigInt("0")]))
    );
    for (let i = 1; i < depth; i++) {
      this.zeros[i] = BigInt(
        poseidon.F.toString(poseidon([this.zeros[i-1], this.zeros[i-1]]))
      );
    }

    // Initialize frontier
    this.filledSubtrees = [...this.zeros];
  }

  static async create(depth: number = 20): Promise<IncrementalMerkleTree> {
    const poseidon = await buildPoseidon();
    return new IncrementalMerkleTree(poseidon, depth);
  }

  private hash(left: bigint, right: bigint): bigint {
    return BigInt(this.poseidon.F.toString(this.poseidon([left, right])));
  }

  /**
   * Insert a leaf and return its index and the new root.
   */
  insert(leaf: bigint): { index: number; root: bigint } {
    const index = this.leaves.length;
    this.leaves.push(leaf);

    let currentIndex = index;
    let currentHash = leaf;

    for (let i = 0; i < this.depth; i++) {
      let left: bigint;
      let right: bigint;

      if (currentIndex % 2 === 0) {
        left = currentHash;
        right = this.zeros[i];
        this.filledSubtrees[i] = currentHash;
      } else {
        left = this.filledSubtrees[i];
        right = currentHash;
      }

      currentHash = this.hash(left, right);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { index, root: currentHash };
  }

  /**
   * Generate a Merkle proof for a leaf at the given index.
   */
  generateProof(leafIndex: number): {
    leaf: bigint;
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
  } {
    if (leafIndex >= this.leaves.length) {
      throw new Error("Leaf index out of bounds");
    }

    // Rebuild the tree to get sibling hashes
    const tree = this.buildFullTree();

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;

      pathElements.push(tree[level][siblingIndex] ?? this.zeros[level]);
      pathIndices.push(isRight ? 1 : 0);

      index = Math.floor(index / 2);
    }

    const root = tree[this.depth][0];

    return {
      leaf: this.leaves[leafIndex],
      pathElements,
      pathIndices,
      root,
    };
  }

  private buildFullTree(): bigint[][] {
    const size = Math.pow(2, this.depth);
    const tree: bigint[][] = [];

    // Level 0: leaves (padded with zeros)
    const level0: bigint[] = [];
    for (let i = 0; i < size; i++) {
      level0.push(i < this.leaves.length ? this.leaves[i] : 0n);
    }
    tree.push(level0.map((leaf) => this.hash(leaf, 0n))); // hash each leaf

    // Build up the tree
    for (let level = 1; level <= this.depth; level++) {
      const prevLevel = tree[level - 1];
      const currentLevel: bigint[] = [];
      for (let i = 0; i < prevLevel.length; i += 2) {
        currentLevel.push(this.hash(prevLevel[i], prevLevel[i + 1] ?? this.zeros[level - 1]));
      }
      tree.push(currentLevel);
    }

    return tree;
  }

  /**
   * Verify a Merkle proof.
   */
  verifyProof(
    leaf: bigint,
    pathElements: bigint[],
    pathIndices: number[],
    root: bigint
  ): boolean {
    let currentHash = this.hash(leaf, 0n); // hash the leaf

    for (let i = 0; i < pathElements.length; i++) {
      const sibling = pathElements[i];
      if (pathIndices[i] === 0) {
        currentHash = this.hash(currentHash, sibling);
      } else {
        currentHash = this.hash(sibling, currentHash);
      }
    }

    return currentHash === root;
  }
}

// Usage
async function demo() {
  const tree = await IncrementalMerkleTree.create(20);

  // Insert some leaves
  const { index: idx0, root: root0 } = tree.insert(12345n);
  const { index: idx1, root: root1 } = tree.insert(67890n);
  const { index: idx2, root: root2 } = tree.insert(11111n);

  console.log("Inserted 3 leaves. Current root:", root2.toString());

  // Generate proof for leaf 1
  const proof = tree.generateProof(1);
  console.log("Proof for leaf 1:", {
    leaf: proof.leaf.toString(),
    pathElements: proof.pathElements.map((e) => e.toString()),
    pathIndices: proof.pathIndices,
  });

  // Verify the proof
  const isValid = tree.verifyProof(
    proof.leaf,
    proof.pathElements,
    proof.pathIndices,
    proof.root
  );
  console.log("Proof valid:", isValid); // true
}
```

---

## Common Mistakes and Gotchas

**1. Not using root history**  
Between when a user generates their proof and when they submit it, new deposits may have been added (changing the root). Without root history, the proof would be invalid. Store the last N roots and accept proofs against any of them.

**2. Wrong zero hash initialization**  
The zero hash at level 0 must match what your circuit uses. If your circuit uses `Poseidon(0)` as the empty leaf hash but your contract uses `keccak256(0)`, proofs will fail. Use the same hash function everywhere.

**3. Off-by-one in path indices**  
Path indices indicate whether the current node is a left (0) or right (1) child. Getting this wrong produces an incorrect root. Test with known inputs and verify the root matches your off-chain computation.

**4. Not handling the full tree case**  
When `nextIndex == 2^depth`, the tree is full. Inserting more leaves should revert. Always check this condition.

**5. Recomputing the full tree for proofs**  
The `buildFullTree()` method in the TypeScript example is O(n) — fine for small trees, but slow for large ones. For production, maintain the full tree in a database and update incrementally.

---

## How This Connects to Production

Tornado Cash uses a 20-level incremental Merkle tree (1M leaves) for its deposit set. Semaphore uses a similar structure for its identity set. Aztec Protocol uses Merkle trees for its note commitment tree. The incremental Merkle tree is the canonical data structure for "prove membership without revealing which member" — the core primitive of privacy protocols. Understanding it deeply is the prerequisite for building any privacy-preserving application.

---

## What to Learn Next

- **Building a Privacy Mixer: Deposit, Withdraw, and Note Management** — use the incremental Merkle tree in a complete privacy protocol.
- **Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions** — understand the hash function used in the tree.
- **On-Chain Proof Verification in Solidity: Gas Costs and Optimization** — optimize the on-chain verification of Merkle proofs.
