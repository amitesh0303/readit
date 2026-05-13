# Public/Private Keys, Wallets, and How Transactions Actually Work

**Track:** Beginner  
**Read time:** 12 min

---

## The Problem

Most developers who start building dApps treat wallets like a black box. MetaMask pops up, user clicks "confirm," transaction goes through. But when something breaks — a signature fails, a transaction gets rejected, a user's address doesn't match what you expected — you have no idea where to even start debugging.

The moment you understand what's actually happening cryptographically when a user "signs" something, a whole class of bugs becomes immediately obvious. You also start making better security decisions: why you never ask users to sign raw data, why private keys must never touch your server, and how account abstraction is changing the game. This blog gives you that foundation.

---

## Core Concepts

### Asymmetric Cryptography in 60 Seconds

Blockchains use a branch of cryptography called elliptic curve cryptography (ECC), specifically the `secp256k1` curve (Ethereum, Bitcoin) or `ed25519` (Solana).

The core idea: you generate a **private key** — a random 256-bit number. From that private key, you mathematically derive a **public key**. The math is a one-way function: easy to go from private → public, computationally infeasible to reverse.

```
Private Key (256-bit random number):
0x4c0883a69102937d6231471b5dbb6e538ebe...

    ↓  (elliptic curve multiplication — one-way)

Public Key (point on the curve):
0x04b9ef...  (uncompressed, 65 bytes)

    ↓  (keccak256 hash, take last 20 bytes)

Ethereum Address:
0x742d35Cc6634C0532925a3b844Bc454e4438f44e
```

Your Ethereum address is derived from your public key. Your public key is derived from your private key. Lose the private key, lose access forever. Share the private key, lose everything.

### What a Wallet Actually Is

Here's a common misconception: your wallet doesn't "hold" your tokens. Your tokens live on-chain as entries in a smart contract's storage (for ERC-20s) or as UTXOs/account balances. Your wallet is just a key manager — it stores your private key and uses it to sign transactions.

MetaMask, Phantom, Ledger — they're all doing the same fundamental thing: keeping your private key secure and producing cryptographic signatures when you authorize an action.

**HD Wallets (BIP-32/BIP-39):**  
Modern wallets don't store a single private key — they store a **seed phrase** (12 or 24 words). From that seed, they derive a tree of private keys using a deterministic algorithm. This is why your 12-word phrase can restore all your accounts across MetaMask, Ledger, and any other BIP-39 compatible wallet.

```
Seed Phrase (12 words)
    ↓  BIP-39
Seed (512-bit)
    ↓  BIP-32 HD derivation
Master Key
    ↓  derivation path: m/44'/60'/0'/0/0
Account 0 Private Key → Address 0
    ↓  derivation path: m/44'/60'/0'/0/1
Account 1 Private Key → Address 1
...
```

The derivation path `m/44'/60'/0'/0/0` is the standard Ethereum path. Solana uses `m/44'/501'/0'/0'`. This is why importing the same seed into different wallets gives you different addresses for different chains.

### How a Transaction Is Constructed and Signed

When you send ETH or call a contract, here's what actually happens:

1. Your wallet constructs a transaction object with these fields:
   - `nonce` — how many transactions this address has sent (prevents replay attacks)
   - `to` — recipient address (or contract address)
   - `value` — ETH to send (in wei)
   - `data` — encoded function call (empty for plain ETH transfers)
   - `gasLimit` — max gas you're willing to spend
   - `maxFeePerGas` / `maxPriorityFeePerGas` — EIP-1559 fee fields
   - `chainId` — which chain this tx is for (prevents cross-chain replay)

2. This object gets RLP-encoded and hashed with keccak256.

3. Your private key signs that hash using ECDSA, producing a signature: `(v, r, s)`.

4. The signed transaction (original data + signature) is broadcast to the network.

5. Nodes verify the signature, recover the signer's address, and check it matches the `from` field. If valid, the tx enters the mempool.

```typescript
import { ethers } from "ethers";

// Reconstruct what ethers does internally when you call sendTransaction
async function manualTransactionDemo() {
  const wallet = new ethers.Wallet("0xYOUR_PRIVATE_KEY");

  // Step 1: Build the transaction object
  const tx = {
    to: "0xRecipientAddress",
    value: ethers.parseEther("0.01"),   // 0.01 ETH in wei
    gasLimit: 21000,                     // standard ETH transfer gas
    maxFeePerGas: ethers.parseUnits("20", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
    nonce: 42,                           // must match on-chain nonce
    chainId: 1,                          // Ethereum mainnet
    type: 2,                             // EIP-1559 transaction
  };

  // Step 2: Sign the transaction — this is where the private key is used
  const signedTx = await wallet.signTransaction(tx);
  console.log("Signed tx:", signedTx);
  // Output: 0x02f86c... (RLP-encoded signed transaction)

  // Step 3: Broadcast (normally done via provider.sendTransaction)
  // const provider = new ethers.JsonRpcProvider("...");
  // const response = await provider.broadcastTransaction(signedTx);
}
```

### Message Signing vs Transaction Signing

This distinction matters a lot for dApp developers.

**Transaction signing** — authorizes a state change on-chain. Costs gas. Goes through the mempool.

**Message signing** — signs arbitrary data off-chain. No gas. Used for authentication ("Sign in with Ethereum"), permit approvals (EIP-2612), and off-chain order books (0x, OpenSea).

```typescript
import { ethers } from "ethers";

// Off-chain message signing — used for auth, permits, etc.
async function signMessage() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // eth_sign — signs raw hash (DANGEROUS, avoid this)
  // personal_sign — prefixes with "\x19Ethereum Signed Message:\n" to prevent
  // a signed message from being mistaken for a transaction
  const message = "Welcome to MyDApp! Signing this proves you own this wallet.";
  const signature = await signer.signMessage(message);

  console.log("Signature:", signature); // 0x...

  // On your backend, recover the signer's address to verify identity
  const recoveredAddress = ethers.verifyMessage(message, signature);
  console.log("Signer:", recoveredAddress); // should match signer.address
}
```

The `personal_sign` prefix (`\x19Ethereum Signed Message:\n`) is critical. Without it, a malicious dApp could trick you into signing something that looks like a transaction. Always use `signMessage` (which adds the prefix) rather than raw `eth_sign`.

### EIP-712: Structured Data Signing

For more complex off-chain signatures (like permit approvals or typed order data), EIP-712 lets you sign structured, human-readable data instead of raw bytes. MetaMask shows the user exactly what they're signing.

```typescript
// EIP-712 typed data signing
async function signTypedData() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const domain = {
    name: "MyProtocol",
    version: "1",
    chainId: 1,
    verifyingContract: "0xContractAddress",
  };

  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    maker: await signer.getAddress(),
    tokenIn: "0xTokenAddress",
    amountIn: ethers.parseUnits("100", 18),
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  };

  // signTypedData uses eth_signTypedData_v4 under the hood
  const signature = await signer.signTypedData(domain, types, value);
  console.log("EIP-712 signature:", signature);
}
```

---

## Common Mistakes and Gotchas

**1. Storing private keys in environment variables and committing them**  
This happens constantly. `.env` files get committed, GitHub scans for exposed keys, and funds get drained within minutes. Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) for production. For local dev, use `.env` but make sure `.gitignore` is set up before you write the first line.

**2. Confusing `eth_sign` with `personal_sign`**  
`eth_sign` signs a raw hash with no prefix. If you sign a hash that happens to be a valid transaction hash, you've just authorized that transaction. Always use `personal_sign` (ethers `signMessage`) or EIP-712 (`signTypedData`). MetaMask actually shows a warning for `eth_sign` now.

**3. Not validating the recovered address on the backend**  
When using wallet-based auth, developers sometimes skip verifying that the recovered address matches the claimed address. An attacker can submit any signature with any address claim. Always call `ecrecover` (or `ethers.verifyMessage`) and compare the result to the expected address.

**4. Nonce management in high-throughput scripts**  
If you're sending multiple transactions programmatically (like a keeper bot), you can't rely on `eth_getTransactionCount` for every tx — it only reflects confirmed transactions. You need to track the nonce locally and increment it manually, otherwise all your transactions will have the same nonce and only one will go through.

**5. Assuming the same seed phrase gives the same address on all chains**  
It doesn't. Ethereum uses derivation path `m/44'/60'/0'/0/0`, Solana uses `m/44'/501'/0'/0'`, Bitcoin uses `m/44'/0'/0'/0/0`. Same seed, different paths, different addresses. Users who import their MetaMask seed into Phantom won't see their Ethereum assets — they're on a completely different derived key.

---

## How This Connects to Production

Every protocol that handles user funds relies on this cryptographic foundation. OpenSea's off-chain order book uses EIP-712 signatures so users can list NFTs without paying gas — the signature is only submitted on-chain when a trade executes. Uniswap's `permit` function (EIP-2612) lets users approve token spending with a signature instead of an on-chain `approve` transaction, saving gas. Gnosis Safe (now Safe) uses multi-sig — multiple private keys must sign a transaction before it executes. Account abstraction (ERC-4337) goes further, replacing the private key model entirely with smart contract-based validation logic. But all of it — every layer — is built on the same ECDSA signing primitive you just learned.

---

## What to Learn Next

- **Gas Fees Explained: Why Does Ethereum Cost So Much?** — now that you know how transactions are constructed, understand how they're priced and prioritized.
- **RPC Nodes Explained: How Your dApp Talks to the Blockchain** — understand the infrastructure layer between your wallet and the chain.
- **MetaMask Integration with ethers.js and wagmi** — put this knowledge to work by building a real wallet connection flow.
