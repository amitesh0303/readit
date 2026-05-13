# Bridging Assets on Scroll: L1↔L2 Deposits and Withdrawals

**Track:** Scroll Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You have ETH or ERC-20 tokens on Ethereum mainnet and need them on Scroll to deploy contracts and interact with protocols. Or you have assets on Scroll that you need to withdraw back to L1. Scroll's bridge uses a message-passing system between L1 and L2, with different trust assumptions and timing for each direction. Deposits (L1→L2) are fast because the sequencer processes them. Withdrawals (L2→L1) require waiting for the validity proof — you can't bypass this without trusting a third-party bridge. This lesson covers both the official bridge and programmatic bridging for smart contracts.

## Core Concepts

### Bridge Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Ethereum L1                                │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │ ScrollMessenger   │    │ L1ScrollBridge               │   │
│  │ (L1 side)        │    │ - depositETH()               │   │
│  │ - sendMessage()  │    │ - depositERC20()             │   │
│  │ - relayMessage() │    │ - finalizeWithdrawal()       │   │
│  └──────────────────┘    └──────────────────────────────┘   │
│           │                          │                       │
└───────────┼──────────────────────────┼───────────────────────┘
            │  L1 → L2: ~10-20 min     │  L2 → L1: ~4-8 hours
            │  (sequencer picks up)     │  (proof finalization)
┌───────────┼──────────────────────────┼───────────────────────┐
│           ▼                          ▼                       │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │ ScrollMessenger   │    │ L2ScrollBridge               │   │
│  │ (L2 side)        │    │ - withdrawETH()              │   │
│  │ - sendMessage()  │    │ - withdrawERC20()            │   │
│  │ - relayMessage() │    │ - finalizeDeposit()          │   │
│  └──────────────────┘    └──────────────────────────────┘   │
│                                                              │
│                    Scroll L2                                  │
└──────────────────────────────────────────────────────────────┘
```

### Depositing ETH (L1 → L2)

Using the Scroll SDK to bridge ETH from Ethereum to Scroll:

```typescript
// bridge-deposit.ts
import { ethers } from "ethers";
import { ScrollSDK } from "@scroll-tech/sdk@0.2.0";

// Scroll bridge contract addresses (Mainnet)
const L1_GATEWAY_ROUTER = "0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6";
const L1_ETH_GATEWAY = "0x7F2b8C31F88B6006c382775eea88297Ec1e3E905";

// ABI for the L1 ETH Gateway
const L1_ETH_GATEWAY_ABI = [
  "function depositETH(address _to, uint256 _amount, uint256 _gasLimit) payable",
  "function depositETH(uint256 _amount, uint256 _gasLimit) payable",
  "event DepositETH(address indexed from, address indexed to, uint256 amount, bytes data)",
];

async function depositETHToScroll(
  privateKey: string,
  amount: bigint,
  l2Recipient?: string
): Promise<string> {
  // Connect to Ethereum mainnet
  const l1Provider = new ethers.JsonRpcProvider("https://eth.llamarpc.com");
  const wallet = new ethers.Wallet(privateKey, l1Provider);

  const gateway = new ethers.Contract(L1_ETH_GATEWAY, L1_ETH_GATEWAY_ABI, wallet);

  // Gas limit for the L2 execution of the deposit
  // 170,000 is sufficient for a simple ETH deposit relay
  const l2GasLimit = 170_000n;

  // The value sent must cover: deposit amount + L2 gas fee
  // L2 gas fee = l2GasLimit * l2BaseFee (usually very small)
  const l2Fee = l2GasLimit * 250_000n; // ~0.0000425 ETH overhead
  const totalValue = amount + l2Fee;

  console.log(`Depositing ${ethers.formatEther(amount)} ETH to Scroll`);
  console.log(`L2 gas fee: ${ethers.formatEther(l2Fee)} ETH`);
  console.log(`Total L1 tx value: ${ethers.formatEther(totalValue)} ETH`);

  const recipient = l2Recipient || wallet.address;

  try {
    const tx = await gateway["depositETH(address,uint256,uint256)"](
      recipient,
      amount,
      l2GasLimit,
      { value: totalValue }
    );

    console.log(`L1 TX submitted: ${tx.hash}`);
    console.log(`Etherscan: https://etherscan.io/tx/${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`L1 TX confirmed in block ${receipt.blockNumber}`);
    console.log(`\nDeposit will arrive on Scroll in ~10-20 minutes`);
    console.log(`Track on Scroll Explorer: https://scrollscan.com/address/${recipient}`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        throw new Error(
          `Insufficient ETH. Need ${ethers.formatEther(totalValue)} ETH ` +
          `(${ethers.formatEther(amount)} deposit + ${ethers.formatEther(l2Fee)} fee)`
        );
      }
      throw new Error(`Deposit failed: ${error.message}`);
    }
    throw error;
  }
}

// Usage
// depositETHToScroll(process.env.PRIVATE_KEY!, ethers.parseEther("0.1"));
```

### Depositing ERC-20 Tokens (L1 → L2)

```typescript
// bridge-deposit-erc20.ts
import { ethers } from "ethers";

const L1_GATEWAY_ROUTER = "0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6";

const GATEWAY_ROUTER_ABI = [
  "function depositERC20(address _token, address _to, uint256 _amount, uint256 _gasLimit) payable",
  "function getERC20Gateway(address _token) view returns (address)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function depositERC20ToScroll(
  privateKey: string,
  tokenAddress: string,
  amount: bigint,
  l2Recipient?: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth.llamarpc.com");
  const wallet = new ethers.Wallet(privateKey, l1Provider);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const router = new ethers.Contract(L1_GATEWAY_ROUTER, GATEWAY_ROUTER_ABI, wallet);

  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const balance = await token.balanceOf(wallet.address);

  console.log(`Token: ${symbol} (${decimals} decimals)`);
  console.log(`Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  if (balance < amount) {
    throw new Error(
      `Insufficient ${symbol} balance. Have ${ethers.formatUnits(balance, decimals)}, ` +
      `need ${ethers.formatUnits(amount, decimals)}`
    );
  }

  // Step 1: Approve the gateway to spend tokens
  const gateway = await router.getERC20Gateway(tokenAddress);
  console.log(`\nGateway for ${symbol}: ${gateway}`);

  const currentAllowance = await token.allowance(wallet.address, gateway);
  if (currentAllowance < amount) {
    console.log(`Approving ${ethers.formatUnits(amount, decimals)} ${symbol}...`);
    const approveTx = await token.approve(gateway, amount);
    await approveTx.wait();
    console.log(`Approved ✅`);
  }

  // Step 2: Deposit through the gateway router
  const recipient = l2Recipient || wallet.address;
  const l2GasLimit = 200_000n;
  const l2Fee = l2GasLimit * 250_000n;

  console.log(`\nDepositing ${ethers.formatUnits(amount, decimals)} ${symbol} to Scroll...`);

  try {
    const tx = await router.depositERC20(
      tokenAddress,
      recipient,
      amount,
      l2GasLimit,
      { value: l2Fee }
    );

    console.log(`L1 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Confirmed in block ${receipt.blockNumber}`);
    console.log(`\nTokens will arrive on Scroll in ~10-20 minutes`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`ERC-20 deposit failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Withdrawing ETH (L2 → L1)

Withdrawals require waiting for the batch containing your transaction to be proven and finalized on L1:

```typescript
// bridge-withdraw.ts
import { ethers } from "ethers";

// Scroll L2 bridge contracts
const L2_ETH_GATEWAY = "0x6EA73e05AdC79974B931123675ea8F78FfdacDF0";
const L2_MESSENGER = "0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC";

const L2_ETH_GATEWAY_ABI = [
  "function withdrawETH(address _to, uint256 _amount, uint256 _gasLimit) payable",
  "function withdrawETH(uint256 _amount, uint256 _gasLimit) payable",
  "event WithdrawETH(address indexed from, address indexed to, uint256 amount, bytes data)",
];

async function withdrawETHFromScroll(
  privateKey: string,
  amount: bigint,
  l1Recipient?: string
): Promise<{ l2TxHash: string; estimatedFinalization: string }> {
  // Connect to Scroll
  const l2Provider = new ethers.JsonRpcProvider("https://rpc.scroll.io");
  const wallet = new ethers.Wallet(privateKey, l2Provider);

  const gateway = new ethers.Contract(L2_ETH_GATEWAY, L2_ETH_GATEWAY_ABI, wallet);

  const balance = await l2Provider.getBalance(wallet.address);
  console.log(`Scroll ETH balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < amount) {
    throw new Error(
      `Insufficient ETH on Scroll. Have ${ethers.formatEther(balance)}, ` +
      `need ${ethers.formatEther(amount)}`
    );
  }

  const recipient = l1Recipient || wallet.address;
  const l1GasLimit = 0n; // 0 for simple ETH withdrawal (no L1 execution needed)

  console.log(`\nWithdrawing ${ethers.formatEther(amount)} ETH to L1...`);
  console.log(`Recipient on L1: ${recipient}`);

  try {
    const tx = await gateway["withdrawETH(address,uint256,uint256)"](
      recipient,
      amount,
      l1GasLimit,
      { value: amount }
    );

    console.log(`L2 TX submitted: ${tx.hash}`);
    console.log(`Scrollscan: https://scrollscan.com/tx/${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`L2 TX confirmed in block ${receipt.blockNumber}`);

    // Estimate finalization time
    const now = new Date();
    const finalizationTime = new Date(now.getTime() + 8 * 60 * 60 * 1000); // ~8 hours

    console.log(`\n⏳ Withdrawal initiated successfully`);
    console.log(`   Current time: ${now.toISOString()}`);
    console.log(`   Estimated finalization: ${finalizationTime.toISOString()}`);
    console.log(`\n   After finalization, claim on L1 via Scroll Bridge UI:`);
    console.log(`   https://scroll.io/bridge`);

    return {
      l2TxHash: tx.hash,
      estimatedFinalization: finalizationTime.toISOString(),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Withdrawal failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Claiming Withdrawals on L1

After the batch is finalized (proof verified on L1), you must claim the withdrawal:

```typescript
// bridge-claim.ts
import { ethers } from "ethers";

const L1_MESSENGER = "0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367";

const L1_MESSENGER_ABI = [
  "function relayMessageWithProof(address from, address to, uint256 value, uint256 nonce, bytes message, tuple(uint256 batchIndex, bytes merkleProof) proof)",
  "function isL2MessageExecuted(bytes32 msgHash) view returns (bool)",
];

interface WithdrawalProof {
  batchIndex: bigint;
  merkleProof: string;
}

async function claimWithdrawalOnL1(
  privateKey: string,
  withdrawalTxHash: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth.llamarpc.com");
  const l2Provider = new ethers.JsonRpcProvider("https://rpc.scroll.io");
  const wallet = new ethers.Wallet(privateKey, l1Provider);

  // Step 1: Get the withdrawal message details from L2 receipt
  const l2Receipt = await l2Provider.getTransactionReceipt(withdrawalTxHash);
  if (!l2Receipt) {
    throw new Error(`L2 transaction ${withdrawalTxHash} not found`);
  }

  console.log(`L2 withdrawal TX found in block ${l2Receipt.blockNumber}`);

  // Step 2: Check if the batch is finalized
  // In practice, use Scroll's API to get the proof:
  // https://mainnet-api-re.scroll.io/api/claimable?address=YOUR_ADDRESS
  console.log(`\nChecking finalization status...`);
  console.log(`Use Scroll Bridge UI to check: https://scroll.io/bridge`);
  console.log(`Or API: https://mainnet-api-re.scroll.io/api/claimable?address=${wallet.address}`);

  // Step 3: Relay the message on L1 with the Merkle proof
  // The proof is obtained from Scroll's API after batch finalization
  const messenger = new ethers.Contract(L1_MESSENGER, L1_MESSENGER_ABI, wallet);

  // Note: In production, fetch the proof from Scroll's API
  // This is a simplified illustration of the claim flow
  console.log(`\n⚠️  To claim, use the Scroll Bridge UI at https://scroll.io/bridge`);
  console.log(`   The UI handles proof fetching and relay automatically.`);
  console.log(`   Programmatic claiming requires fetching the Merkle proof from Scroll's API.`);

  return "Use Scroll Bridge UI for claiming";
}
```

### Third-Party Bridge Alternatives

For faster bridging (minutes instead of hours), third-party bridges provide liquidity-based transfers:

```typescript
// fast-bridge-options.ts

interface BridgeOption {
  name: string;
  type: string;
  l1ToL2Time: string;
  l2ToL1Time: string;
  fee: string;
  trustAssumption: string;
}

const bridgeOptions: BridgeOption[] = [
  {
    name: "Scroll Native Bridge",
    type: "Canonical (validity proof)",
    l1ToL2Time: "~10-20 minutes",
    l2ToL1Time: "~4-8 hours (proof finalization)",
    fee: "Gas only (no protocol fee)",
    trustAssumption: "Trustless — secured by ZK proof",
  },
  {
    name: "Orbiter Finance",
    type: "Liquidity network",
    l1ToL2Time: "~1-5 minutes",
    l2ToL1Time: "~1-5 minutes",
    fee: "~0.1-0.3%",
    trustAssumption: "Trust bridge operators for liveness",
  },
  {
    name: "Owlto Finance",
    type: "Liquidity network",
    l1ToL2Time: "~1-3 minutes",
    l2ToL1Time: "~1-3 minutes",
    fee: "~0.1-0.2%",
    trustAssumption: "Trust bridge operators for liveness",
  },
  {
    name: "Layerswap",
    type: "Liquidity aggregator",
    l1ToL2Time: "~2-10 minutes",
    l2ToL1Time: "~2-10 minutes",
    fee: "Variable (0.1-0.5%)",
    trustAssumption: "Trust bridge operators",
  },
];

// Recommendation:
// - Use native bridge for large amounts (trustless, no fee)
// - Use third-party bridges for speed on smaller amounts
// - Always verify bridge contract addresses from official sources
// Last verified: 2025-01-15
```

### Programmatic Cross-Chain Messaging

For smart contracts that need to communicate between L1 and L2:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title L1 contract that sends a message to Scroll L2
/// @notice Demonstrates cross-chain messaging via ScrollMessenger
interface IScrollMessenger {
    function sendMessage(
        address target,
        uint256 value,
        bytes calldata message,
        uint256 gasLimit
    ) external payable;
}

contract L1ToScrollSender {
    IScrollMessenger public immutable messenger;
    address public l2Target;

    error InsufficientFee(uint256 sent, uint256 required);
    error ZeroAddress();

    constructor(address _messenger, address _l2Target) {
        if (_messenger == address(0) || _l2Target == address(0)) revert ZeroAddress();
        messenger = IScrollMessenger(_messenger);
        l2Target = _l2Target;
    }

    /// @notice Send a message to the L2 contract
    /// @param data Arbitrary data to send to L2
    function sendToL2(bytes calldata data) external payable {
        // Gas limit for L2 execution of the message
        uint256 l2GasLimit = 200_000;

        // msg.value must cover the L2 gas cost
        // In practice, estimate this from the L1GasPriceOracle
        messenger.sendMessage{value: msg.value}(
            l2Target,
            0, // No ETH value to send with the message
            data,
            l2GasLimit
        );
    }
}

/// @title L2 contract that receives messages from Ethereum L1
contract L2ScrollReceiver {
    address public immutable l1Sender;
    address public immutable messenger;

    uint256 public lastReceivedValue;
    bytes public lastReceivedData;

    error UnauthorizedCaller(address caller);
    error UnauthorizedSender(address sender);

    constructor(address _messenger, address _l1Sender) {
        messenger = _messenger;
        l1Sender = _l1Sender;
    }

    /// @notice Called by the ScrollMessenger when an L1 message arrives
    function receiveFromL1(uint256 value, bytes calldata data) external {
        // Verify the message came through the official messenger
        if (msg.sender != messenger) revert UnauthorizedCaller(msg.sender);

        // Verify the original sender on L1
        // The messenger exposes xDomainMessageSender() during relay
        // to identify who sent the message on the other chain
        // (Implementation depends on Scroll's messenger interface)

        lastReceivedValue = value;
        lastReceivedData = data;
    }
}
```

## Common Pitfalls

1. **Not including enough ETH for L2 gas on deposits** — When depositing from L1, the `msg.value` must cover both the deposit amount AND the L2 execution gas. If you send exactly the deposit amount, the transaction will revert. Always add a buffer for the L2 relay gas cost.

2. **Expecting instant L2→L1 withdrawals** — Withdrawals from Scroll to Ethereum require the batch to be proven and finalized (~4-8 hours). There's no way to speed this up with the native bridge. If you need faster exits, use a third-party liquidity bridge (Orbiter, Owlto) and accept the fee.

3. **Forgetting to claim withdrawals on L1** — Unlike deposits (which are automatically relayed by the sequencer), withdrawals require a manual claim transaction on L1 after finalization. If you don't claim, your funds sit in the bridge contract indefinitely. Use the Scroll Bridge UI or API to check claimable withdrawals.

4. **Using wrong contract addresses across networks** — Scroll mainnet and Scroll Sepolia testnet have different bridge contract addresses. Always verify addresses from [Scroll's official documentation](https://docs.scroll.io/en/developers/scroll-contracts/). Sending to the wrong address means lost funds.

5. **Not handling bridge message failures** — If an L1→L2 message fails on L2 (e.g., out of gas), the deposit is not lost but requires manual replay. Monitor your bridge transactions and implement retry logic for programmatic bridges.

## What to Learn Next

- [Ecosystem Tooling on Scroll](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for Scroll
- [Scroll Bridge Documentation](https://docs.scroll.io/en/developers/l1-and-l2-bridging/the-scroll-messenger/) — Official bridge integration guide
- [Scroll Bridge UI](https://scroll.io/bridge) — Web interface for bridging assets
