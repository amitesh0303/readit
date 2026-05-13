# Bridging Assets to and from Mode

**Track:** Mode Network Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You need to move ETH and ERC-20 tokens between Ethereum L1 and Mode L2. The canonical OP Stack bridge works but has a 7-day withdrawal delay. Third-party bridges offer faster exits but introduce trust assumptions. You need to understand both options, implement programmatic bridging, and know when to use each approach — because choosing wrong means either waiting a week for your funds or trusting a third-party liquidity provider.

## Core Concepts

### Bridge Architecture Overview

Mode uses the standard OP Stack bridge infrastructure:

```
┌─────────────────────────────────────────────────────────┐
│              Mode Bridge Architecture                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  L1 → L2 (Deposits) — ~1-5 minutes                     │
│  └── User calls depositETH() or depositERC20()          │
│  └── L1 OptimismPortal contract locks funds              │
│  └── Mode sequencer detects deposit event                │
│  └── Funds appear on L2 after sequencer processes it     │
│                                                         │
│  L2 → L1 (Withdrawals) — ~7 days                       │
│  └── User calls withdraw() on L2                         │
│  └── Transaction included in next output root            │
│  └── 7-day challenge window begins                       │
│  └── After challenge period, user proves + finalizes     │
│  └── Funds released on L1                                │
│                                                         │
│  Fast Bridges (Third-party) — minutes                   │
│  └── Across, Relay, Stargate                             │
│  └── Liquidity providers front the withdrawal            │
│  └── User pays a fee (0.05-0.3%) for speed              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Depositing ETH (L1 → Mode)

Deposits are fast (~1-5 minutes) because the sequencer monitors L1 for deposit events:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Mode bridge contract addresses
const MODE_BRIDGE_ADDRESSES = {
  mainnet: {
    l1StandardBridge: "0x735aDBbE72226BD52e818E7181953f42E3b0FF21",
    l1CrossDomainMessenger: "0x95bDCA6c8EdEB69C98Bd5bd17660BaCef1298A6f",
    optimismPortal: "0x8B34b14c7c7123459Cf3076b8Cb929BE097d0C07"
  },
  testnet: {
    l1StandardBridge: "0xbC5C679879B2965296756CD959C3C739769995E2",
    l1CrossDomainMessenger: "0xc19a60d9E8C27B9A43527c3283B4dd8eDC8bE15C",
    optimismPortal: "0x320e1580effF37E008F1C92700d1eBa47c1B23fD"
  }
};

// Deposit ETH from Ethereum to Mode
async function depositETHToMode(
  l1Provider: ethers.JsonRpcProvider,
  privateKey: string,
  amountEth: string
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, l1Provider);
  const amount = ethers.parseEther(amountEth);

  // L1StandardBridge ABI for ETH deposits
  const bridgeAbi = [
    "function depositETH(uint32 _minGasLimit, bytes _extraData) payable"
  ];

  const bridge = new ethers.Contract(
    MODE_BRIDGE_ADDRESSES.mainnet.l1StandardBridge,
    bridgeAbi,
    wallet
  );

  console.log(`Depositing ${amountEth} ETH to Mode...`);

  const tx = await bridge.depositETH(
    200_000, // minGasLimit for L2 execution
    "0x",    // no extra data
    { value: amount }
  );

  console.log(`L1 tx hash: ${tx.hash}`);
  console.log("Waiting for L1 confirmation...");

  const receipt = await tx.wait();
  console.log(`L1 confirmed in block ${receipt?.blockNumber}`);
  console.log("Deposit will arrive on Mode in ~1-5 minutes");

  return receipt;
}
```

### Depositing ERC-20 Tokens (L1 → Mode)

For ERC-20 tokens, you must approve the bridge first:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

async function depositERC20ToMode(
  l1Provider: ethers.JsonRpcProvider,
  privateKey: string,
  l1TokenAddress: string,
  l2TokenAddress: string,
  amount: bigint
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, l1Provider);

  // Step 1: Approve the bridge to spend tokens
  const erc20Abi = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
  ];

  const token = new ethers.Contract(l1TokenAddress, erc20Abi, wallet);

  const currentAllowance = await token.allowance(
    wallet.address,
    MODE_BRIDGE_ADDRESSES.mainnet.l1StandardBridge
  );

  if (currentAllowance < amount) {
    console.log("Approving bridge to spend tokens...");
    const approveTx = await token.approve(
      MODE_BRIDGE_ADDRESSES.mainnet.l1StandardBridge,
      amount
    );
    await approveTx.wait();
    console.log("Approval confirmed");
  }

  // Step 2: Deposit tokens via the bridge
  const bridgeAbi = [
    "function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)"
  ];

  const bridge = new ethers.Contract(
    MODE_BRIDGE_ADDRESSES.mainnet.l1StandardBridge,
    bridgeAbi,
    wallet
  );

  console.log(`Depositing ${ethers.formatUnits(amount, 18)} tokens to Mode...`);

  const tx = await bridge.depositERC20(
    l1TokenAddress,
    l2TokenAddress,
    amount,
    200_000, // minGasLimit
    "0x"     // no extra data
  );

  const receipt = await tx.wait();
  console.log(`Deposit tx confirmed: ${receipt?.hash}`);
  console.log("Tokens will arrive on Mode in ~1-5 minutes");

  return receipt;
}
```

### Withdrawing ETH (Mode → Ethereum L1)

Withdrawals use the standard OP Stack three-step process:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ModeWithdrawer
/// @notice Initiate a withdrawal from Mode L2 to Ethereum L1
/// @dev Uses the L2ToL1MessagePasser predeploy
contract ModeWithdrawer {
    /// @dev L2StandardBridge predeploy address (same on all OP Stack chains)
    address constant L2_STANDARD_BRIDGE = 0x4200000000000000000000000000000000000010;

    /// @notice Withdraw ETH from Mode to Ethereum L1
    /// @param l1Recipient The address to receive ETH on L1
    function withdrawETH(address l1Recipient) external payable {
        // Call the L2StandardBridge to initiate withdrawal
        (bool success, ) = L2_STANDARD_BRIDGE.call{value: msg.value}(
            abi.encodeWithSignature(
                "bridgeETHTo(address,uint32,bytes)",
                l1Recipient,
                200_000, // L1 gas limit for finalization
                ""       // extra data
            )
        );
        require(success, "Withdrawal initiation failed");
    }
}
```

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Three-step withdrawal process (Mode → Ethereum)
// Step 1: Initiate withdrawal on L2 (immediate)
// Step 2: Prove withdrawal on L1 (after output root is posted, ~1 hour)
// Step 3: Finalize withdrawal on L1 (after 7-day challenge window)

async function initiateWithdrawal(
  modeProvider: ethers.JsonRpcProvider,
  privateKey: string,
  amountEth: string
): Promise<string> {
  const wallet = new ethers.Wallet(privateKey, modeProvider);

  const l2Bridge = new ethers.Contract(
    "0x4200000000000000000000000000000000000010", // L2StandardBridge
    ["function bridgeETH(uint32 _minGasLimit, bytes _extraData) payable"],
    wallet
  );

  const tx = await l2Bridge.bridgeETH(
    200_000,
    "0x",
    { value: ethers.parseEther(amountEth) }
  );

  const receipt = await tx.wait();
  console.log(`Withdrawal initiated: ${receipt?.hash}`);
  console.log("Next steps:");
  console.log("1. Wait ~1 hour for output root to be posted to L1");
  console.log("2. Prove the withdrawal on L1");
  console.log("3. Wait 7 days for challenge period");
  console.log("4. Finalize the withdrawal on L1");

  return receipt?.hash ?? "";
}
```

### Fast Bridges: Across Protocol

For faster withdrawals, use a third-party bridge like Across:

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Using Across Protocol for fast Mode → Ethereum bridging
// Across provides ~2-10 minute withdrawals by fronting liquidity
// Docs: https://docs.across.to

const ACROSS_SPOKE_POOL_MODE = "0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96";

async function fastBridgeViaAcross(
  modeProvider: ethers.JsonRpcProvider,
  privateKey: string,
  amountEth: string,
  destinationChainId: number // 1 for Ethereum mainnet
): Promise<ethers.TransactionReceipt | null> {
  const wallet = new ethers.Wallet(privateKey, modeProvider);
  const amount = ethers.parseEther(amountEth);

  const spokePoolAbi = [
    "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable"
  ];

  const spokePool = new ethers.Contract(ACROSS_SPOKE_POOL_MODE, spokePoolAbi, wallet);

  // WETH address on Mode (input token for ETH bridging)
  const WETH_MODE = "0x4200000000000000000000000000000000000006";
  const WETH_ETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  const currentTime = Math.floor(Date.now() / 1000);
  const fillDeadline = currentTime + 3600; // 1 hour deadline

  // Output amount accounts for Across relayer fee (~0.05-0.1%)
  const relayerFee = amount * 5n / 10000n; // 0.05%
  const outputAmount = amount - relayerFee;

  const tx = await spokePool.depositV3(
    wallet.address,       // depositor
    wallet.address,       // recipient on L1
    WETH_MODE,           // input token (WETH on Mode)
    WETH_ETH,            // output token (WETH on Ethereum)
    amount,              // input amount
    outputAmount,        // output amount (minus fee)
    destinationChainId,  // 1 for Ethereum
    ethers.ZeroAddress,  // no exclusive relayer
    currentTime,         // quote timestamp
    fillDeadline,        // fill deadline
    0,                   // no exclusivity
    "0x",               // no message
    { value: amount }    // ETH value for native ETH bridging
  );

  const receipt = await tx.wait();
  console.log(`Across deposit tx: ${receipt?.hash}`);
  console.log("Relayer will fill on Ethereum in ~2-10 minutes");

  return receipt;
}
```

### Bridge Comparison

| Bridge | Direction | Time | Fee | Trust Model |
|---|---|---|---|---|
| Mode Canonical Bridge | L1→L2 | ~1-5 min | Gas only | Trustless (OP Stack) |
| Mode Canonical Bridge | L2→L1 | ~7 days | Gas only | Trustless (OP Stack) |
| Across Protocol | L2→L1 | ~2-10 min | 0.05-0.1% | Relayer liquidity |
| Relay Bridge | L2→L1 | ~1-5 min | 0.1-0.3% | Relayer liquidity |
| Stargate (LayerZero) | L2→L1 | ~5-15 min | 0.06% | Oracle + Relayer |

## Common Pitfalls

1. **Not accounting for the 7-day withdrawal delay** — The canonical bridge withdrawal takes 7 days. If your protocol needs faster L2→L1 movement, integrate a third-party bridge or design around the delay. Don't promise users instant withdrawals via the canonical bridge.

2. **Forgetting the approve step for ERC-20 deposits** — The L1StandardBridge needs token approval before it can pull tokens from your wallet. If you skip the approve transaction, the deposit will revert with an unhelpful error.

3. **Using wrong L2 token addresses** — When bridging ERC-20 tokens, you must specify the correct L2 representation address. The L2 token address is NOT the same as the L1 address. Check the Mode token list or bridge UI for the correct mapping.

4. **Underestimating L1 gas for withdrawal finalization** — The prove and finalize steps execute on Ethereum L1 and cost L1 gas prices. During high congestion, finalizing a $10 withdrawal might cost $20+ in L1 gas. Batch withdrawals or use fast bridges for small amounts.

## What to Learn Next

- [Mode Ecosystem Tooling](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for Mode
- [Mode Bridge UI](https://bridge.mode.network) — Official bridge interface for manual transfers
- [Across Protocol Docs](https://docs.across.to) — Fast bridge integration documentation
- [OP Stack Bridge Spec](https://github.com/ethereum-optimism/optimism/blob/develop/specs/bridges.md) — Technical specification for the canonical bridge
