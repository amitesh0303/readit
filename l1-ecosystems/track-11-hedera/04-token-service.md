# Hedera Token Service (HTS)

**Track:** Hedera Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

On Ethereum, creating a token means writing and deploying a Solidity contract (ERC-20 or ERC-721), paying gas for deployment, and managing the contract's security yourself. Every custom token is a new attack surface. Hedera offers a fundamentally different approach: the Hedera Token Service (HTS) lets you create, mint, transfer, and manage tokens as native network operations — no smart contract required. But you need to understand HTS's key-based permission model, compliance features, and how it differs from the ERC standard you're used to.

## Core Concepts

### Why HTS Instead of Smart Contracts?

| Aspect | ERC-20 (Ethereum) | HTS (Hedera) |
|--------|-------------------|--------------|
| Creation | Deploy Solidity contract | SDK transaction |
| Cost to create | $50-500 (gas) | $1.00 (fixed) |
| Transfer cost | $2-20 (gas) | $0.001 (fixed) |
| Security | Your contract code | Network-level |
| Compliance | Custom implementation | Built-in (KYC, freeze, wipe) |
| Speed | 12s block + confirmations | 3-5s finality |

### Creating a Fungible Token

```javascript
// create-token.js — Create a fungible token with HTS
const {
    Client,
    AccountId,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function createFungibleToken() {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY);

    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), privateKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));

    // Create a fungible token
    const tokenTx = new TokenCreateTransaction()
        .setTokenName("My DApp Token")
        .setTokenSymbol("MDT")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(8)
        .setInitialSupply(1000000 * 10 ** 8) // 1M tokens
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(10000000 * 10 ** 8) // 10M max
        .setTreasuryAccountId(AccountId.fromString(accountId))
        // Key permissions
        .setAdminKey(privateKey.publicKey)    // Can update token properties
        .setSupplyKey(privateKey.publicKey)   // Can mint/burn
        .setFreezeKey(privateKey.publicKey)   // Can freeze accounts
        .setWipeKey(privateKey.publicKey)     // Can wipe from accounts
        .setPauseKey(privateKey.publicKey)    // Can pause all transfers
        .setFeeScheduleKey(privateKey.publicKey); // Can update custom fees

    const tokenResponse = await tokenTx.execute(client);
    const tokenReceipt = await tokenResponse.getReceipt(client);
    const tokenId = tokenReceipt.tokenId;

    console.log(`Token created!`);
    console.log(`Token ID: ${tokenId.toString()}`);
    console.log(`EVM Address: ${tokenId.toSolidityAddress()}`);
    console.log(
        `View on HashScan: https://hashscan.io/testnet/token/${tokenId.toString()}`
    );

    client.close();
    return tokenId;
}

createFungibleToken().catch(console.error);
```

```
Expected output:
Token created!
Token ID: 0.0.4823456
EVM Address: 0x0000000000000000000000000000000000498d00
View on HashScan: https://hashscan.io/testnet/token/0.0.4823456
```

### HTS Key Permissions

Each key controls a specific capability. Omitting a key makes that feature permanently disabled:

```javascript
// Key roles explained:
// AdminKey    → Update token properties, delete token
// SupplyKey   → Mint new tokens, burn tokens
// FreezeKey   → Freeze/unfreeze specific accounts
// WipeKey     → Remove tokens from a frozen account
// PauseKey    → Pause ALL transfers globally
// FeeScheduleKey → Update custom fee schedules
// KycKey      → Grant/revoke KYC status for accounts

// IMPORTANT: If you don't set a key, that action is IMPOSSIBLE forever.
// If you set AdminKey to null after creation, the token becomes immutable.
```

### Creating an NFT Collection

```javascript
// create-nft.js — Create an NFT collection with HTS
const {
    Client,
    AccountId,
    PrivateKey,
    TokenCreateTransaction,
    TokenMintTransaction,
    TokenType,
    TokenSupplyType,
    Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function createNFTCollection() {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY);

    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), privateKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));

    // Create NFT collection (supply type must be Finite for NFTs)
    const nftTx = new TokenCreateTransaction()
        .setTokenName("My NFT Collection")
        .setTokenSymbol("MNFT")
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100) // Max 100 NFTs in this collection
        .setTreasuryAccountId(AccountId.fromString(accountId))
        .setAdminKey(privateKey.publicKey)
        .setSupplyKey(privateKey.publicKey);

    const nftResponse = await nftTx.execute(client);
    const nftReceipt = await nftResponse.getReceipt(client);
    const nftTokenId = nftReceipt.tokenId;

    console.log(`NFT Collection created: ${nftTokenId.toString()}`);

    // Mint NFTs (each with unique metadata)
    const mintTx = new TokenMintTransaction()
        .setTokenId(nftTokenId)
        .addMetadata(Buffer.from("ipfs://QmFirst..."))
        .addMetadata(Buffer.from("ipfs://QmSecond..."))
        .addMetadata(Buffer.from("ipfs://QmThird..."));

    const mintResponse = await mintTx.execute(client);
    const mintReceipt = await mintResponse.getReceipt(client);

    console.log(`Minted ${mintReceipt.serials.length} NFTs`);
    console.log(`Serial numbers: ${mintReceipt.serials.map(s => s.toString()).join(", ")}`);

    client.close();
}

createNFTCollection().catch(console.error);
```

```
Expected output:
NFT Collection created: 0.0.4823789
Minted 3 NFTs
Serial numbers: 1, 2, 3
```

### Token Association and Transfer

On Hedera, accounts must explicitly associate with a token before receiving it (prevents spam tokens):

```javascript
// transfer-token.js — Associate and transfer HTS tokens
const {
    Client,
    AccountId,
    PrivateKey,
    TokenAssociateTransaction,
    TransferTransaction,
    Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function transferTokens(tokenId, recipientId, recipientKey) {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY);

    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), privateKey);
    client.setDefaultMaxTransactionFee(new Hbar(5));

    // Step 1: Recipient must associate with the token first
    const associateTx = new TokenAssociateTransaction()
        .setAccountId(recipientId)
        .setTokenIds([tokenId])
        .freezeWith(client);

    // Recipient signs the association
    const signedAssociateTx = await associateTx.sign(recipientKey);
    const associateResponse = await signedAssociateTx.execute(client);
    const associateReceipt = await associateResponse.getReceipt(client);
    console.log(`Association status: ${associateReceipt.status.toString()}`);

    // Step 2: Transfer tokens
    const transferTx = new TransferTransaction()
        .addTokenTransfer(tokenId, accountId, -100 * 10 ** 8) // Send 100 tokens
        .addTokenTransfer(tokenId, recipientId, 100 * 10 ** 8); // Receive 100 tokens

    const transferResponse = await transferTx.execute(client);
    const transferReceipt = await transferResponse.getReceipt(client);
    console.log(`Transfer status: ${transferReceipt.status.toString()}`);

    client.close();
}
```

### Custom Fee Schedules

HTS supports built-in royalty and transfer fees — no smart contract logic needed:

```javascript
// custom-fees.js — Create a token with custom fee schedules
const {
    Client,
    AccountId,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    CustomFixedFee,
    CustomFractionalFee,
    CustomRoyaltyFee,
    Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function createTokenWithFees() {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY);

    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), privateKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));

    // Fixed fee: 1 HBAR per transfer
    const fixedFee = new CustomFixedFee()
        .setHbarAmount(new Hbar(1))
        .setFeeCollectorAccountId(AccountId.fromString(accountId));

    // Fractional fee: 2% of each transfer (for fungible tokens)
    const fractionalFee = new CustomFractionalFee()
        .setNumerator(2)
        .setDenominator(100)
        .setMin(1) // Minimum 1 token unit
        .setMax(1000 * 10 ** 8) // Maximum 1000 tokens
        .setFeeCollectorAccountId(AccountId.fromString(accountId));

    const tokenTx = new TokenCreateTransaction()
        .setTokenName("Fee Token")
        .setTokenSymbol("FEE")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(8)
        .setInitialSupply(1000000 * 10 ** 8)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(AccountId.fromString(accountId))
        .setAdminKey(privateKey.publicKey)
        .setSupplyKey(privateKey.publicKey)
        .setFeeScheduleKey(privateKey.publicKey)
        .setCustomFees([fixedFee, fractionalFee]);

    const response = await tokenTx.execute(client);
    const receipt = await response.getReceipt(client);

    console.log(`Token with custom fees: ${receipt.tokenId.toString()}`);

    client.close();
}

createTokenWithFees().catch(console.error);
```

## Common Pitfalls

1. **Forgetting token association** — Unlike ERC-20 where any address can receive tokens, Hedera requires explicit association. If you transfer to an unassociated account, the transaction fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. Build association into your onboarding flow.

2. **Setting keys you don't need** — Every key you set is a potential attack vector. If your token doesn't need freeze/wipe/pause capabilities, don't set those keys. Once created without a key, that capability is permanently disabled — which is a security feature.

3. **Confusing token decimals with supply** — `setInitialSupply(1000000)` with `setDecimals(8)` creates 0.01 tokens, not 1 million. Always multiply: `1000000 * 10 ** decimals` for the supply you actually want.

4. **Not understanding treasury account role** — The treasury account receives the initial supply and is the default fee collector. It's also the only account that doesn't need to associate with the token. Choose your treasury account carefully — changing it requires the admin key.

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect your dApp to Hedera using HashConnect and the browser SDK
- [HTS Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service) — Full reference for all HTS operations
