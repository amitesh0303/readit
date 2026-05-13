# Bridging Assets to and from Immutable zkEVM

**Track:** Immutable zkEVM Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

Your game is live on Immutable zkEVM and players need to move assets between Ethereum mainnet and the L2. A player wants to bring their ETH to buy in-game NFTs, or withdraw an NFT they earned to sell on a mainnet marketplace. You need to understand the bridging mechanics — deposit flow, withdrawal flow, supported assets, timing, and how to integrate bridging into your game's UI. Unlike optimistic rollups with 7-day withdrawal windows, Immutable zkEVM uses ZK proofs for faster finality, but the process still has steps you need to handle correctly.

## Core Concepts

### Bridge Architecture

Immutable zkEVM uses a canonical bridge (inherited from Polygon zkEVM) for L1↔L2 asset transfers. The bridge contract on Ethereum mainnet locks assets and mints corresponding representations on L2, and vice versa.

```
┌─────────────────────────────────────────────────────────┐
│                    Bridge Flow                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  DEPOSIT (L1 → L2):                                    │
│  1. User calls bridge.deposit() on Ethereum             │
│  2. Assets locked in L1 bridge contract                 │
│  3. Sequencer detects deposit event                     │
│  4. L2 mints equivalent tokens to user                  │
│  Time: ~10-20 minutes                                   │
│                                                         │
│  WITHDRAWAL (L2 → L1):                                  │
│  1. User calls bridge.withdraw() on Immutable zkEVM     │
│  2. Assets burned on L2                                 │
│  3. ZK proof generated and posted to L1                 │
│  4. User claims assets on L1 after proof verification   │
│  Time: ~30 minutes to 1 hour (proof generation)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Supported Bridge Assets

| Asset | L1 (Ethereum) | L2 (Immutable zkEVM) |
|-------|---------------|---------------------|
| IMX | ERC-20 on Ethereum | Native gas token |
| ETH | Native | Wrapped ERC-20 (WETH) |
| USDC | ERC-20 | Bridged ERC-20 |
| Game NFTs | ERC-721 | ERC-721 (native) |
| ERC-20 tokens | Any registered | Bridged representation |

### Depositing Assets (L1 → L2)

```typescript
// Depositing IMX from Ethereum to Immutable zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

// Bridge contract ABI (simplified)
const BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
  "event BridgeEvent(uint8 leafType, uint32 originNetwork, address originAddress, uint32 destinationNetwork, address destinationAddress, uint256 amount, bytes metadata, uint32 depositCount)",
];

// Immutable zkEVM Bridge on Ethereum mainnet
const BRIDGE_ADDRESS = "0xBa5E35E26Ae59c7aea6F029B68c6460De2d13eB6";
// IMX token on Ethereum
const IMX_L1_ADDRESS = "0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF";

async function depositIMX(
  amount: bigint,
  recipientOnL2: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
  const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", l1Provider);

  // Step 1: Approve bridge to spend IMX
  const imxToken = new ethers.Contract(
    IMX_L1_ADDRESS,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    wallet
  );

  const approveTx = await imxToken.approve(BRIDGE_ADDRESS, amount);
  await approveTx.wait();
  console.log(`Approved bridge to spend ${ethers.formatEther(amount)} IMX`);

  // Step 2: Call bridge deposit
  const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

  const destinationNetwork = 1; // Immutable zkEVM network ID
  const forceUpdateGlobalExitRoot = true;
  const permitData = "0x";

  try {
    const tx = await bridge.bridgeAsset(
      destinationNetwork,
      recipientOnL2,
      amount,
      IMX_L1_ADDRESS,
      forceUpdateGlobalExitRoot,
      permitData
    );

    console.log(`Deposit TX: ${tx.hash}`);
    console.log(`Explorer: https://etherscan.io/tx/${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Confirmed in block: ${receipt?.blockNumber}`);
    console.log(`\nAssets will arrive on Immutable zkEVM in ~10-20 minutes`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Bridge deposit failed: ${error.message}`);
    }
    throw error;
  }
}

// Deposit 100 IMX
await depositIMX(ethers.parseEther("100"), "0xYourL2Address");
```

### Depositing ETH (Becomes WETH on L2)

```typescript
// Depositing ETH — arrives as WETH on Immutable zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
];

const BRIDGE_ADDRESS = "0xBa5E35E26Ae59c7aea6F029B68c6460De2d13eB6";

async function depositETH(
  amountInEther: string,
  recipientOnL2: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
  const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", l1Provider);

  const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, wallet);
  const amount = ethers.parseEther(amountInEther);

  // For ETH deposits, token address is 0x0 and amount is sent as msg.value
  const destinationNetwork = 1;
  const tokenAddress = ethers.ZeroAddress; // Native ETH
  const forceUpdateGlobalExitRoot = true;

  try {
    const tx = await bridge.bridgeAsset(
      destinationNetwork,
      recipientOnL2,
      amount,
      tokenAddress,
      forceUpdateGlobalExitRoot,
      "0x",
      { value: amount } // Send ETH with the transaction
    );

    console.log(`ETH Deposit TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Confirmed. ETH will arrive as WETH on Immutable zkEVM in ~10-20 min`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`ETH bridge deposit failed: ${error.message}`);
    }
    throw error;
  }
}

await depositETH("0.5", "0xYourL2Address");
```

### Withdrawing Assets (L2 → L1)

Withdrawals from Immutable zkEVM are faster than optimistic rollups because ZK proofs provide cryptographic finality without a challenge window:

```typescript
// Withdrawing from Immutable zkEVM to Ethereum
import { ethers } from "ethers"; // ethers@6.9.0

const L2_BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
  "event BridgeEvent(uint8 leafType, uint32 originNetwork, address originAddress, uint32 destinationNetwork, address destinationAddress, uint256 amount, bytes metadata, uint32 depositCount)",
];

// Bridge contract on Immutable zkEVM
const L2_BRIDGE_ADDRESS = "0xBa5E35E26Ae59c7aea6F029B68c6460De2d13eB6";

async function withdrawToL1(
  amount: bigint,
  tokenAddress: string,
  recipientOnL1: string
): Promise<string> {
  const l2Provider = new ethers.JsonRpcProvider("https://rpc.testnet.immutable.com");
  const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", l2Provider);

  const bridge = new ethers.Contract(L2_BRIDGE_ADDRESS, L2_BRIDGE_ABI, wallet);

  // Destination network 0 = Ethereum mainnet
  const destinationNetwork = 0;
  const forceUpdateGlobalExitRoot = true;

  // If withdrawing native IMX, send as msg.value
  const isNativeIMX = tokenAddress === ethers.ZeroAddress;
  const txValue = isNativeIMX ? amount : 0n;

  // If withdrawing ERC-20, approve first
  if (!isNativeIMX) {
    const token = new ethers.Contract(
      tokenAddress,
      ["function approve(address, uint256) returns (bool)"],
      wallet
    );
    const approveTx = await token.approve(L2_BRIDGE_ADDRESS, amount);
    await approveTx.wait();
    console.log("Token approved for bridge");
  }

  try {
    const tx = await bridge.bridgeAsset(
      destinationNetwork,
      recipientOnL1,
      amount,
      tokenAddress,
      forceUpdateGlobalExitRoot,
      "0x",
      { value: txValue }
    );

    console.log(`Withdrawal TX: ${tx.hash}`);
    console.log(`Explorer: https://explorer.testnet.immutable.com/tx/${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`\nWithdrawal initiated in block: ${receipt?.blockNumber}`);
    console.log(`\nNext steps:`);
    console.log(`1. Wait for ZK proof generation (~30 min to 1 hour)`);
    console.log(`2. Claim assets on Ethereum L1 using the bridge claim function`);
    console.log(`3. Provide the Merkle proof from the global exit root`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Withdrawal failed: ${error.message}`);
    }
    throw error;
  }
}

// Withdraw 50 IMX (native) to L1
await withdrawToL1(
  ethers.parseEther("50"),
  ethers.ZeroAddress, // Native IMX
  "0xYourL1Address"
);
```

### Claiming Withdrawals on L1

After the ZK proof is posted to Ethereum, you need to claim the withdrawal:

```typescript
// Claiming a withdrawal on Ethereum L1
import { ethers } from "ethers"; // ethers@6.9.0

const L1_BRIDGE_ABI = [
  "function claimAsset(bytes32[32] calldata smtProofLocalExitRoot, bytes32[32] calldata smtProofRollupExitRoot, uint256 globalIndex, bytes32 mainnetExitRoot, bytes32 rollupExitRoot, uint32 originNetwork, address originTokenAddress, uint32 destinationNetwork, address destinationAddress, uint256 amount, bytes calldata metadata)",
];

const L1_BRIDGE_ADDRESS = "0xBa5E35E26Ae59c7aea6F029B68c6460De2d13eB6";

async function claimWithdrawal(
  proofData: {
    smtProofLocalExitRoot: string[];
    smtProofRollupExitRoot: string[];
    globalIndex: bigint;
    mainnetExitRoot: string;
    rollupExitRoot: string;
    originNetwork: number;
    originTokenAddress: string;
    destinationNetwork: number;
    destinationAddress: string;
    amount: bigint;
    metadata: string;
  }
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
  const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", l1Provider);

  const bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, L1_BRIDGE_ABI, wallet);

  try {
    const tx = await bridge.claimAsset(
      proofData.smtProofLocalExitRoot,
      proofData.smtProofRollupExitRoot,
      proofData.globalIndex,
      proofData.mainnetExitRoot,
      proofData.rollupExitRoot,
      proofData.originNetwork,
      proofData.originTokenAddress,
      proofData.destinationNetwork,
      proofData.destinationAddress,
      proofData.amount,
      proofData.metadata
    );

    console.log(`Claim TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Assets claimed! Block: ${receipt?.blockNumber}`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Claim failed: ${error.message}`);
    }
    throw error;
  }
}

// Note: Proof data is obtained from the Immutable bridge API
// after the ZK proof has been verified on L1
// See: https://docs.immutable.com/docs/zkEVM/architecture/bridge-functionality
```

### Withdrawal Timeline Comparison

| L2 | Withdrawal Time | Mechanism |
|----|----------------|-----------|
| Arbitrum | 7 days | Challenge window |
| Optimism | 7 days | Challenge window |
| Immutable zkEVM | 30 min - 1 hour | ZK proof verification |
| zkSync Era | 1-24 hours | ZK proof batching |

## Common Pitfalls

1. **Forgetting to claim on L1** — Unlike deposits (which auto-complete), withdrawals require a second transaction on Ethereum to claim. If you don't call `claimAsset` after the proof is posted, your assets sit in the bridge contract indefinitely. Build a UI that reminds users to claim.

2. **Not accounting for the two-step withdrawal** — Your game UI needs to show withdrawal status: "pending proof" → "ready to claim" → "claimed." Many developers only handle the L2 transaction and leave users confused about where their assets are.

3. **Bridging NFTs without checking allowlist compatibility** — If you bridge an NFT from L1 that doesn't implement Immutable's operator allowlist on L2, it won't be tradeable on Immutable's marketplace. Plan your NFT contract architecture before bridging.

4. **Using third-party bridges without understanding trust assumptions** — Fast bridges (like Axelar or LayerZero integrations) provide instant liquidity but introduce additional trust assumptions beyond the canonical bridge. For high-value transfers, use the canonical bridge and wait for ZK proof finality.

5. **Confusing IMX on L1 vs L2** — IMX exists as an ERC-20 on Ethereum and as the native gas token on Immutable zkEVM. When bridging IMX from L1→L2, the ERC-20 is locked and native IMX is minted. When bridging back, native IMX is burned and the ERC-20 is released. They're the same asset, different representations.

## What to Learn Next

- [Gaming SDK and Tooling](./04-gaming-sdk-tooling.md) — Immutable SDK, Passport integration, and minting APIs
- [Immutable Bridge Documentation](https://docs.immutable.com/docs/zkEVM/architecture/bridge-functionality) — Official bridge reference
- [Polygon zkEVM Bridge](https://docs.polygon.technology/zkEVM/architecture/protocol/lxly-bridge/) — Underlying bridge protocol documentation
