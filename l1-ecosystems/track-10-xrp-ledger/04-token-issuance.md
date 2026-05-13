# Token Issuance on XRP Ledger

**Track:** XRP Ledger Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

You want to issue a custom token on XRP Ledger — maybe a stablecoin, a loyalty point, or a tokenized asset. But XRPL doesn't use ERC-20-style smart contracts for tokens. Instead, it uses a trust line model where holders must explicitly opt in to receive your token. You also want to mint NFTs, but XRPL's XLS-20 standard works differently from ERC-721. Without understanding trust lines, issuer accounts, and the rippling mechanism, your tokens won't behave the way you expect.

## Core Concepts

### Trust Lines: The Foundation of XRPL Tokens

On XRPL, tokens (called "issued currencies") require a bilateral relationship between issuer and holder:

```
┌─────────────────────────────────────────────────┐
│           XRPL Trust Line Model                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  Issuer Account ←── Trust Line ──→ Holder       │
│                                                 │
│  • Holder creates trust line (opts in)          │
│  • Issuer sends tokens along the trust line     │
│  • Holder's balance = amount received           │
│  • Issuer's balance = negative (obligation)     │
│  • Trust line has a limit (max holder accepts)  │
│                                                 │
│  Key difference from ERC-20:                    │
│  • No contract deployment needed                │
│  • Holder must opt in BEFORE receiving tokens   │
│  • Each trust line costs 2 XRP owner reserve    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Setting Up a Trust Line

```javascript
// trust-line.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function createTrustLine(holderSeed, issuerAddress, currencyCode, limit) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const holderWallet = xrpl.Wallet.fromSeed(holderSeed);

  // Holder creates a trust line TO the issuer
  const trustSet = {
    TransactionType: "TrustSet",
    Account: holderWallet.address,
    LimitAmount: {
      currency: currencyCode, // 3-char ISO or 40-char hex
      issuer: issuerAddress,
      value: limit, // Maximum amount willing to hold
    },
  };

  const prepared = await client.autofill(trustSet);
  const signed = holderWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult === "tesSUCCESS") {
    console.log(`Trust line created: ${currencyCode} from ${issuerAddress}`);
    console.log(`Limit: ${limit} ${currencyCode}`);
  } else {
    console.error("Trust line failed:", result.result.meta.TransactionResult);
  }

  await client.disconnect();
  return result;
}

// Usage: holder opts in to receive USD from issuer
// createTrustLine("sHolderSeed...", "rIssuerAddress...", "USD", "10000");

module.exports = { createTrustLine };
```

### Issuing Tokens

Once a trust line exists, the issuer sends tokens by making a Payment:

```javascript
// issue-tokens.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function issueTokens(issuerSeed, holderAddress, currencyCode, amount) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const issuerWallet = xrpl.Wallet.fromSeed(issuerSeed);

  // Issuer sends tokens to holder (trust line must exist)
  const payment = {
    TransactionType: "Payment",
    Account: issuerWallet.address,
    Destination: holderAddress,
    Amount: {
      currency: currencyCode,
      issuer: issuerWallet.address,
      value: amount,
    },
  };

  const prepared = await client.autofill(payment);
  const signed = issuerWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult === "tesSUCCESS") {
    console.log(`Issued ${amount} ${currencyCode} to ${holderAddress}`);
  } else {
    console.error("Issuance failed:", result.result.meta.TransactionResult);
  }

  await client.disconnect();
  return result;
}

module.exports = { issueTokens };
```

### Configuring the Issuer Account

Issuer accounts need specific settings for production tokens:

```javascript
// configure-issuer.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function configureIssuerAccount(issuerSeed) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const issuerWallet = xrpl.Wallet.fromSeed(issuerSeed);

  // Set account flags for a proper issuer
  const accountSet = {
    TransactionType: "AccountSet",
    Account: issuerWallet.address,
    // Require destination tags (prevents accidental sends)
    SetFlag: xrpl.AccountSetAsfFlags.asfRequireDest,
  };

  const prepared = await client.autofill(accountSet);
  const signed = issuerWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  console.log("Issuer configured:", result.result.meta.TransactionResult);

  // Enable Default Ripple (allows token holders to trade with each other)
  const enableRippling = {
    TransactionType: "AccountSet",
    Account: issuerWallet.address,
    SetFlag: xrpl.AccountSetAsfFlags.asfDefaultRipple,
  };

  const prepared2 = await client.autofill(enableRippling);
  const signed2 = issuerWallet.sign(prepared2);
  const result2 = await client.submitAndWait(signed2.tx_blob);

  console.log("Default Ripple enabled:", result2.result.meta.TransactionResult);

  await client.disconnect();
}

module.exports = { configureIssuerAccount };
```

### Checking Token Balances

```javascript
// check-balances.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function getTokenBalances(address) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  // Get all trust lines (token balances) for an account
  const response = await client.request({
    command: "account_lines",
    account: address,
    ledger_index: "validated",
  });

  console.log(`\nToken balances for ${address}:`);
  console.log("─".repeat(50));

  response.result.lines.forEach((line) => {
    console.log(`  ${line.currency}: ${line.balance} (issuer: ${line.account})`);
    console.log(`    Limit: ${line.limit} | Peer limit: ${line.limit_peer}`);
  });

  // Also get XRP balance
  const accountInfo = await client.request({
    command: "account_info",
    account: address,
    ledger_index: "validated",
  });

  console.log(
    `  XRP: ${xrpl.dropsToXrp(accountInfo.result.account_data.Balance)}`
  );

  await client.disconnect();
  return response.result.lines;
}

module.exports = { getTokenBalances };
```

### NFTs with XLS-20

XRPL has native NFT support via the XLS-20 standard:

```javascript
// mint-nft.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function mintNFT(minterSeed, uri, transferFee) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const minterWallet = xrpl.Wallet.fromSeed(minterSeed);

  // Mint an NFT
  const mintTx = {
    TransactionType: "NFTokenMint",
    Account: minterWallet.address,
    URI: xrpl.convertStringToHex(uri), // Metadata URI (IPFS, HTTP, etc.)
    Flags: 8, // tfTransferable — allows secondary sales
    TransferFee: transferFee, // Royalty in basis points (e.g., 500 = 5%)
    NFTokenTaxon: 0, // Collection grouping identifier
  };

  const prepared = await client.autofill(mintTx);
  const signed = minterWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult === "tesSUCCESS") {
    // Extract the NFT ID from transaction metadata
    const nfts = result.result.meta.AffectedNodes.filter(
      (node) => node.CreatedNode && node.CreatedNode.LedgerEntryType === "NFTokenPage"
    );
    console.log("NFT minted successfully!");
    console.log("Transaction:", signed.hash);
  } else {
    console.error("Mint failed:", result.result.meta.TransactionResult);
  }

  await client.disconnect();
  return result;
}

// Create a sell offer for the NFT
async function createSellOffer(ownerSeed, nftId, priceDrops) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const ownerWallet = xrpl.Wallet.fromSeed(ownerSeed);

  const offerTx = {
    TransactionType: "NFTokenCreateOffer",
    Account: ownerWallet.address,
    NFTokenID: nftId,
    Amount: priceDrops, // Price in drops (XRP)
    Flags: 1, // tfSellNFToken
  };

  const prepared = await client.autofill(offerTx);
  const signed = ownerWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  console.log("Sell offer created:", result.result.meta.TransactionResult);

  await client.disconnect();
  return result;
}

module.exports = { mintNFT, createSellOffer };
```

### Querying NFTs on an Account

```javascript
// list-nfts.js — xrpl.js@3.0.0
const xrpl = require("xrpl");

async function listAccountNFTs(address) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const response = await client.request({
    command: "account_nfts",
    account: address,
    ledger_index: "validated",
  });

  console.log(`\nNFTs owned by ${address}:`);
  response.result.account_nfts.forEach((nft, i) => {
    const uri = nft.URI ? Buffer.from(nft.URI, "hex").toString("utf8") : "No URI";
    console.log(`  ${i + 1}. ID: ${nft.NFTokenID}`);
    console.log(`     URI: ${uri}`);
    console.log(`     Taxon: ${nft.NFTokenTaxon}`);
    console.log(`     Transfer Fee: ${nft.TransferFee / 100}%`);
  });

  await client.disconnect();
  return response.result.account_nfts;
}

module.exports = { listAccountNFTs };
```

## Common Pitfalls

1. **Issuing tokens without Default Ripple enabled** — If the issuer account doesn't have the `DefaultRipple` flag set, token holders cannot trade tokens with each other through the DEX. The tokens become non-transferable between third parties.

2. **Using 3-character currency codes incorrectly** — Standard currency codes (USD, EUR, BTC) are 3 ASCII characters. For custom tokens with longer names, you must use the 40-character hex format. Mixing these up causes "currency not found" errors.

3. **Forgetting trust line reserves** — Each trust line costs 2 XRP in owner reserve. If you airdrop tokens to 1000 users, each user needs 2 XRP locked just to hold your token. This is a real barrier to adoption for low-value tokens.

4. **Not setting TransferFee on NFTs at mint time** — The royalty percentage (`TransferFee`) is set permanently at mint time. You cannot change it later. If you forget to set it, you get 0% royalties on all secondary sales forever.

5. **Confusing NFTokenTaxon with collection ID** — The taxon groups NFTs for organizational purposes but doesn't enforce collection-level rules. Two NFTs with the same taxon aren't automatically in the same "collection" from a marketplace perspective.

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect XRPL to a browser app with xrpl.js and Xumm wallet
- [XRPL Token Standards](https://xrpl.org/issued-currencies-overview.html) — Official documentation on issued currencies
- [XLS-20 NFT Reference](https://xrpl.org/non-fungible-tokens.html) — Complete NFT API documentation
