# FunC Advanced Patterns: Upgrades, Gas, and Multi-Message Workflows

**Track:** TON Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You can write basic FunC contracts but production applications require patterns that aren't obvious from the language docs. How do you upgrade a contract without losing state? How do you handle complex multi-step operations across multiple contracts when messages are asynchronous? How do you optimize gas when every cell operation costs money? This lesson covers advanced FunC patterns that separate toy contracts from production-ready ones.

---

## Core Concepts

### Upgradeable Contracts

TON contracts can update their own code and data using `set_code()` and `set_data()`:

```func
;; contracts/upgradeable.fc
#include "imports/stdlib.fc";

const int op::upgrade = 0x01;
const int error::unauthorized = 401;

;; Storage: [admin:MsgAddr][version:uint32][...app_data...]

(slice, int) load_admin_data() inline {
    slice ds = get_data().begin_parse();
    slice admin = ds~load_msg_addr();
    int version = ds~load_uint(32);
    return (admin, version);
}

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);
    if (flags & 1) { return (); }

    slice sender = cs~load_msg_addr();

    if (in_msg_body.slice_empty?()) { return (); }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    if (op == op::upgrade) {
        (slice admin, int version) = load_admin_data();
        throw_unless(error::unauthorized, equal_slices(sender, admin));

        ;; New code is passed as a reference in the message body
        cell new_code = in_msg_body~load_ref();
        ;; Optional: new data layout migration
        cell new_data = in_msg_body~load_ref();

        ;; Update contract code (takes effect on NEXT message)
        set_code(new_code);

        ;; Update data with new version number
        set_data(new_data);

        ;; Important: set_code takes effect after this transaction completes
        ;; The current execution continues with the OLD code
        return ();
    }

    ;; ... other operations ...
}

int get_version() method_id {
    (_, int version) = load_admin_data();
    return version;
}
```

```typescript
// scripts/upgradeContract.ts — deploying an upgrade
import { Cell, beginCell, toNano } from "@ton/core@0.57.0";
import { compile, NetworkProvider } from "@ton/blueprint@0.20.0";

export async function run(provider: NetworkProvider) {
  const newCode = await compile("CounterV2");

  // Build new data cell preserving existing state but bumping version
  const newData = beginCell()
    .storeAddress(provider.sender().address!)
    .storeUint(2, 32) // version 2
    .storeInt(0, 64) // counter (reset or migrate from old)
    .endCell();

  const upgradeBody = beginCell()
    .storeUint(0x01, 32) // op::upgrade
    .storeUint(0, 64) // query_id
    .storeRef(newCode)
    .storeRef(newData)
    .endCell();

  await provider.sender().send({
    to: contractAddress,
    value: toNano("0.05"),
    body: upgradeBody,
  });

  console.log("Upgrade transaction sent");
}
```

### Multi-Message Workflows (Sagas)

Since TON is asynchronous, complex operations span multiple messages. Use the "saga pattern" with compensation:

```func
;; Example: Atomic swap between two Jetton wallets
;; Problem: You can't do this in one transaction like Ethereum
;; Solution: Use a coordinator contract with state machine

;; contracts/swap_coordinator.fc
#include "imports/stdlib.fc";

;; Swap states
const int state::idle = 0;
const int state::awaiting_token_a = 1;
const int state::awaiting_token_b = 2;
const int state::complete = 3;
const int state::cancelled = 4;

;; Storage: [state:uint8][party_a:MsgAddr][party_b:MsgAddr]
;;          [token_a_amount:coins][token_b_amount:coins]
;;          [deadline:uint32][received_a:bool][received_b:bool]

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);
    if (flags & 1) {
        ;; Handle bounced messages — compensation logic
        handle_bounce(in_msg_body);
        return ();
    }

    slice sender = cs~load_msg_addr();
    if (in_msg_body.slice_empty?()) { return (); }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    ;; Handle transfer_notification from Jetton Wallets
    if (op == 0x7362d09c) {  ;; transfer_notification
        int amount = in_msg_body~load_coins();
        slice from_user = in_msg_body~load_msg_addr();

        ;; Verify sender is the expected Jetton Wallet
        ;; Update state machine
        ;; If both tokens received → execute swap
        ;; If deadline passed → refund both parties
        handle_token_received(sender, from_user, amount, query_id);
        return ();
    }

    ;; Cancel swap (either party, before completion)
    if (op == 0x03) {  ;; op::cancel
        handle_cancel(sender, query_id);
        return ();
    }

    throw(0xffff);
}

() handle_bounce(slice in_msg_body) impure {
    ;; A message we sent was bounced back
    ;; This means a transfer failed — initiate compensation
    ;; Refund any tokens already received to their original owners
    in_msg_body~skip_bits(32);  ;; skip bounced op
    int original_op = in_msg_body~load_uint(32);

    ;; If our transfer to party_b bounced, refund party_a
    ;; Update state to cancelled
    ;; Send refund messages
}
```

### Gas Optimization Patterns

Gas costs on TON are based on:
- Computation (TVM instructions)
- Storage (cells and bits stored)
- Message forwarding (outgoing messages)

```func
;; Pattern 1: Use inline for small frequently-called functions
;; Saves the overhead of a function call (~20 gas)
(int, slice) load_data() inline {
    slice ds = get_data().begin_parse();
    return (ds~load_uint(64), ds~load_msg_addr());
}

;; Pattern 2: Use inline_ref for larger functions called from multiple places
;; Stores function body once, references it (saves code size)
() complex_logic(int x, int y) inline_ref {
    ;; ... many operations ...
}

;; Pattern 3: Minimize cell references (each ref costs ~500 gas to load)
;; BAD: deeply nested cells
cell bad_storage() {
    return begin_cell()
        .store_ref(begin_cell()
            .store_ref(begin_cell()
                .store_uint(42, 64)
                .end_cell())
            .end_cell())
        .end_cell();
}

;; GOOD: flat structure when possible (fits in 1023 bits)
cell good_storage() {
    return begin_cell()
        .store_uint(42, 64)
        .store_uint(100, 64)
        .store_uint(200, 64)
        .end_cell();
}

;; Pattern 4: Use dictionaries for large key-value storage
;; Dictionaries are Merkle trees stored as cells
() dict_example() {
    cell dict = new_dict();

    ;; Store values (key size must be consistent)
    dict~udict_set(256, 1, begin_cell().store_coins(100).end_cell().begin_parse());
    dict~udict_set(256, 2, begin_cell().store_coins(200).end_cell().begin_parse());

    ;; Load values
    (slice value, int found) = dict.udict_get?(256, 1);
    if (found) {
        int amount = value~load_coins();
    }
}

;; Pattern 5: Carry remaining gas forward (mode 64)
;; Instead of specifying exact amounts, forward what's left
() forward_remaining(slice destination, cell body) impure {
    send_raw_message(
        begin_cell()
            .store_uint(0x18, 6)
            .store_slice(destination)
            .store_coins(0)            ;; 0 value — mode 64 carries remaining
            .store_uint(1, 107)
            .store_ref(body)
            .end_cell(),
        64  ;; mode: carry all remaining value minus fees
    );
}
```

### Message Modes

Understanding send modes is critical for gas management:

```func
;; Message send modes (can be combined with +)
;; Mode 0:  Send specified amount, pay fees from message value
;; Mode 1:  Pay fees from contract balance (not message value)
;; Mode 2:  Ignore errors during action phase
;; Mode 64: Carry all remaining value of inbound message (minus fees)
;; Mode 128: Carry entire contract balance (destroys contract if no other messages)

;; Common combinations:
() examples() impure {
    ;; Standard send: specific amount, fees from message
    send_raw_message(msg, 0);

    ;; Forward remaining gas to next contract in chain
    send_raw_message(msg, 64);

    ;; Send all balance and destroy contract
    send_raw_message(msg, 128 + 32);  ;; 32 = destroy if balance is zero

    ;; Pay fees from contract balance, ignore errors
    send_raw_message(msg, 1 + 2);
}
```

### Proxy and Router Patterns

For complex DApps with multiple contracts:

```func
;; contracts/router.fc — Routes messages to the correct handler contract
#include "imports/stdlib.fc";

;; Storage: [admin:MsgAddr][handler_map:^Cell(Dict)]

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);
    if (flags & 1) { return (); }

    slice sender = cs~load_msg_addr();
    if (in_msg_body.slice_empty?()) { return (); }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    ;; Load handler registry
    slice ds = get_data().begin_parse();
    slice admin = ds~load_msg_addr();
    cell handlers = ds~load_ref();

    ;; Look up handler address for this op code
    (slice handler_addr, int found) = handlers.begin_parse()
        .udict_get?(32, op);

    throw_unless(404, found);

    ;; Forward the message to the handler contract
    cell forward_msg = begin_cell()
        .store_uint(0x18, 6)
        .store_slice(handler_addr)
        .store_coins(0)
        .store_uint(1, 107)
        .store_ref(
            begin_cell()
                .store_uint(op, 32)
                .store_uint(query_id, 64)
                .store_slice(sender)       ;; original sender
                .store_slice(in_msg_body)  ;; remaining body
                .end_cell()
        )
        .end_cell();

    send_raw_message(forward_msg, 64);
}

;; Register a new handler (admin only)
() register_handler(slice sender, int op_code, slice handler_address) impure {
    slice ds = get_data().begin_parse();
    slice admin = ds~load_msg_addr();
    throw_unless(401, equal_slices(sender, admin));

    cell handlers = ds~load_ref();
    slice hs = handlers.begin_parse();

    ;; Add to dictionary
    hs~udict_set(32, op_code,
        begin_cell().store_slice(handler_address).end_cell().begin_parse()
    );

    ;; Save updated registry
    set_data(
        begin_cell()
            .store_slice(admin)
            .store_ref(begin_cell().store_dict(hs).end_cell())
            .end_cell()
    );
}
```

### Testing Async Workflows

```typescript
// tests/AsyncWorkflow.spec.ts
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox@0.20.0";
import { Cell, toNano, beginCell } from "@ton/core@0.57.0";
import "@ton/test-utils@0.4.2";

describe("Multi-message workflow", () => {
  let blockchain: Blockchain;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
  });

  it("should process messages in correct order", async () => {
    const deployer = await blockchain.treasury("deployer");

    // Deploy contracts...
    // Send initial message...

    // The sandbox processes all messages in the chain
    const result = await contractA.sendStart(deployer.getSender(), toNano("1"));

    // Check the full message chain
    expect(result.transactions).toHaveTransaction({
      from: contractA.address,
      to: contractB.address,
      success: true,
    });

    expect(result.transactions).toHaveTransaction({
      from: contractB.address,
      to: contractC.address,
      success: true,
    });

    // Verify final state
    const finalState = await contractC.getState();
    expect(finalState).toBe(expectedValue);
  });

  it("should handle bounced messages correctly", async () => {
    const deployer = await blockchain.treasury("deployer");

    // Send message that will cause a bounce
    const result = await contractA.sendToInvalid(
      deployer.getSender(),
      toNano("0.5")
    );

    // Verify bounce was handled
    expect(result.transactions).toHaveTransaction({
      from: contractB.address,
      to: contractA.address,
      bounced: true,
    });

    // Verify compensation logic executed
    const state = await contractA.getState();
    expect(state).toBe("compensated");
  });
});
```

---

## Common Pitfalls

1. **Using `set_code()` without data migration** — When you upgrade contract code, the storage layout may change. If you call `set_code()` without also updating `set_data()` to match the new code's expected layout, the upgraded contract will misparse its own storage on the next message, causing cryptic failures or data corruption.

2. **Not accounting for message ordering in multi-step flows** — Messages between contracts in different shards may arrive out of order. If your workflow assumes message A arrives before message B, it will break under load. Use state machines with explicit states and handle messages idempotently (check if the step was already completed).

3. **Sending mode 128 accidentally** — Mode 128 sends the entire contract balance with the message. If you use this without mode 32 (destroy on zero balance), your contract becomes unfunded and gets frozen. Only use mode 128 for self-destruct patterns or when you intentionally want to drain the contract.

4. **Not reserving gas for storage rent** — When forwarding remaining value (mode 64), the contract keeps nothing for itself. Over time, storage rent depletes the contract's balance. Always reserve a minimum amount: use `raw_reserve(min_balance, 0)` before sending with mode 128, or send a specific amount instead of using mode 64 for the final message in a chain.

5. **Ignoring the 16 outgoing message limit** — A single transaction can produce at most 255 actions, but practically you should limit outgoing messages to avoid hitting gas limits. If you need to notify many contracts, use a "pagination" pattern where each message triggers the next batch.

---

## What to Learn Next

- [Frontend Integration with TON Connect](./07-frontend-integration.md) — Connect your dApp to TON wallets and interact with contracts from the browser
- [TON Smart Contract Guidelines](https://docs.ton.org/develop/smart-contracts/guidelines) — Official best practices
- [TON Cookbook](https://docs.ton.org/develop/smart-contracts/tutorials/wallet) — Common contract patterns and recipes
