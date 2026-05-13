# Frontend Integration with Stellar SDK and Freighter Wallet

**Track:** Stellar Development
**Level:** Beginner → Intermediate
**Read time:** 12 min

---

## The Problem

You've deployed Soroban contracts and issued assets on Stellar. Now you need to build a frontend that lets users connect their wallet, send payments, interact with your contracts, and manage their Stellar assets. The Stellar ecosystem uses the JavaScript SDK for direct network interaction and Freighter for browser wallet signing.

---

## Setup

```bash
npm install @stellar/stellar-sdk@^12.0.0
npm install @stellar/freighter-api@^2.0.0
```

---

## Connecting Freighter Wallet

[Freighter](https://www.freighter.app) is the primary browser extension wallet for Stellar:

```typescript
import {
  isConnected,
  isAllowed,
  requestAccess,
  getPublicKey,
  signTransaction,
  getNetwork,
} from "@stellar/freighter-api";

// Check if Freighter is installed
async function checkFreighter(): Promise<boolean> {
  const connected = await isConnected();
  return connected.isConnected;
}

// Connect and get the user's public key
async function connectWallet(): Promise<string> {
  const installed = await checkFreighter();
  if (!installed) {
    throw new Error("Freighter wallet not installed. Visit https://www.freighter.app");
  }

  // Request access if not already granted
  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    const access = await requestAccess();
    if (access.error) throw new Error(access.error);
  }

  const { publicKey, error } = await getPublicKey();
  if (error) throw new Error(error);

  console.log("Connected:", publicKey);
  return publicKey;
}

// Get the current network
async function getWalletNetwork(): Promise<string> {
  const { network } = await getNetwork();
  return network; // "TESTNET" or "PUBLIC"
}
```

---

## Querying Account Data

```typescript
import { Horizon, Networks } from "@stellar/stellar-sdk";

// Connect to Horizon (Stellar's REST API)
const server = new Horizon.Server("https://horizon-testnet.stellar.org");
// Mainnet: new Horizon.Server("https://horizon.stellar.org")

// Get account balances
async function getBalances(publicKey: string) {
  const account = await server.loadAccount(publicKey);

  return account.balances.map((balance) => {
    if (balance.asset_type === "native") {
      return { asset: "XLM", balance: balance.balance };
    } else {
      return {
        asset: `${balance.asset_code}:${balance.asset_issuer}`,
        balance: balance.balance,
        limit: balance.limit,
      };
    }
  });
}

// Get transaction history
async function getTransactions(publicKey: string, limit = 10) {
  const transactions = await server
    .transactions()
    .forAccount(publicKey)
    .limit(limit)
    .order("desc")
    .call();

  return transactions.records.map((tx) => ({
    id: tx.id,
    hash: tx.hash,
    createdAt: tx.created_at,
    successful: tx.successful,
    feeCharged: tx.fee_charged,
  }));
}
```

---

## Sending XLM Payments

```typescript
import {
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
} from "@stellar/stellar-sdk";

async function sendXLM(
  senderPublicKey: string,
  destination: string,
  amount: string,
  memo?: string
) {
  // Load sender account (needed for sequence number)
  const sourceAccount = await server.loadAccount(senderPublicKey);

  // Build the transaction
  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(), // XLM
        amount,
      })
    )
    .setTimeout(30); // 30 second timeout

  if (memo) {
    txBuilder.addMemo(Memo.text(memo));
  }

  const transaction = txBuilder.build();

  // Sign with Freighter
  const { signedTxXdr, error } = await signTransaction(
    transaction.toXDR(),
    { networkPassphrase: Networks.TESTNET }
  );
  if (error) throw new Error(error);

  // Submit to network
  const result = await server.submitTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );

  console.log("Payment sent:", result.hash);
  return result.hash;
}
```

---

## Sending Custom Assets

```typescript
async function sendAsset(
  senderPublicKey: string,
  destination: string,
  assetCode: string,
  assetIssuer: string,
  amount: string
) {
  const sourceAccount = await server.loadAccount(senderPublicKey);
  const asset = new Asset(assetCode, assetIssuer);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      })
    )
    .setTimeout(30)
    .build();

  const { signedTxXdr, error } = await signTransaction(
    transaction.toXDR(),
    { networkPassphrase: Networks.TESTNET }
  );
  if (error) throw new Error(error);

  const result = await server.submitTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );
  return result.hash;
}

// Create a trust line for an asset
async function createTrustLine(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
  limit?: string
) {
  const account = await server.loadAccount(publicKey);
  const asset = new Asset(assetCode, assetIssuer);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit, // undefined = max limit
      })
    )
    .setTimeout(30)
    .build();

  const { signedTxXdr, error } = await signTransaction(
    transaction.toXDR(),
    { networkPassphrase: Networks.TESTNET }
  );
  if (error) throw new Error(error);

  const result = await server.submitTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );
  return result.hash;
}
```

---

## Calling Soroban Smart Contracts

```typescript
import {
  SorobanRpc,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

// Soroban RPC server
const sorobanServer = new SorobanRpc.Server(
  "https://soroban-testnet.stellar.org"
);

// Call a read-only contract function (simulation only)
async function callContractReadOnly(
  contractId: string,
  method: string,
  args: xdr.ScVal[]
) {
  const contract = new Contract(contractId);

  const account = await sorobanServer.getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await sorobanServer.simulateTransaction(transaction);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Extract the return value
  const returnVal = simResult.result?.retval;
  return returnVal ? scValToNative(returnVal) : null;
}

// Call a state-changing contract function
async function callContract(
  callerPublicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
) {
  const contract = new Contract(contractId);
  const account = await sorobanServer.getAccount(callerPublicKey);

  // Build the transaction
  let transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get the resource fee
  const simResult = await sorobanServer.simulateTransaction(transaction);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Assemble the transaction with the simulation result (adds resource fee)
  transaction = SorobanRpc.assembleTransaction(transaction, simResult).build();

  // Sign with Freighter
  const { signedTxXdr, error } = await signTransaction(
    transaction.toXDR(),
    { networkPassphrase: Networks.TESTNET }
  );
  if (error) throw new Error(error);

  // Submit
  const sendResult = await sorobanServer.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );

  if (sendResult.status === "ERROR") {
    throw new Error(`Submit failed: ${sendResult.errorResult}`);
  }

  // Poll for confirmation
  let getResult = await sorobanServer.getTransaction(sendResult.hash);
  while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    getResult = await sorobanServer.getTransaction(sendResult.hash);
  }

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    return getResult.returnValue ? scValToNative(getResult.returnValue) : null;
  } else {
    throw new Error(`Transaction failed: ${getResult.resultXdr}`);
  }
}

// Example: call a counter contract
async function incrementCounter(publicKey: string, contractId: string) {
  const result = await callContract(publicKey, contractId, "increment", []);
  console.log("New counter value:", result);
  return result;
}
```

---

## Streaming Events

```typescript
// Stream payments to an account in real-time
function streamPayments(publicKey: string) {
  const closeStream = server
    .payments()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: (payment) => {
        if (payment.type === "payment") {
          const amount = payment.amount;
          const asset =
            payment.asset_type === "native"
              ? "XLM"
              : `${payment.asset_code}:${payment.asset_issuer}`;
          console.log(`Received ${amount} ${asset}`);
        }
      },
      onerror: (error) => {
        console.error("Stream error:", error);
      },
    });

  // Call closeStream() to stop listening
  return closeStream;
}
```

---

## Common Pitfalls

1. **Missing trust lines** — Before sending a custom asset to an account, that account must have a trust line for the asset. Check `account.balances` for existing trust lines before sending.

2. **Sequence number conflicts** — Each transaction must use the next sequence number. If you submit multiple transactions quickly, load the account fresh before each one or manage sequence numbers manually.

3. **Not handling simulation before submission** — Always simulate Soroban transactions before submitting. Simulation reveals the resource fee and any errors without spending real fees.

4. **Freighter network mismatch** — If the user's Freighter is set to mainnet but your app targets testnet, signing will fail. Always check `getNetwork()` and prompt the user to switch if needed.

5. **Transaction timeout** — Stellar transactions expire. Set `setTimeout(30)` for interactive transactions. For automated systems, use a longer timeout but not too long — expired transactions can cause issues if resubmitted.

---

## What to Learn Next

You've completed the Stellar Development track. Next steps:
- Explore [Stellar Quest](https://quest.stellar.org) for hands-on challenges
- Read the [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts) for advanced contract patterns
- Join the [Stellar Developer Discord](https://discord.gg/stellardev) for community support
