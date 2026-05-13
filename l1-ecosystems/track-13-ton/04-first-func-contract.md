# First FunC Contract: Counter with Testnet Deployment

**Track:** TON Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You understand FunC syntax but haven't written a complete contract from scratch or deployed one to a live network. TON's deployment process differs significantly from Ethereum — you need to construct an initial state cell, compute the contract address deterministically, and send an internal message to deploy. This lesson walks you through building a fully functional counter contract, testing it locally with the TON sandbox, and deploying it to testnet using the TON CLI and Blueprint.

---

## Core Concepts

### The Counter Contract

We'll build a counter contract with these features:
- Increment/decrement by any amount
- Owner-only reset
- Get methods for reading state
- Proper error handling and bounce protection

```func
;; contracts/counter.fc
#include "imports/stdlib.fc";

;; Operation codes
const int op::increment = 0x01;
const int op::decrement = 0x02;
const int op::reset = 0x03;

;; Error codes
const int error::unauthorized = 401;
const int error::underflow = 402;

;; Storage layout: [counter:int64][owner:MsgAddress]

(int, slice) load_data() inline {
    slice ds = get_data().begin_parse();
    int counter = ds~load_int(64);
    slice owner = ds~load_msg_addr();
    ds.end_parse();
    return (counter, owner);
}

() save_data(int counter, slice owner) impure inline {
    set_data(
        begin_cell()
            .store_int(counter, 64)
            .store_slice(owner)
            .end_cell()
    );
}

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    ;; Parse incoming message flags
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);

    ;; Ignore bounced messages
    if (flags & 1) {
        return ();
    }

    ;; Get sender address
    slice sender = cs~load_msg_addr();

    ;; Accept simple transfers (no body or op = 0)
    if (in_msg_body.slice_empty?()) {
        return ();
    }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    ;; Load current state
    (int counter, slice owner) = load_data();

    if (op == op::increment) {
        int amount = in_msg_body~load_uint(32);
        counter += amount;
        save_data(counter, owner);
        return ();
    }

    if (op == op::decrement) {
        int amount = in_msg_body~load_uint(32);
        throw_unless(error::underflow, counter >= amount);
        counter -= amount;
        save_data(counter, owner);
        return ();
    }

    if (op == op::reset) {
        throw_unless(error::unauthorized, equal_slices(sender, owner));
        save_data(0, owner);
        return ();
    }

    throw(0xffff);  ;; Unknown operation
}

;; Get methods (read-only, called off-chain)

int get_counter() method_id {
    (int counter, _) = load_data();
    return counter;
}

slice get_owner() method_id {
    (_, slice owner) = load_data();
    return owner;
}
```

### The TypeScript Wrapper

Blueprint uses TypeScript wrappers to interact with contracts:

```typescript
// wrappers/Counter.ts
import {
  Address,
  beginCell,
  Cell,
  Contract,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
  toNano,
} from "@ton/core@0.57.0";

export type CounterConfig = {
  counter: number;
  owner: Address;
};

export function counterConfigToCell(config: CounterConfig): Cell {
  return beginCell()
    .storeInt(config.counter, 64)
    .storeAddress(config.owner)
    .endCell();
}

export class Counter implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell }
  ) {}

  static createFromConfig(config: CounterConfig, code: Cell, workchain = 0) {
    const data = counterConfigToCell(config);
    const init = { code, data };
    return new Counter(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  async sendIncrement(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    amount: number
  ) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0x01, 32) // op::increment
        .storeUint(0, 64) // query_id
        .storeUint(amount, 32) // amount
        .endCell(),
    });
  }

  async sendDecrement(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    amount: number
  ) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0x02, 32) // op::decrement
        .storeUint(0, 64) // query_id
        .storeUint(amount, 32) // amount
        .endCell(),
    });
  }

  async sendReset(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0x03, 32) // op::reset
        .storeUint(0, 64) // query_id
        .endCell(),
    });
  }

  async getCounter(provider: ContractProvider): Promise<number> {
    const result = await provider.get("get_counter", []);
    return result.stack.readNumber();
  }

  async getOwner(provider: ContractProvider): Promise<Address> {
    const result = await provider.get("get_owner", []);
    return result.stack.readAddress();
  }
}
```

### Testing with TON Sandbox

The TON sandbox provides a local blockchain emulator for testing:

```typescript
// tests/Counter.spec.ts
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox@0.20.0";
import { Cell, toNano } from "@ton/core@0.57.0";
import { Counter } from "../wrappers/Counter";
import "@ton/test-utils@0.4.2";
import { compile } from "@ton/blueprint@0.20.0";

describe("Counter", () => {
  let code: Cell;

  beforeAll(async () => {
    code = await compile("Counter");
  });

  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let counter: SandboxContract<Counter>;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    deployer = await blockchain.treasury("deployer");

    counter = blockchain.openContract(
      Counter.createFromConfig(
        { counter: 0, owner: deployer.address },
        code
      )
    );

    const deployResult = await counter.sendDeploy(
      deployer.getSender(),
      toNano("0.05")
    );

    expect(deployResult.transactions).toHaveTransaction({
      from: deployer.address,
      to: counter.address,
      deploy: true,
      success: true,
    });
  });

  it("should deploy with initial counter = 0", async () => {
    const value = await counter.getCounter();
    expect(value).toBe(0);
  });

  it("should increment", async () => {
    await counter.sendIncrement(deployer.getSender(), toNano("0.05"), 5);
    const value = await counter.getCounter();
    expect(value).toBe(5);
  });

  it("should decrement", async () => {
    await counter.sendIncrement(deployer.getSender(), toNano("0.05"), 10);
    await counter.sendDecrement(deployer.getSender(), toNano("0.05"), 3);
    const value = await counter.getCounter();
    expect(value).toBe(7);
  });

  it("should fail decrement below zero", async () => {
    const result = await counter.sendDecrement(
      deployer.getSender(),
      toNano("0.05"),
      1
    );
    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      to: counter.address,
      success: false,
      exitCode: 402, // error::underflow
    });
  });

  it("should reset only by owner", async () => {
    await counter.sendIncrement(deployer.getSender(), toNano("0.05"), 100);

    const notOwner = await blockchain.treasury("notOwner");
    const result = await counter.sendReset(notOwner.getSender(), toNano("0.05"));

    expect(result.transactions).toHaveTransaction({
      from: notOwner.address,
      to: counter.address,
      success: false,
      exitCode: 401, // error::unauthorized
    });

    // Owner can reset
    await counter.sendReset(deployer.getSender(), toNano("0.05"));
    const value = await counter.getCounter();
    expect(value).toBe(0);
  });
});
```

```shell
# Run tests
npx blueprint test
```

```
Expected output:
 PASS  tests/Counter.spec.ts
  Counter
    ✓ should deploy with initial counter = 0 (312 ms)
    ✓ should increment (156 ms)
    ✓ should decrement (189 ms)
    ✓ should fail decrement below zero (134 ms)
    ✓ should reset only by owner (201 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

### Deploying to Testnet

Create a deployment script:

```typescript
// scripts/deployCounter.ts
import { toNano } from "@ton/core@0.57.0";
import { Counter } from "../wrappers/Counter";
import { compile, NetworkProvider } from "@ton/blueprint@0.20.0";

export async function run(provider: NetworkProvider) {
  const code = await compile("Counter");

  const counter = provider.open(
    Counter.createFromConfig(
      {
        counter: 0,
        owner: provider.sender().address!,
      },
      code
    )
  );

  await counter.sendDeploy(provider.sender(), toNano("0.05"));
  await provider.waitForDeploy(counter.address);

  console.log("Counter deployed at:", counter.address.toString());
  console.log("Initial value:", await counter.getCounter());
}
```

```shell
# Deploy using Blueprint (connects via TON Connect or mnemonic)
npx blueprint run deployCounter --testnet
```

```
Expected output:
Using network: testnet
Contract deployed at: EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR
Waiting for deployment...
Counter deployed at: EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR
Initial value: 0
```

### Deploying with TON CLI

Alternative deployment using the `ton` CLI directly:

```shell
# Compile the contract
npx blueprint build

# Deploy using ton-cli with mnemonic
ton contract deploy \
  --network testnet \
  --workchain 0 \
  --code build/Counter.compiled.json \
  --data '{"counter": 0}' \
  --value 0.05
```

```
Expected output:
Contract address: EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR
Transaction hash: abc123...
Deploy successful!
```

Last verified: 2025-01-15. For current CLI commands, see https://docs.ton.org/develop/smart-contracts/sdk/javascript

### Interacting with the Deployed Contract

```typescript
// scripts/incrementCounter.ts
import { Address, toNano } from "@ton/core@0.57.0";
import { Counter } from "../wrappers/Counter";
import { NetworkProvider } from "@ton/blueprint@0.20.0";

export async function run(provider: NetworkProvider) {
  const counterAddress = Address.parse(
    "EQDrjaLahLkMB-hMCmkzOyBuHJ186Kj_0TF-0sM-2HKIzHsR"
  );

  const counter = provider.open(Counter.createFromAddress(counterAddress));

  console.log("Current counter:", await counter.getCounter());

  await counter.sendIncrement(provider.sender(), toNano("0.05"), 1);

  // Wait for transaction to process
  let attempts = 0;
  let newValue = await counter.getCounter();
  while (newValue === 0 && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    newValue = await counter.getCounter();
    attempts++;
  }

  console.log("New counter value:", newValue);
}
```

---

## Common Pitfalls

1. **Not sending enough TON for gas** — Every message to a contract must carry enough TON to pay for computation and storage. For simple operations, 0.05 TON is sufficient. If you send too little, the transaction fails and the message bounces back (minus the gas already consumed). Always include a buffer.

2. **Forgetting the query_id field** — By convention, TON messages include a 64-bit `query_id` after the 32-bit `op` code. This allows tracking request-response pairs in asynchronous communication. Omitting it breaks compatibility with standard tooling and wallets that expect this layout.

3. **Not waiting for transaction confirmation** — TON testnet block time is ~5 seconds. After sending a deploy or interaction message, you must wait before querying the new state. Immediately calling a get method after sending will return stale data. Use polling with a timeout.

4. **Deploying to the wrong workchain** — TON has multiple workchains. Almost all contracts deploy to workchain 0. If you accidentally specify workchain -1 (masterchain), deployment will fail because masterchain deployment requires special permissions and much higher fees.

5. **Not testing bounce handling** — If your contract sends a message to another contract that fails, the bounced message returns to your contract. If you don't handle it in `recv_internal` (checking the bounce flag), your contract may process the bounced message as a new operation, causing unexpected state changes.

---

## What to Learn Next

- [Token Standards and Jettons](./05-token-standards.md) — Implement the Jetton (TEP-74) fungible token standard on TON
- [TON Smart Contract Best Practices](https://docs.ton.org/develop/smart-contracts/guidelines) — Official guidelines for production contracts
- [TON Verifier](https://verifier.ton.org/) — Verify and publish your contract source code
