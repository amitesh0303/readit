# Development Environment Setup

**Track:** Hedera Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You want to start building on Hedera, but you're not sure which SDK to use (JavaScript or Java), how to get testnet HBAR for development, or how to configure your environment to talk to the Hedera network. Unlike Ethereum where you just point at an RPC URL, Hedera requires explicit account creation, operator credentials, and understanding of the mirror node vs consensus node split.

## Core Concepts

### Hedera SDK Options

Hedera provides official SDKs for multiple languages. The JavaScript SDK is the most common for web3 dApp development:

```javascript
// Install the Hedera JavaScript SDK
// npm install @hashgraph/sdk@2.40.0

const {
    Client,
    AccountId,
    PrivateKey,
    Hbar,
    TransferTransaction,
} = require("@hashgraph/sdk@2.40.0");
```

For Java-based backends:

```java
// Maven dependency
// <dependency>
//     <groupId>com.hedera.hashgraph</groupId>
//     <artifactId>sdk</artifactId>
//     <version>2.40.0</version>
// </dependency>

import com.hedera.hashgraph.sdk.*;
```

### Step 1: Get a Testnet Account

Create a testnet account at the Hedera Portal: https://portal.hedera.com/

The portal gives you:
- An **Account ID** (e.g., `0.0.4515123`)
- A **DER-encoded private key** (Ed25519)
- **10,000 test HBAR** automatically funded

Save these credentials — you'll need them for every SDK interaction.

### Step 2: Project Setup

```shell
# Create a new project
mkdir hedera-app && cd hedera-app
npm init -y

# Install dependencies
npm install @hashgraph/sdk@2.40.0 dotenv@16.3.1

# Create environment file
touch .env
```

Configure your `.env` file with portal credentials:

```shell
# .env — NEVER commit this file
HEDERA_ACCOUNT_ID=0.0.4515123
HEDERA_PRIVATE_KEY=302e020100300506032b657004220420...
HEDERA_NETWORK=testnet
```

### Step 3: Initialize the Client

```javascript
// index.js — Basic Hedera client setup
const { Client, AccountId, PrivateKey, Hbar } = require("@hashgraph/sdk");
require("dotenv").config();

async function main() {
    // Validate environment variables
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = process.env.HEDERA_PRIVATE_KEY;

    if (!accountId || !privateKey) {
        throw new Error(
            "Missing HEDERA_ACCOUNT_ID or HEDERA_PRIVATE_KEY in .env file. " +
            "Get credentials at https://portal.hedera.com/"
        );
    }

    // Create client for testnet
    const client = Client.forTestnet();

    // Set the operator (your account that pays for transactions)
    client.setOperator(
        AccountId.fromString(accountId),
        PrivateKey.fromStringDer(privateKey)
    );

    // Set default max transaction fee (in HBAR)
    client.setDefaultMaxTransactionFee(new Hbar(5));

    // Verify connection by checking account balance
    const balance = await client.getAccountBalance(accountId);
    console.log(`Connected to Hedera testnet`);
    console.log(`Account: ${accountId}`);
    console.log(`Balance: ${balance.hbars.toString()}`);

    client.close();
}

main().catch(console.error);
```

```shell
# Run the script
node index.js
```

```
Expected output:
Connected to Hedera testnet
Account: 0.0.4515123
Balance: 10000 ℏ
```

### Step 4: HashPack Wallet Setup

HashPack is the primary wallet for Hedera (similar to MetaMask for Ethereum):

1. Install HashPack browser extension from https://www.hashpack.app/
2. Create or import a wallet
3. Switch to **Testnet** in wallet settings
4. Import your portal account using the private key

HashPack supports:
- HBAR transfers
- HTS token management
- Smart contract interactions
- dApp connections via HashConnect

### Step 5: Your First Transaction

```javascript
// transfer.js — Send HBAR between accounts
const {
    Client,
    AccountId,
    PrivateKey,
    Hbar,
    TransferTransaction,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function transferHbar() {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = process.env.HEDERA_PRIVATE_KEY;

    if (!accountId || !privateKey) {
        throw new Error("Missing credentials in .env");
    }

    const client = Client.forTestnet();
    client.setOperator(
        AccountId.fromString(accountId),
        PrivateKey.fromStringDer(privateKey)
    );

    // Transfer 1 HBAR to another testnet account
    const recipientId = "0.0.3"; // Treasury account (always exists on testnet)

    const transaction = new TransferTransaction()
        .addHbarTransfer(accountId, new Hbar(-1)) // Debit sender
        .addHbarTransfer(recipientId, new Hbar(1)) // Credit recipient
        .setTransactionMemo("My first Hedera transfer");

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    console.log(`Transfer status: ${receipt.status.toString()}`);
    console.log(`Transaction ID: ${response.transactionId.toString()}`);
    console.log(
        `View on HashScan: https://hashscan.io/testnet/transaction/${response.transactionId.toString()}`
    );

    client.close();
}

transferHbar().catch(console.error);
```

```
Expected output:
Transfer status: SUCCESS
Transaction ID: 0.0.4515123@1705334400.123456789
View on HashScan: https://hashscan.io/testnet/transaction/0.0.4515123@1705334400.123456789
```

### Step 6: Mirror Node Queries

Use the mirror node REST API for reading data (free, no transaction fees):

```javascript
// mirror-query.js — Query account info via mirror node
async function queryMirrorNode(accountId) {
    const baseUrl = "https://testnet.mirrornode.hedera.com";

    // Get account details
    const response = await fetch(`${baseUrl}/api/v1/accounts/${accountId}`);

    if (!response.ok) {
        throw new Error(`Mirror node query failed: ${response.status}`);
    }

    const data = await response.json();

    console.log(`Account: ${data.account}`);
    console.log(`Balance: ${(data.balance.balance / 1e8).toFixed(4)} HBAR`);
    console.log(`Key type: ${data.key.type}`);
    console.log(`Created: ${data.created_timestamp}`);
    console.log(`Memo: ${data.memo || "(none)"}`);
}

queryMirrorNode(process.env.HEDERA_ACCOUNT_ID).catch(console.error);
```

## Common Pitfalls

1. **Using DER-encoded keys incorrectly** — The Hedera portal provides DER-encoded private keys (hex string starting with `302e...`). Use `PrivateKey.fromStringDer()`, not `PrivateKey.fromString()`. Using the wrong method silently creates an invalid key that fails on transaction signing.

2. **Querying consensus nodes for reads** — Every query to a consensus node costs HBAR. Use the mirror node REST API (`testnet.mirrornode.hedera.com`) for reading balances, transaction history, and token info. Reserve consensus node queries for real-time state that must be cryptographically verified.

3. **Forgetting to close the client** — The Hedera SDK maintains gRPC connections. Always call `client.close()` when done, or your Node.js process will hang. In long-running servers, create one client instance and reuse it.

4. **Not setting max transaction fees** — Without `setDefaultMaxTransactionFee()`, the SDK uses a very low default that causes transactions to fail with `INSUFFICIENT_TX_FEE`. Set a reasonable max (e.g., 5 HBAR for testnet) to avoid silent failures.

## What to Learn Next

- [Smart Contracts on Hedera](./03-smart-contracts.md) — Deploy Solidity contracts using the Hedera Smart Contract Service
- [Hedera Portal](https://portal.hedera.com/) — Manage testnet accounts and monitor usage
