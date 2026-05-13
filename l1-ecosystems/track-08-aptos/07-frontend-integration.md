# Frontend Integration: Aptos TypeScript SDK and Petra Wallet

**Track:** Aptos Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

Your Move modules are deployed to testnet but you need a web frontend for users to interact with them. The Aptos ecosystem uses the `@aptos-labs/ts-sdk` for blockchain interactions and the Petra wallet for transaction signing. This lesson shows you how to connect a frontend to your deployed modules, read on-chain state, and submit transactions through the wallet.

---

## Core Concepts

### Installing the Aptos TypeScript SDK

```shell
# Install the official Aptos TypeScript SDK
npm install @aptos-labs/ts-sdk@1.0.0
```

```json
// package.json (relevant section)
{
  "dependencies": {
    "@aptos-labs/ts-sdk": "1.0.0"
  }
}
```

### SDK Initialization

```typescript
// src/aptos.ts
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk@1.0.0";

// Configure for testnet
const config = new AptosConfig({
  network: Network.TESTNET,
});

// Create the Aptos client
const aptos = new Aptos(config);

export { aptos };
```

### Reading On-Chain State (View Functions)

View functions are read-only and don't require a wallet connection:

```typescript
// src/read-state.ts
import { aptos } from "./aptos";

const MODULE_ADDRESS = "0x<your-deployed-module-address>";

// Call a view function (no transaction, no gas)
async function getTaskCount(userAddress: string): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::todo::get_task_count`,
        typeArguments: [],
        functionArguments: [userAddress],
      },
    });

    // View functions return an array of results
    return Number(result[0]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("E_NOT_INITIALIZED")) {
      return 0; // User hasn't created a todo list yet
    }
    throw error;
  }
}

// Read account resources directly
async function getAccountBalance(address: string): Promise<number> {
  try {
    const resource = await aptos.getAccountResource({
      accountAddress: address,
      resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>",
    });

    return Number(resource.coin.value);
  } catch (error) {
    console.error("Failed to fetch balance:", error);
    return 0;
  }
}

// Get fungible asset balance (new FA standard)
async function getFABalance(
  ownerAddress: string,
  metadataAddress: string
): Promise<number> {
  try {
    const balance = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: ownerAddress },
          asset_type: { _eq: metadataAddress },
        },
      },
    });

    return balance.length > 0 ? Number(balance[0].amount) : 0;
  } catch (error) {
    console.error("Failed to fetch FA balance:", error);
    return 0;
  }
}

export { getTaskCount, getAccountBalance, getFABalance };
```

### Connecting Petra Wallet

Petra injects a `window.aptos` object into the browser:

```typescript
// src/wallet.ts

interface PetraWallet {
  connect(): Promise<{ address: string; publicKey: string }>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  account(): Promise<{ address: string; publicKey: string }>;
  network(): Promise<string>;
  signAndSubmitTransaction(payload: any): Promise<{ hash: string }>;
  onAccountChange(callback: (account: { address: string }) => void): void;
  onNetworkChange(callback: (network: { name: string }) => void): void;
}

// Check if Petra is installed
function getPetraWallet(): PetraWallet | null {
  if (typeof window === "undefined") return null;
  const petra = (window as any).aptos;
  if (!petra) {
    console.warn(
      "Petra wallet not found. Install from: " +
      "https://chromewebstore.google.com/detail/petra-aptos-wallet/ejjladinnckdgjemekebdpeokbikhfci"
    );
    return null;
  }
  return petra as PetraWallet;
}

// Connect to Petra
async function connectWallet(): Promise<string | null> {
  const wallet = getPetraWallet();
  if (!wallet) return null;

  try {
    const response = await wallet.connect();
    console.log("Connected:", response.address);
    return response.address;
  } catch (error) {
    console.error("User rejected connection:", error);
    return null;
  }
}

// Disconnect
async function disconnectWallet(): Promise<void> {
  const wallet = getPetraWallet();
  if (wallet) {
    await wallet.disconnect();
  }
}

// Listen for account changes
function onAccountChange(callback: (address: string) => void): void {
  const wallet = getPetraWallet();
  if (wallet) {
    wallet.onAccountChange((account) => {
      callback(account.address);
    });
  }
}

export { getPetraWallet, connectWallet, disconnectWallet, onAccountChange };
```

### Submitting Transactions

```typescript
// src/transactions.ts
import { aptos } from "./aptos";
import { getPetraWallet } from "./wallet";
import {
  InputTransactionData,
  AccountAddress,
} from "@aptos-labs/ts-sdk@1.0.0";

const MODULE_ADDRESS = "0x<your-deployed-module-address>";

// Submit a transaction via Petra wallet
async function createTodoList(): Promise<string | null> {
  const wallet = getPetraWallet();
  if (!wallet) return null;

  try {
    const response = await wallet.signAndSubmitTransaction({
      type: "entry_function_payload",
      function: `${MODULE_ADDRESS}::todo::create_list`,
      type_arguments: [],
      arguments: [],
    });

    // Wait for transaction confirmation
    const txn = await aptos.waitForTransaction({
      transactionHash: response.hash,
    });

    console.log("Todo list created! Tx:", response.hash);
    return response.hash;
  } catch (error) {
    console.error("Transaction failed:", error);
    return null;
  }
}

// Submit with arguments
async function addTask(content: string): Promise<string | null> {
  const wallet = getPetraWallet();
  if (!wallet) return null;

  try {
    const response = await wallet.signAndSubmitTransaction({
      type: "entry_function_payload",
      function: `${MODULE_ADDRESS}::todo::add_task`,
      type_arguments: [],
      arguments: [content],
    });

    await aptos.waitForTransaction({ transactionHash: response.hash });
    console.log("Task added! Tx:", response.hash);
    return response.hash;
  } catch (error) {
    console.error("Transaction failed:", error);
    return null;
  }
}

// Complete a task (pass u64 argument)
async function completeTask(taskId: number): Promise<string | null> {
  const wallet = getPetraWallet();
  if (!wallet) return null;

  try {
    const response = await wallet.signAndSubmitTransaction({
      type: "entry_function_payload",
      function: `${MODULE_ADDRESS}::todo::complete_task`,
      type_arguments: [],
      arguments: [taskId.toString()], // u64 passed as string
    });

    await aptos.waitForTransaction({ transactionHash: response.hash });
    console.log("Task completed! Tx:", response.hash);
    return response.hash;
  } catch (error) {
    console.error("Transaction failed:", error);
    return null;
  }
}

// Transfer APT (native coin)
async function transferAPT(
  toAddress: string,
  amountInOctas: number
): Promise<string | null> {
  const wallet = getPetraWallet();
  if (!wallet) return null;

  try {
    const response = await wallet.signAndSubmitTransaction({
      type: "entry_function_payload",
      function: "0x1::aptos_account::transfer",
      type_arguments: [],
      arguments: [toAddress, amountInOctas.toString()],
    });

    await aptos.waitForTransaction({ transactionHash: response.hash });
    return response.hash;
  } catch (error) {
    console.error("Transfer failed:", error);
    return null;
  }
}

export { createTodoList, addTask, completeTask, transferAPT };
```

### Querying Events via Indexer

```typescript
// src/events.ts
import { aptos } from "./aptos";

const MODULE_ADDRESS = "0x<your-deployed-module-address>";

interface TaskCreatedEvent {
  owner: string;
  task_id: string;
  content: string;
}

// Fetch events using the Indexer API
async function getTaskCreatedEvents(
  ownerAddress: string
): Promise<TaskCreatedEvent[]> {
  try {
    const events = await aptos.getEvents({
      options: {
        where: {
          type: {
            _eq: `${MODULE_ADDRESS}::todo::TaskCreated`,
          },
          // Filter by data field if needed
          data: {
            _contains: { owner: ownerAddress },
          },
        },
        orderBy: [{ transaction_version: "desc" }],
        limit: 50,
      },
    });

    return events.map((e) => e.data as TaskCreatedEvent);
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

// Fetch transaction details
async function getTransactionDetails(txHash: string) {
  try {
    const txn = await aptos.getTransactionByHash({
      transactionHash: txHash,
    });
    return txn;
  } catch (error) {
    console.error("Failed to fetch transaction:", error);
    return null;
  }
}

export { getTaskCreatedEvents, getTransactionDetails };
```

### Complete Integration Example

```typescript
// src/app.ts — Minimal frontend integration
import { aptos } from "./aptos";
import { connectWallet, disconnectWallet } from "./wallet";
import { createTodoList, addTask, completeTask } from "./transactions";
import { getTaskCount } from "./read-state";

class TodoApp {
  private userAddress: string | null = null;

  async connect(): Promise<void> {
    this.userAddress = await connectWallet();
    if (this.userAddress) {
      console.log(`Connected: ${this.userAddress}`);
      await this.refreshState();
    }
  }

  async disconnect(): Promise<void> {
    await disconnectWallet();
    this.userAddress = null;
  }

  async refreshState(): Promise<void> {
    if (!this.userAddress) return;

    const count = await getTaskCount(this.userAddress);
    console.log(`You have ${count} tasks`);

    // Fetch account APT balance
    const resources = await aptos.getAccountResource({
      accountAddress: this.userAddress,
      resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>",
    });
    const balanceOctas = Number(resources.coin.value);
    console.log(`Balance: ${balanceOctas / 1e8} APT`);
  }

  async initializeList(): Promise<void> {
    const txHash = await createTodoList();
    if (txHash) {
      console.log("List created!");
      await this.refreshState();
    }
  }

  async addNewTask(content: string): Promise<void> {
    const txHash = await addTask(content);
    if (txHash) {
      console.log(`Task "${content}" added!`);
      await this.refreshState();
    }
  }

  async markComplete(taskId: number): Promise<void> {
    const txHash = await completeTask(taskId);
    if (txHash) {
      console.log(`Task ${taskId} completed!`);
      await this.refreshState();
    }
  }
}

// Usage
const app = new TodoApp();
await app.connect();
await app.initializeList();
await app.addNewTask("Learn Aptos Move");
await app.markComplete(1);
```

### Handling Errors Gracefully

```typescript
// src/error-handling.ts
import { AptosApiError } from "@aptos-labs/ts-sdk@1.0.0";

// Map Move abort codes to user-friendly messages
const ERROR_MESSAGES: Record<string, string> = {
  "1": "Todo list not initialized. Please create a list first.",
  "2": "Todo list already exists for this account.",
  "3": "Task not found. It may have been deleted.",
  "4": "Task is already completed.",
};

function handleTransactionError(error: unknown): string {
  if (error instanceof AptosApiError) {
    // Extract abort code from VM status
    const vmStatus = error.message;
    const abortMatch = vmStatus.match(/abort_code: (\d+)/);
    if (abortMatch) {
      const code = abortMatch[1];
      return ERROR_MESSAGES[code] || `Transaction aborted with code ${code}`;
    }
    return `API error: ${error.message}`;
  }

  if (error instanceof Error) {
    if (error.message.includes("User rejected")) {
      return "Transaction cancelled by user.";
    }
    return error.message;
  }

  return "An unknown error occurred.";
}

export { handleTransactionError };
```

---

## Common Pitfalls

1. **Not waiting for transaction confirmation before reading state** — After `signAndSubmitTransaction`, the transaction is submitted but not yet committed. Always call `aptos.waitForTransaction({ transactionHash })` before reading updated state. Without this, your frontend shows stale data.

2. **Passing numbers directly instead of strings for u64 arguments** — The Petra wallet and SDK expect large numbers (u64, u128) as strings to avoid JavaScript precision loss. Passing `1000000000` as a number works for small values but breaks for amounts near `Number.MAX_SAFE_INTEGER`. Always use `.toString()`.

3. **Not checking if Petra is installed before calling methods** — If `window.aptos` is undefined, calling methods on it throws. Always check `getPetraWallet()` returns non-null before proceeding. Show an install prompt if the wallet isn't detected.

4. **Confusing testnet and mainnet module addresses** — A module deployed to testnet has a different address than the same module on mainnet (unless you use the same account). Always configure `MODULE_ADDRESS` based on the current network. Check `wallet.network()` to verify the user is on the expected network.

5. **Not handling the Aptos Indexer lag** — The Indexer (used for event queries and historical data) can lag 1-5 seconds behind the fullnode. If you query events immediately after a transaction confirms, you may not see the new event yet. Add a short delay or poll until the event appears.

---

## What to Learn Next

- [Aptos TypeScript SDK Documentation](https://aptos.dev/en/build/sdks/ts-sdk) — Complete SDK reference
- [Petra Wallet Integration Guide](https://petra.app/docs) — Official Petra developer docs
- [Aptos Indexer API](https://aptos.dev/en/build/indexer) — GraphQL API for querying historical data
- [Aptos Wallet Adapter](https://github.com/aptos-labs/aptos-wallet-adapter) — Multi-wallet support for React apps

