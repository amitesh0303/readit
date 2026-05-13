# SnarkJS and Trusted Setup Ceremonies: How They Work and Why They Matter

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You've written a Circom circuit. Now you need to set it up for production. You've heard "trusted setup ceremony" and "powers of tau" but you're not sure what they actually do, why they matter for security, or how to use an existing ceremony instead of running your own.

Getting the trusted setup wrong doesn't just mean a bug — it means your entire ZK system can be compromised silently. This blog explains the setup process completely.

---

## Core Concepts

### Why Trusted Setup Exists

Groth16 and PLONK proofs require a Common Reference String (CRS) — a set of cryptographic parameters that both the prover and verifier use. These parameters are generated from random secrets.

The problem: whoever generates the secrets can use them to create fake proofs. This is the "toxic waste" problem.

```
Setup generates: (secret s, public CRS derived from s)
If attacker knows s: can prove false statements
If s is destroyed: CRS is safe to use

Security guarantee: as long as at least ONE participant destroyed their secret,
the CRS is secure — even if all other participants were malicious.
```

### Two-Phase Setup

The setup has two phases:

**Phase 1: Powers of Tau (circuit-independent)**
Generates parameters that work for any circuit up to a certain size. This is the expensive, one-time ceremony. The Hermez Ignition ceremony (used by many protocols) had 176 participants.

**Phase 2: Circuit-specific setup**
Takes the Phase 1 output and specializes it for your specific circuit. Faster, can be done by the protocol team.

```
Phase 1 (Powers of Tau):
- Many participants contribute randomness
- Output: ptau file (works for any circuit ≤ 2^n constraints)
- Done once, reused by many protocols

Phase 2 (Circuit-specific):
- Protocol team contributes randomness
- Input: ptau file + your circuit's R1CS
- Output: zkey file (proving key for your specific circuit)
- Done once per circuit
```

### The Contribution Process

Each participant in a ceremony:
1. Downloads the current accumulator (ptau or zkey file)
2. Generates a random secret
3. Applies their secret to the accumulator (cryptographic mixing)
4. Publishes the new accumulator + a hash proving they contributed
5. Destroys their secret (ideally with hardware destruction)

The final accumulator is secure as long as at least one participant destroyed their secret.

### Existing Ceremonies You Can Use

Instead of running your own ceremony, use an existing one:

- **Hermez Ignition** (Phase 1): 176 participants, widely used, supports up to 2^28 constraints
- **Zcash Powers of Tau**: the original, supports up to 2^28 constraints
- **Aztec Ignition**: used by Aztec Protocol

For Phase 2, you still need to run your own (circuit-specific), but it's much simpler — even a single-participant ceremony is acceptable if you're the protocol team and users trust you.

---

## Code Walkthrough

Complete setup workflow using snarkjs:

```typescript
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as crypto from "crypto";

// ── Phase 1: Powers of Tau ─────────────────────────────────────────────────
// In production: download from Hermez or Zcash instead of generating locally

async function phase1Setup(maxConstraintsPower: number = 12) {
  console.log(`Setting up Powers of Tau for 2^${maxConstraintsPower} constraints`);

  // Start new accumulator
  await snarkjs.powersOfTau.newAccumulator(
    "bn128",              // curve (bn128 for Groth16/PLONK)
    maxConstraintsPower,  // 2^12 = 4096 max constraints
    "ptau/pot_0000.ptau"
  );

  // Simulate multiple participants contributing
  // In production: each participant does this independently
  for (let i = 1; i <= 3; i++) {
    const entropy = crypto.randomBytes(32).toString("hex");
    await snarkjs.powersOfTau.contribute(
      `ptau/pot_${String(i-1).padStart(4, "0")}.ptau`,
      `ptau/pot_${String(i).padStart(4, "0")}.ptau`,
      `Participant ${i}`,
      entropy
    );
    console.log(`Participant ${i} contributed`);
    // In production: participant destroys entropy here
  }

  // Prepare for Phase 2 (adds beacon randomness for final security)
  // The beacon is a public random value (e.g., a future Bitcoin block hash)
  const beaconHash = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  await snarkjs.powersOfTau.beacon(
    "ptau/pot_0003.ptau",
    "ptau/pot_final.ptau",
    "Final Beacon",
    beaconHash,
    10 // number of iterations
  );

  await snarkjs.powersOfTau.preparePhase2(
    "ptau/pot_final.ptau",
    "ptau/pot_prepared.ptau"
  );

  console.log("Phase 1 complete: ptau/pot_prepared.ptau");
}

// ── Phase 2: Circuit-Specific Setup ───────────────────────────────────────

async function phase2Setup(circuitName: string) {
  const r1csFile = `build/${circuitName}.r1cs`;
  const ptauFile = "ptau/pot_prepared.ptau";

  // Verify the R1CS file
  const r1csInfo = await snarkjs.r1cs.info(r1csFile);
  console.log(`Circuit: ${r1csInfo.nConstraints} constraints, ${r1csInfo.nVars} variables`);

  // Initial zkey (before contributions)
  await snarkjs.groth16.setup(r1csFile, ptauFile, `zkeys/${circuitName}_0000.zkey`);

  // Protocol team contributes (Phase 2 ceremony)
  // Even a single contribution is fine if users trust the protocol team
  const entropy1 = crypto.randomBytes(32).toString("hex");
  await snarkjs.zKey.contribute(
    `zkeys/${circuitName}_0000.zkey`,
    `zkeys/${circuitName}_0001.zkey`,
    "Protocol Team",
    entropy1
  );

  // Optional: add a beacon for additional security
  const beaconHash = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  await snarkjs.zKey.beacon(
    `zkeys/${circuitName}_0001.zkey`,
    `zkeys/${circuitName}_final.zkey`,
    "Phase 2 Beacon",
    beaconHash,
    10
  );

  // Verify the final zkey
  const isValid = await snarkjs.zKey.verify(
    r1csFile,
    ptauFile,
    `zkeys/${circuitName}_final.zkey`
  );
  console.log("zkey valid:", isValid);

  // Export verification key (public, used by verifier contract)
  const vKey = await snarkjs.zKey.exportVerificationKey(`zkeys/${circuitName}_final.zkey`);
  fs.writeFileSync(`zkeys/${circuitName}_vkey.json`, JSON.stringify(vKey, null, 2));

  // Generate Solidity verifier contract
  const solidityVerifier = await snarkjs.zKey.exportSolidityVerifier(
    `zkeys/${circuitName}_final.zkey`,
    {
      groth16: fs.readFileSync(
        "node_modules/snarkjs/templates/verifier_groth16.sol.ejs",
        "utf8"
      ),
    }
  );
  fs.writeFileSync(`contracts/${circuitName}Verifier.sol`, solidityVerifier);

  console.log(`Phase 2 complete for ${circuitName}`);
  console.log(`Proving key: zkeys/${circuitName}_final.zkey`);
  console.log(`Verification key: zkeys/${circuitName}_vkey.json`);
  console.log(`Verifier contract: contracts/${circuitName}Verifier.sol`);
}

// ── Using Hermez Ignition (Production) ────────────────────────────────────

async function useHermezIgnition(circuitName: string) {
  // Download Hermez Ignition Phase 1 output
  // https://hermez.io/hermez-cryptographic-setup
  // Choose the appropriate size (hermez_final_12.ptau for ≤ 4096 constraints)

  console.log("Downloading Hermez Ignition ptau...");
  // In practice: wget https://hermez.io/hermez_final_12.ptau

  // Verify the download (check against published hash)
  const ptauHash = await snarkjs.powersOfTau.verify("hermez_final_12.ptau");
  console.log("Hermez ptau valid:", ptauHash);

  // Proceed with Phase 2 using the downloaded ptau
  await phase2Setup(circuitName);
}

// ── Verify Contribution Transcript ────────────────────────────────────────

async function verifyContributions(ptauFile: string) {
  // Anyone can verify the ceremony transcript
  const isValid = await snarkjs.powersOfTau.verify(ptauFile);
  console.log("Ceremony valid:", isValid);

  // Print contribution hashes (for public verification)
  // Each participant publishes their contribution hash
  // Anyone can verify the chain of contributions
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Create directories
  fs.mkdirSync("ptau", { recursive: true });
  fs.mkdirSync("zkeys", { recursive: true });
  fs.mkdirSync("contracts", { recursive: true });

  // For production: use Hermez Ignition instead of phase1Setup
  await phase1Setup(12);
  await phase2Setup("age_verification");

  console.log("\nSetup complete. Files generated:");
  console.log("- zkeys/age_verification_final.zkey (proving key — keep private)");
  console.log("- zkeys/age_verification_vkey.json (verification key — publish)");
  console.log("- contracts/age_verificationVerifier.sol (deploy this)");
}

main().catch(console.error);
```

---

## Common Mistakes and Gotchas

**1. Running a single-participant Phase 1 ceremony**  
A single-participant Phase 1 ceremony means you're the only one who could have the toxic waste. Users must trust you completely. For Phase 2 (circuit-specific), single-participant is acceptable. For Phase 1, use an existing multi-participant ceremony.

**2. Not verifying the ptau file**  
Before using a downloaded ptau file, verify it with `snarkjs.powersOfTau.verify()`. A corrupted or malicious ptau file can compromise your entire system.

**3. Storing the proving key insecurely**  
The proving key (zkey file) is large (can be hundreds of MB) and must be kept secure. It doesn't contain the toxic waste (that was destroyed), but it's needed to generate proofs. Store it securely and distribute it to your prover service.

**4. Not publishing the verification key**  
The verification key must be public — it's what the verifier contract uses. Publish it alongside your circuit code so users can verify your setup independently.

**5. Forgetting to update the verifier contract when the circuit changes**  
If you change your circuit (even a small change), you need a new Phase 2 setup and a new verifier contract. The old verifier won't work with proofs from the new circuit. Plan your upgrade process carefully.

---

## How This Connects to Production

Tornado Cash ran a trusted setup ceremony with 1,114 participants — one of the largest in history. The Hermez Ignition ceremony had 176 participants and its output is used by many protocols. Aztec's Ignition ceremony is used by Aztec Protocol. The Zcash Sapling ceremony (6 participants) was the first major ceremony and established the process. For new protocols, the standard practice is to use Hermez Ignition for Phase 1 and run a small Phase 2 ceremony with the protocol team plus a few trusted external participants.

---

## What to Learn Next

- **On-Chain Proof Verification in Solidity: Gas Costs and Optimization** — deploy the verifier contract generated by this process.
- **Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions** — understand the hash functions used in your circuits.
- **Incremental Merkle Trees: The Data Structure Powering Privacy Protocols** — build on top of your ZK foundation.
