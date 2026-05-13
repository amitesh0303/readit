# Bridging Assets on Mantle: Deposits and Withdrawals

**Track:** Mantle Network Development
**Lesson:** 3 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

Your users need to move assets between Ethereum mainnet and Mantle. Unlike most L2s where you only bridge ETH and ERC-20 tokens, Mantle adds complexity: MNT is the native gas token on L2, ETH exists as a wrapped ERC-20 on Mantle, and the native bridge has a 7-day withdrawal delay. You need to understand both directions — deposits (L1→L2) and withdrawals (L2→L1) — including how to handle MNT, ETH, and arbitrary ERC-20 tokens programmatically.

## Core Concepts

### Bridge Architecture Overview

Mantle's bridge is based on the OP Stack's standard bridge with modifications for the MNT gas token:

```
┌─────────────────────────────────────────────────────────┐
│                  Mantle Bridge Flow                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  L1 (Ethereum)                L2 (Mantle)               │
│  ┌──────────────┐            ┌──────────────┐          │
│  │ L1 Standard  │  Deposit   │ L2 Standard  │          │
│  │ Bridge       │ ────────→  │ Bridge       │          │
│  │              │            │              │          │
│  │ Holds locked │  Withdraw  │ Mints/burns  │          │
│  │ assets       │ ←────────  │ L2 tokens    │          │
│  └──────────────┘            └──────────────┘          │
│                                                         │
│  Key Addresses (Mainnet):                               │
│  L1StandardBridge: 0x95fC37A27a2f68e3A647CDc081F0A89bb47c3012 │
│  L1CrossDomainMessenger: 0x676A795fe6E43C17c668de16730c3F690FEB7120 │
│                                                         │
│  Deposit time: ~10-20 minutes                           │
│  Withdrawal time: ~7 days (challenge period)            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Depositing ETH (L1 → L2)

When you deposit ETH from Ethereum to Mantle, it arrives as wrapped ETH (WETH) on Mantle since MNT is the native token:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Mantle L1 Standard Bridge on Ethereum mainnet
const L1_STANDARD_BRIDGE = "0x95fC37A27a2f68e3A647CDc081F0A89bb47c3012";

const L1_BRIDGE_ABI = [
  "function depositETH(uint32 _minGasLimit, bytes _extraData) payable",
  "function depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable",
  "function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)",
  "function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
];

async function depositETHToMantle(
  l1Provider: ethers.JsonRpcProvider,
  privateKey: string,
  amountEth: string
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, l1Provider);
  const bridge = new ethers.Contract(L1_STANDARD_BRIDGE, L1_BRIDGE_ABI, wallet);

  const amount = ethers.parseEther(amountEth);
  const minGasLimit = 200_000; // L2 gas for the deposit relay

  console.log(`Depositing ${amountEth} ETH to Mantle...`);
  console.log(`ETH will arrive as WETH (ERC-20) on Mantle`);

  try {
    const tx = await bridge.depositETH(
      minGasLimit,
      "0x", // No extra data
      { value: amount }
    );

    console.log(`L1 tx hash: ${tx.hash}`);
    console.log(`Waiting for L1 confirmation...`);

    const receipt = await tx.wait();
    console.log(`L1 confirmed in block ${receipt?.blockNumber}`);
    console.log(`Deposit will arrive on Mantle in ~10-20 minutes`);
    console.log(`ETH will appear as WETH at: 0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111`);

    return receipt;
  } catch (error) {
    console.error("Deposit failed:", error);
    throw error;
  }
}

// Usage
const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");
await depositETHToMantle(l1Provider, "YOUR_PRIVATE_KEY", "0.1");
```

### Depositing MNT (L1 → L2)

MNT exists as an ERC-20 on Ethereum L1. When bridged to Mantle, it becomes the native gas token:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// MNT token on Ethereum L1
const MNT_L1_ADDRESS = "0x3c3a81e81dc49A522A592e7622A7E711c06bf354";
const L1_STANDARD_BRIDGE = "0x95fC37A27a2f68e3A647CDc081F0A89bb47c3012";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

const BRIDGE_ABI = [
  "function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)",
  "function depositMNT(uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
];

async function depositMNTToMantle(
  l1Provider: ethers.JsonRpcProvider,
  privateKey: string,
  amountMNT: string
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, l1Provider);
  const mntToken = new ethers.Contract(MNT_L1_ADDRESS, ERC20_ABI, wallet);
  const bridge = new ethers.Contract(L1_STANDARD_BRIDGE, BRIDGE_ABI, wallet);

  const amount = ethers.parseEther(amountMNT);

  // Step 1: Check MNT balance on L1
  const balance = await mntToken.balanceOf(wallet.address);
  if (balance < amount) {
    throw new Error(`Insufficient MNT. Have: ${ethers.formatEther(balance)}, Need: ${amountMNT}`);
  }

  // Step 2: Approve bridge to spend MNT
  const allowance = await mntToken.allowance(wallet.address, L1_STANDARD_BRIDGE);
  if (allowance < amount) {
    console.log("Approving bridge to spend MNT...");
    const approveTx = await mntToken.approve(L1_STANDARD_BRIDGE, amount);
    await approveTx.wait();
    console.log("Approval confirmed");
  }

  // Step 3: Deposit MNT through the bridge
  console.log(`Depositing ${amountMNT} MNT to Mantle...`);
  console.log(`MNT will arrive as native gas token on Mantle`);

  const tx = await bridge.depositMNT(
    amount,
    200_000, // L2 gas limit
    "0x"     // No extra data
  );

  console.log(`L1 tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Deposit confirmed. MNT will arrive on Mantle in ~10-20 minutes`);

  return receipt;
}
```

### Withdrawing from Mantle (L2 → L1)

Withdrawals follow the standard optimistic rollup pattern with a 7-day challenge period:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// L2 Standard Bridge on Mantle
const L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";

const L2_BRIDGE_ABI = [
  "function withdraw(address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData) payable",
  "function withdrawTo(address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData) payable"
];

// Predeploy addresses on Mantle (OP Stack standard)
const L2_ADDRESSES = {
  L2StandardBridge: "0x4200000000000000000000000000000000000010",
  L2CrossDomainMessenger: "0x4200000000000000000000000000000000000007",
  L2ToL1MessagePasser: "0x4200000000000000000000000000000000000016",
  WETH: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111"
};

async function withdrawETHFromMantle(
  l2Provider: ethers.JsonRpcProvider,
  privateKey: string,
  amountEth: string
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, l2Provider);
  const bridge = new ethers.Contract(L2_STANDARD_BRIDGE, L2_BRIDGE_ABI, wallet);

  const amount = ethers.parseEther(amountEth);

  // Withdrawing WETH from Mantle → ETH on Ethereum
  console.log(`Initiating withdrawal of ${amountEth} WETH from Mantle...`);
  console.log(`⚠️  Withdrawal requires ~7 days to finalize on L1`);

  try {
    const tx = await bridge.withdraw(
      L2_ADDRESSES.WETH,  // L2 token address (WETH on Mantle)
      amount,
      200_000,            // L1 gas limit for finalization
      "0x"               // No extra data
    );

    console.log(`L2 tx hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Withdrawal initiated in block ${receipt?.blockNumber}`);
    console.log(`\nNext steps:`);
    console.log(`1. Wait ~7 days for the challenge period`);
    console.log(`2. Prove the withdrawal on L1`);
    console.log(`3. Finalize the withdrawal on L1`);
    console.log(`\nOr use a third-party bridge for faster withdrawals`);

    return receipt;
  } catch (error) {
    console.error("Withdrawal failed:", error);
    throw error;
  }
}
```

### Third-Party Bridges for Faster Transfers

The native bridge's 7-day delay is impractical for most users. Third-party bridges provide faster alternatives:

| Bridge | Speed | Fee | Supported Assets |
|---|---|---|---|
| [Across Protocol](https://across.to) | ~2-5 min | 0.04-0.12% | ETH, USDC, USDT, WBTC |
| [Stargate](https://stargate.finance) | ~1-5 min | 0.06% | ETH, USDC, USDT |
| [Orbiter Finance](https://orbiter.finance) | ~1-3 min | Variable | ETH, USDC, USDT |
| [Mantle Bridge](https://bridge.mantle.xyz) | ~10 min (deposit) / 7 days (withdraw) | Gas only | All supported tokens |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Example: Check if a third-party bridge is more economical
async function compareBridgeOptions(
  amount: bigint,
  l1GasPrice: bigint
): Promise<void> {
  // Native bridge cost: L1 gas for deposit tx (~100k gas)
  const nativeBridgeCost = 100_000n * l1GasPrice;

  // Third-party bridge: typically 0.04-0.12% fee
  const thirdPartyFee = amount * 6n / 10_000n; // 0.06% average

  console.log(`Amount to bridge: ${ethers.formatEther(amount)} ETH`);
  console.log(`Native bridge gas cost: ${ethers.formatEther(nativeBridgeCost)} ETH`);
  console.log(`Third-party bridge fee: ${ethers.formatEther(thirdPartyFee)} ETH`);

  if (nativeBridgeCost < thirdPartyFee) {
    console.log(`→ Native bridge is cheaper (but takes 7 days for withdrawals)`);
  } else {
    console.log(`→ Third-party bridge is cheaper AND faster`);
  }
}

// For a 1 ETH transfer at 30 gwei gas price
await compareBridgeOptions(ethers.parseEther("1"), 30_000_000_000n);
```

### Monitoring Bridge Transactions

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

const L1_CROSS_DOMAIN_MESSENGER = "0x676A795fe6E43C17c668de16730c3F690FEB7120";

const MESSENGER_ABI = [
  "event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)",
  "event RelayedMessage(bytes32 indexed msgHash)"
];

async function monitorDeposit(
  l1Provider: ethers.JsonRpcProvider,
  l2Provider: ethers.JsonRpcProvider,
  l1TxHash: string
): Promise<void> {
  // Get the L1 transaction receipt
  const receipt = await l1Provider.getTransactionReceipt(l1TxHash);
  if (!receipt) {
    throw new Error("L1 transaction not found");
  }

  console.log(`L1 tx confirmed in block ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 1 ? "Success" : "Failed"}`);

  // Parse SentMessage event from the CrossDomainMessenger
  const messenger = new ethers.Contract(
    L1_CROSS_DOMAIN_MESSENGER,
    MESSENGER_ABI,
    l1Provider
  );

  const sentEvents = receipt.logs
    .filter(log => log.address.toLowerCase() === L1_CROSS_DOMAIN_MESSENGER.toLowerCase())
    .map(log => {
      try {
        return messenger.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (sentEvents.length > 0) {
    console.log(`\nCross-domain message sent. Waiting for relay on L2...`);
    console.log(`Expected arrival: ~10-20 minutes`);
    console.log(`Monitor on Mantle Explorer: https://explorer.mantle.xyz`);
  }
}
```

## Common Pitfalls

1. **Confusing ETH and MNT when bridging** — ETH deposited to Mantle becomes WETH (an ERC-20), not the native token. MNT deposited becomes the native gas token. If you send ETH expecting to receive native gas token, you'll have WETH but no MNT to pay for transactions.

2. **Not approving tokens before bridging ERC-20s** — The L1 Standard Bridge needs ERC-20 approval before it can transfer tokens. Forgetting the approve step causes the deposit transaction to revert. Always check allowance first.

3. **Underestimating the 7-day withdrawal delay** — Native withdrawals from Mantle to Ethereum take ~7 days. For time-sensitive operations, use a third-party bridge like Across or Stargate that provides liquidity upfront for a small fee.

4. **Using wrong L2 token addresses** — Each L1 token has a specific L2 representation on Mantle. Using the wrong L2 token address in withdrawal calls will fail. Always verify token mappings via the Mantle token list or bridge UI.

5. **Not reserving MNT for gas after bridging** — If you bridge all your MNT to ETH or other tokens on Mantle, you won't have gas to execute transactions. Always keep a small MNT reserve for gas fees.

## What to Learn Next

- [Ecosystem Tooling](./04-ecosystem-tooling.md) — Set up your development environment with Mantle-specific tools and SDKs
- [Mantle Bridge UI](https://bridge.mantle.xyz) — Official bridge interface for manual transfers
- [Mantle Docs: Bridge](https://docs.mantle.xyz/network/for-devs/cross-l1-l2-communication) — Official bridge documentation and contract addresses
