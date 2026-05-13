# Bridging Assets on Starknet: L1↔L2 Messaging

**Track:** Starknet Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

You have ETH or ERC-20 tokens on Ethereum mainnet and need to move them to Starknet for use in DeFi protocols or dApps. Unlike EVM-compatible L2s where bridging feels like a simple transfer, Starknet's bridge uses a unique messaging system between L1 (Solidity) and L2 (Cairo) contracts. You need to understand the deposit flow, withdrawal flow (including the mandatory waiting period for proof verification), and how to build custom L1↔L2 messaging into your own contracts.

## Core Concepts

### Bridge Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Ethereum L1                                                     │
│                                                                   │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  StarknetCore.sol    │    │  L1 Token Bridge (ERC-20)    │    │
│  │  - sendMessageToL2() │    │  - deposit()                 │    │
│  │  - consumeMessageL2()│    │  - withdraw()                │    │
│  │  - state root        │    │  - Holds locked tokens       │    │
│  └─────────────────────┘    └──────────────────────────────┘    │
│           │                            │                          │
├───────────┼────────────────────────────┼──────────────────────────┤
│           │    L1 → L2 Messages        │                          │
│           ▼                            ▼                          │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  L2 Message Handler  │    │  L2 Token Bridge (Cairo)     │    │
│  │  - l1_handler        │    │  - handle_deposit()          │    │
│  │  - Processes L1 msgs │    │  - initiate_withdraw()       │    │
│  └─────────────────────┘    │  - Mints/burns L2 tokens     │    │
│                              └──────────────────────────────┘    │
│  Starknet L2                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### L1 → L2 Deposit (Ethereum to Starknet)

Depositing ETH from Ethereum to Starknet:

```typescript
// deposit-to-starknet.ts
import { ethers } from "ethers";

// StarknetCore contract on Ethereum (Sepolia testnet)
// Last verified: 2025-01-15
const STARKNET_CORE_ADDRESS = "0xE2Bb56ee936fd6433DC0F6e7e3b8c33208AbeC75";

const STARKNET_CORE_ABI = [
  "function sendMessageToL2(uint256 toAddress, uint256 selector, uint256[] payload) payable returns (bytes32, uint256)",
  "function l2ToL1Messages(bytes32) view returns (uint256)",
];

// ETH Bridge contract on Ethereum Sepolia
const ETH_BRIDGE_ADDRESS = "0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc";

const ETH_BRIDGE_ABI = [
  "function deposit(uint256 amount, uint256 l2Recipient) payable",
  "event LogDeposit(address indexed l1Sender, uint256 amount, uint256 indexed l2Recipient)",
];

async function depositETHToStarknet(
  l2RecipientAddress: string,
  amountWei: bigint
): Promise<string> {
  const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
  const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY!, provider);

  const bridge = new ethers.Contract(ETH_BRIDGE_ADDRESS, ETH_BRIDGE_ABI, wallet);

  // l2Recipient must be the Starknet account address (felt252 as uint256)
  const l2Recipient = BigInt(l2RecipientAddress);

  console.log(`Depositing ${ethers.formatEther(amountWei)} ETH to Starknet...`);
  console.log(`L2 recipient: ${l2RecipientAddress}`);

  try {
    const tx = await bridge.deposit(amountWei, l2Recipient, {
      value: amountWei, // ETH sent with the transaction
    });

    console.log(`L1 TX hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Confirmed in block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    // Deposit will appear on L2 after the next Starknet block processes L1 messages
    // Typically 5-30 minutes on testnet
    console.log("\nDeposit submitted. Funds will appear on L2 in ~5-30 minutes.");
    console.log("Track status: https://sepolia.starkscan.co/");

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        throw new Error("Not enough ETH for deposit + gas. Get Sepolia ETH from faucet.");
      }
      throw new Error(`Deposit failed: ${error.message}`);
    }
    throw error;
  }
}

// Usage
depositETHToStarknet(
  "0x04a3B2c1D5e6F7890AbCdEf1234567890aBcDeF1234567890AbCdEf12345678",
  ethers.parseEther("0.1")
).catch(console.error);
```

```
Expected output:
Depositing 0.1 ETH to Starknet...
L2 recipient: 0x04a3B2c1D5e6F7890AbCdEf1234567890aBcDeF1234567890AbCdEf12345678
L1 TX hash: 0xabc123def456...
Confirmed in block: 5234567
Gas used: 85432

Deposit submitted. Funds will appear on L2 in ~5-30 minutes.
Track status: https://sepolia.starkscan.co/
```

### L2 → L1 Withdrawal (Starknet to Ethereum)

Withdrawals from Starknet to Ethereum require two steps:

```typescript
// withdraw-from-starknet.ts
import { Account, Provider, Contract, cairo, CallData } from "starknet";

// starknet@6.17.0

const STARKNET_PROVIDER = new Provider({
  nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
});

// ETH token contract on Starknet Sepolia
const L2_ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// L2 Bridge contract on Starknet Sepolia
const L2_BRIDGE_ADDRESS = "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82";

const L2_BRIDGE_ABI = [
  {
    name: "initiate_withdraw",
    type: "function",
    inputs: [
      { name: "l1_recipient", type: "felt" },
      { name: "amount", type: "Uint256" },
    ],
    outputs: [],
  },
];

async function initiateWithdrawal(
  l1RecipientAddress: string,
  amountWei: bigint
): Promise<string> {
  const privateKey = process.env.STARKNET_PRIVATE_KEY!;
  const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS!;

  const account = new Account(STARKNET_PROVIDER, accountAddress, privateKey);
  const bridge = new Contract(L2_BRIDGE_ABI, L2_BRIDGE_ADDRESS, account);

  console.log(`Initiating withdrawal of ${amountWei} wei to L1...`);
  console.log(`L1 recipient: ${l1RecipientAddress}`);

  try {
    // Step 1: Initiate withdrawal on L2
    const { transaction_hash } = await account.execute([
      {
        contractAddress: L2_BRIDGE_ADDRESS,
        entrypoint: "initiate_withdraw",
        calldata: CallData.compile({
          l1_recipient: l1RecipientAddress,
          amount: cairo.uint256(amountWei),
        }),
      },
    ]);

    console.log(`L2 TX hash: ${transaction_hash}`);
    console.log("\nWithdrawal initiated on L2.");
    console.log("Next steps:");
    console.log("  1. Wait for STARK proof to be verified on L1 (~3-12 hours)");
    console.log("  2. Call withdraw() on L1 bridge contract to claim funds");

    return transaction_hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Withdrawal initiation failed: ${error.message}`);
    }
    throw error;
  }
}

// Step 2: Claim on L1 (after proof is verified)
async function claimWithdrawalOnL1(
  l2TxHash: string,
  amount: bigint
): Promise<string> {
  const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
  const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY!, provider);

  const bridge = new ethers.Contract(
    ETH_BRIDGE_ADDRESS,
    ["function withdraw(uint256 amount, address recipient)"],
    wallet
  );

  try {
    const tx = await bridge.withdraw(amount, wallet.address);
    const receipt = await tx.wait();
    console.log(`Withdrawal claimed! L1 TX: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("INVALID_MESSAGE_TO_CONSUME")) {
        throw new Error("Proof not yet verified on L1. Wait longer and retry.");
      }
      throw new Error(`L1 claim failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Custom L1↔L2 Messaging

Build your own cross-layer communication using Starknet's messaging system:

```cairo
// L2 contract that receives messages from L1
// my_l2_receiver.cairo

#[starknet::contract]
mod L2Receiver {
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        l1_sender: felt252,  // Authorized L1 contract address
        received_values: LegacyMap::<u64, u256>,
        message_count: u64,
    }

    // l1_handler functions are called automatically when an L1 message arrives
    // The function name selector must match what L1 sends
    #[l1_handler]
    fn handle_message(ref self: ContractState, from_address: felt252, value: u256) {
        // Verify the message comes from our authorized L1 contract
        assert(from_address == self.l1_sender.read(), 'Unauthorized L1 sender');

        let count = self.message_count.read();
        self.received_values.write(count, value);
        self.message_count.write(count + 1);
    }
}
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// L1 contract that sends messages to Starknet L2
// Interacts with StarknetCore messaging contract

interface IStarknetCore {
    function sendMessageToL2(
        uint256 toAddress,
        uint256 selector,
        uint256[] calldata payload
    ) external payable returns (bytes32 msgHash, uint256 nonce);

    function consumeMessageFromL2(
        uint256 fromAddress,
        uint256[] calldata payload
    ) external returns (bytes32);
}

contract L1Sender {
    IStarknetCore public immutable starknetCore;
    uint256 public immutable l2ReceiverAddress;

    // Selector for "handle_message" on L2
    // Computed as: starknet_keccak("handle_message")
    uint256 constant HANDLE_MESSAGE_SELECTOR =
        0x02d757788a8d8d6f21d1cd40bce38a8222d70654214e96ff95d8086e684fbee5;

    constructor(address _starknetCore, uint256 _l2Receiver) {
        starknetCore = IStarknetCore(_starknetCore);
        l2ReceiverAddress = _l2Receiver;
    }

    function sendToL2(uint256 value) external payable {
        uint256[] memory payload = new uint256[](2);
        payload[0] = value & ((1 << 128) - 1);        // low 128 bits
        payload[1] = value >> 128;                      // high 128 bits

        // msg.value covers the L1→L2 message fee
        starknetCore.sendMessageToL2{value: msg.value}(
            l2ReceiverAddress,
            HANDLE_MESSAGE_SELECTOR,
            payload
        );
    }
}
```

### Withdrawal Timeline

```
L2 → L1 Withdrawal Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

t=0        User calls initiate_withdraw() on L2
           └─ L2 transaction confirmed (~30 seconds)

t=1-3h     Starknet block containing withdrawal is proven
           └─ SHARP generates STARK proof

t=3-12h    Proof verified on Ethereum L1
           └─ State root updated on StarknetCore contract

t=12h+     User calls withdraw() on L1 bridge
           └─ Funds released to L1 address

Total: ~12-24 hours (vs 7 days for optimistic rollups)
```

## Common Pitfalls

1. **Not waiting for proof verification before claiming** — If you call `withdraw()` on L1 before the STARK proof is verified, the transaction will revert with `INVALID_MESSAGE_TO_CONSUME`. Check the Starknet block explorer to confirm your withdrawal transaction's block has been proven on L1.

2. **Using wrong address format** — Starknet addresses are felt252 values (up to 252 bits). When passing a Starknet address to an L1 contract, it must be encoded as a `uint256`. When passing an Ethereum address to L2, it must be a felt252. Truncation or padding errors cause funds to be sent to unreachable addresses.

3. **Forgetting L1→L2 message fees** — Sending a message from L1 to L2 requires paying a fee (sent as `msg.value` to `sendMessageToL2`). If you don't include enough ETH, the transaction reverts. The fee covers the cost of including the message in the next Starknet block.

4. **Assuming instant L1→L2 deposits** — While faster than withdrawals, deposits still take 5-30 minutes because the Starknet sequencer must process the L1 message in the next block. Don't build UX that promises instant availability.

## What to Learn Next

- [Ecosystem Tooling](./04-ecosystem-tooling.md) — Starknet development tools, SDKs, and explorers
- [Starknet Bridge UI](https://starkgate.starknet.io/) — Official bridge interface
- [L1-L2 Messaging Documentation](https://docs.starknet.io/architecture-and-concepts/network-architecture/messaging-mechanism/) — Official messaging reference
- [StarkGate GitHub](https://github.com/starkware-libs/starkgate-contracts) — Bridge contract source code
