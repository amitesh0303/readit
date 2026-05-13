# NEAR Protocol: Architecture and Core Concepts

**Track:** NEAR Protocol Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You've heard NEAR is "the scalable L1" but you don't know what that actually means for you as a developer. Sharding, Nightshade, human-readable accounts, storage staking — these terms get thrown around without explaining how they affect the code you write and the apps you build. This lesson breaks down NEAR's architecture so you understand the runtime model before writing your first contract.

---

## Core Concepts

### Nightshade Sharding

NEAR uses a sharding design called Nightshade. Unlike Ethereum (single chain, sequential execution) or Solana (single chain, parallel execution), NEAR splits the network into multiple shards that process transactions in parallel.

Key points:
- Each shard processes a subset of accounts
- Validators are assigned to shards dynamically
- Cross-shard communication happens asynchronously (1-2 blocks)
- As of 2024, NEAR runs 6 shards with plans to scale further

```
Traditional blockchain:
All txs → Single chain → Sequential processing

NEAR Nightshade:
tx(alice.near) → Shard 0 ─┐
tx(bob.near)   → Shard 1 ─┼→ Combined block (chunk per shard)
tx(carol.near) → Shard 2 ─┘
```

For developers, sharding means cross-contract calls between accounts on different shards are asynchronous. You must design contracts to handle callbacks rather than expecting synchronous return values.

### The Account Model

NEAR's account model is fundamentally different from Ethereum:

| Feature | Ethereum | NEAR |
|---------|----------|------|
| Account ID | 0x... (20-byte hex) | Human-readable (alice.near) |
| Account creation | Implicit (any address exists) | Explicit (must be created) |
| Sub-accounts | Not supported | Supported (app.alice.near) |
| Access keys | One private key per account | Multiple keys with permissions |
| Contract storage | Contract owns storage | Account pays for own storage |

```rust
// NEAR account hierarchy example:
// Top-level account (TLA): alice.near
// Sub-account: app.alice.near
// Sub-sub-account: v2.app.alice.near

// Implicit accounts also exist (64-char hex, like Ethereum):
// 98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de
```

**Sub-accounts** are powerful for organizing deployments:
- `dao.myproject.near` — your DAO contract
- `token.myproject.near` — your token contract
- `nft.myproject.near` — your NFT contract

Each sub-account is a fully independent account that happens to be namespaced under the parent.

### Access Keys: Full-Access vs Function-Call

NEAR accounts can have multiple access keys, each with different permissions:

```json
// Full-access key — can do anything (deploy, transfer, delete)
{
  "access_key": {
    "nonce": 0,
    "permission": "FullAccess"
  },
  "public_key": "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
}

// Function-call key — limited to specific contract methods
{
  "access_key": {
    "nonce": 0,
    "permission": {
      "FunctionCall": {
        "allowance": "250000000000000000000000",
        "receiver_id": "app.myproject.near",
        "method_names": ["submit_score", "claim_reward"]
      }
    }
  },
  "public_key": "ed25519:3FgHkZ2..."
}
```

Function-call keys enable gasless UX — your app can sign transactions on behalf of users for specific methods without requiring wallet popups for every action.

### Storage Staking

On NEAR, accounts pay for their own storage by locking NEAR tokens. This is called "storage staking":

- Cost: 1 NEAR per 100KB of storage used
- Storage is paid by the account that owns the data
- When data is deleted, the locked NEAR is released back

```rust
// Storage cost calculation
// Each key-value pair in contract state costs:
// - Key length + value length + 40 bytes overhead
// - At rate of 10^19 yoctoNEAR per byte (0.00001 NEAR per byte)

// Example: storing a 32-byte account ID as key + 8-byte u64 as value
// (32 + 8 + 40) bytes × 10^19 yoctoNEAR/byte = 8 × 10^20 yoctoNEAR ≈ 0.0008 NEAR
```

This model means contracts must handle storage deposits from users. If a user wants to register with your token contract, they must attach enough NEAR to cover the storage for their balance entry.

### Gas Model

NEAR gas is measured in TGas (teragas = 10^12 gas units):

| Operation | Gas Cost |
|-----------|----------|
| Simple transfer | ~0.45 TGas |
| Function call (basic) | 2-5 TGas |
| Cross-contract call | 5-10 TGas |
| Contract deployment | 10-20 TGas |
| Maximum per transaction | 300 TGas |

```shell
# Current gas price: 0.0001 NEAR per TGas (1 TGas = 10^8 yoctoNEAR)
# A 5 TGas function call costs: 5 × 0.0001 = 0.0005 NEAR (~$0.003)
```

30% of gas fees are burned, 70% go to the contract that was called (developer rewards). This is unique to NEAR — contract developers earn revenue from usage.

---

## Common Pitfalls

1. **Assuming cross-contract calls are synchronous** — On NEAR, calls between contracts on different shards are asynchronous. You must use callbacks (`.then()` pattern in the SDK) to handle results. Forgetting this leads to state inconsistencies where your contract updates state before knowing if the remote call succeeded.

2. **Not handling storage deposits** — Unlike Ethereum where the contract deployer pays for all storage via gas, NEAR requires each account to cover its own storage costs. If your token contract doesn't require a `storage_deposit` before registering a new user, the transaction will panic with `StorageUsageExceeded`.

3. **Using a single full-access key in production** — NEAR supports multiple access keys per account. Deploying a contract with only one full-access key means losing that key loses the contract forever. Production contracts should use a multisig or DAO as the full-access key holder, with function-call keys for routine operations.

4. **Ignoring the 300 TGas transaction limit** — Complex cross-contract call chains can exceed the 300 TGas limit. Unlike Ethereum where you can set arbitrary gas limits, NEAR has a hard cap. Design your contract interactions to minimize call depth, or split operations across multiple transactions.

5. **Confusing NEAR and yoctoNEAR** — 1 NEAR = 10^24 yoctoNEAR. The SDK uses yoctoNEAR (as a string, since it exceeds u64 range). Passing `"1"` when you mean 1 NEAR will send 1 yoctoNEAR (essentially nothing). Always use the `NEAR` constant or parse utilities.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install near-cli-rs, create a testnet account, and configure your local environment
- [NEAR Smart Contracts documentation](https://docs.near.org/build/smart-contracts/what-is) — Official reference for contract development
