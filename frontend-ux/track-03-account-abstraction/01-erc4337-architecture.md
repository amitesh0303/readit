# ERC-4337 Architecture: UserOps, Bundlers, EntryPoint, Paymasters

**Track:** Intermediate → Advanced
**Read time:** 10 min

---

## The Problem

Account abstraction has been "coming" since 2020. ERC-4337 finally shipped in March 2023, and three years later it's everywhere: Coinbase Smart Wallet uses it, Safe uses it, every onboarding flow that says "no seed phrase" uses it. But most developers learn AA the wrong way around — they pick up a SDK like Alchemy's Account Kit or ZeroDev, paste in some boilerplate, and never understand what's happening underneath. Then something fails ("UserOp dropped from alt-mempool"), and the abstraction is no help.

This lesson is the foundation. What's a UserOperation, what does the EntryPoint do, who are bundlers and paymasters, and why is the architecture shaped the way it is?

---

## Core Concepts

### Why "account abstraction" exists

Ethereum has two account types: **EOAs** (externally owned accounts — `0x...` addresses controlled by a private key) and **smart contract accounts** (controlled by code). Until 2023, only EOAs could initiate transactions. Smart contract wallets like Argent and Safe existed, but they always needed an EOA to "trigger" them — pay the initial gas, sign the wrapper transaction.

Account abstraction means: smart contract accounts can initiate transactions directly. The validation logic — "what counts as a valid signature for this account?" — is defined by the contract, not by Ethereum's protocol. That unlocks:

- **Custom signatures** (multisig, biometric, ZK, social recovery)
- **Gas sponsorship** (someone else pays gas)
- **Batching** (one user action = many on-chain calls)
- **Session keys** (delegate limited authority to a sub-key)
- **Spending limits** (enforce by code, not trust)

The challenge: doing this without changing Ethereum's consensus rules. ERC-4337 solves this entirely at the application layer.

### The UserOperation

A regular transaction has a fixed shape: `from`, `to`, `value`, `data`, gas params, nonce, signature. ERC-4337 introduces a parallel construct: the **UserOperation**.

```solidity
struct PackedUserOperation {
    address sender;          // the smart account
    uint256 nonce;
    bytes initCode;          // code to deploy the account if it doesn't exist yet
    bytes callData;          // what the account should execute
    bytes32 accountGasLimits; // packed: verification + call gas
    uint256 preVerificationGas;
    bytes32 gasFees;         // packed: maxFee + maxPriorityFee
    bytes paymasterAndData;  // optional paymaster + its data
    bytes signature;         // arbitrary, validated by the account
}
```

A UserOperation is *not* a transaction. It's a signed intent that the user wants something to happen. The actual transaction that executes it is sent by someone else — a bundler.

### The actors

The architecture has four roles, all separable:

```
       ┌─────────┐
       │  User   │ signs UserOps with their custom auth
       └────┬────┘
            │ submits to
            ▼
       ┌─────────────┐         ┌──────────────┐
       │ Alt-mempool │ ◄──────►│  Bundler     │ packages many UserOps
       └─────────────┘         │  (an EOA)    │ into one bundle tx
                               └──────┬───────┘
                                      │ sends tx with handleOps([...])
                                      ▼
                            ┌──────────────────┐
                            │   EntryPoint     │ singleton contract
                            │   (deployed once │
                            │    per chain)    │
                            └────┬─────────────┘
                                 │ for each UserOp:
                                 │   validateUserOp on the account
                                 │   call paymaster (if any)
                                 │   execute callData
                                 ▼
                            ┌──────────────────┐
                            │  Smart Account   │ user's smart wallet contract
                            └──────────────────┘
```

- **User**: produces a signed UserOp.
- **Bundler**: an EOA running specialized software. Picks up UserOps from the alt-mempool, validates them off-chain, and packages a bunch into a single `handleOps` call to the EntryPoint.
- **EntryPoint**: a singleton contract (audited, versioned — currently v0.7 / v0.8 in mid-2026). It enforces the protocol: collects gas from the user (or paymaster), calls the account's `validateUserOp` method, then executes the requested call.
- **Paymaster**: an *optional* contract that can pay gas for the user. It runs `validatePaymasterUserOp` and either approves (eats the cost) or rejects.
- **Smart Account**: the user's actual wallet contract. Implements `validateUserOp(userOp, hash, missingAccountFunds)` to define what a valid signature is.

### How a UserOp executes, step by step

1. **User signs a UserOp**. The signature scheme is whatever the smart account contract requires — could be ECDSA, BLS, a passkey, or anything.
2. **Submit to bundler** via `eth_sendUserOperation` RPC. Bundlers run alt-mempools — separate from Ethereum's regular mempool.
3. **Bundler validates**: simulates the UserOp via `eth_estimateUserOperationGas`-style logic. Critically, ERC-4337 has strict opcode/storage rules during validation to prevent griefing. If the account's `validateUserOp` reads storage outside its own slots, the bundler must reject it.
4. **Bundler packages** N UserOps into a single transaction calling `EntryPoint.handleOps([userOps])`.
5. **EntryPoint, for each UserOp**:
   - If `initCode` is non-empty, deploys the account
   - Calls `account.validateUserOp(userOp, hash, missingFunds)` — account checks signature and pays its prefund (or paymaster does)
   - If paymaster set, calls `paymaster.validatePaymasterUserOp` and `postOp`
   - Calls `account.execute(callData)` to actually run the user's intended action
6. **EntryPoint refunds** any unused gas to the prefunder (account or paymaster).

### Why the alt-mempool exists

You can't just put a UserOp in Ethereum's regular mempool — it's not a valid transaction. So bundlers maintain their own gossip network of pending UserOps. This means UserOp inclusion latency depends on bundler network health, not just Ethereum block time.

In practice in 2026, every major RPC provider (Alchemy, Pimlico, StackUp, Biconomy) offers a bundler endpoint, and the alt-mempool is healthy enough that UserOps land within 1-2 blocks of submission for most chains. But it is a separate piece of infrastructure that can fail independently — and when it fails, your "wallet" stops working in ways regular EOAs don't.

### EntryPoint versions

ERC-4337 has shipped multiple EntryPoint versions:

- **v0.6** (2023) — the original, deployed at `0x5FF137...789`. Mostly deprecated.
- **v0.7** (mid-2024) — introduced packed encodings, separate paymaster verification gas, cleaner APIs. The mainstream version through 2025.
- **v0.8** (late 2025) — adds EIP-7702 integration, simpler signature aggregator interface. Adoption growing in 2026.

Choosing a version matters: bundlers, paymasters, and account implementations are version-specific. You can't mix a v0.6 paymaster with a v0.7 EntryPoint. Most teams pick one and standardize.

---

## Code Walkthrough

The minimum on-chain interface for a smart account, version 0.7:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAccount, PackedUserOperation} from "account-abstraction/interfaces/IAccount.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

contract MinimalSmartAccount is IAccount {
    address public owner;
    IEntryPoint public immutable entryPoint;

    constructor(address _entryPoint, address _owner) {
        entryPoint = IEntryPoint(_entryPoint);
        owner = _owner;
    }

    /// @notice Called by the EntryPoint during handleOps to validate this UserOp
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        require(msg.sender == address(entryPoint), "only EntryPoint");

        // Verify the signature is from `owner` over `userOpHash`
        bytes32 ethSigned = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", userOpHash
        ));
        address recovered = recover(ethSigned, userOp.signature);
        if (recovered != owner) {
            return 1; // SIG_VALIDATION_FAILED
        }

        // Prefund the EntryPoint with the gas it'll need
        if (missingAccountFunds > 0) {
            (bool ok, ) = msg.sender.call{value: missingAccountFunds}("");
            (ok); // ignore failure — EntryPoint will revert if it cares
        }

        return 0; // SIG_VALIDATION_SUCCESS, no time bounds
    }

    /// @notice Called by the EntryPoint to execute the user's intended call
    function execute(address dest, uint256 value, bytes calldata data) external {
        require(msg.sender == address(entryPoint), "only EntryPoint");
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    function recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        // simplified — use OZ ECDSA in production
        require(sig.length == 65);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    receive() external payable {}
}
```

This account does the absolute minimum: ECDSA signature, one owner, single execute. Real implementations (Safe, Kernel, BiconomyV2) layer on multi-sig, modules, recovery, session keys, and more. But the core protocol surface is just `validateUserOp` and `execute` — everything else is your design choice.

Sending a UserOp from the client side using viem's account abstraction extension:

```typescript
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { createBundlerClient, toCoinbaseSmartAccount } from "viem/account-abstraction";

const publicClient = createPublicClient({ chain: sepolia, transport: http() });
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http("https://api.pimlico.io/v2/sepolia/rpc?apikey=KEY"),
});

const account = await toCoinbaseSmartAccount({
  client: publicClient,
  owners: [privateKeyToAccount(PRIVATE_KEY)],
});

const hash = await bundlerClient.sendUserOperation({
  account,
  calls: [
    {
      to: "0x...",
      data: "0x...",
      value: 0n,
    },
  ],
});

const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
```

Three things going on under the hood: account address derivation, UserOp construction with proper gas estimation, and submission to the bundler RPC. viem's account-abstraction module handles all of it.

---

## Common Mistakes and Gotchas

**1. Confusing UserOp hash with transaction hash**
A UserOp has its own hash (computed by the EntryPoint as part of validation). The bundler also produces a transaction hash for the on-chain tx that contains the bundle. These are different. Block explorers show both. When debugging, know which one you're looking at.

**2. Using v0.6 examples with v0.7 contracts**
Tutorials from 2023 show the unpacked UserOperation struct. v0.7 packed several fields into single `bytes32` slots for gas reasons. Decode and encode with version-aware libraries (viem and ethers helpers do this; raw ABI encoders need updating).

**3. Validation-phase opcode restrictions**
During `validateUserOp`, the bundler enforces a list of forbidden opcodes (`TIMESTAMP`, `BLOCKHASH`, etc.) and storage access rules. If your account reads from a global token contract during validation, the bundler will reject your UserOp because it can't safely simulate. Push such logic to the execution phase.

**4. Forgetting to prefund the EntryPoint**
If `missingAccountFunds > 0` and your account doesn't transfer to the EntryPoint, the entire bundle fails. Either send the prefund (as in the example) or use a paymaster.

**5. Not handling `initCode` for first-time deployments**
The first time a user transacts, `initCode` deploys their account. Bundlers charge extra gas for this and some paymasters won't sponsor it. Plan for the first-tx UX being slightly worse.

**6. Treating bundler errors as opaque**
Bundlers return structured errors: AA10 (sender missing), AA13 (initCode failed), AA21 (didn't pay prefund), AA23 (signature failed), AA33 (paymaster failed). Memorize the codes or have a parser — generic "UserOp failed" errors are not actionable.

---

## How This Connects to Production

Every consumer-facing dApp that wants gasless or password-free auth in 2026 is built on this architecture. Smart accounts are now the default for Coinbase Wallet, Argent, Safe (when configured for AA), and most "embedded wallet" providers like Privy and Dynamic. The big shift is happening on the auth side: passkeys (WebAuthn) instead of seed phrases, social logins backed by smart accounts, recovery via guardians.

The big production lesson: **AA is infrastructure**. You depend on a bundler running, a paymaster being funded, an alt-mempool gossiping. When something fails, regular RPC monitoring doesn't show it — you need bundler health metrics, paymaster balance alerts, and a fallback path to plain-EOA flow if the AA layer is degraded. Most teams who skip these monitoring steps learn the hard way during their first incident.

---

## What to Learn Next

- **Building a Smart Account from Scratch with Solidity** — go beyond the minimal example into modular accounts, hooks, and recovery.
- **Paymaster Design: Sponsored Gas, ERC-20 Gas, and Rate Limiting** — the most-used AA feature, and the one with the trickiest economics.
- **Session Keys and Permission Systems** — the AA feature that's actually new, not a UX bandage on top of EOAs.
