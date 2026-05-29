# EIP-7702: Setting Code on EOAs

**Track:** Intermediate → Advanced
**Read time:** 8 min

---

## The Problem

ERC-4337 gave us smart accounts. But they're a different kind of address — a contract wallet, not the EOA the user has been using. Every existing user's `0xAlice` address is an EOA, and to "upgrade" to a smart account they'd have to migrate everything (token balances, NFTs, ENS, social graph, app permissions) to a new address. That's a non-starter.

EIP-7702 (active in mainnet since the Pectra fork in 2025) solves this. It's a new transaction type that lets an EOA *authorize a contract to be its code* for the duration of the transaction. The address stays the same. The user's history stays the same. But for that one transaction (and optionally future ones), the EOA can use smart-account features: batching, sponsorship, custom validation, session keys.

It's the AA upgrade you don't have to migrate for. By 2026 it's everywhere.


---

## Core Concepts

### What 7702 actually does

A new transaction type (`SET_CODE_TX_TYPE`, hex `0x04`) that includes an authorization list:

```
authorizationList: [
  { chainId, address, nonce, signature }
]
```

Each authorization is signed by an EOA and says: "until further notice, set my account's code to point at this contract." When the tx is executed, every authorization in the list temporarily sets that EOA's code field to a delegation pointing at the named contract.

After the tx, the delegation persists (unlike earlier drafts of the EIP that were per-tx only). The EOA now has code. Calling the EOA invokes the delegated contract. The user can still send regular EOA-style transactions (the protocol distinguishes), but they can also be the target of contract calls that would normally only work on a smart account.

To remove the delegation, the user signs another 7702 authorization pointing at `address(0)`.

### Why this is different from a smart contract wallet

A smart contract wallet has its own address; the EOA controlling it is a separate thing.

A 7702-delegated EOA has *one* address that is *both* an EOA and (effectively) a smart contract. You can:

- Call its functions like a contract (`account.execute(...)` works because the delegation provides the code)
- Send it Ether like an EOA (`receive()` from the delegated code handles it, or just bare value transfer)
- Have it sign transactions as an EOA (the underlying private key still works)

The delegation is *additive*. The user gains smart-account capabilities without losing EOA capabilities.


### What you can now do with an EOA

Once an EOA delegates to a smart-account implementation, it gets:

- **Batching**: send multiple calls in one transaction. "Approve and swap" becomes one tx.
- **Gas sponsorship**: a paymaster (or a sponsor in a 7702-aware bundler) pays gas. The user signs the inner action; someone else pays.
- **Session keys**: install scoped, time-limited delegate signers that don't require the main key for every action.
- **Custom validation**: the delegated contract can implement multisig, passkey, or ZK validation.
- **Recovery hooks**: install a recovery validator without changing addresses.

The delegated contract is your choice. Most teams use a Safe-flavored implementation, Kernel, or a minimal account ("simple7702" in viem's account-abstraction extension). You can change implementations later by signing a new authorization.

### The EIP-4337 + 7702 combo

EIP-4337 v0.8 added explicit support for 7702-delegated accounts as UserOp senders. The flow:

1. User's EOA signs a 7702 authorization to delegate to (say) Kernel.
2. The delegation is committed in a regular tx (or bundled with the first UserOp).
3. From now on, the EOA's address can be a UserOp `sender` — bundlers route UserOps to it via the EntryPoint just like a normal smart account.
4. The Kernel-as-delegated-code handles `validateUserOp` and `execute`, just like a Kernel deployed at its own address.

The user has done nothing differently except sign one extra authorization. Their wallet, their address, their balances — all the same. They just gained smart-account features.


---

## Code Walkthrough

Signing a 7702 authorization with viem:

```typescript
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const account = privateKeyToAccount(EOA_PRIVATE_KEY);
const client = createWalletClient({ account, chain: mainnet, transport: http() });

// Authorize delegation to a smart-account implementation
const authorization = await client.signAuthorization({
  account,
  contractAddress: KERNEL_IMPLEMENTATION, // e.g. an audited Kernel deploy
});

// Now send a 7702 transaction that uses this authorization
const hash = await client.sendTransaction({
  authorizationList: [authorization],
  to: account.address, // calling our own EOA, which now has code
  data: encodeFunctionData({
    abi: kernelAbi,
    functionName: "execute",
    args: [target, value, callData],
  }),
});
```

After this tx confirms, the EOA has code. From any other client (bundler, dApp, wallet), `getCode(account.address)` returns the delegation pointer. Subsequent calls to `account.execute(...)` work directly.

Using viem's account-abstraction extension to send a UserOp from a 7702-delegated EOA:

```typescript
import { create7702Account } from "viem/account-abstraction";

const eoa = privateKeyToAccount(PRIVATE_KEY);
const smartAccount = await create7702Account({
  client: publicClient,
  owners: [eoa],
  implementation: KERNEL_IMPLEMENTATION,
});

// On first use, viem includes a 7702 authorization in the UserOp.
// On subsequent uses (delegation already exists), it's just a regular UserOp.
const hash = await bundlerClient.sendUserOperation({
  account: smartAccount,
  calls: [
    { to: tokenA, data: approveCallData, value: 0n },
    { to: router, data: swapCallData, value: 0n },
  ],
});
```

Two calls, one UserOp, one signature, gas sponsored by the bundler's paymaster — using the same address the user has had for years.


---

## Common Mistakes and Gotchas

**1. Authorizing a malicious or buggy implementation**
A 7702 authorization is *full delegation* to a contract. If that contract has a bug — or is outright malicious — your EOA is owned. Only delegate to audited, well-known implementations (Safe, Kernel, OpenZeppelin's reference). Don't delegate to "this random contract from a tutorial."

**2. Authorization replay across chains**
A 7702 authorization is signed for a specific chainId. But there's a special case: chainId of 0 means "any chain." If a user signs an authorization for `chainId: 0` (intended for testing), it can be replayed on every chain, anywhere. Always sign for a specific chainId in production.

**3. Forgetting that delegation persists**
Until the user explicitly delegates to `address(0)`, their EOA has code. Wallets that show the address as "EOA" without checking the code field are misleading users. Always check `getCode` to see if a delegation is active.

**4. Trying to deploy a contract at a 7702-delegated address**
You can't. The address has code. CREATE/CREATE2 to that address fails. (You probably weren't trying to, but worth knowing.)

**5. Sending value to an EOA that's now delegated to a contract without `receive()`**
If the delegated implementation doesn't have a `receive()` or `fallback()`, plain ether transfers to the EOA will revert. The EOA can still *send* but can't *receive* until the delegation is fixed. Most account implementations include `receive()` for this reason.

**6. Mixing nonce semantics**
EOAs have one nonce field shared between regular txs and 7702 authorizations. The nonce in the authorization is *separate from* the EOA's transaction nonce — it's incremented when the auth is consumed. Edge case to know about when building tooling.

**7. Bundlers without 7702 support**
Not every bundler supports 7702 yet. Pre-pectra bundlers reject UserOps from EOAs. Check your bundler provider's compatibility before architecting around 7702.


---

## How This Connects to Production

7702 changed the practical adoption story for AA. Before 7702: "to use AA, your users have to migrate to new addresses." After 7702: "your users sign one authorization and gain AA features on the address they already have." That's a fundamentally easier sell to product teams and to users.

The big production patterns by 2026:

- **Wallets ship with 7702 onboarding** — MetaMask, Rabby, Coinbase Wallet all let users delegate their EOA to a smart-account implementation in a single click. Once delegated, batching and sponsorship "just work" in supporting dApps.
- **dApps detect delegation** — a UI that does "approve + swap" as two transactions when the user is a plain EOA, but as one batched UserOp when the user is delegated. Same UI, smarter under the hood.
- **Sponsored onboarding** — first-time users get a 7702 authorization included in their first UserOp, bundled with whatever action they wanted to do, gas sponsored. Users go from "I need to buy ETH for gas" to "click button" with zero friction.

For builders, the takeaway: design with both EOAs and smart accounts as first-class. 7702 means most users will be both at different times. Don't make assumptions; use `getCode` to check. The authorization mechanism is the bridge that lets every existing user benefit from everything we've covered in this track without leaving their current address behind.

---

## What to Learn Next

This is the last lesson of the AA track. From here:

- **Web3 Frontend Engineering** (separate track) — pair AA on the contract side with viem/wagmi on the client side.
- **The Graph & Subgraph Development** (separate track) — index UserOp activity for analytics and per-user dashboards.
- **Web3 Backend Engineering** (separate track) — your sponsor service, paymaster RPCs, and bundler operations all live here.
