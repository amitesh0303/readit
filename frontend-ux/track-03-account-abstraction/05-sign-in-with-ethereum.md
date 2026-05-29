# Sign-In With Ethereum (SIWE): Sessions, Nonces, and JWT Bridging

**Track:** Intermediate → Advanced
**Read time:** 8 min

---

## The Problem

A wallet connection isn't a login. `useAccount().address` tells you what's in the wallet — it doesn't prove the user controls it. For "show their balance" that's fine. For "let them post under this address," "let them access their private data," "tie API requests to this account" — you need an actual session.

Sign-In With Ethereum (EIP-4361, finalized 2022) is the standardized way. The user signs a structured message; your backend verifies the signature; you mint a session token. Same flow as OAuth, but the identity provider is the user's wallet. By 2026 it's the de-facto standard for wallet-bound auth.


---

## Core Concepts

### The SIWE message format

EIP-4361 specifies an exact message string:

```
example.com wants you to sign in with your Ethereum account:
0x1234abcd...

I accept the example.com Terms: https://example.com/tos

URI: https://example.com/login
Version: 1
Chain ID: 1
Nonce: 32891756
Issued At: 2026-05-29T12:34:56Z
Expiration Time: 2026-05-29T13:34:56Z
```

Every field has a meaning. The user's wallet shows them this message. They sign it. Your backend verifies the signature came from the claimed address.

The fields that prevent attacks:

- **Domain** (first line) — locked to your site. A signature from a phishing site that says `evil.com wants you to sign in...` won't authenticate on `example.com`.
- **Nonce** — server-generated, single-use. Prevents replay.
- **Issued At / Expiration Time** — bounds the window. Old signatures don't authenticate.
- **Chain ID** — prevents using a mainnet sig on a testnet (or vice versa).

### The flow

```
User clicks "Sign in with Ethereum"
       │
       ▼
Frontend → Backend: GET /siwe/nonce
       │                   │
       │                   └─► Backend generates and stores nonce
       ◄─── nonce ─────────┘
       │
Frontend builds SIWE message with the nonce, asks wallet to sign
       │
       ▼
User sees message in wallet popup, signs
       │
       ▼
Frontend → Backend: POST /siwe/verify { message, signature }
       │                   │
       │                   ├─► Verify signature recovers the claimed address
       │                   ├─► Check nonce is fresh (and burn it)
       │                   ├─► Check domain, chainId, expiration
       │                   ├─► Mint session token (JWT or opaque)
       ◄─── session ───────┘
       │
Frontend stores token, sends with every API call
```

The backend never sees the user's private key. It just verifies signatures against the public address.


### Smart accounts and ERC-1271

EOA signatures are verified with `ecrecover`. Smart contract accounts (Safe, Coinbase Smart Wallet) can't sign with `ecrecover` — they don't have a private key in the traditional sense. ERC-1271 solves this with `isValidSignature(hash, signature)` returning a magic value.

For a SIWE library to support smart wallets, it has to:

1. Try `ecrecover` first (works for EOAs).
2. If that doesn't match, call `isValidSignature` on the claimed address as a contract.
3. If the contract returns the magic value `0x1626ba7e`, accept.

Most modern SIWE libraries (`siwe` npm package, `siwe-py`) handle both. If your backend rolls its own verification, make sure to handle both paths — otherwise smart-account users can't log in.

### JWT vs opaque sessions

Once you've verified the signature, mint a session. Two common patterns:

- **JWT** — sign a token containing `{address, expiresAt, ...claims}` with a backend-only key. Stateless. Frontend includes it as `Authorization: Bearer ...`. Good for distributed systems.
- **Opaque session ID** — random string, stored in your DB with the address it maps to. Stateful. Easy to revoke (delete from DB).

For Web3, opaque sessions tied to the wallet have a nice property: revocation is trivial. If a user reports their wallet compromised, you delete all their active sessions. With JWT, you'd need a revocation list.

### When to re-prompt for signature

Each SIWE flow ends with a session token. While the session is valid, the user doesn't sign again. But you might want re-signature for sensitive actions:

- High-value money movements
- Account deletion
- Permission changes (granting another address access)

For these, your frontend re-runs the SIWE flow with a fresh nonce, possibly with extra "statement" text describing the specific action. The user signs once more. The backend verifies, performs the action, doesn't extend the session.

This is the pattern equivalent to "confirm with password" in non-Web3 apps.


---

## Code Walkthrough

Backend (Node + Express + the `siwe` library):

```typescript
import express from "express";
import { SiweMessage, generateNonce } from "siwe";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

app.get("/siwe/nonce", (req, res) => {
  const nonce = generateNonce();
  // Bind nonce to a session id (cookie) so it can't be used by another client
  const sid = req.headers["x-session-id"] as string;
  nonceStore.set(sid, { nonce, expiresAt: Date.now() + 5 * 60_000 });
  res.json({ nonce });
});

app.post("/siwe/verify", async (req, res) => {
  const { message, signature } = req.body;
  const sid = req.headers["x-session-id"] as string;

  try {
    const siwe = new SiweMessage(message);
    const { data } = await siwe.verify({ signature });

    // Burn the nonce
    const stored = nonceStore.get(sid);
    if (!stored || stored.nonce !== data.nonce || Date.now() > stored.expiresAt) {
      return res.status(400).json({ error: "invalid or expired nonce" });
    }
    nonceStore.delete(sid);

    if (data.domain !== "example.com") {
      return res.status(400).json({ error: "wrong domain" });
    }

    const token = jwt.sign(
      { address: data.address, chainId: data.chainId },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" },
    );
    res.json({ token, address: data.address });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});
```


Frontend (with viem + wagmi):

```typescript
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";

export function useSiweLogin() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return async () => {
    if (!address) throw new Error("not connected");

    // 1) Get nonce
    const sid = getOrCreateSessionId();
    const { nonce } = await fetch("/siwe/nonce", {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    // 2) Build SIWE message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: "Sign in to Example",
      uri: window.location.origin,
      version: "1",
      chainId,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60 * 60_000).toISOString(),
    }).prepareMessage();

    // 3) Sign
    const signature = await signMessageAsync({ message });

    // 4) Verify and get session
    const { token } = await fetch("/siwe/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": sid,
      },
      body: JSON.stringify({ message, signature }),
    }).then((r) => r.json());

    localStorage.setItem("auth", token);
  };
}
```

Now `Authorization: Bearer <token>` on every API request. Your backend middleware verifies the JWT and extracts the address.


---

## Common Mistakes and Gotchas

**1. Not binding nonces to a client session**
A nonce that's globally usable is replay-vulnerable: a man-in-the-middle could intercept a victim's `/siwe/nonce` response, complete the auth flow with their own wallet, and become the victim's session. Bind the nonce to a cookie or session ID.

**2. Skipping ERC-1271 verification**
If you only verify `ecrecover`, smart-account users can't sign in. Their wallets don't produce ECDSA-recoverable signatures. Use a SIWE library that calls `isValidSignature` for contract addresses.

**3. Letting nonces live forever**
A nonce that's valid for 24h gives an attacker a long replay window. 5-15 minutes is appropriate. Store with TTL in Redis or with a background cleanup job.

**4. Not checking domain**
The `domain` field in the message is the *only* thing tying the signature to your site. If your backend ignores it, a phishing page with a different domain can capture signatures and use them on the real site (technically the SIWE message says `evil.com`, but if you don't check it, the backend doesn't know).

**5. Storing the JWT in localStorage with insufficient claims**
JWT tokens stored in localStorage are XSS-extractable. If your token has 7-day expiry and broad claims, an XSS exfiltrates a long-lived powerful token. Use shorter expiry (1 hour) with a refresh flow, or use httpOnly cookies.

**6. Treating the address as immutable identity**
Users can lose access to a wallet. They can transfer accounts. They can use multiple wallets. Don't treat the wallet address as the *only* user identifier — pair it with a database user ID that survives wallet changes (allow users to add/remove wallets from one account).

**7. Forgetting chainId binding**
A SIWE signature for chainId 1 is technically usable on chainId 1 only — but some libraries don't enforce this. If your backend permits any chainId, an attacker can replay a signature signed for testnet onto mainnet auth.


---

## How This Connects to Production

Almost every consumer Web3 app in 2026 uses some flavor of SIWE for backend auth. Embedded wallet providers (Privy, Dynamic) often handle the SIWE flow internally and give you the resulting JWT. RainbowKit ships with SIWE integration out of the box. The pattern is mature enough that you rarely write the flow from scratch — but understanding it matters because the gotchas (nonce binding, domain check, ERC-1271) are easy to get wrong even with libraries.

The other production consideration: SIWE pairs naturally with smart accounts. The user installs a session-key validator on their smart account (signing once) and your backend mints a JWT covering the same scope. Now both your contract layer and your API layer agree on what the session can do. Done well, this is the auth experience users actually want — sign in once, do everything for an hour, sign out cleanly.

---

## What to Learn Next

- **Passkeys + WebAuthn for Smart Wallets** — replacing wallet-managed keys with hardware passkeys for both signing and SIWE.
- **EIP-7702: Setting Code on EOAs** — the AA upgrade that lets existing EOAs adopt smart-account features without migrating addresses.
- **Web3 Backend Engineering** (separate track) — the broader picture of running auth, indexing, and tx orchestration server-side.
