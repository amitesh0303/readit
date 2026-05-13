# Solana Transaction Anatomy: Instructions, Signers, and Compute Units

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

Your Solana transaction fails with "Transaction too large" or "Exceeded compute budget." You're not sure why, and you don't know how to fix it. Or you're trying to batch multiple operations into one transaction to save fees, but you're not sure what the limits are.

Understanding Solana transaction anatomy is essential for building efficient programs and debugging failures. This blog dissects every component of a Solana transaction and explains the limits you'll hit in production.

---

## Core Concepts

### Transaction Structure

A Solana transaction is a signed message containing one or more instructions:

```
Transaction
├── Signatures (one per required signer)
├── Message
│   ├── Header
│   │   ├── num_required_signatures
│   │   ├── num_readonly_signed_accounts
│   │   └── num_readonly_unsigned_accounts
│   ├── Account Keys (all accounts referenced by any instruction)
│   ├── Recent Blockhash (prevents replay, expires after ~90 seconds)
│   └── Instructions[]
│       ├── program_id_index (index into account keys)
│       ├── accounts[] (indices into account keys)
│       └── data (encoded instruction arguments)
```

Key insight: all account keys are deduplicated and listed once at the transaction level. Instructions reference accounts by index. This is why you can batch multiple instructions that share accounts efficiently.

### Transaction Size Limit: 1232 Bytes

Solana transactions have a hard limit of 1232 bytes. This includes:
- All signatures (64 bytes each)
- All account keys (32 bytes each)
- All instruction data

For a transaction with 10 accounts and 2 signers:
```
2 signatures: 2 × 64 = 128 bytes
10 account keys: 10 × 32 = 320 bytes
Header + blockhash: ~40 bytes
Instruction data: variable
Total overhead: ~488 bytes
Remaining for instruction data: ~744 bytes
```

This is why complex transactions with many accounts can hit the size limit. The solution: use versioned transactions with Address Lookup Tables (ALTs) to compress account references.

### Instructions vs Transactions

One transaction can contain multiple instructions. This is how you batch operations:

```typescript
// Single transaction with 3 instructions
const tx = new Transaction()
  .add(createAccountInstruction)    // instruction 1
  .add(initializeMintInstruction)   // instruction 2
  .add(mintToInstruction);          // instruction 3

// All 3 execute atomically — if any fails, all revert
```

This is more efficient than 3 separate transactions: one signature, one fee, one block confirmation.

### Compute Units: The Gas of Solana

Every instruction consumes compute units (CUs). The default limit is 200,000 CU per transaction. The maximum is 1,400,000 CU.

Common CU costs:
- Simple arithmetic: ~1 CU
- Account data read: ~100 CU
- SHA256 hash: ~100 CU per 128 bytes
- Secp256k1 signature verify: ~3,000 CU
- Cross-program invocation: ~1,000 CU overhead + callee's CUs
- System program create account: ~3,000 CU

You can request more CUs with `ComputeBudgetProgram.setComputeUnitLimit`. You can also set a priority fee with `ComputeBudgetProgram.setComputeUnitPrice` to get your transaction included faster during congestion.

### Signers and Account Permissions

Accounts in a transaction have three permission levels:
- **Writable + Signer**: can modify data, must sign (e.g., fee payer, account creator)
- **Writable**: can modify data, no signature needed (e.g., accounts being modified by the program)
- **Readonly**: can only read data (e.g., program accounts, oracles)

The transaction header encodes how many accounts fall into each category. Programs validate that accounts have the correct permissions.

### Recent Blockhash and Transaction Expiry

Every transaction includes a `recentBlockhash` — the hash of a recent block. This serves two purposes:
1. Prevents replay attacks (same transaction can't be submitted twice)
2. Gives transactions an expiry (~90 seconds / ~150 blocks)

If your transaction isn't included within ~90 seconds, it expires and must be resubmitted with a new blockhash. This is why long-running operations need to be broken into multiple transactions.

---

## Code Walkthrough

Building and optimizing transactions in TypeScript:

```typescript
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// ── Basic Transaction with Compute Budget ──────────────────────────────────

async function sendWithComputeBudget(
  instructions: TransactionInstruction[],
  signer: anchor.web3.Keypair,
  computeUnits: number = 200_000,
  priorityFeePerCU: number = 1000 // microlamports per CU
) {
  // Add compute budget instructions at the BEGINNING of the transaction
  const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnits,
  });

  // Priority fee: total fee = computeUnits * priorityFeePerCU / 1,000,000 lamports
  // At 1000 microlamports/CU and 200k CUs: 0.0002 SOL priority fee
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFeePerCU,
  });

  const tx = new Transaction()
    .add(computeLimitIx)
    .add(priorityFeeIx)
    .add(...instructions);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;

  tx.sign(signer);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Wait for confirmation with timeout
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return signature;
}

// ── Simulate Transaction to Check CU Usage ────────────────────────────────

async function simulateAndGetCUs(
  instructions: TransactionInstruction[],
  payer: PublicKey
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);

  const simulation = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  if (simulation.value.err) {
    console.error("Simulation failed:", simulation.value.err);
    console.error("Logs:", simulation.value.logs);
    throw new Error("Simulation failed");
  }

  const unitsConsumed = simulation.value.unitsConsumed ?? 0;
  console.log(`Simulation: ${unitsConsumed} CUs consumed`);
  console.log("Logs:", simulation.value.logs);

  return unitsConsumed;
}

// ── Versioned Transactions with Address Lookup Tables ─────────────────────
// Use when you have many accounts and hit the 1232-byte limit

async function createAddressLookupTable(
  payer: anchor.web3.Keypair,
  addresses: PublicKey[]
): Promise<PublicKey> {
  const slot = await connection.getSlot();

  // Create the lookup table
  const [createIx, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: slot,
    });

  // Extend it with addresses (max 256 addresses per table)
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses,
  });

  await sendWithComputeBudget([createIx, extendIx], payer);
  console.log("Lookup table created:", lookupTableAddress.toBase58());
  return lookupTableAddress;
}

async function sendVersionedTransaction(
  instructions: TransactionInstruction[],
  signer: anchor.web3.Keypair,
  lookupTableAddress?: PublicKey
) {
  const { blockhash } = await connection.getLatestBlockhash();

  // Load lookup table if provided
  const lookupTableAccounts = [];
  if (lookupTableAddress) {
    const lookupTableAccount = await connection
      .getAddressLookupTable(lookupTableAddress)
      .then((res) => res.value!);
    lookupTableAccounts.push(lookupTableAccount);
  }

  // Versioned transaction with lookup table support
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTableAccounts);

  const tx = new VersionedTransaction(message);
  tx.sign([signer]);

  return connection.sendRawTransaction(tx.serialize());
}

// ── Batch Multiple Operations ──────────────────────────────────────────────

async function batchTransfers(
  program: anchor.Program<any>,
  recipients: PublicKey[],
  amounts: bigint[]
) {
  // Build all instructions
  const instructions: TransactionInstruction[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const ix = await program.methods
      .transfer(new anchor.BN(amounts[i].toString()))
      .accounts({ recipient: recipients[i] })
      .instruction(); // .instruction() returns the instruction without sending
    instructions.push(ix);
  }

  // Check if we need to split into multiple transactions
  // Rough estimate: each instruction ~200 bytes + 32 bytes per unique account
  const estimatedSize = instructions.length * 200;
  if (estimatedSize > 900) {
    // Split into chunks
    const CHUNK_SIZE = 4; // instructions per transaction
    const signatures = [];
    for (let i = 0; i < instructions.length; i += CHUNK_SIZE) {
      const chunk = instructions.slice(i, i + CHUNK_SIZE);
      const sig = await sendWithComputeBudget(chunk, program.provider.wallet as any);
      signatures.push(sig);
    }
    return signatures;
  }

  return [await sendWithComputeBudget(instructions, program.provider.wallet as any)];
}
```

---

## Common Mistakes and Gotchas

**1. Not requesting enough compute units for complex instructions**  
The default 200,000 CU limit is fine for simple operations but insufficient for complex programs with multiple CPIs. Always simulate first to check actual CU usage, then set the limit to ~110% of simulated usage.

**2. Forgetting that blockhash expires**  
If you build a transaction and wait too long before sending it (>90 seconds), the blockhash expires and the transaction fails. For user-facing flows, build and send immediately. For automated systems, always fetch a fresh blockhash right before sending.

**3. Not handling transaction confirmation properly**  
`sendRawTransaction` returns a signature but doesn't wait for confirmation. Always use `confirmTransaction` with the blockhash and `lastValidBlockHeight` to properly detect expiry vs failure.

**4. Putting compute budget instructions in the wrong position**  
`ComputeBudgetProgram` instructions must be the first instructions in the transaction. If you add them after other instructions, they may not take effect.

**5. Ignoring preflight simulation failures**  
`skipPreflight: false` (the default) runs a simulation before sending. If the simulation fails, the transaction is rejected before hitting the network. Don't set `skipPreflight: true` to bypass errors — fix the underlying issue instead.

---

## How This Connects to Production

Jupiter's swap transactions often include 5-10 instructions (compute budget + multiple DEX swaps) in a single transaction, using versioned transactions with address lookup tables to stay under the 1232-byte limit. Drift Protocol's liquidation transactions are carefully optimized to fit within compute limits while executing complex margin calculations. Helius provides enhanced transaction APIs that automatically handle compute budget estimation and priority fees. Understanding transaction anatomy is what separates protocols that work reliably under load from those that fail during peak usage.

---

## What to Learn Next

- **Phantom Wallet Integration: Connecting Solana dApps to Users** — build the frontend that constructs and sends these transactions.
- **Solana Token Program and SPL Tokens** — the most common instruction type in Solana transactions.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build systems that construct and send transactions programmatically.
