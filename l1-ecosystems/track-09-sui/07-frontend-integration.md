# Frontend Integration with Sui

**Track:** Sui Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've published a Sui Move package to testnet, but users can't interact with it through a terminal. You need a web frontend that connects to Sui wallets, reads on-chain object state, and submits transactions. Sui's TypeScript SDK (`@mysten/sui.js`) and wallet adapter kit work differently from ethers.js or web3.js — there's no ABI, no contract instance pattern, and transactions are built as Programmable Transaction Blocks. Without understanding these patterns, your dApp won't connect to wallets or display object data correctly.

## Core Concepts

### Installing the SDK

```shell
# Install Sui TypeScript SDK and wallet kit — @mysten/sui.js@0.50.0
npm install @mysten/sui.js@0.50.0 @mysten/wallet-kit@0.8.0

# For React apps, also install the dApp kit
npm install @mysten/dapp-kit@0.12.0 @tanstack/react-query@5.17.0
```

### Connecting to the Network

```typescript
// src/sui-client.ts
// @mysten/sui.js@0.50.0
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';

// Create a client for testnet
const client = new SuiClient({
  url: getFullnodeUrl('testnet'),
  // Or use explicit URL: 'https://fullnode.testnet.sui.io:443'
});

// Verify connection
async function checkConnection(): Promise<void> {
  try {
    const chainId = await client.getChainIdentifier();
    console.log('Connected to chain:', chainId);

    const latestCheckpoint = await client.getLatestCheckpointSequenceNumber();
    console.log('Latest checkpoint:', latestCheckpoint);
  } catch (error) {
    console.error('Failed to connect to Sui network:', error);
    throw error;
  }
}

export { client };
```

### Reading Object State

On Sui, you query objects by their ID — not by contract address + storage slot:

```typescript
// src/read-objects.ts
// @mysten/sui.js@0.50.0
import { SuiClient } from '@mysten/sui.js/client';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

// Fetch a single object by ID
async function getObject(objectId: string) {
  const object = await client.getObject({
    id: objectId,
    options: {
      showContent: true,   // Include parsed Move struct fields
      showOwner: true,     // Show who owns it
      showType: true,      // Show the Move type
    },
  });

  if (object.error) {
    throw new Error(`Object not found: ${object.error.code}`);
  }

  console.log('Type:', object.data?.type);
  console.log('Owner:', object.data?.owner);
  console.log('Content:', object.data?.content);

  return object.data;
}

// Fetch all objects owned by an address
async function getOwnedObjects(address: string) {
  const objects = await client.getOwnedObjects({
    owner: address,
    options: { showContent: true, showType: true },
    // Filter by type if you only want specific objects
    filter: {
      StructType: '0x<package_id>::todo_list::TodoList',
    },
  });

  console.log(`Found ${objects.data.length} TodoList objects`);
  return objects.data;
}

// Query objects by type across all owners
async function queryByType(packageId: string) {
  const objects = await client.queryEvents({
    query: {
      MoveEventType: `${packageId}::todo_list::TodoCreated`,
    },
    limit: 50,
    order: 'descending',
  });

  return objects.data;
}

export { getObject, getOwnedObjects, queryByType };
```

### Wallet Connection with dApp Kit (React)

```typescript
// src/App.tsx
// @mysten/dapp-kit@0.12.0, @tanstack/react-query@5.17.0
import React from 'react';
import {
  SuiClientProvider,
  WalletProvider,
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransactionBlock,
  useSuiClient,
} from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();
const networks = {
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider>
          <div className="app">
            <h1>Sui Todo dApp</h1>
            <ConnectButton />
            <TodoApp />
          </div>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

function TodoApp() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransactionBlock();

  if (!account) {
    return <p>Connect your wallet to continue.</p>;
  }

  const PACKAGE_ID = '0x<your_package_id>';

  // Create a new todo list
  async function createTodoList() {
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGE_ID}::todo_list::create`,
    });

    signAndExecute(
      { transactionBlock: tx, options: { showEffects: true } },
      {
        onSuccess: (result) => {
          console.log('Created todo list:', result.digest);
          // Extract created object ID from effects
          const created = result.effects?.created;
          if (created && created.length > 0) {
            console.log('TodoList ID:', created[0].reference.objectId);
          }
        },
        onError: (error) => {
          console.error('Transaction failed:', error);
        },
      },
    );
  }

  // Add an item to an existing todo list
  async function addItem(listId: string, item: string) {
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGE_ID}::todo_list::add_item`,
      arguments: [
        tx.object(listId),           // The TodoList object
        tx.pure(item, 'string'),     // The item text
      ],
    });

    signAndExecute(
      { transactionBlock: tx, options: { showEffects: true, showEvents: true } },
      {
        onSuccess: (result) => {
          console.log('Item added:', result.digest);
          // Check events for confirmation
          const events = result.events;
          if (events) {
            console.log('Events:', events);
          }
        },
        onError: (error) => {
          console.error('Failed to add item:', error);
        },
      },
    );
  }

  // Remove an item by index
  async function removeItem(listId: string, index: number) {
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGE_ID}::todo_list::remove_item`,
      arguments: [
        tx.object(listId),
        tx.pure(index, 'u64'),
      ],
    });

    signAndExecute(
      { transactionBlock: tx, options: { showEffects: true } },
      {
        onSuccess: (result) => {
          console.log('Item removed:', result.digest);
        },
        onError: (error) => {
          console.error('Failed to remove item:', error);
        },
      },
    );
  }

  return (
    <div>
      <p>Connected: {account.address}</p>
      <button onClick={createTodoList}>Create Todo List</button>
      {/* Add UI for listing and managing items */}
    </div>
  );
}

export default App;
```

### Subscribing to Events

```typescript
// src/events.ts
// @mysten/sui.js@0.50.0
import { SuiClient } from '@mysten/sui.js/client';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

const PACKAGE_ID = '0x<your_package_id>';

// Subscribe to real-time events (WebSocket)
async function subscribeToEvents() {
  const unsubscribe = await client.subscribeEvent({
    filter: {
      MoveEventType: `${PACKAGE_ID}::todo_list::ItemAdded`,
    },
    onMessage: (event) => {
      console.log('New item added:', event.parsedJson);
      // event.parsedJson contains: { list_id, item, position }
    },
  });

  // Call unsubscribe() to stop listening
  return unsubscribe;
}

// Query historical events (REST)
async function getRecentEvents() {
  const events = await client.queryEvents({
    query: {
      MoveEventType: `${PACKAGE_ID}::todo_list::TodoCreated`,
    },
    limit: 25,
    order: 'descending',
  });

  for (const event of events.data) {
    const data = event.parsedJson as { list_id: string; owner: string };
    console.log(`List ${data.list_id} created by ${data.owner}`);
  }

  return events;
}

export { subscribeToEvents, getRecentEvents };
```

### Building PTBs for Complex Operations

```typescript
// src/complex-transaction.ts
// @mysten/sui.js@0.50.0
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient } from '@mysten/sui.js/client';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

const PACKAGE_ID = '0x<your_package_id>';

/**
 * Compose multiple operations in a single atomic transaction:
 * 1. Create a todo list
 * 2. Add three items to it
 * 3. Transfer a tip to the developer
 *
 * All steps succeed or all fail — no partial state.
 */
async function createAndPopulateList(
  signer: any, // Ed25519Keypair or wallet signer
  items: string[],
  devAddress: string,
) {
  const tx = new TransactionBlock();

  // Step 1: Create the list (returns the created object)
  const [list] = tx.moveCall({
    target: `${PACKAGE_ID}::todo_list::create`,
  });

  // Step 2: Add each item
  for (const item of items) {
    tx.moveCall({
      target: `${PACKAGE_ID}::todo_list::add_item`,
      arguments: [
        list,                        // Reference the object from step 1
        tx.pure(item, 'string'),
      ],
    });
  }

  // Step 3: Split 0.1 SUI as a tip and transfer to developer
  const [tip] = tx.splitCoins(tx.gas, [100_000_000]); // 0.1 SUI
  tx.transferObjects([tip], devAddress);

  // Execute the entire PTB atomically
  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  if (result.effects?.status.status !== 'success') {
    throw new Error(`Transaction failed: ${result.effects?.status.error}`);
  }

  console.log('Transaction digest:', result.digest);
  console.log('Gas used:', result.effects?.gasUsed);

  return result;
}

export { createAndPopulateList };
```

### Deploying the Frontend

```shell
# Create a React app with Vite
npm create vite@latest sui-todo-app -- --template react-ts
cd sui-todo-app

# Install Sui dependencies — @mysten/sui.js@0.50.0
npm install @mysten/sui.js@0.50.0 @mysten/dapp-kit@0.12.0 @tanstack/react-query@5.17.0

# Start development server
npm run dev
```

```
Expected output:
  VITE v5.x.x  ready in 300 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Faucet for testnet SUI: https://docs.sui.io/guides/developer/getting-started/get-coins

## Common Pitfalls

1. **Using wrong object ID format** — Sui object IDs are 32-byte hex strings prefixed with `0x`. If you pass a truncated ID or forget the prefix, the RPC call will fail with "invalid object ID." Always copy the full ID from explorer or CLI output.

2. **Not handling the `showContent` option** — By default, `getObject` returns minimal data. If you need the Move struct fields, you must pass `options: { showContent: true }`. Without it, `object.data.content` is undefined.

3. **Forgetting to wrap primitives with `tx.pure()`** — In PTBs, raw values must be wrapped: `tx.pure(42, 'u64')`, `tx.pure("hello", 'string')`. Passing raw JavaScript values directly causes type errors at runtime.

4. **Not checking transaction status** — `signAndExecuteTransactionBlock` resolves even if the transaction fails on-chain. Always check `result.effects?.status.status === 'success'` before assuming the operation worked.

5. **Mixing up `tx.object()` and PTB results** — When a `moveCall` returns an object, you reference it directly (e.g., `const [obj] = tx.moveCall(...)`). For existing on-chain objects, use `tx.object('0x...')`. Confusing these causes "invalid argument" errors.

## What to Learn Next

- [Sui dApp Kit Documentation](https://sdk.mystenlabs.com/dapp-kit) — Official React integration guide
- [@mysten/sui.js Reference](https://sdk.mystenlabs.com/typescript) — Complete TypeScript SDK docs
- [Sui Explorer](https://suiscan.xyz/testnet) — View transactions and objects on testnet
- [Sui Move Overview](./01-sui-overview.md) — Review the object model fundamentals
