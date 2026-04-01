# Phantom Wallet Integration on Solana: Sign Transactions and Send SOL

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

You've built a Solana program. Now you need a frontend where users can connect Phantom, sign transactions, and interact with your program. The Solana wallet ecosystem is different from Ethereum — different wallet interface, different transaction model, different signing patterns.

This blog covers the complete Phantom integration: connecting, signing messages, sending SOL, and interacting with Anchor programs. It also covers the wallet adapter standard so your dApp works with Backpack, Solflare, and any other Solana wallet.

---

## Core Concepts

### The Phantom Provider Interface

Phantom injects `window.solana` (and `window.phantom.solana`) into the browser:

```typescript
interface PhantomProvider {
  isPhantom: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;

  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;

  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: Transaction, opts?: SendOptions): Promise<{ signature: string }>;
}
```

### The Wallet Adapter Standard

Instead of using `window.solana` directly, use `@solana/wallet-adapter-react` — it provides a unified interface for all Solana wallets:

```typescript
// Works with Phantom, Backpack, Solflare, Ledger, etc.
import { useWallet } from "@solana/wallet-adapter-react";

const { publicKey, signTransaction, sendTransaction } = useWallet();
```

This is covered in depth in the Solana track. This blog focuses on the Phantom-specific patterns and the raw integration for non-React environments.

---

## Code Walkthrough

**Raw Phantom integration (no framework):**

```typescript
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// ── Connect ────────────────────────────────────────────────────────────────

async function connectPhantom(): Promise<PublicKey> {
  const phantom = (window as any).phantom?.solana;

  if (!phantom?.isPhantom) {
    window.open("https://phantom.app/", "_blank");
    throw new Error("Phantom not installed");
  }

  // connect() triggers the Phantom popup
  const { publicKey } = await phantom.connect();
  console.log("Connected:", publicKey.toBase58());

  // Listen for disconnect
  phantom.on("disconnect", () => {
    console.log("Disconnected from Phantom");
  });

  // Listen for account change
  phantom.on("accountChanged", (newPublicKey: PublicKey | null) => {
    if (newPublicKey) {
      console.log("Account changed to:", newPublicKey.toBase58());
    } else {
      console.log("Disconnected");
    }
  });

  return publicKey;
}

// ── Sign Message (for auth) ────────────────────────────────────────────────

async function signMessage(message: string): Promise<string> {
  const phantom = (window as any).phantom?.solana;
  if (!phantom?.isConnected) throw new Error("Not connected");

  const encodedMessage = new TextEncoder().encode(message);

  // signMessage returns the signature as Uint8Array
  const { signature } = await phantom.signMessage(encodedMessage, "utf8");

  // Convert to base58 for storage/verification
  const bs58 = await import("bs58");
  return bs58.default.encode(signature);
}

// Verify signature on backend
async function verifySignature(
  message: string,
  signatureBase58: string,
  publicKeyBase58: string
): Promise<boolean> {
  const bs58 = await import("bs58");
  const nacl = await import("tweetnacl");

  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.default.decode(signatureBase58);
  const publicKeyBytes = new PublicKey(publicKeyBase58).toBytes();

  return nacl.default.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
}

// ── Send SOL ───────────────────────────────────────────────────────────────

async function sendSOL(
  fromPublicKey: PublicKey,
  toAddress: string,
  amountSOL: number
): Promise<string> {
  const phantom = (window as any).phantom?.solana;
  if (!phantom?.isConnected) throw new Error("Not connected");

  const toPubkey = new PublicKey(toAddress);
  const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

  // Build transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: fromPublicKey,
  }).add(
    SystemProgram.transfer({
      fromPubkey: fromPublicKey,
      toPubkey,
      lamports,
    })
  );

  // Sign and send via Phantom
  const { signature } = await phantom.signAndSendTransaction(transaction);

  // Wait for confirmation
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  console.log("SOL sent:", signature);
  return signature;
}

// ── Interact with Anchor Program ───────────────────────────────────────────

async function callAnchorProgram(
  publicKey: PublicKey,
  programId: PublicKey,
  idl: any
): Promise<void> {
  const phantom = (window as any).phantom?.solana;

  // Create Anchor provider using Phantom as the wallet
  const { AnchorProvider, Program, web3 } = await import("@coral-xyz/anchor");

  const provider = new AnchorProvider(
    connection,
    {
      publicKey,
      signTransaction: (tx: Transaction) => phantom.signTransaction(tx),
      signAllTransactions: (txs: Transaction[]) => phantom.signAllTransactions(txs),
    },
    { commitment: "confirmed" }
  );

  const program = new Program(idl, programId, provider);

  // Call a program instruction
  const tx = await program.methods
    .myInstruction(/* args */)
    .accounts({ /* accounts */ })
    .rpc();

  console.log("Transaction:", tx);
}

// ── Check Balance ──────────────────────────────────────────────────────────

async function getBalance(publicKey: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

// ── Auto-connect on page load ──────────────────────────────────────────────

async function tryAutoConnect(): Promise<PublicKey | null> {
  const phantom = (window as any).phantom?.solana;
  if (!phantom?.isPhantom) return null;

  try {
    // onlyIfTrusted: connect without popup if user previously approved
    const { publicKey } = await phantom.connect({ onlyIfTrusted: true });
    return publicKey;
  } catch {
    // User hasn't approved this site yet — don't show popup
    return null;
  }
}
```

**React component with wallet adapter:**

```tsx
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useState } from "react";

export function SolanaWallet() {
  const { publicKey, sendTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState("");

  async function handleSendSOL() {
    if (!publicKey) return;

    try {
      setStatus("Building transaction...");

      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: publicKey, // send to self for demo
          lamports: 0.001 * LAMPORTS_PER_SOL,
        })
      );

      setStatus("Waiting for wallet approval...");
      const signature = await sendTransaction(tx, connection);

      setStatus("Confirming...");
      await connection.confirmTransaction(signature, "confirmed");

      setStatus(`Confirmed: ${signature.slice(0, 8)}...`);
    } catch (err: any) {
      if (err.name === "WalletSignTransactionError") {
        setStatus("Transaction rejected");
      } else {
        setStatus(`Error: ${err.message}`);
      }
    }
  }

  async function handleSignMessage() {
    if (!signMessage) return;

    try {
      const message = new TextEncoder().encode("Hello from my dApp!");
      const signature = await signMessage(message);
      setStatus(`Signed: ${Buffer.from(signature).toString("hex").slice(0, 16)}...`);
    } catch (err: any) {
      setStatus("Message signing rejected");
    }
  }

  return (
    <div>
      <WalletMultiButton />

      {connected && publicKey && (
        <div>
          <p>Address: {publicKey.toBase58().slice(0, 8)}...</p>
          <button onClick={handleSendSOL}>Send 0.001 SOL</button>
          <button onClick={handleSignMessage}>Sign Message</button>
          <p>{status}</p>
        </div>
      )}
    </div>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Using `window.solana` directly instead of wallet adapter**  
`window.solana` only works with Phantom. The wallet adapter works with all Solana wallets. Always use the adapter for production dApps.

**2. Not handling `WalletNotConnectedError`**  
If the user's wallet disconnects (locked, network issue), subsequent operations throw `WalletNotConnectedError`. Always check `connected` before operations and handle this error gracefully.

**3. Not setting `feePayer` on transactions**  
Every Solana transaction needs a fee payer. If you don't set it explicitly, it defaults to the first signer. Always set `feePayer: publicKey` explicitly to avoid confusion.

**4. Forgetting that `signTransaction` doesn't send**  
`signTransaction` returns a signed transaction but doesn't broadcast it. You must call `connection.sendRawTransaction(tx.serialize())` separately. `sendTransaction` (from wallet adapter) does both.

**5. Not handling the case where Phantom is locked**  
If Phantom is locked, `connect()` will prompt the user to unlock it. If they cancel, the promise rejects. Handle this gracefully — don't assume the user will always approve.

---

## How This Connects to Production

Jupiter's frontend uses `@solana/wallet-adapter-react` with support for 20+ wallets. Tensor (NFT marketplace) uses the same stack. Magic Eden supports Phantom, Backpack, and Solflare via the wallet adapter. The wallet adapter standard has become so universal that any Solana dApp that doesn't use it is considered non-standard. Helius provides enhanced RPC endpoints that work seamlessly with the wallet adapter for better transaction confirmation.

---

## What to Learn Next

- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full range of wallet scenarios across chains.
- **Solana Transaction Anatomy: Instructions, Signers, and Compute Units** — understand what's happening under the hood.
- **Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp** — reduce friction for new users.
