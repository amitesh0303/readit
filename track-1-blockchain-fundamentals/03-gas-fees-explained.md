# Gas Fees Explained: Why Does Ethereum Cost So Much?

**Track:** Beginner  
**Read time:** 10 min

---

## The Problem

You deploy your first contract on Ethereum mainnet, try to call a function, and watch $40 disappear for a transaction that took 3 seconds. You try again during peak hours and it's $120. You switch to Polygon and it's $0.001. What is going on?

Gas fees are one of the most misunderstood parts of Ethereum — and one of the most important to understand if you're building anything users will actually pay to use. Get this wrong and your dApp is either unusable (too expensive) or your transactions get stuck (too cheap). This blog explains the full mechanics: what gas is, how EIP-1559 changed the fee market, and how to write contracts that don't bleed your users dry.

---

## Core Concepts

### What Gas Actually Is

Gas is a unit of computational work. Every EVM opcode has a fixed gas cost. `ADD` costs 3 gas. `SSTORE` (writing to storage) costs 20,000 gas for a new slot. `CALL` costs 700 gas. When your transaction executes, the EVM tallies up every opcode and charges you accordingly.

This serves two purposes:
1. It prevents infinite loops — you can only run as many opcodes as your `gasLimit` allows.
2. It prices computation fairly — expensive operations (storage writes, cryptographic ops) cost more than cheap ones (arithmetic).

Gas itself has no ETH value. You pay for gas in ETH at a rate called the **gas price** (in gwei, where 1 gwei = 0.000000001 ETH).

```
Transaction cost = gas used × gas price (in gwei)

Example:
- Simple ETH transfer: 21,000 gas
- Gas price: 30 gwei
- Cost: 21,000 × 30 gwei = 630,000 gwei = 0.00063 ETH
- At ETH = $3,000: ~$1.89
```

### Pre-EIP-1559: The First-Price Auction (and Why It Was Broken)

Before August 2021, Ethereum used a simple first-price auction. You set a `gasPrice`, miners picked the highest-paying transactions first. This led to:

- **Overpaying**: Users had to guess the right price. Wallets showed "slow/medium/fast" estimates that were often wrong.
- **Volatility**: During NFT mints or DeFi liquidation cascades, gas prices would spike 10-100x in seconds.
- **Inefficiency**: Users who overpaid couldn't get refunds. Miners captured all the surplus.

### EIP-1559: The New Fee Market

EIP-1559 (London fork, August 2021) redesigned the fee market with two components:

**Base Fee** — set by the protocol, not users. It adjusts automatically based on how full the previous block was. If blocks are >50% full, base fee goes up. If <50% full, it goes down. Maximum change per block: ±12.5%.

**Priority Fee (tip)** — paid directly to the validator. This is your incentive for the validator to include your transaction. During normal conditions, 1-2 gwei is enough. During congestion, you need to tip more to jump the queue.

**Max Fee** — the absolute maximum you're willing to pay per gas unit. The actual fee paid is `min(maxFeePerGas, baseFee + priorityFee)`. Any difference between your max fee and the actual fee is refunded.

```
EIP-1559 Transaction:
┌─────────────────────────────────────────────────────┐
│  maxFeePerGas:         50 gwei  (your ceiling)       │
│  maxPriorityFeePerGas:  2 gwei  (tip to validator)   │
│                                                       │
│  Current baseFee:      30 gwei  (set by protocol)    │
│                                                       │
│  Actual fee paid:      32 gwei  (baseFee + tip)      │
│  Refunded:             18 gwei  (50 - 32)            │
│                                                       │
│  Base fee is BURNED — removed from supply            │
│  Priority fee goes to validator                      │
└─────────────────────────────────────────────────────┘
```

The burning of the base fee is significant — it makes ETH deflationary during high-usage periods, which is part of the "ultrasound money" narrative.

### gasLimit vs Gas Used

`gasLimit` is the maximum gas you authorize the transaction to consume. If execution uses less, you're refunded the difference. If execution hits the limit before finishing, the transaction **reverts** — but you still pay for all the gas consumed up to that point.

This is a critical gotcha: a reverted transaction still costs gas. The EVM did work, even if that work ended in failure.

```
gasLimit: 100,000
Gas used before revert: 80,000
Gas refunded: 20,000
You pay for: 80,000 × gasPrice — even though nothing changed on-chain
```

For simple ETH transfers, the gas cost is always exactly 21,000 — no estimation needed. For contract calls, you need to estimate, and you should add a buffer (typically 20-30%) because estimation can be slightly off.

### Why L2s Are So Much Cheaper

Ethereum L2s (Arbitrum, Optimism, Polygon) are cheap because they batch many transactions together and post compressed data to Ethereum mainnet. Instead of each transaction paying for its own Ethereum block space, hundreds of transactions share the cost of a single L1 data posting.

```
Ethereum mainnet:
- Each tx pays full L1 gas
- Simple swap: ~$5-50 depending on congestion

Arbitrum:
- Tx executes on L2 (cheap compute)
- L2 batches 1000 txs, posts compressed data to L1
- Each tx pays ~1/1000th of the L1 data cost
- Simple swap: ~$0.05-0.50
```

EIP-4844 (Dencun upgrade, March 2024) introduced "blobs" — a new data type for L2 data posting that's even cheaper than calldata. This dropped L2 fees by another 10-100x.

---

## Code Walkthrough

Here's how to properly estimate and set gas in a production dApp:

```typescript
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/YOUR_KEY");

async function sendWithProperGas(
  signer: ethers.Signer,
  contractAddress: string,
  abi: ethers.InterfaceAbi,
  functionName: string,
  args: unknown[]
) {
  const contract = new ethers.Contract(contractAddress, abi, signer);

  // Step 1: Get current fee data from the network
  const feeData = await provider.getFeeData();
  console.log("Base fee:", ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"), "gwei");

  // Step 2: Estimate gas for this specific call
  // This simulates the transaction and returns gas units needed
  const estimatedGas = await contract[functionName].estimateGas(...args);
  console.log("Estimated gas:", estimatedGas.toString());

  // Step 3: Add a 20% buffer to avoid out-of-gas reverts
  // estimatedGas is a bigint, so we use bigint arithmetic
  const gasLimit = (estimatedGas * 120n) / 100n;

  // Step 4: Set EIP-1559 fee params
  // maxFeePerGas = 2x current baseFee + tip (gives room for base fee increases)
  const maxPriorityFeePerGas = ethers.parseUnits("1.5", "gwei"); // tip
  const maxFeePerGas = (feeData.lastBaseFeePerGas ?? 0n) * 2n + maxPriorityFeePerGas;

  // Step 5: Send the transaction
  const tx = await contract[functionName](...args, {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log(
    "Actual cost (ETH):",
    ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
  );
}
```

For a keeper bot or script that needs to speed up a stuck transaction:

```typescript
// Speed up a stuck transaction by replacing it with higher fees
// Same nonce, higher maxFeePerGas — this replaces the original in the mempool
async function speedUpTransaction(
  signer: ethers.Signer,
  originalTxHash: string
) {
  const provider = signer.provider!;
  const originalTx = await provider.getTransaction(originalTxHash);

  if (!originalTx) throw new Error("Transaction not found");

  // EIP-1559 replacement requires at least 10% higher fees
  const newMaxFeePerGas = (originalTx.maxFeePerGas! * 115n) / 100n; // +15%
  const newPriorityFee = (originalTx.maxPriorityFeePerGas! * 115n) / 100n;

  const replacementTx = await signer.sendTransaction({
    to: originalTx.to,
    data: originalTx.data,
    value: originalTx.value,
    nonce: originalTx.nonce,          // SAME nonce — this is the replacement
    gasLimit: originalTx.gasLimit,
    maxFeePerGas: newMaxFeePerGas,
    maxPriorityFeePerGas: newPriorityFee,
    chainId: originalTx.chainId,
    type: 2,
  });

  console.log("Replacement tx:", replacementTx.hash);
}
```

---

## Common Mistakes and Gotchas

**1. Using `gasPrice` instead of EIP-1559 fields on mainnet**  
Legacy `gasPrice` transactions still work on Ethereum, but they're less efficient. You can't get refunds on overpayment, and wallets may deprioritize them. Always use `maxFeePerGas` + `maxPriorityFeePerGas` for EIP-1559 chains.

**2. Not handling out-of-gas reverts differently from logic reverts**  
Both show up as failed transactions, but they have different causes. An out-of-gas revert means your `gasLimit` was too low. A logic revert means the contract's `require` or `revert` fired. You can distinguish them: out-of-gas uses exactly `gasLimit` gas, logic reverts use less. Check `receipt.gasUsed === receipt.gasLimit` as a heuristic.

**3. Hardcoding gas limits**  
Contract upgrades, state changes, and EVM upgrades can change how much gas a function uses. A hardcoded `gasLimit: 200000` that worked last month might fail after a contract upgrade. Always estimate dynamically.

**4. Forgetting that `estimateGas` can revert**  
If the transaction would revert on-chain (wrong params, insufficient balance, failed require), `estimateGas` throws an error. Wrap it in try/catch and surface the revert reason to the user — don't just show "transaction failed."

**5. Ignoring gas on L2s entirely**  
L2 gas is cheap but not free. On Arbitrum, gas estimation works differently — there's an L2 execution fee and an L1 data fee component. Tools like Arbitrum's `NodeInterface` contract expose L1 fee estimates. For high-frequency bots, even $0.01 per transaction adds up at scale.

---

## How This Connects to Production

Gas optimization is a first-class concern at every major protocol. Uniswap V3 spent significant engineering effort reducing swap gas costs — their tick-based liquidity math is partly designed around minimizing storage reads. Aave V3 introduced efficiency mode and other features partly to reduce the gas overhead of liquidations. GMX on Arbitrum can offer near-zero trading fees partly because Arbitrum's gas costs are low enough that the protocol doesn't need to charge users to cover infrastructure. When you're building a DeFi protocol, gas cost per operation directly determines whether your product is viable — a liquidation bot that costs more in gas than it earns in profit is a bot that won't run, which means your protocol's risk management breaks down.

---

## What to Learn Next

- **Gas Optimization Patterns Every Solidity Dev Should Know** — go from understanding gas to actively reducing it in your contracts.
- **EVM vs Non-EVM Chains: What's the Difference and Why It Matters** — see how different chains handle computation costs differently.
- **Ethereum L2s Explained: Optimistic vs ZK Rollups** — understand the architectural reason L2s are cheaper and what tradeoffs they make.
