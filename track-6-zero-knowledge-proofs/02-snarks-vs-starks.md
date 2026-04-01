# SNARKs vs STARKs: Key Differences for Developers

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You're evaluating ZK technology for your protocol. You've heard "SNARK" and "STARK" thrown around interchangeably, but they're fundamentally different systems with different tradeoffs. Choosing the wrong one can mean slower proof generation, higher on-chain verification costs, or a trusted setup requirement that undermines your security model.

This blog gives you a practical comparison — not the math, but the tradeoffs that matter for building real systems.

---

## Core Concepts

### The Acronyms

**SNARK**: Succinct Non-interactive ARgument of Knowledge
- Succinct: small proof size, fast verification
- Non-interactive: single message from prover to verifier
- Argument of Knowledge: prover knows a witness

**STARK**: Scalable Transparent ARgument of Knowledge
- Scalable: proof generation scales quasi-linearly with computation
- Transparent: no trusted setup required
- Argument of Knowledge: same as SNARK

### The Key Differences

| Property | SNARKs (Groth16) | SNARKs (PLONK) | STARKs |
|----------|-----------------|----------------|--------|
| Trusted setup | Yes (circuit-specific) | Yes (universal) | No |
| Proof size | ~200 bytes | ~400 bytes | ~50-200 KB |
| Verification gas | ~200K | ~300K | ~1-5M |
| Prover time | Fast | Medium | Slower |
| Post-quantum secure | No | No | Yes |
| Recursion | Hard | Easier | Native |

### Trusted Setup: The Critical Difference

**SNARKs require a trusted setup ceremony**. During the ceremony, participants generate cryptographic parameters (the "common reference string" or CRS). If any participant keeps their secret ("toxic waste"), they can generate fake proofs.

```
Trusted setup ceremony:
1. Participant 1 generates random secret, contributes to CRS, destroys secret
2. Participant 2 takes CRS, adds their randomness, destroys their secret
3. ... (more participants = more security)
4. Final CRS is published

Security: as long as at least ONE participant destroyed their secret, the setup is secure
```

**Groth16** requires a new ceremony for each circuit (circuit-specific setup). This is expensive and inflexible.

**PLONK** uses a universal setup — one ceremony works for all circuits up to a certain size. This is much more practical. Aztec's Ignition ceremony and Hermez's ceremony are universal setups.

**STARKs have no trusted setup** — they use hash functions (collision-resistant, publicly verifiable). This is a significant security advantage. No ceremony, no toxic waste, no trust assumptions.

### Proof Size and Verification Cost

This is where SNARKs win decisively:

```
Groth16 proof: ~200 bytes, ~200K gas to verify
PLONK proof: ~400 bytes, ~300K gas to verify
STARK proof: ~50-200 KB, ~1-5M gas to verify

For on-chain verification:
- SNARKs: practical for most use cases
- STARKs: expensive, often requires recursive proofs to compress
```

STARKs' large proof size is why StarkNet uses recursive proofs — they prove a STARK proof is valid using another STARK proof, compressing the final on-chain proof.

### Post-Quantum Security

SNARKs rely on elliptic curve cryptography, which is vulnerable to quantum computers (Shor's algorithm). STARKs rely only on hash functions, which are believed to be quantum-resistant.

For most current applications, this doesn't matter — quantum computers capable of breaking elliptic curves don't exist yet. But for long-term security (10+ years), STARKs have an advantage.

### Recursion: Proving Proofs

Recursive proofs — where you prove that a proof is valid — are the key to scalability. Instead of verifying 1,000 proofs on-chain, you prove that all 1,000 proofs are valid off-chain, then verify one recursive proof on-chain.

```
Without recursion:
1,000 transactions → 1,000 proofs → verify 1,000 proofs on-chain (expensive)

With recursion:
1,000 transactions → 1,000 proofs → 1 recursive proof → verify 1 proof on-chain (cheap)
```

STARKs support recursion natively. SNARKs (especially Groth16) are harder to recurse. PLONK and newer SNARK systems (Nova, Halo2) are designed with recursion in mind.

### Which System for Which Use Case

**Use Groth16 when:**
- You need the smallest proof size and lowest verification gas
- Your circuit is fixed (no need to change it)
- You can run a trusted setup ceremony
- Example: Tornado Cash, Zcash Sapling

**Use PLONK when:**
- You need a universal setup (circuits can change)
- You want better developer experience than Groth16
- Example: zkSync Lite, many newer protocols

**Use STARKs when:**
- You can't do a trusted setup (or don't want to)
- You need post-quantum security
- You're building a ZK rollup with recursive proofs
- Example: StarkNet, StarkEx (dYdX V3, Immutable X)

**Use newer systems (Nova, Halo2, Plonky2) when:**
- You need efficient recursion
- You're building a zkEVM
- Example: Polygon zkEVM (Plonky2), Scroll (Halo2)

---

## Code Walkthrough

Comparing proof generation and verification for the same circuit in Groth16 vs PLONK:

```typescript
import * as snarkjs from "snarkjs";
import * as fs from "fs";

// ── Groth16 ────────────────────────────────────────────────────────────────

async function groth16Example() {
  // Groth16 requires circuit-specific setup
  // These files are generated during the trusted setup ceremony
  const wasmFile = "circuit_groth16.wasm";
  const zkeyFile = "circuit_groth16_final.zkey"; // circuit-specific proving key

  const input = {
    a: "3",
    b: "11",
    // c = a * b = 33 (public output)
  };

  console.time("Groth16 proof generation");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmFile,
    zkeyFile
  );
  console.timeEnd("Groth16 proof generation");

  // Proof size: ~200 bytes (3 elliptic curve points)
  const proofJson = JSON.stringify(proof);
  console.log("Groth16 proof size:", Buffer.byteLength(proofJson), "bytes");

  // Verify
  const vKey = JSON.parse(fs.readFileSync("verification_key_groth16.json", "utf8"));
  const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  console.log("Groth16 valid:", isValid);

  // Generate Solidity verifier
  const solidityVerifier = await snarkjs.zKey.exportSolidityVerifier(
    zkeyFile,
    { groth16: fs.readFileSync("node_modules/snarkjs/templates/verifier_groth16.sol.ejs", "utf8") }
  );
  fs.writeFileSync("Groth16Verifier.sol", solidityVerifier);
}

// ── PLONK ──────────────────────────────────────────────────────────────────

async function plonkExample() {
  // PLONK uses a universal setup — same ptau file works for all circuits
  // ptau = powers of tau (the universal setup parameters)
  const wasmFile = "circuit_plonk.wasm";
  const zkeyFile = "circuit_plonk_final.zkey"; // derived from universal ptau

  const input = { a: "3", b: "11" };

  console.time("PLONK proof generation");
  const { proof, publicSignals } = await snarkjs.plonk.fullProve(
    input,
    wasmFile,
    zkeyFile
  );
  console.timeEnd("PLONK proof generation");

  // Proof size: ~400 bytes (larger than Groth16)
  const proofJson = JSON.stringify(proof);
  console.log("PLONK proof size:", Buffer.byteLength(proofJson), "bytes");

  const vKey = JSON.parse(fs.readFileSync("verification_key_plonk.json", "utf8"));
  const isValid = await snarkjs.plonk.verify(vKey, publicSignals, proof);
  console.log("PLONK valid:", isValid);
}

// ── Benchmark Comparison ───────────────────────────────────────────────────

async function benchmark() {
  const iterations = 10;

  // Groth16
  let groth16Total = 0;
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await snarkjs.groth16.fullProve({ a: "3", b: "11" }, "circuit.wasm", "circuit_groth16.zkey");
    groth16Total += Date.now() - start;
  }
  console.log(`Groth16 avg: ${groth16Total / iterations}ms`);

  // PLONK
  let plonkTotal = 0;
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await snarkjs.plonk.fullProve({ a: "3", b: "11" }, "circuit.wasm", "circuit_plonk.zkey");
    plonkTotal += Date.now() - start;
  }
  console.log(`PLONK avg: ${plonkTotal / iterations}ms`);

  // Typical results:
  // Groth16: ~500ms for simple circuit
  // PLONK: ~800ms for same circuit
  // STARKs: ~2-10s for equivalent computation
}
```

---

## Common Mistakes and Gotchas

**1. Choosing Groth16 for a circuit that will change**  
Groth16 requires a new trusted setup for every circuit change. If you're still iterating on your circuit design, use PLONK (universal setup) or STARKs. Switching from Groth16 to PLONK after deployment requires a new ceremony and contract upgrade.

**2. Underestimating STARK verification gas**  
A STARK proof can cost 1-5M gas to verify on Ethereum mainnet. At 30 gwei and $3,000 ETH, that's $90-450 per verification. This is why StarkNet uses recursive proofs — compress many STARKs into one SNARK for final on-chain verification.

**3. Not auditing the trusted setup ceremony**  
If you use Groth16 or PLONK, your security depends on the trusted setup. Use a well-audited ceremony (Hermez's Ignition, Zcash's Powers of Tau) rather than running your own. A poorly run ceremony can compromise your entire system.

**4. Confusing proof systems with ZK languages**  
Circom, Cairo, Noir, Leo — these are languages for writing ZK circuits. Groth16, PLONK, STARKs — these are proof systems. You can write a circuit in Circom and prove it with either Groth16 or PLONK. Cairo is specifically designed for STARKs (StarkNet).

**5. Ignoring prover hardware requirements**  
Generating ZK proofs is computationally intensive. For complex circuits (like zkEVMs), proof generation requires specialized hardware (GPUs, FPGAs). Factor this into your architecture — you may need a prover service rather than client-side proving.

---

## How This Connects to Production

StarkNet uses STARKs (Cairo language) for its ZK rollup. zkSync Era uses PLONK-based proofs. Polygon zkEVM uses Plonky2 (a STARK-SNARK hybrid). Scroll uses Halo2 (a PLONK variant). Aztec uses PLONK for its privacy protocol. The zkEVM space is converging on PLONK-based systems because they offer a good balance of proof size, verification cost, and flexibility. STARKs are dominant in the StarkNet ecosystem because of their transparency and scalability properties.

---

## What to Learn Next

- **Getting Started with Circom: Writing Your First ZK Circuit** — write circuits that work with both Groth16 and PLONK.
- **SnarkJS and Trusted Setup Ceremonies: How They Work and Why They Matter** — understand the setup process in depth.
- **On-Chain Proof Verification in Solidity: Gas Costs and Optimization** — deploy verifier contracts for both systems.
