# Session Keys and Permission Systems for dApps and Games

**Track:** Intermediate → Advanced
**Read time:** 9 min

---

## The Problem

Every transaction signature is a UX hit. Click "Stake," see the wallet popup, sign, wait. Click "Claim rewards," another popup, another sign. For a DeFi UI you visit weekly, this is fine. For a game where the player swings a sword every two seconds, it's lethal — the popup tax kills the experience entirely.

Session keys solve this. The user signs *once* to authorize a separate key (the session key) to act on their behalf, scoped to specific contracts, specific functions, and a time/spend limit. The session key is held by the dApp (or a frontend keystore) and used to sign UserOps without further user interaction.

Done well, this is the most genuinely-new capability AA enables — not a UX bandage on top of EOAs, but something that wasn't possible before. Done poorly, it's a vector for permanent wallet drains.


---

## Core Concepts

### Session keys as scoped validators

Recall from earlier lessons: a smart account installs **validators**. A session key is just a validator that:

1. Has its own keypair (separate from the owner's main key).
2. Enforces *permissions* — only certain target contracts, only certain function selectors, only certain calldata patterns, only up to a max ETH/token spend, only until a specific timestamp.

The session key validator is the on-chain enforcement. The validator looks at the UserOp it's asked to validate and rejects anything that violates its policy.

Critically, the user installs the session key by signing *once* with their main key. After that, the session key holds delegated authority — the user doesn't sign again until the session expires.

### What permissions look like

A typical session-key permission set:

- **Allowed targets**: a list of contract addresses the key can call.
- **Allowed selectors**: per target, which function selectors are callable. (`bytes4`)
- **Argument constraints**: per selector, restrictions on specific calldata regions (e.g. "the `token` argument must be USDC", "the `amount` must be ≤ 10 USDC").
- **Spend cap**: total ETH (or per-token) value the key can move during the session.
- **Time bounds**: `validUntil` and `validAfter` — outside this window, validation fails.
- **Nonce/usage cap**: e.g. "this key can be used at most 100 times."

Production session-key validators (Permissionless's, Kernel's session keys, Safe's plugins) all implement variations of this list. ERC-7715 is an emerging standard for how dApps can *request* a permission set, leaving the user/wallet to grant it.

### Where the session key actually lives

Three options, in increasing security:

1. **Browser localStorage** — easy, but anyone who runs JS in the page can read it. Mitigation: keep the spend cap small, scope tightly, expire fast. Works for "play 1 hour of a game with $5 of in-game spending."
2. **Browser keystore (WebCrypto, non-extractable)** — the key is stored in the browser but cannot be read out. Better. Used by Privy and other embedded wallets.
3. **TEE / passkey-bound** — the session key lives behind a passkey or a remote attested execution environment. Best, but more complex.

The threat model: if the session key leaks, the attacker can spend up to the cap on the allowed contracts. With small caps and tight scopes, that's usually a recoverable annoyance, not a wallet wipe. With wide-open scopes ("any contract, any selector"), it's catastrophic. Always scope tightly.

### Time-bounded validation in ERC-4337

ERC-4337's `validateUserOp` returns a `validationData` packed value that includes:

- 1 bit: signature failure flag
- 6 bytes: `validUntil` timestamp
- 6 bytes: `validAfter` timestamp
- 20 bytes: optional aggregator address

The EntryPoint checks the time bounds. So if your session-key validator returns `validationData` with `validUntil = sessionExpiry`, the EntryPoint enforces it on-chain — no off-chain trust required.

```solidity
// In your session key validator
function validateUserOp(PackedUserOperation calldata op, bytes32 hash)
    external view returns (uint256 validationData)
{
    // ... check signature, check permissions ...
    bool sigOK = _verifySig(op, hash);
    return _packValidation(!sigOK, session.validUntil, session.validAfter);
}
```

The EntryPoint will refuse to execute the UserOp before `validAfter` or after `validUntil`. Time-based expiry is enforced by the protocol, not by code you have to remember to check.

---

## Code Walkthrough

A simplified session-key validator with target/selector/spend constraints:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PackedUserOperation} from "account-abstraction/interfaces/IAccount.sol";

contract SessionKeyValidator {
    struct Session {
        address sessionKey;
        uint48 validUntil;
        uint48 validAfter;
        uint256 spendCap;          // wei
        uint256 spent;             // running total
        // Per-call: target -> selector -> allowed
        mapping(address => mapping(bytes4 => bool)) allowed;
    }

    // smart account => session id => Session
    mapping(address => mapping(bytes32 => Session)) internal sessions;

    /// Account installs a session by calling this from itself
    function installSession(
        bytes32 sessionId,
        address sessionKey,
        uint48 validUntil,
        uint256 spendCap,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external {
        Session storage s = sessions[msg.sender][sessionId];
        s.sessionKey = sessionKey;
        s.validUntil = validUntil;
        s.validAfter = uint48(block.timestamp);
        s.spendCap = spendCap;
        s.spent = 0;
        for (uint256 i; i < targets.length; ++i) {
            s.allowed[targets[i]][selectors[i]] = true;
        }
    }

    /// Called by the account during validateUserOp dispatch
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        // Signature layout: validatorAddr (20) || sessionId (32) || ECDSA sig (65)
        bytes32 sessionId = bytes32(userOp.signature[20:52]);
        bytes calldata sig = userOp.signature[52:];

        Session storage s = sessions[userOp.sender][sessionId];
        if (s.sessionKey == address(0)) return 1; // not installed

        // Verify signature is from session key
        bytes32 ethSigned = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", userOpHash
        ));
        if (_recover(ethSigned, sig) != s.sessionKey) return 1;

        // Decode the call: callData = execute(target, value, innerData)
        (address target, uint256 value, bytes memory innerData) =
            _decodeExecute(userOp.callData);

        // Check selector is allowed
        bytes4 selector;
        assembly { selector := mload(add(innerData, 32)) }
        if (!s.allowed[target][selector]) return 1;

        // Check spend cap
        if (s.spent + value > s.spendCap) return 1;
        s.spent += value;

        // Pack time bounds
        return uint256(s.validUntil) << 160 | uint256(s.validAfter) << 208;
    }

    function _decodeExecute(bytes calldata data)
        internal pure returns (address target, uint256 value, bytes memory inner)
    {
        // selector is execute(address,uint256,bytes) — abi.decode after strip
        target = abi.decode(data[4:36], (address));
        value = abi.decode(data[36:68], (uint256));
        // ... decode inner ...
    }

    function _recover(bytes32 h, bytes memory s) internal pure returns (address) {
        if (s.length != 65) return address(0);
        bytes32 r; bytes32 ss; uint8 v;
        assembly {
            r := mload(add(s, 32)); ss := mload(add(s, 64)); v := byte(0, mload(add(s, 96)))
        }
        return ecrecover(h, v, r, ss);
    }
}
```

Frontend usage with viem + a permissionless toolkit:

```typescript
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";

// 1) Create the session key
const sessionKey = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionKey);
const sessionId = keccak256(toBytes(crypto.randomUUID()));

// 2) Install the session — user signs ONCE
const installCall = {
  to: SESSION_VALIDATOR_ADDR,
  data: encodeFunctionData({
    abi: sessionValidatorAbi,
    functionName: "installSession",
    args: [
      sessionId,
      sessionAccount.address,
      BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
      parseEther("0.05"), // spend cap
      [GAME_CONTRACT, GAME_CONTRACT],
      ["0xa1b2c3d4", "0xe5f6a7b8"], // selectors for `move()`, `attack()`
    ],
  }),
  value: 0n,
};
await mainAccountClient.sendUserOperation({ calls: [installCall] });

// 3) For every subsequent action — no user signature, just session-key
async function gameAction(call) {
  // Build UserOp signed by sessionAccount, with signature prefix
  // identifying the SessionKeyValidator
  const userOp = await buildUserOp(smartAccount, call);
  const hash = await getUserOpHash(userOp);
  const sig = await sessionAccount.signMessage({ message: { raw: hash } });
  userOp.signature = encodePacked(
    ["address", "bytes32", "bytes"],
    [SESSION_VALIDATOR_ADDR, sessionId, sig],
  );
  return await bundlerClient.sendUserOperation({ userOp });
}
```

After the install, `gameAction()` requires no wallet popup. The user can swing their sword 100 times in a minute, sponsored by your paymaster, with no signature prompts — until either the spend cap or the time runs out.

---

## Common Mistakes and Gotchas

**1. Storing the session key in plain localStorage**
A single XSS in your dApp leaks the key. Mitigations: scope tightly so the damage is bounded; use WebCrypto with non-extractable keys; encrypt the key under a passphrase derived from a passkey.

**2. Granting "any contract" or "any selector" permissions**
The whole point is scoped delegation. A session key with permission to call any contract is a fully-functional account. Don't.

**3. Forgetting argument-level constraints**
"Allowed selectors: `transfer`" lets the session key transfer any token to any address up to the spend cap. If you only want it to interact with your dApp's escrow, also constrain the calldata: `to` must equal escrow address.

**4. Spend cap that doesn't match what the function does**
`spendCap` only limits `msg.value`. If the session key calls a function that moves ERC-20 tokens, the ETH spend cap is irrelevant. Track per-token spending or constrain the calldata to a fixed amount.

**5. Long-lived sessions**
A 30-day session is a 30-day attack window. For most flows, hours is the right unit. Re-prompting once per day is good UX *and* good security.

**6. Re-using session IDs**
If `sessionId` collides with an old session, you're either overwriting state or — worse — re-enabling a previously-revoked session. Always randomize.

**7. Not surfacing active sessions to the user**
Users should see "Game X has access to your wallet (expires in 22 minutes, spent 0.01 ETH of 0.05 cap) [Revoke]." Make this UI. Wallets that hide active sessions are training users to ignore them.

---

## How This Connects to Production

Onchain games (Dark Forest, Realms, Pirate Nation), high-frequency trading UIs (Hyperliquid's onboarding, Aevo's setup), and payment dApps (recurring subscriptions) all rely on session keys to make the experience feel like a normal app instead of "sign 50 popups." It's the AA feature where the UX delta is *enormous*.

The thing to take away: AA isn't really about smart wallets or social recovery. It's about the validator-and-permissions model. Once you can install scoped, time-bounded, custom validation logic on an account, *all* of these features fall out — gas sponsorship, session keys, multisig, biometric, ZK auth — as instances of the same primitive.

---

## What to Learn Next

- **Sign-In With Ethereum (SIWE)** — the auth side: how a session key install can be tied to a server-side login.
- **Passkeys + WebAuthn for Smart Wallets** — replacing seed phrases with hardware-backed passkeys.
- **EIP-7702: Setting Code on EOAs** — the AA upgrade that lets existing EOAs adopt these patterns without migrating addresses.
