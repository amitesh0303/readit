# Bridging Assets on Polygon zkEVM

**Track:** Polygon zkEVM Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

Your users have ETH and ERC-20 tokens on Ethereum mainnet. Your dApp lives on Polygon zkEVM. You need to move assets between the two chains — deposits from L1 to L2, and withdrawals from L2 to L1. Unlike optimistic rollups with their 7-day withdrawal window, Polygon zkEVM withdrawals finalize once the ZK proof is verified on L1 (typically ~30 minutes). But the bridging mechanics involve understanding the unified bridge contract, claim transactions, and how to track cross-layer message status programmatically.

## Core Concepts

### Bridge Architecture

Polygon zkEVM uses a unified bridge contract (`PolygonZkEVMBridge.sol`) deployed on both L1 and L2:

```
L1 → L2 (Deposit):
  User calls bridgeAsset() on L1 bridge contract
  → Deposit event emitted, included in global exit root
  → Sequencer picks up the deposit (~minutes)
  → User calls claimAsset() on L2 bridge to receive funds

L2 → L1 (Withdrawal):
  User calls bridgeAsset() on L2 bridge contract
  → Withdrawal included in L2 batch
  → Batch is proven on L1 (~30 minutes)
  → User calls claimAsset() on L1 bridge with Merkle proof
  → Funds released on L1

Key difference from optimistic rollups:
  - No 7-day challenge window
  - Withdrawal finality = proof verification time (~30 min)
  - Both directions require a "claim" transaction on the destination chain
```

### Depositing ETH (L1 → L2)

```typescript
// Deposit ETH from Ethereum to Polygon zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const L1_BRIDGE_ADDRESS = "0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe"; // Mainnet bridge
const BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
  "event BridgeEvent(uint8 leafType, uint32 originNetwork, address originAddress, uint32 destinationNetwork, address destinationAddress, uint256 amount, bytes metadata, uint32 depositCount)",
];

async function depositETH(amount: string): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);
  const bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

  const depositAmount = ethers.parseEther(amount);

  // destinationNetwork: 1 = Polygon zkEVM
  // token: address(0) = native ETH
  // forceUpdateGlobalExitRoot: true = update immediately (costs more gas)
  const tx = await bridge.bridgeAsset(
    1,                          // destinationNetwork (Polygon zkEVM)
    wallet.address,             // destinationAddress (same address on L2)
    depositAmount,              // amount
    ethers.ZeroAddress,         // token (ETH = address(0))
    true,                       // forceUpdateGlobalExitRoot
    "0x",                       // permitData (empty for ETH)
    { value: depositAmount }    // Send ETH with the transaction
  );

  console.log(`Deposit TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block: ${receipt!.blockNumber}`);
  console.log(`Gas used: ${receipt!.gasUsed}`);

  // Parse the BridgeEvent to get the deposit count (needed for claiming)
  const bridgeEvent = receipt!.logs.find(
    (log) => log.address.toLowerCase() === L1_BRIDGE_ADDRESS.toLowerCase()
  );
  console.log(`Deposit logged. Wait ~5-10 min, then claim on L2.`);

  return tx.hash;
}

// Usage
depositETH("0.1").catch(console.error);
```

### Claiming Deposits on L2

After depositing on L1, you must claim on L2. This requires a Merkle proof from the bridge service:

```typescript
// Claim deposited assets on Polygon zkEVM (L2 side)
import { ethers } from "ethers"; // ethers@6.9.0

const L2_BRIDGE_ADDRESS = "0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe"; // Same address on L2
const CLAIM_ABI = [
  "function claimAsset(bytes32[32] calldata smtProofLocalExitRoot, bytes32[32] calldata smtProofRollupExitRoot, uint256 globalIndex, bytes32 mainnetExitRoot, bytes32 rollupExitRoot, uint32 originNetwork, address originTokenAddress, uint32 destinationNetwork, address destinationAddress, uint256 amount, bytes calldata metadata)",
];

// The bridge API provides Merkle proofs for claiming
const BRIDGE_API = "https://bridge-api.zkevm-rpc.com";

interface BridgeProof {
  proof: {
    merkle_proof: string[];
    rollup_merkle_proof: string[];
    main_exit_root: string;
    rollup_exit_root: string;
  };
  global_index: string;
}

async function getClaimProof(depositCount: number, networkId: number): Promise<BridgeProof> {
  const response = await fetch(
    `${BRIDGE_API}/merkle-proof?deposit_cnt=${depositCount}&net_id=${networkId}`
  );
  if (!response.ok) {
    throw new Error(`Bridge API error: ${response.status}`);
  }
  return response.json();
}

async function claimDeposit(depositCount: number): Promise<string> {
  const l2Provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);
  const bridge = new ethers.Contract(L2_BRIDGE_ADDRESS, CLAIM_ABI, wallet);

  // Get Merkle proof from bridge API
  const proofData = await getClaimProof(depositCount, 0); // networkId 0 = mainnet

  // Pad proof arrays to 32 elements
  const localProof = proofData.proof.merkle_proof.concat(
    Array(32 - proofData.proof.merkle_proof.length).fill(ethers.ZeroHash)
  );
  const rollupProof = proofData.proof.rollup_merkle_proof.concat(
    Array(32 - proofData.proof.rollup_merkle_proof.length).fill(ethers.ZeroHash)
  );

  try {
    const tx = await bridge.claimAsset(
      localProof,
      rollupProof,
      proofData.global_index,
      proofData.proof.main_exit_root,
      proofData.proof.rollup_exit_root,
      0,                          // originNetwork (Ethereum mainnet)
      ethers.ZeroAddress,         // originTokenAddress (ETH)
      1,                          // destinationNetwork (Polygon zkEVM)
      wallet.address,             // destinationAddress
      ethers.parseEther("0.1"),   // amount
      "0x"                        // metadata
    );

    console.log(`Claim TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Claimed! Gas used: ${receipt!.gasUsed}`);
    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("AlreadyClaimed")) {
        console.log("Deposit already claimed");
      } else if (error.message.includes("GlobalExitRootInvalid")) {
        console.log("Proof not yet available — wait for global exit root update");
      } else {
        throw error;
      }
    }
    throw error;
  }
}
```

### Depositing ERC-20 Tokens

```typescript
// Bridge ERC-20 tokens from L1 to Polygon zkEVM
import { ethers } from "ethers"; // ethers@6.9.0

const L1_BRIDGE_ADDRESS = "0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe";
const BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

async function bridgeERC20(
  tokenAddress: string,
  amount: bigint
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

  // Check balance
  const balance = await token.balanceOf(wallet.address);
  if (balance < amount) {
    throw new Error(`Insufficient balance: ${balance} < ${amount}`);
  }

  // Approve bridge to spend tokens
  const allowance = await token.allowance(wallet.address, L1_BRIDGE_ADDRESS);
  if (allowance < amount) {
    console.log("Approving bridge contract...");
    const approveTx = await token.approve(L1_BRIDGE_ADDRESS, amount);
    await approveTx.wait();
    console.log("Approved.");
  }

  // Bridge tokens (no ETH value needed for ERC-20)
  const tx = await bridge.bridgeAsset(
    1,                    // destinationNetwork (Polygon zkEVM)
    wallet.address,       // destinationAddress
    amount,               // amount
    tokenAddress,         // token address (not address(0))
    true,                 // forceUpdateGlobalExitRoot
    "0x"                  // permitData
  );

  console.log(`Bridge TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed. Gas used: ${receipt!.gasUsed}`);
  console.log(`Claim on L2 after global exit root updates (~5-10 min)`);

  return tx.hash;
}

// Bridge 1000 USDC (6 decimals)
const USDC_L1 = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
bridgeERC20(USDC_L1, 1000n * 10n ** 6n).catch(console.error);
```

### Withdrawing from L2 to L1

```typescript
// Withdraw ETH from Polygon zkEVM back to Ethereum
import { ethers } from "ethers"; // ethers@6.9.0

const L2_BRIDGE_ADDRESS = "0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe";
const BRIDGE_ABI = [
  "function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes calldata permitData) payable",
];

async function withdrawToL1(amount: string): Promise<string> {
  const l2Provider = new ethers.JsonRpcProvider("https://zkevm-rpc.com");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);
  const bridge = new ethers.Contract(L2_BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

  const withdrawAmount = ethers.parseEther(amount);

  // destinationNetwork: 0 = Ethereum mainnet
  const tx = await bridge.bridgeAsset(
    0,                          // destinationNetwork (Ethereum L1)
    wallet.address,             // destinationAddress
    withdrawAmount,             // amount
    ethers.ZeroAddress,         // token (ETH)
    true,                       // forceUpdateGlobalExitRoot
    "0x",                       // permitData
    { value: withdrawAmount }
  );

  console.log(`Withdrawal TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed on L2. Gas used: ${receipt!.gasUsed}`);
  console.log(`Wait for ZK proof verification (~30 min), then claim on L1.`);

  return tx.hash;
}

// After ~30 min, claim on L1 using the same claimAsset pattern
// but calling the L1 bridge contract with the L2 exit proof
```

### Tracking Bridge Status

```typescript
// Monitor bridge transaction status
import { ethers } from "ethers"; // ethers@6.9.0

const BRIDGE_API = "https://bridge-api.zkevm-rpc.com";

interface BridgeDeposit {
  deposit_cnt: number;
  network_id: number;
  orig_net: number;
  orig_addr: string;
  amount: string;
  dest_net: number;
  dest_addr: string;
  ready_for_claim: boolean;
  claim_tx_hash: string;
}

async function checkBridgeStatus(address: string): Promise<void> {
  // Get all deposits for an address
  const response = await fetch(
    `${BRIDGE_API}/bridges/${address}?limit=10&offset=0`
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const deposits: BridgeDeposit[] = data.deposits || [];

  for (const deposit of deposits) {
    const direction = deposit.dest_net === 1 ? "L1 → L2" : "L2 → L1";
    const status = deposit.ready_for_claim
      ? deposit.claim_tx_hash
        ? "✅ Claimed"
        : "⏳ Ready to claim"
      : "🔄 Pending proof";

    console.log(`[${direction}] Amount: ${ethers.formatEther(deposit.amount)} ETH`);
    console.log(`  Status: ${status}`);
    console.log(`  Deposit #: ${deposit.deposit_cnt}`);
    console.log("");
  }
}

checkBridgeStatus("0xYourAddress").catch(console.error);
```

### Bridge Message Passing (L1 ↔ L2 Communication)

Beyond asset bridging, you can send arbitrary messages between L1 and L2:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title L1ToL2Messenger
/// @notice Send arbitrary messages from L1 to Polygon zkEVM
/// @dev Uses bridgeMessage instead of bridgeAsset for data-only transfers
interface IPolygonZkEVMBridge {
    function bridgeMessage(
        uint32 destinationNetwork,
        address destinationAddress,
        bool forceUpdateGlobalExitRoot,
        bytes calldata metadata
    ) payable external;
}

contract L1ToL2Messenger {
    IPolygonZkEVMBridge constant BRIDGE = IPolygonZkEVMBridge(
        0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe
    );

    event MessageSent(uint32 destinationNetwork, address target, bytes data);

    /// @notice Send a message to a contract on Polygon zkEVM
    /// @param target The contract address on L2 that will receive the message
    /// @param message The encoded message data
    function sendMessageToL2(address target, bytes calldata message) external payable {
        BRIDGE.bridgeMessage(
            1,       // destinationNetwork (Polygon zkEVM)
            target,  // destinationAddress on L2
            true,    // forceUpdateGlobalExitRoot
            message  // arbitrary data payload
        );

        emit MessageSent(1, target, message);
    }
}
```

## Common Pitfalls

1. **Forgetting the claim transaction** — Unlike some bridges that auto-credit funds, Polygon zkEVM's bridge requires a separate `claimAsset()` call on the destination chain. If you deposit on L1 but never claim on L2, your funds sit in the bridge contract indefinitely.

2. **Claiming before the proof is ready** — For L2→L1 withdrawals, you must wait until the batch containing your withdrawal is proven on L1 (~30 min). Calling `claimAsset()` before the proof is verified will revert with `GlobalExitRootInvalid`.

3. **Using the wrong network ID** — Ethereum mainnet is network `0`, Polygon zkEVM is network `1`. Swapping these in `bridgeAsset()` will send funds to the wrong chain or cause the transaction to revert.

4. **Not checking `ready_for_claim` status** — The bridge API's `ready_for_claim` field tells you whether a deposit can be claimed. Attempting to claim before this is `true` wastes gas on a reverting transaction.

5. **Bridging tokens without approval** — For ERC-20 bridges, you must approve the bridge contract to spend your tokens before calling `bridgeAsset()`. The transaction will revert with an allowance error if approval is missing.

## What to Learn Next

- [Ecosystem Tooling](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for Polygon zkEVM
- [Polygon zkEVM Bridge Documentation](https://docs.polygon.technology/zkEVM/how-to/bridge-to-zkevm/) — Official bridging guide
- [Bridge Smart Contract Source](https://github.com/0xPolygonHermez/zkevm-contracts) — Bridge contract implementations
- [LxLy Bridge Interface](https://bridge.zkevm-rpc.com/) — Official bridge UI
