# Passkeys + WebAuthn for Smart Wallets

**Track:** Intermediate → Advanced
**Read time:** 8 min

---

## The Problem

Seed phrases are the single biggest UX failure of crypto. They're hostile to non-technical users. They get phished. They get lost. They get written on Post-It notes. Every "we lost a million users to seed-phrase friction" study points the same direction: kill the seed phrase.

Passkeys are how you do it. WebAuthn (the W3C standard, supported by every modern browser and OS) lets you authenticate with a hardware-backed key — Touch ID, Face ID, a YubiKey, the secure enclave on a phone. The private key never leaves the device. Combined with a smart account that uses passkey signatures for validation, you get a wallet with no seed phrase that's *more secure* than typical EOA setups, not less.


---

## Core Concepts

### What WebAuthn actually does

WebAuthn is a browser API that talks to an "authenticator" — usually the device's secure enclave or an attached security key. Two operations:

- **Registration** (`navigator.credentials.create`): generates a new keypair on the authenticator, returns the public key plus an opaque credential ID. The private key never leaves the authenticator.
- **Authentication** (`navigator.credentials.get`): asks the authenticator to sign a challenge with the previously-registered private key. Returns the signature.

User interaction is mandatory — a Touch ID prompt, Face ID, or button press on a hardware key. No background signing. This is enforced by the browser, the OS, and the hardware. It's much harder to abuse than a key sitting in a JS variable.

### The signature format mismatch

Here's where it gets technical. Ethereum signatures are ECDSA over secp256k1. Passkeys produce ECDSA signatures over... secp256r1 (also called P-256 or prime256v1). Different curve. The verification math is similar but not identical, and `ecrecover` doesn't help you — there's no `ecrecover` for P-256 in the EVM.

Two solutions emerged:

1. **Verify P-256 on-chain in Solidity** — possible but expensive (~600k gas pre-2024, ~150k after the introduction of EIP-7212's RIP-7212 precompile on supporting chains).
2. **Use the RIP-7212 precompile** — a precompiled contract at address `0x100` (or similar) that verifies P-256 signatures cheaply (~3,500 gas). Available on most major L2s (Base, Arbitrum, Optimism, Polygon zkEVM, etc.) and being integrated into Ethereum mainnet.

A passkey-signing smart account validator does:

```solidity
function validateUserOp(UserOp calldata op, bytes32 hash) external returns (uint256) {
    (bytes memory authenticatorData, bytes memory clientDataJSON, uint256 r, uint256 s) =
        abi.decode(op.signature[20:], (bytes, bytes, uint256, uint256));

    // 1) WebAuthn-specific message: clientDataJSON | sha256(authenticatorData)
    bytes32 msgHash = sha256(bytes.concat(authenticatorData, sha256(clientDataJSON)));

    // 2) Verify P-256 signature via the precompile
    bool ok = P256Verifier.verify(msgHash, r, s, publicKeyX, publicKeyY);
    return ok ? 0 : 1;
}
```

The `clientDataJSON` is what WebAuthn returns; we extract the challenge from inside it and verify it matches the UserOp hash. Detail-heavy but mechanical.


### The signing flow

```
User clicks "Send transaction"
       │
       ▼
Wallet builds UserOp, computes the userOpHash
       │
       ▼
Frontend calls navigator.credentials.get with userOpHash as challenge
       │
       ▼
Browser prompts: Touch ID / Face ID / YubiKey
       │
       ▼ (user authenticates)
Authenticator returns:
   - authenticatorData (which authenticator, when, etc.)
   - clientDataJSON     (includes the challenge / userOpHash)
   - signature (P-256 ECDSA over sha256(authenticatorData || sha256(clientDataJSON)))
       │
       ▼
Frontend packs (authenticatorData, clientDataJSON, sig) into op.signature
       │
       ▼
Send UserOp to bundler → EntryPoint → Account → Validator
       │
       ▼
Validator verifies P-256 sig matches the userOpHash
       │
       ▼
UserOp executes
```

For the user, the experience is: tap "send," tap fingerprint, done. No seed phrase. No browser extension. No private key the user is responsible for.

### Cross-device sync (or not)

Passkeys are sometimes synced via iCloud Keychain, Google Password Manager, etc. — the keys are stored encrypted with a key derived from the user's account password and the device. This is great for UX (sign in on a new phone, your wallet works) but less great for security (compromise the cloud account, get the keys).

Hardware-only passkeys (a YubiKey, or non-syncable platform passkeys) are more secure but harder to recover from loss. Most production wallets use synced passkeys for the main signer, plus *guardian-based recovery* — if your iCloud is compromised AND you notice within the recovery delay, designated guardians can override.

The right tradeoff depends on the user. For a $100-balance wallet, syncing is fine. For a $1M-balance wallet, you want a non-syncable passkey or a multi-device threshold setup.


---

## Code Walkthrough

Registering a passkey for a new wallet (frontend):

```typescript
async function registerPasskey(userIdentifier: string) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "MyDApp", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userIdentifier),
        name: userIdentifier,
        displayName: userIdentifier,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 / P-256
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "required", // discoverable credential
      },
      timeout: 60_000,
    },
  });

  // Extract the public key — needed for the on-chain validator
  const attestation = (credential as PublicKeyCredential).response as AuthenticatorAttestationResponse;
  const publicKey = parseCOSEPublicKey(attestation.getPublicKey()!);

  return {
    credentialId: arrayBufferToBase64Url((credential as PublicKeyCredential).rawId),
    publicKeyX: publicKey.x, // bigint
    publicKeyY: publicKey.y,
  };
}
```

After registration, deploy a smart account with the passkey validator pre-installed using the public key (X, Y) just generated. The credential ID is stored locally so the wallet knows which passkey to invoke for this account.

Signing a UserOp with the passkey:

```typescript
async function signUserOpWithPasskey(userOpHash: Uint8Array, credentialId: string) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: userOpHash,
      allowCredentials: [{
        type: "public-key",
        id: base64UrlToArrayBuffer(credentialId),
      }],
      userVerification: "required",
    },
  });

  const response = (assertion as PublicKeyCredential).response as AuthenticatorAssertionResponse;
  const { r, s } = parseECDSASignature(new Uint8Array(response.signature));

  // Pack for on-chain verifier: validatorAddr (20) || authenticatorData || clientDataJSON || r || s
  return encodePacked(
    ["address", "bytes", "bytes", "uint256", "uint256"],
    [
      PASSKEY_VALIDATOR_ADDRESS,
      new Uint8Array(response.authenticatorData),
      new Uint8Array(response.clientDataJSON),
      r,
      s,
    ],
  );
}
```

Use this `signature` as `userOp.signature` when sending to the bundler.


---

## Common Mistakes and Gotchas

**1. Targeting a chain without RIP-7212**
On-chain P-256 verification without the precompile costs 200k+ gas. On a chain with the precompile, it's ~3,500 gas. Always check whether your target chain supports RIP-7212 before architecting for passkeys. Most major L2s do; mainnet is in the process.

**2. Forgetting to include the challenge in clientDataJSON verification**
The `clientDataJSON` returned by WebAuthn includes the challenge that was signed. You must extract it and verify it matches the userOpHash. Skipping this means an attacker can replace the challenge with anything and produce a valid passkey signature for unrelated data.

**3. Treating the credential ID as confidential**
The credential ID is *not* secret. It's an identifier, like a username. The signing key is what's protected, and that lives in the secure enclave. Don't hide credential IDs out of misplaced concern.

**4. Not handling iCloud/Google sync surprises**
A user registers a passkey on their MacBook. It syncs to their iPhone. They're happy. Then they delete the passkey on the iPhone — it's removed from the MacBook too. Now their wallet is bricked. Either explain sync clearly or use non-syncable passkeys with a separate recovery path.

**5. Relying on platform passkeys for recovery**
"Just use Touch ID on a different Mac" doesn't work — passkeys are bound to the iCloud account. If the user changes Apple IDs, the passkey is gone. Always have a recovery flow that doesn't depend on the same passkey infrastructure.

**6. Using the same passkey for auth and signing**
Some teams use one passkey for SIWE auth *and* for transaction signing. Cleaner to separate: a SIWE passkey can be a different credential than the wallet's transaction-signing one. Compromise of the auth path doesn't directly enable transactions.

**7. Skipping `userVerification: "required"`**
Without it, the authenticator might allow a no-touch signature ("user presence" only). For wallet operations, always require verification — fingerprint, face, or PIN.


---

## How This Connects to Production

Coinbase Smart Wallet, Privy's embedded wallets, and many newer onboarding flows are passkey-first by 2026. The pattern is no longer experimental — it's the recommended UX for non-crypto-native users. Onboarding goes from "write down 12 words" to "tap your fingerprint to create your wallet." That single change measurably moves drop-off rates.

The infrastructure side: every chain that wants to be relevant for consumer dApps has to support cheap P-256 verification. The RIP-7212 precompile (or an equivalent in zk-rollups using their own circuits) is now table stakes. Chains without it are competing with one hand tied behind their back.

The remaining hard problem: **recovery**. Passkeys solve "user creates a wallet without a seed phrase." They don't fully solve "user loses their phone, hard drive crashes, etc." That's why smart-account features like guardian-based recovery, time-locked overrides, and multi-device threshold signing matter so much. Passkeys are the *signing* layer; recovery is a *separate* problem that a serious wallet has to solve in addition.

---

## What to Learn Next

- **EIP-7702: Setting Code on EOAs** — the AA upgrade that brings smart-account features (including passkey support) to existing EOA addresses without migration.
- **Session Keys and Permission Systems** — passkeys for the install signature, session keys for the high-frequency actions afterwards.
- **Sign-In With Ethereum (SIWE)** — pair passkey-based wallets with passkey-style SIWE flows for fully passwordless apps.
