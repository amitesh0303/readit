# Token Standards and Jettons on TON

**Track:** TON Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

You want to create a fungible token on TON but the architecture is completely different from ERC-20 on Ethereum. On TON, a single contract can't store all token balances because of the actor model — each user needs their own "wallet" contract to hold their tokens. The Jetton standard (TEP-74) defines how this distributed token system works, but without understanding the multi-contract architecture, you'll build tokens that don't interoperate with wallets and DEXes. This lesson explains TON's token standards and walks you through implementing a Jetton.

---

## Core Concepts

### Why Tokens Are Different on TON

On Ethereum, an ERC-20 token is a single contract with a `mapping(address => uint256)`:

```
Ethereum ERC-20:
┌─────────────────────────────────┐
│ Token Contract                   │
│ balances[Alice] = 100           │
│ balances[Bob] = 50              │
│ balances[Carol] = 200           │
│ totalSupply = 350               │
└─────────────────────────────────┘
```

On TON, this design doesn't scale because:
- A single contract processing all transfers becomes a bottleneck (no parallelism)
- Reading another contract's storage requires async messages (expensive)
- Storage rent means one contract paying for all users' data is unsustainable

Instead, TON uses a **distributed architecture**:

```
TON Jetton (TEP-74):
┌──────────────────┐
│ Jetton Master     │  ← Stores metadata, total supply, minting logic
│ total_supply: 350│
└────────┬─────────┘
         │ deploys
    ┌────┼────────────────┐
    ▼    ▼                ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Alice's│ │ Bob's  │ │Carol's │  ← Each user has their own Jetton Wallet
│ Wallet │ │ Wallet │ │ Wallet │
│ bal:100│ │ bal:50 │ │bal:200 │
└────────┘ └────────┘ └────────┘
```

### Jetton Standard (TEP-74)

The Jetton standard defines two contract types:

**Jetton Master** (one per token):
- Stores token metadata (name, symbol, decimals, image)
- Tracks total supply
- Deploys Jetton Wallet contracts for new holders
- Handles minting (if mintable)

**Jetton Wallet** (one per holder):
- Stores the holder's balance
- Handles transfers (send tokens to another wallet)
- Handles burns (destroy tokens)
- Linked to exactly one Jetton Master

### Jetton Master Contract

```func
;; contracts/jetton_master.fc
#include "imports/stdlib.fc";
#include "imports/jetton-utils.fc";

;; Storage: [total_supply:coins][admin:MsgAddr][content:^Cell][wallet_code:^Cell]

(int, slice, cell, cell) load_data() inline {
    slice ds = get_data().begin_parse();
    int total_supply = ds~load_coins();
    slice admin = ds~load_msg_addr();
    cell content = ds~load_ref();
    cell wallet_code = ds~load_ref();
    ds.end_parse();
    return (total_supply, admin, content, wallet_code);
}

() save_data(int total_supply, slice admin, cell content, cell wallet_code) impure inline {
    set_data(
        begin_cell()
            .store_coins(total_supply)
            .store_slice(admin)
            .store_ref(content)
            .store_ref(wallet_code)
            .end_cell()
    );
}

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);
    if (flags & 1) { return (); }  ;; Ignore bounced

    slice sender = cs~load_msg_addr();

    if (in_msg_body.slice_empty?()) { return (); }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    (int total_supply, slice admin, cell content, cell wallet_code) = load_data();

    ;; Mint new tokens (admin only)
    if (op == 21) {  ;; op::mint
        throw_unless(401, equal_slices(sender, admin));
        slice to_address = in_msg_body~load_msg_addr();
        int amount = in_msg_body~load_coins();
        int forward_ton = in_msg_body~load_coins();

        ;; Calculate the Jetton Wallet address for recipient
        cell state_init = calculate_jetton_wallet_state_init(
            to_address, my_address(), wallet_code
        );
        slice wallet_address = calculate_jetton_wallet_address(state_init);

        ;; Send internal transfer message to the wallet
        cell mint_msg = begin_cell()
            .store_uint(0x178d4519, 32)  ;; op::internal_transfer
            .store_uint(query_id, 64)
            .store_coins(amount)
            .store_slice(my_address())   ;; from (master = minter)
            .store_slice(sender)         ;; response_destination
            .store_coins(0)              ;; forward_ton_amount
            .store_uint(0, 1)            ;; no forward_payload
            .end_cell();

        send_raw_message(
            begin_cell()
                .store_uint(0x18, 6)
                .store_slice(wallet_address)
                .store_coins(forward_ton)
                .store_uint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
                .store_ref(state_init)
                .store_ref(mint_msg)
                .end_cell(),
            1  ;; pay transfer fees separately
        );

        total_supply += amount;
        save_data(total_supply, admin, content, wallet_code);
        return ();
    }

    throw(0xffff);
}

;; Get methods

int get_jetton_data() method_id {
    (int total_supply, slice admin, cell content, cell wallet_code) = load_data();
    return total_supply;
}

slice get_wallet_address(slice owner_address) method_id {
    (_, _, _, cell wallet_code) = load_data();
    cell state_init = calculate_jetton_wallet_state_init(
        owner_address, my_address(), wallet_code
    );
    return calculate_jetton_wallet_address(state_init);
}
```

### Jetton Wallet Contract (Transfer Logic)

```func
;; contracts/jetton_wallet.fc (simplified)
#include "imports/stdlib.fc";

;; Storage: [balance:coins][owner:MsgAddr][jetton_master:MsgAddr][wallet_code:^Cell]

(int, slice, slice, cell) load_data() inline {
    slice ds = get_data().begin_parse();
    int balance = ds~load_coins();
    slice owner = ds~load_msg_addr();
    slice jetton_master = ds~load_msg_addr();
    cell wallet_code = ds~load_ref();
    ds.end_parse();
    return (balance, owner, jetton_master, wallet_code);
}

() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    slice cs = in_msg_full.begin_parse();
    int flags = cs~load_uint(4);
    if (flags & 1) { return (); }

    slice sender = cs~load_msg_addr();

    if (in_msg_body.slice_empty?()) { return (); }

    int op = in_msg_body~load_uint(32);
    int query_id = in_msg_body~load_uint(64);

    (int balance, slice owner, slice jetton_master, cell wallet_code) = load_data();

    ;; Transfer tokens to another user
    if (op == 0xf8a7ea5) {  ;; op::transfer
        throw_unless(401, equal_slices(sender, owner));

        int amount = in_msg_body~load_coins();
        slice destination = in_msg_body~load_msg_addr();
        slice response_destination = in_msg_body~load_msg_addr();
        in_msg_body~skip_bits(1);  ;; custom_payload flag
        int forward_ton_amount = in_msg_body~load_coins();

        throw_unless(402, balance >= amount);
        balance -= amount;

        ;; Calculate destination's Jetton Wallet address
        cell state_init = calculate_jetton_wallet_state_init(
            destination, jetton_master, wallet_code
        );
        slice dest_wallet = calculate_jetton_wallet_address(state_init);

        ;; Send internal_transfer to destination wallet
        cell transfer_msg = begin_cell()
            .store_uint(0x178d4519, 32)  ;; op::internal_transfer
            .store_uint(query_id, 64)
            .store_coins(amount)
            .store_slice(owner)          ;; from
            .store_slice(response_destination)
            .store_coins(forward_ton_amount)
            .store_uint(0, 1)            ;; no forward_payload
            .end_cell();

        send_raw_message(
            begin_cell()
                .store_uint(0x18, 6)
                .store_slice(dest_wallet)
                .store_coins(0)
                .store_uint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
                .store_ref(state_init)
                .store_ref(transfer_msg)
                .end_cell(),
            64  ;; carry remaining value
        );

        save_data(balance, owner, jetton_master, wallet_code);
        return ();
    }

    throw(0xffff);
}

int get_wallet_data() method_id {
    (int balance, slice owner, slice jetton_master, _) = load_data();
    return balance;
}
```

### NFT Standard (TEP-62)

TON NFTs follow a similar distributed pattern:

```
TON NFT Architecture:
┌──────────────────────┐
│ NFT Collection        │  ← Stores collection metadata, deploys items
│ next_item_index: 100 │
└──────────┬───────────┘
           │ deploys
    ┌──────┼──────────────────┐
    ▼      ▼                  ▼
┌────────┐ ┌────────┐ ┌────────────┐
│ NFT #0 │ │ NFT #1 │ │ NFT #99    │  ← Each NFT is its own contract
│owner:A │ │owner:B │ │ owner:C    │
└────────┘ └────────┘ └────────────┘
```

Key differences from ERC-721:
- Each NFT is a separate contract (not entries in a mapping)
- Transfer = sending a message to the NFT contract to change owner
- Metadata stored on-chain or via content cell pointing to off-chain URL

### Token Metadata (TEP-64)

TON uses a standard for on-chain/off-chain metadata:

```typescript
// TypeScript: Building Jetton metadata content cell
import { beginCell, Cell, Dictionary } from "@ton/core@0.57.0";

function buildJettonContent(): Cell {
  // Off-chain metadata (points to JSON URL)
  const offChainContent = beginCell()
    .storeUint(0x01, 8) // off-chain flag
    .storeStringTail("https://example.com/token-metadata.json")
    .endCell();

  return offChainContent;
}

// On-chain metadata alternative
function buildOnChainContent(
  name: string,
  symbol: string,
  decimals: number,
  description: string
): Cell {
  const dict = Dictionary.empty(
    Dictionary.Keys.Buffer(32),
    Dictionary.Values.Cell()
  );

  // SHA256 hash of attribute name → value cell
  const nameKey = Buffer.from(
    "71e0db43fcece5d94014a41a6415d2e3ef5fb3e8e943e3c3a8e5bc6b1b1c7b2e",
    "hex"
  ); // sha256("name")
  dict.set(nameKey, beginCell().storeStringTail(name).endCell());

  return beginCell()
    .storeUint(0x00, 8) // on-chain flag
    .storeDict(dict)
    .endCell();
}
```

### Deploying a Jetton

```shell
# Using Blueprint to deploy a Jetton Master
npx blueprint run deployJetton --testnet
```

```typescript
// scripts/deployJetton.ts
import { toNano, Address } from "@ton/core@0.57.0";
import { JettonMaster } from "../wrappers/JettonMaster";
import { compile, NetworkProvider } from "@ton/blueprint@0.20.0";

export async function run(provider: NetworkProvider) {
  const masterCode = await compile("JettonMaster");
  const walletCode = await compile("JettonWallet");

  const master = provider.open(
    JettonMaster.createFromConfig(
      {
        admin: provider.sender().address!,
        content: buildJettonContent(),
        walletCode: walletCode,
      },
      masterCode
    )
  );

  await master.sendDeploy(provider.sender(), toNano("0.1"));
  await provider.waitForDeploy(master.address);

  console.log("Jetton Master deployed:", master.address.toString());

  // Mint tokens to yourself
  await master.sendMint(
    provider.sender(),
    toNano("0.1"),
    provider.sender().address!,
    toNano("1000000") // 1M tokens
  );

  console.log("Minted 1,000,000 tokens");
}
```

```
Expected output:
Using network: testnet
Jetton Master deployed: EQBx7...
Minted 1,000,000 tokens
```

Last verified: 2025-01-15. For current Jetton implementation, see https://github.com/ton-blockchain/token-contract

---

## Common Pitfalls

1. **Treating Jettons like ERC-20** — You cannot query all holders from the master contract. Each holder has a separate wallet contract. To check a user's balance, you must compute their wallet address (deterministic from owner + master + wallet_code) and query that specific contract. There's no `balanceOf(address)` on the master.

2. **Not forwarding enough TON for multi-hop transfers** — A Jetton transfer involves multiple messages: user → their wallet → recipient's wallet → notification to recipient. Each hop costs gas. If you don't attach enough TON to the initial transfer message (~0.1 TON for safety), intermediate messages will fail and tokens may get stuck.

3. **Forgetting to handle `transfer_notification`** — When tokens arrive at a Jetton Wallet, the wallet sends a `transfer_notification` (op 0x7362d09c) to the owner. DApps and DEX contracts rely on this notification to trigger logic. If your contract receives Jettons but doesn't handle this op, it won't know tokens arrived.

4. **Not verifying the sender is the correct Jetton Wallet** — When your contract receives an `internal_transfer` or `transfer_notification`, you must verify the sender address matches the expected Jetton Wallet address (computed from the claimed sender + master + wallet_code). Without this check, anyone can fake token transfers to your contract.

5. **Ignoring storage fees for wallet contracts** — Each Jetton Wallet contract pays storage rent. If a user's wallet runs out of TON balance, it gets frozen and they can't transfer tokens. Ensure wallet contracts always retain a minimum balance (~0.01 TON) for storage rent by not allowing users to withdraw their entire TON balance from the wallet.

---

## What to Learn Next

- [FunC Advanced Patterns](./06-func-advanced-patterns.md) — Upgradeable contracts, multi-message workflows, and gas optimization on TON
- [TEP-74 Jetton Standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md) — Full specification
- [TON Token Contract Reference](https://github.com/ton-blockchain/token-contract) — Official Jetton implementation
