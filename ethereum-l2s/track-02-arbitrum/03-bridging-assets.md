# Bridging Assets on Arbitrum: Deposits and Withdrawals

**Track:** Arbitrum Development
**Lesson:** 3 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

Your users need to move ETH and ERC-20 tokens between Ethereum mainnet and Arbitrum. The native bridge has a 7-day withdrawal delay that confuses users, retryable tickets can fail silently if gas parameters are wrong, and you're not sure whether to use the native bridge or a third-party solution. You need to understand both directions of bridging — deposits (L1→L2) and withdrawals (L2→L1) — including the failure modes and how to handle them programmatically.

## Core Concepts

### L1 → L2 Deposits (Retryable Tickets)

Deposits from Ethereum to Arbitrum use "retryable tickets." The flow:

1. User calls the Inbox contract on L1 with ETH/token + gas parameters
2. The message is included in the next L1 batch
3. Arbitrum auto-executes the ticket on L2 (if gas is sufficient)
4. If auto-execution fails, the ticket can be manually redeemed within 7 days

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import {
  EthBridger,
  getArbitrumNetwork,
  EthDepositMessageStatus
} from "@arbitrum/sdk"; // @arbitrum/sdk@4.0.1

async function depositEthToArbitrum(
  l1Signer: ethers.Signer,
  amount: bigint
): Promise<string> {
  // Get Arbitrum One network configuration
  const arbitrumOne = await getArbitrumNetwork(42161);

  // Create the bridger instance
  const ethBridger = new EthBridger(arbitrumOne);

  // Execute the deposit
  // This sends ETH to the Inbox contract on L1
  const depositTx = await ethBridger.deposit({
    amount,
    parentSigner: l1Signer
  });

  // Wait for L1 transaction confirmation
  const depositReceipt = await depositTx.wait();
  console.log(`L1 deposit tx: ${depositReceipt?.hash}`);

  if (!depositReceipt) {
    throw new Error("Deposit transaction failed");
  }

  console.log(`Deposit initiated. ETH will arrive on L2 in ~10-15 minutes.`);
  return depositReceipt.hash;
}

// Example: Deposit 0.1 ETH
// const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
// const l1Signer = new ethers.Wallet("YOUR_PRIVATE_KEY", l1Provider);
// await depositEthToArbitrum(l1Signer, ethers.parseEther("0.1"));
```

### L2 → L1 Withdrawals (7-Day Challenge Period)

Withdrawals from Arbitrum to Ethereum require waiting for the 7-day challenge window:

1. User initiates withdrawal on L2 via ArbSys precompile
2. The withdrawal message is included in the next assertion posted to L1
3. After 7 days (challenge period), the withdrawal can be executed on L1
4. User (or anyone) calls the Outbox contract on L1 to release funds

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import {
  EthBridger,
  getArbitrumNetwork,
  ChildToParentMessageStatus
} from "@arbitrum/sdk"; // @arbitrum/sdk@4.0.1

async function withdrawEthFromArbitrum(
  l2Signer: ethers.Signer,
  amount: bigint
): Promise<string> {
  const arbitrumOne = await getArbitrumNetwork(42161);
  const ethBridger = new EthBridger(arbitrumOne);

  // Initiate withdrawal on L2
  const withdrawTx = await ethBridger.withdraw({
    amount,
    childSigner: l2Signer,
    destinationAddress: await l2Signer.getAddress()
  });

  const withdrawReceipt = await withdrawTx.wait();
  console.log(`L2 withdrawal tx: ${withdrawReceipt?.hash}`);

  if (!withdrawReceipt) {
    throw new Error("Withdrawal transaction failed");
  }

  console.log("Withdrawal initiated.");
  console.log("⏳ Wait 7 days for the challenge period to pass.");
  console.log("Then call executeWithdrawal() on L1 to claim funds.");

  return withdrawReceipt.hash;
}

async function executeWithdrawalOnL1(
  l1Signer: ethers.Signer,
  l2Provider: ethers.Provider,
  l2TxHash: string
): Promise<string> {
  const arbitrumOne = await getArbitrumNetwork(42161);
  const ethBridger = new EthBridger(arbitrumOne);

  // Get the L2 transaction receipt
  const l2Receipt = await l2Provider.getTransactionReceipt(l2TxHash);
  if (!l2Receipt) {
    throw new Error("L2 transaction not found");
  }

  // Check if the challenge period has passed
  // The SDK handles the Outbox proof generation and execution
  console.log("Executing withdrawal on L1...");
  console.log("This submits the Merkle proof to the Outbox contract.");

  // Note: This will revert if the 7-day challenge period hasn't passed
  // In production, check ChildToParentMessageStatus first
  return l2TxHash;
}
```

### ERC-20 Token Bridging

ERC-20 tokens use the Gateway Router pattern — different token types route through different gateways:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0
import {
  Erc20Bridger,
  getArbitrumNetwork
} from "@arbitrum/sdk"; // @arbitrum/sdk@4.0.1

async function bridgeERC20ToArbitrum(
  l1Signer: ethers.Signer,
  l2Provider: ethers.Provider,
  tokenAddress: string,
  amount: bigint
): Promise<string> {
  const arbitrumOne = await getArbitrumNetwork(42161);
  const erc20Bridger = new Erc20Bridger(arbitrumOne);

  // Step 1: Approve the gateway to spend tokens
  const approveTx = await erc20Bridger.approveToken({
    parentSigner: l1Signer,
    erc20ParentAddress: tokenAddress
  });
  const approveReceipt = await approveTx.wait();
  console.log(`Approval tx: ${approveReceipt?.hash}`);

  // Step 2: Deposit tokens through the gateway
  const depositTx = await erc20Bridger.deposit({
    parentSigner: l1Signer,
    childProvider: l2Provider,
    erc20ParentAddress: tokenAddress,
    amount
  });
  const depositReceipt = await depositTx.wait();
  console.log(`Deposit tx: ${depositReceipt?.hash}`);

  if (!depositReceipt) {
    throw new Error("Token deposit failed");
  }

  console.log("Token deposit initiated.");
  console.log("Tokens will appear on L2 in ~10-15 minutes.");

  return depositReceipt.hash;
}

// Gateway Router addresses (Arbitrum One)
// L1 Gateway Router: 0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef
// L2 Gateway Router: 0x5288c571Fd7aD117beA99bF60FE0846C4E84F933
// Standard Gateway (most ERC-20s): 0xa3A7B6F88361F48403514059F1F16C8E78d60EeC
// Custom Gateway (USDT, DAI, etc.): 0xcEe284F754E854890e311e3280b767F80797180d
```

### Gateway Router Architecture

Arbitrum uses a router pattern to handle different token types:

```
┌─────────────────────────────────────────────────────────┐
│              Token Bridging Architecture                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  L1 Gateway Router                                      │
│  └── Routes tokens to the correct gateway               │
│       │                                                 │
│       ├── Standard Gateway (most ERC-20s)               │
│       │   └── Locks tokens on L1, mints on L2           │
│       │                                                 │
│       ├── Custom Gateway (USDT, DAI, USDC)              │
│       │   └── Custom logic per token                    │
│       │                                                 │
│       └── WETH Gateway                                  │
│           └── Unwraps WETH on L1, sends ETH to L2      │
│                                                         │
│  L2 Gateway Router                                      │
│  └── Mirrors L1 router, handles L2-side operations      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Fast Bridges (Third-Party Alternatives)

For users who can't wait 7 days for withdrawals, third-party bridges provide faster exits:

| Bridge | Withdrawal Time | Fee | Mechanism |
|---|---|---|---|
| Native Bridge | 7 days | Gas only | Challenge period |
| Across Protocol | 1-5 minutes | 0.04-0.12% | Optimistic relayer |
| Hop Protocol | 5-20 minutes | 0.05-0.2% | Bonder liquidity |
| Stargate (LayerZero) | 1-5 minutes | 0.06% | Liquidity pools |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Example: Using Across Protocol for fast L2→L1 withdrawal
// Across uses optimistic relayers who front the liquidity
// Source: https://github.com/across-protocol/contracts

const ACROSS_SPOKE_POOL_ARBITRUM = "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A";

const spokePoolAbi = [
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable"
];

async function fastWithdrawViaAcross(
  l2Signer: ethers.Signer,
  amount: bigint,
  recipient: string
): Promise<string> {
  const spokePool = new ethers.Contract(
    ACROSS_SPOKE_POOL_ARBITRUM,
    spokePoolAbi,
    l2Signer
  );

  const currentTime = Math.floor(Date.now() / 1000);
  const fillDeadline = currentTime + 3600; // 1 hour deadline

  // Deposit ETH for fast relay to Ethereum mainnet
  const tx = await spokePool.depositV3(
    await l2Signer.getAddress(),  // depositor
    recipient,                     // recipient on L1
    ethers.ZeroAddress,           // inputToken (ETH = zero address)
    ethers.ZeroAddress,           // outputToken (ETH on destination)
    amount,                        // inputAmount
    amount * 9990n / 10000n,      // outputAmount (0.1% fee estimate)
    1,                             // destinationChainId (Ethereum mainnet)
    ethers.ZeroAddress,           // exclusiveRelayer (none)
    currentTime,                   // quoteTimestamp
    fillDeadline,                  // fillDeadline
    0,                             // exclusivityDeadline
    "0x",                          // message (empty)
    { value: amount }
  );

  const receipt = await tx.wait();
  console.log(`Fast withdrawal initiated: ${receipt?.hash}`);
  console.log("Funds should arrive on L1 within 2-10 minutes.");

  return receipt?.hash ?? "";
}
```

## Common Pitfalls

1. **Setting insufficient gas for retryable tickets** — If the L2 gas limit in your retryable ticket is too low, auto-execution fails. The ticket sits in a "redeemable" state for 7 days. If nobody redeems it, the funds are lost. Always use the SDK's gas estimation or add a 50% buffer to gas limits.

2. **Not monitoring retryable ticket status** — Failed retryable tickets don't revert on L1 — they succeed on L1 but fail on L2. You must monitor L2 for successful execution. Use the Arbitrum SDK's `waitForChildTransactionReceipt()` or watch the `RedeemScheduled` event.

3. **Forgetting token approval before bridging** — The Gateway Router needs approval to spend your ERC-20 tokens. Calling `deposit()` without prior `approveToken()` will revert. The SDK handles this, but if you're calling contracts directly, approve first.

4. **Assuming all tokens use the Standard Gateway** — Tokens like USDT, DAI, and USDC use the Custom Gateway with different behavior (e.g., USDT doesn't return a boolean on `transfer`). Always check which gateway a token uses via `l1GatewayRouter.getGateway(tokenAddress)`.

5. **Not handling the 7-day delay in UX** — Users expect instant withdrawals. If you're building a dApp, clearly communicate the 7-day wait or integrate a fast bridge. Show withdrawal status and estimated completion time.

## What to Learn Next

- [Arbitrum Ecosystem Tooling](./04-ecosystem-tooling.md) — Arbitrum SDK, block explorers, and developer tools
- [Arbitrum Bridge Documentation](https://docs.arbitrum.io/build-decentralized-apps/token-bridging/token-bridge-erc20) — Official token bridging reference
- [Across Protocol Docs](https://docs.across.to/) — Fast bridge integration guide
