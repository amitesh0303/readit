# Bridging Assets to and from Base

**Track:** Base Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

Your users have ETH and tokens on Ethereum mainnet but your dApp lives on Base. You need to move assets between L1 and L2 — but the native bridge has a 7-day withdrawal delay, third-party bridges have trust assumptions, and getting the contract interactions wrong can lock funds permanently. You need to understand both the native bridge mechanics and the faster alternatives so you can guide users through the right path for their use case.

## Core Concepts

### Native Bridge: L1 → L2 (Deposits)

Depositing from Ethereum to Base uses the OP Stack's standard bridge contracts. Deposits are fast — typically confirmed on Base within 1-3 minutes after the L1 transaction is included.

The flow:
1. User calls `depositETH()` or `depositERC20()` on the L1 bridge contract
2. The L1 transaction is included in an Ethereum block
3. The Base derivation pipeline detects the deposit event
4. Base creates a corresponding L2 transaction crediting the user

```typescript
// ethers.js@6.9.0
import { ethers } from "ethers";

// Base bridge contract addresses (Ethereum mainnet)
const BASE_BRIDGE_ADDRESSES = {
  l1StandardBridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
  l1CrossDomainMessenger: "0x866E82a600A1414e583f7F13623F1aC5d58b0Afa",
  optimismPortal: "0x49048044D57e1C92A77f79988d21Fa8fAF36f97B",
};

// Base Sepolia bridge addresses (Ethereum Sepolia)
const BASE_SEPOLIA_BRIDGE_ADDRESSES = {
  l1StandardBridge: "0xfd0Bf71F60660E2f608ed56e1659C450eB113120",
  l1CrossDomainMessenger: "0xC34855F4De64F1840e5686e64278da901e261f20",
  optimismPortal: "0x49f53e41452C74589E85cA1677426Ba426459e85",
};

const L1_STANDARD_BRIDGE_ABI = [
  "function depositETH(uint32 _minGasLimit, bytes calldata _extraData) payable",
  "function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes calldata _extraData)",
  "event ETHDepositInitiated(address indexed from, address indexed to, uint256 amount, bytes extraData)",
];

async function depositETHToBase(
  l1Wallet: ethers.Wallet,
  amount: bigint
): Promise<ethers.TransactionReceipt> {
  const bridge = new ethers.Contract(
    BASE_BRIDGE_ADDRESSES.l1StandardBridge,
    L1_STANDARD_BRIDGE_ABI,
    l1Wallet
  );

  console.log(`Depositing ${ethers.formatEther(amount)} ETH to Base...`);

  try {
    const tx = await bridge.depositETH(
      200_000, // _minGasLimit for L2 execution
      "0x",    // _extraData (empty)
      { value: amount }
    );

    console.log("L1 tx hash:", tx.hash);
    console.log("Etherscan:", `https://etherscan.io/tx/${tx.hash}`);

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      throw new Error("L1 deposit transaction reverted");
    }

    console.log("Deposit confirmed on L1. Funds will appear on Base in ~1-3 minutes.");
    return receipt;
  } catch (error) {
    throw new Error(`Deposit failed: ${(error as Error).message}`);
  }
}

async function depositERC20ToBase(
  l1Wallet: ethers.Wallet,
  l1TokenAddress: string,
  l2TokenAddress: string,
  amount: bigint
): Promise<ethers.TransactionReceipt> {
  // First approve the bridge to spend tokens
  const erc20 = new ethers.Contract(
    l1TokenAddress,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    l1Wallet
  );

  const approveTx = await erc20.approve(
    BASE_BRIDGE_ADDRESSES.l1StandardBridge,
    amount
  );
  await approveTx.wait();
  console.log("Approval confirmed");

  // Then deposit
  const bridge = new ethers.Contract(
    BASE_BRIDGE_ADDRESSES.l1StandardBridge,
    L1_STANDARD_BRIDGE_ABI,
    l1Wallet
  );

  try {
    const tx = await bridge.depositERC20(
      l1TokenAddress,
      l2TokenAddress,
      amount,
      200_000, // _minGasLimit
      "0x"     // _extraData
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      throw new Error("ERC-20 deposit transaction reverted");
    }

    console.log("ERC-20 deposit confirmed. Tokens will appear on Base in ~1-3 minutes.");
    return receipt;
  } catch (error) {
    throw new Error(`ERC-20 deposit failed: ${(error as Error).message}`);
  }
}
```

### Native Bridge: L2 → L1 (Withdrawals)

Withdrawing from Base to Ethereum is a multi-step process due to the 7-day challenge window:

1. **Initiate withdrawal** on Base (L2) — calls `L2ToL1MessagePasser`
2. **Wait for state root** — the proposer posts the state root to L1 (~1 hour)
3. **Prove withdrawal** on Ethereum (L1) — submit a Merkle proof
4. **Wait 7 days** — challenge window
5. **Finalize withdrawal** on Ethereum (L1) — claim funds

```typescript
// ethers.js@6.9.0
import { ethers } from "ethers";

// L2 bridge contract on Base
const L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";
const L2_TO_L1_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";

const L2_STANDARD_BRIDGE_ABI = [
  "function withdraw(address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes calldata _extraData) payable",
  "event WithdrawalInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)",
];

async function initiateWithdrawalFromBase(
  l2Wallet: ethers.Wallet,
  amount: bigint
): Promise<ethers.TransactionReceipt> {
  const bridge = new ethers.Contract(
    L2_STANDARD_BRIDGE,
    L2_STANDARD_BRIDGE_ABI,
    l2Wallet
  );

  console.log(`Initiating withdrawal of ${ethers.formatEther(amount)} ETH from Base...`);

  try {
    // For ETH withdrawals, use address(0) as the L2 token and send ETH as value
    const tx = await bridge.withdraw(
      "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000", // ETH placeholder on L2
      amount,
      200_000, // _minGasLimit for L1 execution
      "0x",    // _extraData
      { value: amount }
    );

    console.log("L2 tx hash:", tx.hash);
    console.log("Basescan:", `https://basescan.org/tx/${tx.hash}`);

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      throw new Error("Withdrawal initiation reverted on L2");
    }

    console.log("Withdrawal initiated on Base.");
    console.log("Next steps:");
    console.log("  1. Wait ~1 hour for state root to be proposed on L1");
    console.log("  2. Prove the withdrawal on L1");
    console.log("  3. Wait 7 days for the challenge period");
    console.log("  4. Finalize the withdrawal on L1 to claim funds");

    return receipt;
  } catch (error) {
    throw new Error(`Withdrawal failed: ${(error as Error).message}`);
  }
}
```

### Third-Party Bridges: Faster Alternatives

For users who can't wait 7 days, liquidity bridges provide near-instant withdrawals by fronting the funds:

| Bridge | Speed | Fee | Trust Model |
|--------|-------|-----|-------------|
| [Across Protocol](https://across.to) | ~1-2 min | 0.04-0.12% | Optimistic oracle (UMA) |
| [Hop Protocol](https://hop.exchange) | ~5-15 min | 0.05-0.2% | Bonder liquidity |
| [Stargate (LayerZero)](https://stargate.finance) | ~1-5 min | 0.06% | LayerZero messaging |
| [Synapse](https://synapseprotocol.com) | ~5-10 min | Variable | AMM-based |
| Native Bridge | 7 days | Gas only | Trustless (fraud proofs) |

```typescript
// Example: Using Across Protocol SDK for fast bridging
// @across-protocol/sdk@3.0.0
import { ethers } from "ethers";

// Across uses a spoke pool on each chain
const ACROSS_BASE_SPOKE_POOL = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";

const SPOKE_POOL_ABI = [
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes calldata message) payable",
];

// Note: In production, use the Across SDK to get quotes and handle routing
// This shows the underlying contract interaction pattern
async function bridgeViaAcross(
  wallet: ethers.Wallet,
  amount: bigint,
  destinationChainId: number
): Promise<void> {
  const spokePool = new ethers.Contract(
    ACROSS_BASE_SPOKE_POOL,
    SPOKE_POOL_ABI,
    wallet
  );

  console.log("For production use, integrate the Across SDK:");
  console.log("  npm install @across-protocol/sdk@3.0.0");
  console.log("  See: https://docs.across.to/integration-guides");
  console.log(`  Amount: ${ethers.formatEther(amount)} ETH`);
  console.log(`  Destination chain: ${destinationChainId}`);
}
```

### Bridging ERC-20 Tokens

Not all tokens have official Base representations. The standard bridge creates "bridged" versions of L1 tokens on Base. For tokens with custom bridge implementations (like USDC), use the token-specific bridge.

**USDC on Base**: Circle provides native USDC on Base (not bridged). The native USDC address on Base is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Bridged USDC (USDbC) at `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` is the older bridged version.

## Common Pitfalls

1. **Forgetting the 7-day withdrawal delay** — The native bridge withdrawal takes 7 days minimum. If your protocol needs faster L2→L1 movement, integrate a third-party bridge or design around the delay. Never promise users instant withdrawals via the native bridge.

2. **Not approving tokens before bridging ERC-20s** — The L1 bridge needs token approval before it can transfer your tokens. Forgetting the approve step causes the deposit transaction to revert.

3. **Using bridged USDC (USDbC) instead of native USDC** — Base has both bridged USDC (`0xd9aA...`) and native USDC (`0x8335...`). Native USDC is preferred — it's issued directly by Circle and has better liquidity. Check which version your protocol integrates with.

4. **Sending tokens to the bridge contract directly** — Never send tokens directly to the bridge contract address via a standard transfer. Always use the bridge's `deposit` functions. Direct transfers will lock your tokens permanently.

5. **Not monitoring withdrawal status** — After initiating a withdrawal, you must prove it on L1 and then finalize it after 7 days. If you forget the prove or finalize steps, your funds sit in limbo. Use the [Base Bridge UI](https://bridge.base.org) to track pending withdrawals.

## What to Learn Next

- [Base Ecosystem Tooling](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for building on Base
- [Base Bridge Documentation](https://docs.base.org/docs/tools/bridge-faq) — Official bridge FAQ and guides
- [Across Protocol Docs](https://docs.across.to) — Fast bridging integration guide
