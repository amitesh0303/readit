# Paymaster Design: Sponsored Gas, ERC-20 Gas, and Rate Limiting

**Track:** Intermediate → Advanced
**Read time:** 10 min

---

## The Problem

The single most-used feature of ERC-4337 isn't smart wallets, recovery, or session keys. It's **gasless transactions**. Users hate the "you need ETH for gas" friction. Drop-off rates at that step are easily 30-50% for new users. A paymaster fixes it: someone else (you, the protocol team) pays gas on the user's behalf.

That sounds simple. It is not. A naively-deployed paymaster will be drained in hours by anyone who notices. ERC-20 paymasters (where the user pays gas in USDC instead of ETH) have their own price-feed and slippage problems. And the on-chain gas accounting is precise enough that getting it wrong by a few thousand units per UserOp adds up to real money at scale.


---

## Core Concepts

### What a paymaster actually does

A paymaster is a contract that the EntryPoint calls during UserOp validation to ask: "are you willing to pay this UserOp's gas?" If yes, the paymaster prefunds the EntryPoint instead of the user's account. The paymaster gets called twice:

1. **`validatePaymasterUserOp(userOp, hash, maxCost)`** — pre-flight check. The paymaster decides whether to sponsor and returns optional `context` data and a validation result.
2. **`postOp(mode, context, actualGasCost, actualUserOpFeePerGas)`** — after execution. Used to settle final state — e.g. for ERC-20 paymasters, charge the user's USDC balance for the gas actually used.

Whoever the paymaster is, they're staking ETH with the EntryPoint upfront. That ETH is what gets paid to the bundler.

### The three paymaster shapes

**1. Sponsored (verifying) paymaster**
Your backend signs an off-chain attestation: "this UserOp is OK to sponsor." The paymaster contract verifies the signature and approves. You sponsor everything you signed; you decline (or just don't sign) for the rest.

This is the most flexible model and what most production paymasters use. Decisioning logic lives in your backend (rate limits, user allowlists, action allowlists), not on-chain.

**2. ERC-20 paymaster**
The user pays gas in an ERC-20 (typically USDC). The paymaster's `postOp` pulls the equivalent value of USDC from the account based on the actual gas spent and a price oracle.

The hard parts: getting a fresh ETH/USDC price (oracle lag costs you money), handling slippage (`maxCost` is in ETH terms; you need to ensure the user has enough USDC even if ETH price spikes), and refunding overcharges.

**3. Free-for-all paymaster**
Approves any UserOp from any account. Useful for testnets and demos. **Will be drained on mainnet within minutes** unless you front it with off-chain rate limiting at the bundler RPC layer (Alchemy and Pimlico both offer this — the paymaster is technically permissive, but their RPC enforces policies). Don't deploy a free-for-all paymaster directly on mainnet.

### The off-chain decision pattern

Most production paymasters look like:

```
User signs UserOp
   ↓
Frontend calls your backend: "sponsor this UserOp?"
   ↓
Your backend checks:
   - Is this user authenticated?
   - Is this action one we sponsor (e.g. swaps but not transfers)?
   - Has this user been rate-limited?
   - Is the calldata pattern reasonable (no obvious griefing)?
   ↓
If yes: sign the UserOp's hash with backend's private key,
        attach signature to userOp.paymasterAndData
   ↓
Send to bundler
   ↓
On-chain paymaster verifies the backend signature
```

The on-chain logic is dumb: "is this signed by my approved signer?" All policy lives off-chain where you can update it without redeploying.

### Gas accounting traps

The paymaster pays for gas. If your paymaster contract has high `verificationGas` (because `validatePaymasterUserOp` does expensive checks), you eat that on every UserOp — even ones you decline. Keep the on-chain validation cheap. Push complex logic off-chain.

Two specific gas costs to plan for:

- **postOpGas**: gas charged for the `postOp` call. v0.7+ requires you to declare this upfront in `paymasterAndData`. Underestimate and the postOp will revert; overestimate and you tie up the user's prefund unnecessarily.
- **paymasterVerificationGas**: similar but for `validatePaymasterUserOp`. Set tight, but not too tight — bundler simulation must succeed.

---

## Code Walkthrough

A verifying paymaster, the workhorse of production AA:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPaymaster, PackedUserOperation} from "account-abstraction/interfaces/IPaymaster.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

contract VerifyingPaymaster is IPaymaster {
    using ECDSA for bytes32;

    address public immutable entryPoint;
    address public verifyingSigner; // backend public key
    address public owner;

    constructor(address _ep, address _signer) {
        entryPoint = _ep;
        verifyingSigner = _signer;
        owner = msg.sender;
    }

    /// Pre-flight: check the off-chain signature attached by our backend
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 /* maxCost */
    ) external view returns (bytes memory context, uint256 validationData) {
        require(msg.sender == entryPoint, "only EP");

        // Layout: paymasterAndData = paymasterAddr (20) || verifGas (16) || postOpGas (16) || validUntil (6) || validAfter (6) || sig (65)
        (uint48 validUntil, uint48 validAfter, bytes calldata sig) = _unpack(userOp.paymasterAndData);

        bytes32 hash = keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.callData),
            validUntil,
            validAfter,
            block.chainid,
            address(this)
        ));
        bytes32 ethSigned = hash.toEthSignedMessageHash();

        bool sigOK = ethSigned.recover(sig) == verifyingSigner;
        // packed validationData: 1 bit (sigFailed) + 6 bytes validUntil + 6 bytes validAfter + ...
        validationData = _packValidation(!sigOK, validUntil, validAfter);
        context = ""; // no postOp needed
    }

    function postOp(
        PostOpMode /* mode */,
        bytes calldata /* context */,
        uint256 /* actualGasCost */,
        uint256 /* actualUserOpFeePerGas */
    ) external pure {
        // Verifying paymaster doesn't need post-op accounting.
    }

    /// Owner deposits ETH for the EntryPoint to draw on
    function deposit() external payable {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external {
        require(msg.sender == owner, "only owner");
        IEntryPoint(entryPoint).withdrawTo(to, amount);
    }

    function setSigner(address s) external {
        require(msg.sender == owner, "only owner");
        verifyingSigner = s;
    }

    function _unpack(bytes calldata pd) internal pure
        returns (uint48 validUntil, uint48 validAfter, bytes calldata sig)
    {
        // implementation elided for brevity — slice paymasterAndData
        validUntil = uint48(bytes6(pd[52:58]));
        validAfter = uint48(bytes6(pd[58:64]));
        sig = pd[64:];
    }

    function _packValidation(bool sigFailed, uint48 validUntil, uint48 validAfter)
        internal pure returns (uint256)
    {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable to, uint256 amount) external;
}

enum PostOpMode { opSucceeded, opReverted, postOpReverted }
```

The backend that signs sponsorships:

```typescript
// backend/sponsor.ts (Node.js)
import { privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, keccak256, encodePacked } from "viem";

const signer = privateKeyToAccount(process.env.SPONSOR_KEY!);

export async function shouldSponsor(req): Promise<boolean> {
  const { user, action } = req;
  // Your policy. Examples:
  if (await isUserOverDailyLimit(user)) return false;
  if (!APPROVED_ACTIONS.has(action)) return false;
  if (await isOnDenylist(user)) return false;
  return true;
}

export async function signSponsorship(userOp, validUntil, validAfter) {
  const hash = keccak256(encodeAbiParameters(
    [
      { type: "address" }, { type: "uint256" }, { type: "bytes32" },
      { type: "uint48" }, { type: "uint48" }, { type: "uint256" }, { type: "address" },
    ],
    [
      userOp.sender, userOp.nonce, keccak256(userOp.callData),
      validUntil, validAfter, BigInt(CHAIN_ID), PAYMASTER_ADDRESS,
    ],
  ));
  return signer.signMessage({ message: { raw: hash } });
}
```

The frontend then assembles `paymasterAndData = paymasterAddr || verifGas || postOpGas || validUntil || validAfter || signature` and includes it in the UserOp.

### Rate limiting that actually works

Common policies, in order of how often I see them in production:

- **Per-address-per-day spending cap** — total gas you'll sponsor for a single address per UTC day. Stops both abuse and runaway costs from a single user.
- **Per-address-per-hour rate** — caps bursts. A legit user makes 10 actions/hour at most.
- **Per-action allowlist** — only sponsor specific function selectors on specific contracts. Prevents users from "tunneling" sponsored gas into arbitrary calls.
- **Captcha / auth gating** — sponsorship requires a valid session token from your auth backend. The simplest way to keep bots out.
- **Spend-cap per signer key** — set a budget per backend signer; rotate signers if one is compromised.

All of this lives in the backend that produces the off-chain signature. The on-chain paymaster is intentionally dumb.

---

## Common Mistakes and Gotchas

**1. Open paymaster on mainnet**
A paymaster that approves anything on mainnet will be drained. People run scripts hunting for them. Always gate with a backend signature, an allowlist, or both.

**2. Letting the paymaster ETH balance hit zero unnoticed**
Once the deposit runs out, every sponsored UserOp fails. Monitor the balance and alert on low-watermark. Auto-topup from a treasury wallet is even better.

**3. ERC-20 paymaster with stale price feeds**
If you're charging USDC for gas at a price you cached an hour ago and ETH spiked 5%, you're sponsoring 5% of every tx. At scale this is real money. Use a fresh oracle (Pyth, Chainlink) and add a slippage buffer.

**4. Forgetting that bundler simulation drives gas estimates**
If your validation does anything weird (reads from non-deterministic state, accesses banned opcodes), simulation fails and bundlers reject everything you sponsor. Test under simulation, not just direct calls.

**5. Validity windows that don't match clock skew**
`validUntil` is enforced by `block.timestamp`. If your backend signs with a 60-second window and the bundler waits 90 seconds before submitting, the UserOp fails on-chain. Use 5-15 minute windows minimum.

**6. Replay across chains**
Without `chainId` in the signed digest, a sponsorship signed for chain A can be replayed on chain B (if you have a paymaster on both). Always bind chainId.

**7. Underestimating `postOpGas` on ERC-20 paymasters**
The `postOp` does a token transfer, which is ~50k gas minimum. Set the declared `postOpGas` accordingly, with margin.

---

## How This Connects to Production

Most teams don't build their own paymaster. They use Pimlico's, Alchemy's Gas Manager, or Biconomy's — all of which expose the verifying-paymaster pattern with a hosted policy engine. You write rules in their dashboard or via API; they handle the signer infrastructure, deposit management, and rate limiting. That's the right call for 90% of teams.

Building your own makes sense when: you have unusual policies (e.g. "sponsor up to $X per user per protocol-level action, with refunds on partial fills"), you need on-chain state in the decision (e.g. "sponsor only if the user holds our governance token"), or you operate at a scale where the per-UserOp markup of hosted services is bigger than your engineering cost.

Either way, the architecture is the same — and understanding it is what lets you debug the inevitable "why was this UserOp rejected?" issues.

---

## What to Learn Next

- **Session Keys and Permission Systems** — pair sponsored gas with limited delegation to get truly seamless dApp UX.
- **Sign-In With Ethereum (SIWE)** — the auth side of the puzzle: tying sessions to smart accounts.
- **Web3 Backend Engineering** (separate track) — your sponsor backend is just one of several services running alongside an AA-enabled dApp.
