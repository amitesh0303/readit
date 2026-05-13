# Bridging Assets on Blast: Deposits and Withdrawals

**Track:** Blast Development
**Lesson:** 3 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

Your users need to move assets between Ethereum and Blast, but Blast's bridge works differently from other L2 bridges. ETH deposited to Blast gets staked in Lido, stablecoins get deposited into MakerDAO's sDAI — so the bridge is also a yield strategy. Withdrawals take 14 days (not 7 like Optimism). You need to understand the deposit flow, how yield starts accruing immediately, the withdrawal mechanics, and when to use third-party bridges for faster exits.

## Core Concepts

### L1 → L2 Deposits

When you bridge assets to Blast, the bridge contract on L1 doesn't just lock them — it puts them to work:

- **ETH** → Deposited into Lido (stETH), earning ~3.5% APY
- **USDC/USDT/DAI** → Deposited into MakerDAO (sDAI), earning ~5% APY
- **On L2**: User receives rebasing ETH or USDB that reflects the yield

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Blast Bridge contract on Ethereum L1
// Source: https://github.com/blast-io/blast
const BLAST_BRIDGE_L1 = "0x3a05E5d33d7Ab3864D53aaEc93c8301C1Fa49115";

const bridgeAbi = [
  "function bridgeETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable",
  "function bridgeERC20To(address _localToken, address _remoteToken, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
];

async function depositETHToBlast(
  l1Signer: ethers.Signer,
  amount: bigint,
  recipient: string
): Promise<string> {
  const bridge = new ethers.Contract(BLAST_BRIDGE_L1, bridgeAbi, l1Signer);

  // Bridge ETH to Blast
  // On L1: ETH goes to Lido (stETH)
  // On L2: Recipient gets rebasing ETH
  const tx = await bridge.bridgeETHTo(
    recipient,
    200000,  // minGasLimit for L2 execution
    "0x",    // extraData (empty)
    { value: amount }
  );

  const receipt = await tx.wait();
  console.log(`Deposit tx on L1: ${receipt?.hash}`);
  console.log(`ETH will arrive on Blast in ~10-20 minutes`);
  console.log(`Yield starts accruing immediately upon arrival`);

  return receipt?.hash ?? "";
}

// Example: Deposit 1 ETH to Blast
// const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");
// const signer = new ethers.Wallet("PRIVATE_KEY", l1Provider);
// await depositETHToBlast(signer, ethers.parseEther("1.0"), signer.address);
```

### Stablecoin Bridging (USDC/USDT/DAI → USDB)

When you bridge stablecoins to Blast, they're converted to USDB (Blast's native rebasing stablecoin):

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

const BLAST_BRIDGE_L1 = "0x3a05E5d33d7Ab3864D53aaEc93c8301C1Fa49115";
const USDC_L1 = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDB_L2 = "0x4300000000000000000000000000000000000003";

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const bridgeAbi = [
  "function bridgeERC20To(address _localToken, address _remoteToken, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
];

async function bridgeUSDCToBlast(
  l1Signer: ethers.Signer,
  amount: bigint,
  recipient: string
): Promise<string> {
  // Step 1: Approve the bridge to spend USDC
  const usdc = new ethers.Contract(USDC_L1, erc20Abi, l1Signer);
  const approveTx = await usdc.approve(BLAST_BRIDGE_L1, amount);
  await approveTx.wait();
  console.log("USDC approved for bridge");

  // Step 2: Bridge USDC → USDB
  const bridge = new ethers.Contract(BLAST_BRIDGE_L1, bridgeAbi, l1Signer);
  const tx = await bridge.bridgeERC20To(
    USDC_L1,     // L1 token (USDC)
    USDB_L2,     // L2 token (USDB — rebasing stablecoin)
    recipient,
    amount,
    200000,      // minGasLimit
    "0x"         // extraData
  );

  const receipt = await tx.wait();
  console.log(`Bridge tx: ${receipt?.hash}`);
  console.log(`USDC will arrive as USDB on Blast in ~10-20 minutes`);
  console.log(`USDB earns ~5% APY from MakerDAO T-Bills`);

  return receipt?.hash ?? "";
}
```

### L2 → L1 Withdrawals (14-Day Challenge Period)

Withdrawals from Blast to Ethereum use the standard OP Stack withdrawal flow, but with a 14-day challenge window:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Blast L2 withdrawal uses the L2ToL1MessagePasser precompile
const L2_TO_L1_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";

const l2BridgeAbi = [
  "function bridgeETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable",
  "function bridgeERC20To(address _l2Token, address _l1Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
];

async function withdrawETHFromBlast(
  l2Signer: ethers.Signer,
  amount: bigint,
  l1Recipient: string
): Promise<string> {
  const l2Bridge = new ethers.Contract(
    L2_STANDARD_BRIDGE,
    l2BridgeAbi,
    l2Signer
  );

  // Initiate withdrawal on L2
  const tx = await l2Bridge.bridgeETHTo(
    l1Recipient,
    200000,  // minGasLimit on L1
    "0x",
    { value: amount }
  );

  const receipt = await tx.wait();
  console.log(`Withdrawal initiated on L2: ${receipt?.hash}`);
  console.log("");
  console.log("⏳ Withdrawal timeline:");
  console.log("  1. Wait for L2 output root to be posted to L1 (~1 hour)");
  console.log("  2. Wait 14 days for the challenge period");
  console.log("  3. Prove the withdrawal on L1");
  console.log("  4. Finalize the withdrawal on L1");
  console.log("");
  console.log("Total wait: ~14 days");

  return receipt?.hash ?? "";
}
```

### Withdrawal Lifecycle

The full withdrawal process on Blast follows the OP Stack pattern:

```
┌─────────────────────────────────────────────────────────┐
│              Blast Withdrawal Lifecycle                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Step 1: Initiate (L2)                                  │
│  └── Call L2StandardBridge.bridgeETHTo()                │
│  └── Transaction included in L2 block                   │
│       ↓ (~1 hour)                                       │
│                                                         │
│  Step 2: Output Root Posted (L1)                        │
│  └── Blast proposer posts L2 output root to L1          │
│  └── Contains Merkle root of all L2→L1 messages         │
│       ↓ (14 days)                                       │
│                                                         │
│  Step 3: Prove Withdrawal (L1)                          │
│  └── Submit Merkle proof that withdrawal is in output   │
│  └── Starts the 14-day challenge period                 │
│       ↓ (14 days)                                       │
│                                                         │
│  Step 4: Finalize (L1)                                  │
│  └── Call OptimismPortal.finalizeWithdrawalTransaction() │
│  └── Funds released to recipient on L1                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Fast Bridges for Blast

For users who can't wait 14 days, third-party bridges offer faster exits:

| Bridge | Withdrawal Time | Fee | Supported Assets |
|---|---|---|---|
| Native Bridge | 14 days | Gas only | ETH, USDB |
| Across Protocol | 1-5 minutes | 0.04-0.12% | ETH, USDC |
| Orbiter Finance | 1-5 minutes | ~$1 flat | ETH, USDC, USDT |
| Relay Bridge | 1-10 seconds | 0.01-0.05% | ETH |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Example: Fast withdrawal via Across Protocol on Blast
// Across SpokePool on Blast: 0x2D509190Ed0172ba588407D4c2df918F3F67A2A5
const ACROSS_SPOKE_POOL_BLAST = "0x2D509190Ed0172ba588407D4c2df918F3F67A2A5";

const spokePoolAbi = [
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable"
];

async function fastWithdrawFromBlast(
  l2Signer: ethers.Signer,
  amount: bigint,
  l1Recipient: string
): Promise<string> {
  const spokePool = new ethers.Contract(
    ACROSS_SPOKE_POOL_BLAST,
    spokePoolAbi,
    l2Signer
  );

  const currentTime = Math.floor(Date.now() / 1000);
  const fillDeadline = currentTime + 7200; // 2 hour deadline

  // Deposit ETH for fast relay to Ethereum mainnet
  const tx = await spokePool.depositV3(
    await l2Signer.getAddress(),  // depositor
    l1Recipient,                   // recipient on L1
    ethers.ZeroAddress,           // inputToken (ETH)
    ethers.ZeroAddress,           // outputToken (ETH on L1)
    amount,                        // inputAmount
    amount * 9988n / 10000n,      // outputAmount (~0.12% fee)
    1,                             // destinationChainId (Ethereum)
    ethers.ZeroAddress,           // exclusiveRelayer (none)
    currentTime,                   // quoteTimestamp
    fillDeadline,                  // fillDeadline
    0,                             // exclusivityDeadline
    "0x",                          // message
    { value: amount }
  );

  const receipt = await tx.wait();
  console.log(`Fast withdrawal initiated: ${receipt?.hash}`);
  console.log("Funds should arrive on L1 within 2-10 minutes");

  return receipt?.hash ?? "";
}
```

### Yield Implications of Bridging

A unique consideration on Blast: bridging direction affects yield:

| Direction | What Happens to Yield |
|---|---|
| L1 → Blast (deposit) | Yield starts accruing immediately on L2 |
| Blast → L1 (withdrawal) | Yield stops when withdrawal is initiated |
| Blast → L1 (fast bridge) | Yield stops immediately, no 14-day wait |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum YieldMode { AUTOMATIC, VOID, CLAIMABLE }
enum GasMode { VOID, CLAIMABLE }

interface IBlast {
    function configure(YieldMode _yield, GasMode gasMode, address governor) external;
    function claimAllYield(address contractAddress, address recipientOfYield) external returns (uint256);
    function readClaimableYield(address contractAddress) external view returns (uint256);
}

/// @title BridgeYieldOptimizer
/// @notice Claim yield before bridging out to maximize returns
contract BridgeYieldOptimizer {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    address public owner;

    constructor() {
        owner = msg.sender;
        BLAST.configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, msg.sender);
    }

    /// @notice Claim all accumulated yield before withdrawing
    /// @dev Always claim yield before initiating a withdrawal,
    ///      otherwise unclaimed yield is forfeited
    function claimAndPrepareWithdrawal() external returns (uint256 yieldClaimed) {
        require(msg.sender == owner, "Only owner");
        yieldClaimed = BLAST.claimAllYield(address(this), owner);
    }

    /// @notice Check pending yield before deciding to bridge
    function pendingYield() external view returns (uint256) {
        return BLAST.readClaimableYield(address(this));
    }

    receive() external payable {}
}
```

## Common Pitfalls

1. **Not claiming yield before withdrawing** — If your contract is in CLAIMABLE mode and you initiate a withdrawal without first claiming accumulated yield, that yield may be lost. Always call `claimAllYield()` before bridging assets back to L1.

2. **Expecting USDB on L1** — USDB only exists on Blast L2. When you withdraw USDB to L1, you receive DAI (from the MakerDAO sDAI unwinding). Don't build L1 logic that expects to receive USDB.

3. **Underestimating the 14-day withdrawal time** — Blast's challenge period is 14 days, double that of Optimism (7 days). If your protocol requires L1 liquidity within 7 days, you must use a fast bridge. Budget for the bridge fee in your protocol economics.

4. **Ignoring L1 gas costs for withdrawal finalization** — The `finalizeWithdrawalTransaction()` call on L1 costs significant gas (~200k-400k gas). At 30 gwei, that's $15-30. For small withdrawals, the L1 finalization cost may exceed the withdrawal amount. Batch withdrawals or use fast bridges for small amounts.

5. **Bridging without checking supported assets** — The Blast native bridge only supports ETH and specific stablecoins (USDC, USDT, DAI → USDB). Arbitrary ERC-20 tokens cannot be bridged natively. For other tokens, use third-party bridges that support Blast.

## What to Learn Next

- [Blast Ecosystem Tooling](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for Blast
- [Blast Bridge Documentation](https://docs.blast.io/building/bridges/mainnet) — Official bridge reference
- [Across Protocol Docs](https://docs.across.to/) — Fast bridge integration for Blast
