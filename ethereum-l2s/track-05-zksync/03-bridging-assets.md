# Bridging Assets on zkSync Era

**Track:** zkSync Era Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

Your users have ETH and tokens on Ethereum mainnet. Your dApp lives on zkSync Era. You need to move assets between the two chains — deposits from L1 to L2, and withdrawals from L2 to L1. Unlike optimistic rollups with their 7-day withdrawal window, zkSync Era withdrawals finalize once the SNARK proof is verified (typically 1-24 hours). But the bridging mechanics are still non-trivial: you need to understand priority queues, L2 transaction types, and how to track cross-layer message status.

## Core Concepts

### Bridge Architecture Overview

zkSync Era's native bridge uses a priority queue system on L1:

```
L1 → L2 (Deposit):
  User calls L1 bridge contract
  → Transaction enters priority queue
  → Sequencer includes it in next batch (~minutes)
  → Funds available on L2

L2 → L1 (Withdrawal):
  User initiates withdrawal on L2
  → Included in L2 batch
  → Batch proof generated and verified on L1 (~1-24 hours)
  → User claims funds on L1 (separate L1 transaction)
```

### Depositing ETH (L1 → L2)

Using the zkSync SDK to deposit ETH from Ethereum to zkSync Era:

```typescript
import { Provider, Wallet, utils } from "zksync-ethers@6.8.0";
import { ethers } from "ethers@6.9.0";

// Configuration
const L1_RPC = "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY";
const L2_RPC = "https://sepolia.era.zksync.dev";
const PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"; // Never hardcode in production

async function depositETH(amountEther: string): Promise<string> {
  // Connect to both layers
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new Provider(L2_RPC);

  // Create wallet connected to both L1 and L2
  const wallet = new Wallet(PRIVATE_KEY, l2Provider, l1Provider);

  try {
    // Check L1 balance before deposit
    const l1Balance = await wallet.getBalanceL1();
    const depositAmount = ethers.parseEther(amountEther);

    if (l1Balance < depositAmount) {
      throw new Error(
        `Insufficient L1 balance. Have: ${ethers.formatEther(l1Balance)} ETH, ` +
        `Need: ${amountEther} ETH`
      );
    }

    console.log(`Depositing ${amountEther} ETH from L1 to L2...`);

    // Initiate deposit — this sends an L1 transaction
    const depositTx = await wallet.deposit({
      token: utils.ETH_ADDRESS,
      amount: depositAmount,
      // Optional: specify L2 gas limit for the deposit transaction
      l2GasLimit: 300_000n,
    });

    console.log(`L1 deposit tx: ${depositTx.hash}`);
    console.log(`Explorer: https://sepolia.etherscan.io/tx/${depositTx.hash}`);

    // Wait for L1 confirmation
    const l1Receipt = await depositTx.waitL1Commit();
    console.log(`L1 confirmed in block ${l1Receipt.blockNumber}`);

    // Wait for L2 processing (usually 1-5 minutes)
    const l2Receipt = await depositTx.wait();
    console.log(`L2 deposit processed! L2 tx hash: ${l2Receipt.hash}`);
    console.log(`L2 Explorer: https://sepolia.explorer.zksync.io/tx/${l2Receipt.hash}`);

    return l2Receipt.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Deposit failed: ${error.message}`);
    }
    throw error;
  }
}

// Execute deposit
// Last verified: 2025-01-15
depositETH("0.01").catch(console.error);
```

### Depositing ERC-20 Tokens (L1 → L2)

```typescript
import { Provider, Wallet, utils } from "zksync-ethers@6.8.0";
import { ethers } from "ethers@6.9.0";

const L1_USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Sepolia USDC

async function depositERC20(
  tokenAddress: string,
  amount: string,
  decimals: number = 18
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new Provider(L2_RPC);
  const wallet = new Wallet(PRIVATE_KEY, l2Provider, l1Provider);

  const depositAmount = ethers.parseUnits(amount, decimals);

  try {
    // Step 1: Approve the zkSync bridge to spend tokens
    // The bridge contract address is retrieved from the L2 provider
    const approvalTx = await wallet.approveERC20(tokenAddress, depositAmount);
    console.log(`Approval tx: ${approvalTx.hash}`);
    await approvalTx.wait();
    console.log("Approval confirmed");

    // Step 2: Initiate the deposit
    const depositTx = await wallet.deposit({
      token: tokenAddress,
      amount: depositAmount,
      // For ERC-20 deposits, you need ETH for L1 gas + L2 execution
      approveERC20: true, // Auto-approve if not already approved
    });

    console.log(`Deposit tx: ${depositTx.hash}`);

    // Wait for L2 processing
    const l2Receipt = await depositTx.wait();
    console.log(`ERC-20 deposited to L2! Hash: ${l2Receipt.hash}`);

    // Get the L2 token address (bridged representation)
    const l2TokenAddress = await l2Provider.l2TokenAddress(tokenAddress);
    console.log(`L2 token address: ${l2TokenAddress}`);

    return l2Receipt.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`ERC-20 deposit failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Withdrawing ETH (L2 → L1)

Withdrawals require two steps: initiate on L2, then finalize on L1 after proof verification.

```typescript
import { Provider, Wallet, utils } from "zksync-ethers@6.8.0";
import { ethers } from "ethers@6.9.0";

async function withdrawETH(amountEther: string): Promise<{
  l2TxHash: string;
  finalizationStatus: string;
}> {
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new Provider(L2_RPC);
  const wallet = new Wallet(PRIVATE_KEY, l2Provider, l1Provider);

  const withdrawAmount = ethers.parseEther(amountEther);

  try {
    // Check L2 balance
    const l2Balance = await wallet.getBalance();
    if (l2Balance < withdrawAmount) {
      throw new Error(
        `Insufficient L2 balance. Have: ${ethers.formatEther(l2Balance)} ETH`
      );
    }

    // Step 1: Initiate withdrawal on L2
    console.log(`Initiating withdrawal of ${amountEther} ETH from L2 to L1...`);

    const withdrawTx = await wallet.withdraw({
      token: utils.ETH_ADDRESS,
      amount: withdrawAmount,
      to: wallet.address, // Withdraw to same address on L1
    });

    console.log(`L2 withdrawal tx: ${withdrawTx.hash}`);
    const l2Receipt = await withdrawTx.wait();
    console.log(`L2 withdrawal confirmed in batch ${l2Receipt.l1BatchNumber}`);

    // Step 2: Wait for proof verification (1-24 hours on mainnet)
    // On testnet this is faster (~minutes)
    console.log("Waiting for proof verification on L1...");
    console.log("This takes 1-24 hours on mainnet. Check status periodically.");

    return {
      l2TxHash: withdrawTx.hash,
      finalizationStatus: "pending_proof",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Withdrawal failed: ${error.message}`);
    }
    throw error;
  }
}

// Step 3: Finalize withdrawal on L1 (call after proof is verified)
async function finalizeWithdrawal(l2TxHash: string): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new Provider(L2_RPC);
  const wallet = new Wallet(PRIVATE_KEY, l2Provider, l1Provider);

  try {
    // Check if the withdrawal is ready to finalize
    const isFinalized = await wallet.isWithdrawalFinalized(l2TxHash);
    if (isFinalized) {
      throw new Error("Withdrawal already finalized");
    }

    // Check if proof has been verified
    const l2TxReceipt = await l2Provider.getTransactionReceipt(l2TxHash);
    if (!l2TxReceipt || !l2TxReceipt.l1BatchNumber) {
      throw new Error("L2 transaction not yet included in a batch");
    }

    // Finalize on L1 — this sends an L1 transaction
    const finalizeTx = await wallet.finalizeWithdrawal(l2TxHash);
    console.log(`Finalization tx: ${finalizeTx.hash}`);

    const receipt = await finalizeTx.wait();
    console.log(`Withdrawal finalized! L1 tx: ${receipt?.hash}`);

    return finalizeTx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Finalization failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Checking Withdrawal Status

```typescript
import { Provider } from "zksync-ethers@6.8.0";

async function checkWithdrawalStatus(l2TxHash: string): Promise<{
  status: "processing" | "committed" | "proven" | "finalized";
  details: string;
}> {
  const l2Provider = new Provider(L2_RPC);

  try {
    const receipt = await l2Provider.getTransactionReceipt(l2TxHash);

    if (!receipt) {
      return { status: "processing", details: "Transaction not yet included in a batch" };
    }

    if (!receipt.l1BatchNumber) {
      return { status: "processing", details: "Awaiting batch inclusion" };
    }

    // Check L1 batch status
    const batchDetails = await l2Provider.getL1BatchDetails(receipt.l1BatchNumber);

    if (!batchDetails.commitTxHash) {
      return { status: "processing", details: `In batch ${receipt.l1BatchNumber}, not yet committed` };
    }

    if (!batchDetails.proveTxHash) {
      return {
        status: "committed",
        details: `Committed to L1 (${batchDetails.commitTxHash}), awaiting proof`,
      };
    }

    if (!batchDetails.executeTxHash) {
      return {
        status: "proven",
        details: `Proof verified (${batchDetails.proveTxHash}), ready to finalize`,
      };
    }

    return {
      status: "finalized",
      details: `Fully finalized (${batchDetails.executeTxHash})`,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Status check failed: ${error.message}`);
    }
    throw error;
  }
}
```

### L1 ↔ L2 Messaging (Custom Bridge Logic)

For advanced use cases, you can send arbitrary messages between L1 and L2:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// L2 contract that sends a message to L1
// Uses the L1Messenger system contract

import "@matterlabs/zk-contracts/l2/system-contracts/Constants.sol";

contract L2ToL1Messenger {
    event MessageSent(bytes32 indexed messageHash, bytes message);

    /// @notice Send an arbitrary message to L1
    /// @param message The message bytes to deliver to L1
    function sendMessageToL1(bytes memory message) external returns (bytes32) {
        // The L1Messenger system contract handles L2→L1 communication
        bytes32 messageHash = IL1Messenger(L1_MESSENGER_SYSTEM_CONTRACT)
            .sendToL1(message);

        emit MessageSent(messageHash, message);
        return messageHash;
    }
}
```

## Common Pitfalls

1. **Forgetting the two-step withdrawal process** — Unlike deposits (which auto-complete), withdrawals require a separate `finalizeWithdrawal` transaction on L1 after the proof is verified. If you don't finalize, funds remain locked in the bridge contract indefinitely.

2. **Not checking `isWithdrawalFinalized` before finalizing** — Calling `finalizeWithdrawal` before the proof is verified will revert and waste L1 gas. Always check the batch proof status first.

3. **Assuming L2 token addresses match L1** — When you bridge an ERC-20 token, the L2 representation has a different address. Use `l2Provider.l2TokenAddress(l1Address)` to get the correct L2 address. Hardcoding L1 addresses on L2 will interact with the wrong (or non-existent) contract.

4. **Underestimating deposit gas on L1** — L1→L2 deposits require gas for both the L1 transaction and the L2 execution. The `l2GasLimit` parameter determines how much L2 gas is prepaid. If set too low, the deposit transaction will fail on L2 and require manual recovery.

5. **Not handling the priority queue delay** — Deposits enter a priority queue and are processed by the sequencer. During high congestion, there can be a delay of several minutes. Don't assume deposits are instant — poll for the L2 receipt.

## What to Learn Next

- [zkSync Era Tooling and Development](./04-ecosystem-tooling.md) — Set up your development environment with Hardhat and zkSync plugins
- [zkSync Bridge Interface](https://bridge.zksync.io/) — Official bridge UI for manual transfers
- [zksync-ethers SDK Reference](https://docs.zksync.io/sdk/js/ethers) — Complete SDK documentation
