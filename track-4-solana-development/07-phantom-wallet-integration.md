# Phantom Wallet Integration: Connecting Solana dApps to Users

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

You've built a Solana program. Now you need a frontend where users can connect their Phantom wallet, sign transactions, and interact with your program. The Solana wallet ecosystem is fragmented — Phantom, Backpack, Solflare, Ledger — and each has slightly different behavior. You need a unified integration that works across all of them.

This blog covers the full wallet integration stack: the Wallet Adapter library (the standard), connecting wallets, signing transactions, and handling the edge cases that trip up real dApps.

---

## Core Concepts

### The Wallet Adapter Standard

Solana's wallet ecosystem uses the `@solana/wallet-adapter` library — a unified interface that works with Phantom, Backpack, Solflare, Ledger, and any other wallet that implements the standard.

```
Your dApp
    ↓
@solana/wallet-adapter-react (React hooks)
    ↓
Wallet Adapter (unified interface)
    ↓
Phantom / Backpack / Solflare / Ledger
```

This is similar to WalletConnect on Ethereum — one integration, many wallets.

### The Wallet Interface

Every wallet adapter exposes:
```typescript
interface WalletAdapter {
  publicKey: PublicKey | null;      // connected wallet's public key
  connected: boolean;               // is wallet connected?
  connecting: boolean;              // connection in progress?
  disconnecting: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Sign a transaction (wallet adds signature)
  signTransaction(tx: Transaction): Promise<Transaction>;

  // Sign multiple transactions at once
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;

  // Sign a message (for auth, not on-chain)
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;

  // Send a transaction (sign + broadcast)
  sendTransaction(
    tx: Transaction,
    connection: Connection,
    options?: SendTransactionOptions
  ): Promise<TransactionSignature>;
}
```

### Connection vs Signing

Two distinct operations:
- **Connect**: user approves your dApp to see their public key. No transaction, no fee.
- **Sign/Send**: user approves a specific transaction. Shows transaction details in wallet UI.

Users can connect once and stay connected across sessions (if they approve). Each transaction requires a separate approval.

---

## Code Walkthrough

Complete React dApp with wallet integration:

```typescript
// src/main.tsx — Provider setup
import React from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  BackpackWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import App from "./App";

// Import default wallet modal styles
import "@solana/wallet-adapter-react-ui/styles.css";

const wallets = [
  new PhantomWalletAdapter(),
  new BackpackWalletAdapter(),
  new SolflareWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={clusterApiUrl("mainnet-beta")}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
```

```typescript
// src/components/WalletButton.tsx — Connect/disconnect UI
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function WalletButton() {
  const { publicKey, connected, disconnect } = useWallet();

  // WalletMultiButton handles the full connect/disconnect/select flow
  // It shows "Select Wallet" when disconnected, wallet address when connected
  return (
    <div className="wallet-section">
      <WalletMultiButton />
      {connected && publicKey && (
        <p className="wallet-address">
          Connected: {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
        </p>
      )}
    </div>
  );
}
```

```typescript
// src/hooks/useProgram.ts — Anchor program hook
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import IDL from "../idl/my_program.json";

const PROGRAM_ID = new PublicKey("YourProgramId111111111111111111111111111111");

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;

    // AnchorProvider wraps the wallet adapter for use with Anchor
    return new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions!,
      },
      { commitment: "confirmed" }
    );
  }, [connection, wallet.publicKey, wallet.signTransaction]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(IDL as Idl, PROGRAM_ID, provider);
  }, [provider]);

  return { program, provider };
}
```

```typescript
// src/components/TodoApp.tsx — Full dApp component
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "../hooks/useProgram";
import * as anchor from "@coral-xyz/anchor";

interface Todo {
  title: string;
  description: string;
  completed: boolean;
  index: number;
}

export function TodoApp() {
  const { publicKey, connected } = useWallet();
  const { program } = useProgram();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive user's list PDA
  const userListPda = publicKey
    ? PublicKey.findProgramAddressSync(
        [Buffer.from("user_list"), publicKey.toBuffer()],
        program?.programId ?? PublicKey.default
      )[0]
    : null;

  // Load todos when wallet connects
  useEffect(() => {
    if (!connected || !program || !userListPda) return;
    loadTodos();
  }, [connected, program]);

  async function loadTodos() {
    if (!program || !userListPda || !publicKey) return;
    setLoading(true);
    setError(null);

    try {
      // Check if user list exists
      const listAccount = await program.account.userList
        .fetchNullable(userListPda)
        .catch(() => null);

      if (!listAccount) {
        setTodos([]);
        return;
      }

      // Fetch all todo accounts for this user
      const todoAccounts = await program.account.todoItem.all([
        {
          memcmp: {
            offset: 8, // skip discriminator
            bytes: publicKey.toBase58(), // filter by owner
          },
        },
      ]);

      setTodos(
        todoAccounts
          .map((acc) => ({
            title: acc.account.title,
            description: acc.account.description,
            completed: acc.account.completed,
            index: acc.account.index.toNumber(),
          }))
          .sort((a, b) => a.index - b.index)
      );
    } catch (err) {
      setError("Failed to load todos");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function initializeList() {
    if (!program || !userListPda || !publicKey) return;
    setLoading(true);
    setError(null);

    try {
      const tx = await program.methods
        .initializeList()
        .accounts({
          userList: userListPda,
          user: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("List initialized:", tx);
      await loadTodos();
    } catch (err: any) {
      // Parse Anchor errors for user-friendly messages
      if (err.error?.errorCode?.code) {
        setError(`Error: ${err.error.errorMessage}`);
      } else {
        setError("Failed to initialize list");
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function addTodo(title: string, description: string) {
    if (!program || !userListPda || !publicKey) return;
    setLoading(true);
    setError(null);

    try {
      // Get current todo count to derive the new todo's PDA
      const listAccount = await program.account.userList.fetch(userListPda);
      const todoIndex = listAccount.todoCount.toNumber();

      const indexBuffer = Buffer.alloc(8);
      indexBuffer.writeBigUInt64LE(BigInt(todoIndex));
      const [todoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("todo"), publicKey.toBuffer(), indexBuffer],
        program.programId
      );

      await program.methods
        .addTodo(title, description)
        .accounts({
          userList: userListPda,
          todo: todoPda,
          user: publicKey,
          owner: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await loadTodos();
    } catch (err: any) {
      setError(err.error?.errorMessage ?? "Failed to add todo");
    } finally {
      setLoading(false);
    }
  }

  async function completeTodo(index: number) {
    if (!program || !publicKey) return;

    const indexBuffer = Buffer.alloc(8);
    indexBuffer.writeBigUInt64LE(BigInt(index));
    const [todoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("todo"), publicKey.toBuffer(), indexBuffer],
      program.programId
    );

    try {
      await program.methods
        .completeTodo()
        .accounts({ todo: todoPda, owner: publicKey })
        .rpc();
      await loadTodos();
    } catch (err: any) {
      setError(err.error?.errorMessage ?? "Failed to complete todo");
    }
  }

  if (!connected) {
    return (
      <div>
        <p>Connect your wallet to use the todo app</p>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading...</div>}

      <button onClick={initializeList} disabled={loading}>
        Initialize List
      </button>

      <button
        onClick={() => addTodo("New Todo", "Description")}
        disabled={loading}
      >
        Add Todo
      </button>

      <ul>
        {todos.map((todo) => (
          <li key={todo.index}>
            <span style={{ textDecoration: todo.completed ? "line-through" : "none" }}>
              {todo.title}
            </span>
            {!todo.completed && (
              <button onClick={() => completeTodo(todo.index)}>Complete</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Not handling wallet not installed**  
If Phantom isn't installed, `window.solana` is undefined. The wallet adapter handles this gracefully — the wallet appears in the list but shows "Not Detected." Don't access `window.solana` directly; always use the adapter.

**2. Not handling transaction rejection**  
When a user clicks "Cancel" in their wallet, the promise rejects with a `WalletSignTransactionError`. Always catch this and show a user-friendly message instead of crashing.

**3. Using stale account data**  
After a transaction, account data doesn't update automatically. Always re-fetch accounts after successful transactions. Consider using a subscription (`connection.onAccountChange`) for real-time updates.

**4. Not handling `autoConnect` correctly**  
`autoConnect={true}` in `WalletProvider` reconnects the last used wallet on page load. This is good UX but can cause issues if the wallet is locked or the user has revoked permissions. Handle the `WalletNotConnectedError` gracefully.

**5. Forgetting to handle devnet vs mainnet**  
Your program ID is different on devnet and mainnet. Your RPC endpoint is different. Use environment variables and make sure your frontend config matches your deployed program. A common mistake: testing on devnet, deploying to mainnet, but forgetting to update the program ID in the frontend.

---

## How This Connects to Production

Jupiter's frontend uses `@solana/wallet-adapter-react` with support for 20+ wallets. Tensor (NFT marketplace) uses the same stack with custom transaction building for complex NFT operations. Magic Eden uses wallet adapter for their multi-chain marketplace. The wallet adapter standard has become so universal that any Solana dApp that doesn't use it is considered non-standard. Helius provides enhanced RPC endpoints that work seamlessly with the wallet adapter for better transaction confirmation and error handling.

---

## What to Learn Next

- **Solana Token Program and SPL Tokens: The Equivalent of ERC-20** — integrate token operations into your dApp.
- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full range of wallet UX scenarios.
- **Solana Transaction Anatomy: Instructions, Signers, and Compute Units** — optimize the transactions your frontend sends.
