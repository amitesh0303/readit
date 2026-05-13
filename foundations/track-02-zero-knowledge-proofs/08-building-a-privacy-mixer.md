# Building a Privacy Mixer: Deposit, Withdraw, and Note Management

**Track:** Expert  
**Read time:** 14 min

---

## The Problem

You've learned ZK proofs, Circom, Poseidon, and Merkle trees. Now you want to put it all together into something real. A privacy mixer is the canonical ZK application — it breaks the on-chain link between deposit and withdrawal addresses. Understanding how it works gives you the mental model for any ZK-based privacy system.

This blog builds a simplified Tornado Cash-style mixer from scratch, explaining every design decision.

---

## Core Concepts

### The Privacy Model

```
Without mixer:
Alice deposits 1 ETH → Alice withdraws 1 ETH
On-chain: Alice → Alice (link is visible)

With mixer:
Alice deposits 1 ETH → commitment added to Merkle tree
Bob (Alice's other wallet) withdraws 1 ETH using ZK proof
On-chain: Alice → Mixer → Bob (link is broken)
```

The ZK proof proves: "I know a secret that corresponds to a commitment in the deposit tree" — without revealing which commitment.

### The Note System

When Alice deposits, she creates a "note" — a secret value that represents her deposit:

```
note = (secret, nullifier)
commitment = Poseidon(nullifier, secret)  // stored in Merkle tree
nullifierHash = Poseidon(nullifier)       // used to prevent double-spending
```

To withdraw, Alice proves:
1. She knows a `(secret, nullifier)` pair
2. `Poseidon(nullifier, secret)` is in the Merkle tree (she has a valid deposit)
3. `Poseidon(nullifier)` is the nullifier hash (prevents double-spending)

The nullifier hash is public — it's stored on-chain after withdrawal to prevent reuse. But it doesn't reveal which deposit it corresponds to.

### The Circuit

```
Private inputs:
- secret
- nullifier
- pathElements[20]  (Merkle proof)
- pathIndices[20]

Public inputs:
- root              (current Merkle root)
- nullifierHash     (Poseidon(nullifier))
- recipient         (who receives the ETH)
- relayer           (optional: who submitted the tx)
- fee               (optional: relayer fee)

Constraints:
1. nullifierHash == Poseidon(nullifier)
2. commitment == Poseidon(nullifier, secret)
3. MerkleProof(commitment, pathElements, pathIndices) == root
```

---

## Code Walkthrough

**The circuit:**

```circom
// circuits/mixer.circom
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/mux1.circom";

template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashers[levels];
    component mux[levels];
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== levelHashes[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        levelHashes[i + 1] <== hashers[i].out;
    }

    root === levelHashes[levels];
}

template Mixer(levels) {
    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;   // not used in constraints, but included for binding
    signal input relayer;
    signal input fee;
    signal input refund;

    // Constraint 1: nullifierHash = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // Constraint 2: commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // Constraint 3: commitment is in the Merkle tree
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Dummy constraints to prevent optimization of public inputs
    // (prevents the circuit from ignoring recipient/relayer/fee)
    signal recipientSquare;
    signal feeSquare;
    signal relayerSquare;
    signal refundSquare;
    recipientSquare <== recipient * recipient;
    feeSquare <== fee * fee;
    relayerSquare <== relayer * relayer;
    refundSquare <== refund * refund;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund]} = Mixer(20);
```

**The Solidity contract:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[6] calldata pubSignals
    ) external view returns (bool);
}

/**
 * @title PrivacyMixer
 * @notice Simplified Tornado Cash-style mixer.
 * Breaks the on-chain link between deposit and withdrawal.
 */
contract PrivacyMixer {
    IVerifier public immutable verifier;

    uint256 public constant DENOMINATION = 1 ether;
    uint256 public constant DEPTH = 20;
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Merkle tree state
    uint256[DEPTH] public filledSubtrees;
    uint256[DEPTH] public zeros;
    bytes32[100] public roots; // root history
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    // Nullifier tracking (prevents double-spending)
    mapping(bytes32 => bool) public nullifierHashes;

    // Commitment tracking (prevents duplicate deposits)
    mapping(bytes32 => bool) public commitments;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);

    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
        _initializeTree();
    }

    /**
     * @notice Deposit ETH and add commitment to the Merkle tree.
     * @param commitment Poseidon(nullifier, secret) — computed off-chain
     */
    function deposit(bytes32 commitment) external payable {
        require(msg.value == DENOMINATION, "Wrong denomination");
        require(!commitments[commitment], "Commitment already exists");
        require(nextIndex < 2**DEPTH, "Tree is full");

        commitments[commitment] = true;
        uint32 insertedIndex = _insert(commitment);

        emit Deposit(commitment, insertedIndex, block.timestamp);
    }

    /**
     * @notice Withdraw ETH using a ZK proof.
     * @param pA, pB, pC Groth16 proof components
     * @param root Merkle root the proof was generated against
     * @param nullifierHash Poseidon(nullifier) — prevents double-spending
     * @param recipient Address to receive ETH
     * @param relayer Optional relayer address (for gasless withdrawals)
     * @param fee Fee paid to relayer
     */
    function withdraw(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        bytes32 root,
        bytes32 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 refund
    ) external payable {
        require(fee <= DENOMINATION, "Fee too large");
        require(!nullifierHashes[nullifierHash], "Note already spent");
        require(isKnownRoot(root), "Unknown root");

        // Verify the ZK proof
        // Public signals: [root, nullifierHash, recipient, relayer, fee, refund]
        uint[6] memory pubSignals = [
            uint256(root),
            uint256(nullifierHash),
            uint256(uint160(address(recipient))),
            uint256(uint160(address(relayer))),
            fee,
            refund
        ];

        require(
            verifier.verifyProof(pA, pB, pC, pubSignals),
            "Invalid proof"
        );

        // Mark nullifier as used (prevents double-spending)
        nullifierHashes[nullifierHash] = true;

        // Send ETH
        uint256 amount = DENOMINATION - fee;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        if (fee > 0 && relayer != address(0)) {
            (bool relayerSuccess, ) = relayer.call{value: fee}("");
            require(relayerSuccess, "Relayer transfer failed");
        }

        emit Withdrawal(recipient, nullifierHash, relayer, fee);
    }

    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == bytes32(0)) return false;
        uint32 i = currentRootIndex;
        do {
            if (_root == roots[i]) return true;
            if (i == 0) i = 99;
            else i--;
        } while (i != currentRootIndex);
        return false;
    }

    function _insert(bytes32 leaf) internal returns (uint32 index) {
        index = nextIndex;
        uint32 currentIndex = index;
        uint256 currentLevelHash = uint256(leaf);

        for (uint256 i = 0; i < DEPTH; i++) {
            uint256 left;
            uint256 right;
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = _hashLeftRight(left, right);
            currentIndex /= 2;
        }

        currentRootIndex = (currentRootIndex + 1) % 100;
        roots[currentRootIndex] = bytes32(currentLevelHash);
        nextIndex++;
    }

    function _hashLeftRight(uint256 left, uint256 right) internal pure returns (uint256) {
        // Production: use Poseidon precompile
        return uint256(keccak256(abi.encodePacked(left, right))) % FIELD_SIZE;
    }

    function _initializeTree() internal {
        zeros[0] = uint256(keccak256("tornado")) % FIELD_SIZE;
        for (uint256 i = 1; i < DEPTH; i++) {
            zeros[i] = _hashLeftRight(zeros[i-1], zeros[i-1]);
        }
        for (uint256 i = 0; i < DEPTH; i++) {
            filledSubtrees[i] = zeros[i];
        }
        roots[0] = bytes32(_hashLeftRight(zeros[DEPTH-1], zeros[DEPTH-1]));
    }
}
```

**TypeScript: note management and proof generation:**

```typescript
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import * as crypto from "crypto";
import { ethers } from "ethers";

interface Note {
  nullifier: bigint;
  secret: bigint;
  commitment: bigint;
  nullifierHash: bigint;
}

async function generateNote(): Promise<Note> {
  const poseidon = await buildPoseidon();

  // Generate random nullifier and secret
  const nullifier = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  // Compute commitment and nullifier hash
  const commitment = BigInt(poseidon.F.toString(poseidon([nullifier, secret])));
  const nullifierHash = BigInt(poseidon.F.toString(poseidon([nullifier])));

  return { nullifier, secret, commitment, nullifierHash };
}

async function generateWithdrawalProof(
  note: Note,
  merkleTree: any, // IncrementalMerkleTree instance
  leafIndex: number,
  recipient: string,
  relayer: string = ethers.ZeroAddress,
  fee: bigint = 0n,
  refund: bigint = 0n
): Promise<{ proof: any; publicSignals: string[] }> {
  // Get Merkle proof
  const { pathElements, pathIndices, root } = merkleTree.generateProof(leafIndex);

  const input = {
    // Private inputs
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    pathElements: pathElements.map((e: bigint) => e.toString()),
    pathIndices: pathIndices,

    // Public inputs
    root: root.toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    relayer: BigInt(relayer).toString(),
    fee: fee.toString(),
    refund: refund.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "build/mixer_js/mixer.wasm",
    "build/mixer_final.zkey"
  );

  return { proof, publicSignals };
}

// Full deposit → withdraw flow
async function demo() {
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const alice = new ethers.Wallet("0xAlicePrivateKey", provider);
  const bob = new ethers.Wallet("0xBobPrivateKey", provider);

  const mixer = new ethers.Contract("0xMixerAddress", MIXER_ABI, alice);
  const merkleTree = await IncrementalMerkleTree.create(20);

  // Alice deposits
  const note = await generateNote();
  console.log("Note generated. Save this securely:", {
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
  });

  const depositTx = await mixer.deposit(
    ethers.toBeHex(note.commitment, 32),
    { value: ethers.parseEther("1") }
  );
  const receipt = await depositTx.wait();

  // Get leaf index from event
  const depositEvent = receipt.logs.find((log: any) =>
    log.topics[0] === ethers.id("Deposit(bytes32,uint32,uint256)")
  );
  const leafIndex = parseInt(depositEvent.topics[2], 16);

  // Update local Merkle tree
  merkleTree.insert(note.commitment);

  console.log("Deposited at leaf index:", leafIndex);

  // Bob withdraws (using Alice's note)
  const { proof, publicSignals } = await generateWithdrawalProof(
    note,
    merkleTree,
    leafIndex,
    bob.address
  );

  // Format proof for Solidity
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
  const pC = [proof.pi_c[0], proof.pi_c[1]];

  const withdrawTx = await mixer.connect(bob).withdraw(
    pA, pB, pC,
    ethers.toBeHex(BigInt(publicSignals[0]), 32), // root
    ethers.toBeHex(BigInt(publicSignals[1]), 32), // nullifierHash
    bob.address,
    ethers.ZeroAddress,
    0n,
    0n
  );

  await withdrawTx.wait();
  console.log("Withdrawal successful. Bob received 1 ETH.");
}
```

---

## Common Mistakes and Gotchas

**1. Not including recipient in the circuit**  
If the recipient address isn't bound to the proof, a front-runner can intercept the withdrawal transaction and change the recipient to their own address. The circuit must include recipient as a public input (even if it's not used in constraints — use dummy constraints to prevent optimization).

**2. Storing notes insecurely**  
The note (nullifier + secret) is the only way to withdraw. If it's lost, the ETH is locked forever. If it's stolen, the thief can withdraw. Never store notes in plaintext. Use encrypted local storage or a secure note management system.

**3. Not using a relayer for privacy**  
If Alice withdraws from her own address, the gas payment creates a link between her deposit address and withdrawal address. Use a relayer (a third party who submits the transaction for a fee) to break this link completely.

**4. Reusing nullifiers across denominations**  
If you have multiple denomination pools (0.1 ETH, 1 ETH, 10 ETH), use different nullifier derivation for each. Otherwise, a nullifier used in the 0.1 ETH pool could theoretically be linked to the 1 ETH pool.

**5. Not handling the root history correctly**  
Between deposit and withdrawal, new deposits may have been added. The proof is generated against a specific root. If that root is no longer in the history (too many new deposits), the proof is invalid. Keep a large enough root history (100+ roots) and generate proofs against recent roots.

---

## How This Connects to Production

Tornado Cash is the canonical implementation of this pattern — it processed billions in volume before being sanctioned. The code is open source and has been audited multiple times. Aztec Protocol extends this model to support arbitrary private transactions (not just fixed denominations). Zcash uses a similar note-based model for its shielded transactions. The privacy mixer pattern — commitment → Merkle tree → ZK proof → nullifier — is the foundation of all on-chain privacy systems. Understanding it completely means you can build any privacy-preserving application.

---

## What to Learn Next

- **SNARKs vs STARKs: Key Differences for Developers** — understand the proof systems powering production privacy protocols.
- **On-Chain Proof Verification in Solidity: Gas Costs and Optimization** — optimize your verifier for production.
- **Smart Contract Audit Process: What Auditors Actually Look For** — ZK contracts have unique audit requirements.
