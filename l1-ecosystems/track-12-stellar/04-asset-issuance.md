# Asset Issuance on Stellar

**Track:** Stellar Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You need to issue a custom token — a stablecoin, loyalty point, or tokenized asset — but deploying an ERC-20 contract feels like overkill for what's essentially a ledger entry. Stellar has built-in asset issuance that doesn't require smart contracts, but the trust line model is unfamiliar if you come from EVM chains. You need to understand issuer accounts, trust lines, authorization flags, and anchors before you can safely issue and manage assets on Stellar.

## Core Concepts

### Stellar Classic Assets vs Smart Contract Tokens

On Ethereum, every token requires a deployed contract. On Stellar, assets are a native primitive:

```
┌─────────────────────────────────────────────────┐
│  Stellar Asset Model                            │
├─────────────────────────────────────────────────┤
│                                                 │
│  Asset = (Code, Issuer)                         │
│  • Code: 1-12 alphanumeric characters           │
│  • Issuer: G... public key of issuing account   │
│  • Same code + different issuer = different asset│
│                                                 │
│  Trust Line = Permission to hold an asset       │
│  • Receiver must opt-in before receiving        │
│  • Prevents spam tokens in your wallet          │
│  • Has a configurable limit                     │
│                                                 │
│  No contract deployment needed!                 │
│  No gas for token transfers (just base fee)     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Step 1: Create Issuer and Distribution Accounts

Best practice separates the issuing account from the distribution account:

```javascript
// issue-asset.mjs
// @stellar/stellar-sdk@11.0.0
import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE
} from '@stellar/stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Generate keypairs for issuer and distributor
const issuerKeypair = Keypair.random();
const distributorKeypair = Keypair.random();

console.log('Issuer Public:', issuerKeypair.publicKey());
console.log('Distributor Public:', distributorKeypair.publicKey());

// Fund both accounts via Friendbot
// https://friendbot.stellar.org/?addr={ADDRESS}
async function fundAccount(publicKey) {
  const response = await fetch(
    `https://friendbot.stellar.org/?addr=${publicKey}`
  );
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.statusText}`);
  }
  return response.json();
}

await fundAccount(issuerKeypair.publicKey());
await fundAccount(distributorKeypair.publicKey());
console.log('Both accounts funded on testnet');
```

### Step 2: Create Trust Line (Distributor Opts In)

The distributor must trust the issuer before receiving tokens:

```javascript
// @stellar/stellar-sdk@11.0.0
// Define the custom asset
const myToken = new Asset('READIT', issuerKeypair.publicKey());

// Load distributor account for sequence number
const distributorAccount = await server.loadAccount(distributorKeypair.publicKey());

// Build trust line transaction
const trustTx = new TransactionBuilder(distributorAccount, {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.changeTrust({
      asset: myToken,
      limit: '1000000', // Maximum tokens this account will hold
    })
  )
  .setTimeout(30)
  .build();

// Sign with distributor's key (they're opting in)
trustTx.sign(distributorKeypair);

// Submit
const trustResult = await server.submitTransaction(trustTx);
console.log('Trust line created:', trustResult.hash);
```

### Step 3: Issue Tokens (Issuer Sends to Distributor)

Tokens are created by the issuer sending a payment. The act of sending creates supply:

```javascript
// @stellar/stellar-sdk@11.0.0
// Load issuer account
const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());

// Issue 1,000,000 READIT tokens to distributor
const issueTx = new TransactionBuilder(issuerAccount, {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination: distributorKeypair.publicKey(),
      asset: myToken,
      amount: '1000000',
    })
  )
  .setTimeout(30)
  .build();

// Sign with issuer's key
issueTx.sign(issuerKeypair);

const issueResult = await server.submitTransaction(issueTx);
console.log('Tokens issued:', issueResult.hash);

// Verify distributor balance
const updatedDistributor = await server.loadAccount(distributorKeypair.publicKey());
const tokenBalance = updatedDistributor.balances.find(
  (b) => b.asset_code === 'READIT' && b.asset_issuer === issuerKeypair.publicKey()
);
console.log('Distributor READIT balance:', tokenBalance.balance);
// Expected: 1000000.0000000
```

### Step 4: Lock the Issuer (Fixed Supply)

To guarantee fixed supply, lock the issuer account so no more tokens can ever be created:

```javascript
// @stellar/stellar-sdk@11.0.0
// WARNING: This is irreversible! The issuer can never issue more tokens.
const lockTx = new TransactionBuilder(issuerAccount, {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.setOptions({
      masterWeight: 0, // Remove signing ability
      lowThreshold: 1,
      medThreshold: 1,
      highThreshold: 1,
    })
  )
  .setTimeout(30)
  .build();

lockTx.sign(issuerKeypair);

const lockResult = await server.submitTransaction(lockTx);
console.log('Issuer locked — supply is now fixed:', lockResult.hash);
```

### Authorization Flags

Issuers can control who holds their asset using authorization flags:

```javascript
// @stellar/stellar-sdk@11.0.0
// Set authorization flags on the issuer account BEFORE issuing
const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());

const flagsTx = new TransactionBuilder(issuerAccount, {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.setOptions({
      setFlags:
        // AUTH_REQUIRED: accounts need issuer approval to hold asset
        1 |
        // AUTH_REVOCABLE: issuer can freeze accounts
        2 |
        // AUTH_CLAWBACK_ENABLED: issuer can claw back tokens
        8,
    })
  )
  .setTimeout(30)
  .build();

flagsTx.sign(issuerKeypair);
await server.submitTransaction(flagsTx);
console.log('Authorization flags set');
```

| Flag | Value | Effect |
|------|-------|--------|
| AUTH_REQUIRED | 1 | Accounts must be approved before holding asset |
| AUTH_REVOCABLE | 2 | Issuer can freeze/unfreeze accounts |
| AUTH_IMMUTABLE | 4 | Flags can never be changed (lock forever) |
| AUTH_CLAWBACK_ENABLED | 8 | Issuer can claw back tokens from holders |

### Anchors: Bridging Real-World Assets

An anchor is an entity that issues Stellar assets backed by real-world value (fiat, commodities, etc.):

```
┌─────────────────────────────────────────────────┐
│  Anchor Model                                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  User deposits $100 USD to Anchor's bank        │
│       ↓                                         │
│  Anchor issues 100 USDC to user's Stellar addr  │
│       ↓                                         │
│  User trades/sends USDC on Stellar network      │
│       ↓                                         │
│  User redeems: sends USDC back to Anchor        │
│       ↓                                         │
│  Anchor burns USDC, wires $100 to user's bank   │
│                                                 │
│  SEP-24: Interactive deposit/withdrawal         │
│  SEP-31: Cross-border payments                  │
│  SEP-6: Programmatic deposit/withdrawal         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Querying Assets on the Network

```javascript
// @stellar/stellar-sdk@11.0.0
import { Horizon } from '@stellar/stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Find all assets with code "USDC"
const assets = await server.assets()
  .forCode('USDC')
  .call();

for (const record of assets.records) {
  console.log(`USDC issued by: ${record.asset_issuer}`);
  console.log(`  Accounts: ${record.num_accounts}`);
  console.log(`  Amount: ${record.amount}`);
  console.log(`  Flags:`, record.flags);
}

// Check trust lines for a specific account
const account = await server.loadAccount('GABC...XYZ');
for (const balance of account.balances) {
  if (balance.asset_type !== 'native') {
    console.log(`${balance.asset_code} (${balance.asset_issuer.slice(0, 8)}...): ${balance.balance}`);
    console.log(`  Limit: ${balance.limit}`);
    console.log(`  Authorized: ${balance.is_authorized}`);
  }
}
```

## Common Pitfalls

1. **Sending tokens before trust line exists** — If the receiver hasn't created a trust line for your asset, the payment operation fails with `NO_TRUST`. Always verify the trust line exists before sending, or use `claimable balances` for recipients who haven't opted in yet.

2. **Using the issuer account for distribution** — If the issuer account is compromised, an attacker can mint unlimited tokens. Always use a separate distribution account. The issuer should only send tokens to the distributor, then be locked.

3. **Setting AUTH_IMMUTABLE too early** — Once AUTH_IMMUTABLE is set, you can never change authorization flags again. If you later need to freeze accounts or enable clawback for compliance, you're locked out. Only set AUTH_IMMUTABLE when you're absolutely certain about your flag configuration.

4. **Forgetting the 0.5 XLM reserve per trust line** — Each trust line a user creates increases their minimum balance by 0.5 XLM. If users create trust lines for many assets, they lock up significant XLM. Consider this UX cost when designing multi-asset systems.

5. **Not handling asset code collisions** — Asset codes are not unique globally — only the (code, issuer) pair is unique. Anyone can issue a token called "USDC". Always verify the issuer address matches the expected entity, not just the asset code.

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect Freighter wallet and build a dApp that interacts with Stellar assets
- [Stellar SEP Standards](https://developers.stellar.org/docs/fundamentals/stellar-ecosystem-proposals) — Interoperability protocols for anchors, federation, and cross-border payments
