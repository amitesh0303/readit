# Bridging Assets on Optimism: Deposits and Withdrawals

**Track:** Optimism & OP Stack Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

Your users need to move ETH and ERC-20 tokens between Ethereum L1 and Optimism L2. Deposits (L1 → L2) are fast (~1-3 minutes), but withdrawals (L2 → L1) take 7 days due to the challenge period. You need to understand the native bridge mechanics, how to integrate them programmatically, and when to use third-party bridges for faster withdrawals. Getting this wrong means stuck funds, failed transactions, or users waiting 7 days when they didn't expect to.

## Core Concepts

### Bridge Architecture

The Optimism native bridge consists of paired contracts on L1 and L2:

```
┌─────────────────────────────────────────────────────────────┐
│                     Native Bridge Flow                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  L1 (Ethereum)                  L2 (Optimism)               │
│  ┌────────────────┐            ┌────────────────┐           │
│  │OptimismPortal  │───deposit──▶│ L2 receives    │           │
│  │(0xbEb5Fc...)   │            │ (1-3 min)      │           │
│  └────────────────┘            └────────────────┘           │
│                                                              │
│  ┌────────────────┐            ┌────────────────┐           │
│  │L1StandardBridge│◀──withdraw─│L2StandardBridge│           │
│  │(0x99C9fc46...) │  (7 days)  │(0x4200...0010) │           │
│  └────────────────┘            └────────────────┘           │
│                                                              │
│  ┌────────────────┐            ┌────────────────┐           │
│  │L1CrossDomain   │◀──message──│L2CrossDomain   │           │
│  │Messenger       │            │Messenger       │           │
│  │(0x25ace71c...) │            │(0x4200...0007) │           │
│  └────────────────┘            └────────────────┘           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Depositing ETH (L1 → L2)

Deposits are initiated on L1 and automatically executed on L2 after the next L1 block is processed by the sequencer:

```typescript
// @eth-optimism/sdk@3.3.1
// ethers@6.13.0
import { ethers } from "ethers";
import { CrossChainMessenger, ETHBridgeAdapter } from "@eth-optimism/sdk";

async function depositETH() {
  // Setup providers
  const l1Provider = new ethers.JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const l2Provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

  const l1Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);
  const l2Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  // Initialize CrossChainMessenger
  const messenger = new CrossChainMessenger({
    l1ChainId: 1,
    l2ChainId: 10,
    l1SignerOrProvider: l1Wallet,
    l2SignerOrProvider: l2Wallet,
    bedrock: true,
  });

  const depositAmount = ethers.parseEther("0.1");

  console.log("Depositing", ethers.formatEther(depositAmount), "ETH to Optimism...");

  try {
    // Initiate deposit on L1
    const tx = await messenger.depositETH(depositAmount);
    console.log("L1 tx hash:", tx.hash);
    console.log("Waiting for L1 confirmation...");

    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction failed");
    console.log("L1 confirmed in block:", receipt.blockNumber);

    // Wait for L2 to process the deposit (typically 1-3 minutes)
    console.log("Waiting for L2 relay (1-3 minutes)...");
    await messenger.waitForMessageStatus(
      tx.hash,
      0 // MessageStatus.RELAYED
    );

    const l2Balance = await l2Provider.getBalance(l2Wallet.address);
    console.log("L2 balance:", ethers.formatEther(l2Balance), "ETH");
    console.log("Deposit complete!");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Deposit failed:", error.message);
    }
    throw error;
  }
}

depositETH().catch(console.error);
```

### Depositing ERC-20 Tokens (L1 → L2)

ERC-20 deposits require an approval step before bridging:

```typescript
// @eth-optimism/sdk@3.3.1
// ethers@6.13.0
import { ethers } from "ethers";
import { CrossChainMessenger } from "@eth-optimism/sdk";

async function depositERC20() {
  const l1Provider = new ethers.JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const l2Provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

  const l1Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);
  const l2Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  const messenger = new CrossChainMessenger({
    l1ChainId: 1,
    l2ChainId: 10,
    l1SignerOrProvider: l1Wallet,
    l2SignerOrProvider: l2Wallet,
    bedrock: true,
  });

  // USDC addresses (different on L1 vs L2!)
  const L1_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const L2_USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
  const amount = ethers.parseUnits("100", 6); // 100 USDC (6 decimals)

  try {
    // Step 1: Approve the L1 Standard Bridge to spend tokens
    console.log("Approving bridge to spend USDC...");
    const approveTx = await messenger.approveERC20(L1_USDC, L2_USDC, amount);
    await approveTx.wait();
    console.log("Approval confirmed");

    // Step 2: Initiate the deposit
    console.log("Depositing", ethers.formatUnits(amount, 6), "USDC...");
    const depositTx = await messenger.depositERC20(L1_USDC, L2_USDC, amount);
    console.log("L1 tx:", depositTx.hash);

    const receipt = await depositTx.wait();
    if (!receipt) throw new Error("Deposit transaction failed");
    console.log("L1 confirmed, waiting for L2 relay...");

    // Step 3: Wait for L2 processing
    await messenger.waitForMessageStatus(depositTx.hash, 0);
    console.log("ERC-20 deposit complete on L2!");
  } catch (error) {
    if (error instanceof Error) {
      console.error("ERC-20 deposit failed:", error.message);
      // Common failure: insufficient allowance or balance
      if (error.message.includes("insufficient")) {
        console.error("Check your L1 token balance and allowance");
      }
    }
    throw error;
  }
}

depositERC20().catch(console.error);
```

### Withdrawing ETH (L2 → L1) — The 7-Day Process

Withdrawals are a multi-step process due to the challenge period:

```typescript
// @eth-optimism/sdk@3.3.1
// ethers@6.13.0
import { ethers } from "ethers";
import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";

async function withdrawETH() {
  const l1Provider = new ethers.JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const l2Provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

  const l1Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);
  const l2Wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  const messenger = new CrossChainMessenger({
    l1ChainId: 1,
    l2ChainId: 10,
    l1SignerOrProvider: l1Wallet,
    l2SignerOrProvider: l2Wallet,
    bedrock: true,
  });

  const withdrawAmount = ethers.parseEther("0.05");

  try {
    // Step 1: Initiate withdrawal on L2
    console.log("Initiating withdrawal on L2...");
    const withdrawTx = await messenger.withdrawETH(withdrawAmount);
    console.log("L2 tx:", withdrawTx.hash);
    await withdrawTx.wait();
    console.log("L2 withdrawal initiated");

    // Step 2: Wait for state root to be published (~1 hour)
    console.log("Waiting for state root publication (~1 hour)...");
    await messenger.waitForMessageStatus(
      withdrawTx.hash,
      MessageStatus.READY_TO_PROVE
    );

    // Step 3: Prove the withdrawal on L1
    console.log("Proving withdrawal on L1...");
    const proveTx = await messenger.proveMessage(withdrawTx.hash);
    await proveTx.wait();
    console.log("Withdrawal proved");

    // Step 4: Wait for challenge period (7 days)
    console.log("Waiting for 7-day challenge period...");
    await messenger.waitForMessageStatus(
      withdrawTx.hash,
      MessageStatus.READY_FOR_RELAY
    );

    // Step 5: Finalize the withdrawal on L1
    console.log("Finalizing withdrawal on L1...");
    const finalizeTx = await messenger.finalizeMessage(withdrawTx.hash);
    await finalizeTx.wait();
    console.log("Withdrawal finalized! ETH is now on L1.");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Withdrawal failed at step:", error.message);
    }
    throw error;
  }
}

// Helper: Check withdrawal status
async function checkWithdrawalStatus(l2TxHash: string) {
  const l1Provider = new ethers.JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );
  const l2Provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");

  const messenger = new CrossChainMessenger({
    l1ChainId: 1,
    l2ChainId: 10,
    l1SignerOrProvider: l1Provider,
    l2SignerOrProvider: l2Provider,
    bedrock: true,
  });

  const status = await messenger.getMessageStatus(l2TxHash);
  const statusNames: Record<number, string> = {
    0: "UNCONFIRMED_L1_TO_L2_MESSAGE",
    1: "FAILED_L1_TO_L2_MESSAGE",
    2: "STATE_ROOT_NOT_PUBLISHED",
    3: "READY_TO_PROVE",
    4: "IN_CHALLENGE_PERIOD",
    5: "READY_FOR_RELAY",
    6: "RELAYED",
  };

  console.log("Withdrawal status:", statusNames[status] || "UNKNOWN");
  return status;
}

withdrawETH().catch(console.error);
```

### Fast Withdrawals via Third-Party Bridges

For users who can't wait 7 days, third-party bridges provide faster exits (minutes instead of days) by fronting liquidity:

```typescript
// Example: Using Across Protocol for fast bridging
// @across-protocol/sdk@3.0.0
// Note: Third-party bridges charge a fee (typically 0.04-0.12%)

import { ethers } from "ethers";

// Across Protocol bridge contract on Optimism
const ACROSS_SPOKE_POOL_OP = "0x6f26Bf09B1C792e3228e5467807a900A503c0281";

const spokePoolAbi = [
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable",
];

async function fastBridgeToL1(amount: bigint) {
  const l2Provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  const spokePool = new ethers.Contract(
    ACROSS_SPOKE_POOL_OP,
    spokePoolAbi,
    wallet
  );

  const recipient = wallet.address;
  const WETH_OP = "0x4200000000000000000000000000000000000006";
  const WETH_L1 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  // Fee is deducted from output amount (typically ~0.06%)
  const outputAmount = amount * 9994n / 10000n; // 0.06% fee estimate

  const fillDeadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const quoteTimestamp = Math.floor(Date.now() / 1000);

  try {
    const tx = await spokePool.depositV3(
      wallet.address,       // depositor
      recipient,            // recipient on L1
      WETH_OP,             // input token (WETH on OP)
      WETH_L1,            // output token (WETH on L1)
      amount,              // input amount
      outputAmount,        // output amount (minus fee)
      1,                   // destination chain ID (Ethereum)
      ethers.ZeroAddress,  // no exclusive relayer
      quoteTimestamp,
      fillDeadline,
      0,                   // no exclusivity deadline
      "0x",               // no message
      { value: amount }    // send ETH
    );

    console.log("Fast bridge tx:", tx.hash);
    console.log("Expected arrival: 2-10 minutes");
    await tx.wait();
    console.log("Bridge transaction confirmed on L2");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Fast bridge failed:", error.message);
    }
    throw error;
  }
}
```

## Common Pitfalls

1. **Not explaining the 7-day wait to users** — If your dApp uses the native bridge for withdrawals, users will be surprised by the 7-day delay. Always show clear UI messaging about the challenge period. Consider integrating a fast bridge (Across, Stargate, Hop) for better UX.

2. **Forgetting the prove step** — Withdrawals require three L1 transactions: initiate (L2), prove (L1), and finalize (L1). If you skip the prove step, the withdrawal will never complete. Automate this with a backend service or remind users to return after the state root is published.

3. **Using wrong token addresses across chains** — L1 USDC (`0xA0b8...`) and L2 USDC (`0x0b2C...`) are different contracts. The Optimism token list maps L1 ↔ L2 addresses. Always verify addresses from the official bridge UI or token list before integrating.

4. **Not handling deposit failures** — L1 → L2 deposits can fail if the L2 execution reverts (e.g., the receiving contract doesn't accept ETH). Failed deposits are not automatically refunded — you need to replay them. Always test deposits on Sepolia first.

5. **Ignoring gas costs of the prove and finalize transactions** — The prove and finalize steps happen on L1 and cost L1 gas (can be $5-50 depending on gas prices). For small withdrawals, the L1 gas cost may exceed the withdrawal amount. Factor this into your UX.

## What to Learn Next

- [Optimism Ecosystem Tooling](./04-ecosystem-tooling.md) — explore the OP SDK, block explorers, and developer tools
- [Optimism Bridge Documentation](https://docs.optimism.io/builders/app-developers/bridging/standard-bridge) — official bridge integration guide
- [Optimism SDK GitHub](https://github.com/ethereum-optimism/optimism/tree/develop/packages/sdk) — source code for the CrossChainMessenger
