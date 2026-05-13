# Cross-Chain Bridges: How They Work and Where They Break

**Track:** Intermediate → Expert  
**Read time:** 12 min

---

## The Problem

You need to move USDC from Ethereum to Arbitrum. Or ETH from Arbitrum to Optimism. Or SOL to Ethereum. Bridges make this possible — but bridges are also the most exploited infrastructure in crypto. Ronin ($625M), Wormhole ($320M), Nomad ($190M), Harmony Horizon ($100M). The pattern is consistent: bridge gets exploited, funds are drained.

Understanding how bridges work — and why they fail — is essential for any developer building cross-chain protocols or integrating bridge functionality.

---

## Core Concepts

### The Bridge Problem

Moving assets between chains is fundamentally hard because blockchains don't communicate with each other natively. A bridge must:

1. Lock or burn assets on the source chain
2. Verify that lock/burn happened
3. Mint or release equivalent assets on the destination chain

Step 2 is the hard part. How does the destination chain know what happened on the source chain? This is the "oracle problem" for cross-chain communication.

### Bridge Architectures

**Lock-and-Mint (Custodial)**:
```
Source chain: Lock 1 ETH in bridge contract
Destination chain: Mint 1 "wrapped ETH" (wETH)

To return:
Destination chain: Burn 1 wETH
Source chain: Unlock 1 ETH
```

The bridge contract on the source chain holds the locked assets. If the bridge is exploited, all locked assets can be drained. This is why bridge exploits are so large — the bridge contract is a honeypot.

**Liquidity Network (Non-Custodial)**:
```
Source chain: User deposits 1 ETH
Destination chain: LP provides 1 ETH from their liquidity pool
Source chain: LP is reimbursed from user's deposit

No locked assets — LPs provide liquidity on both sides
```

Hop Protocol and Across Protocol use this model. It's faster (no waiting for finality) and less risky (no single honeypot), but requires liquidity providers.

**Native Bridge (Rollup-Specific)**:
```
Ethereum → Arbitrum: Use Arbitrum's native inbox contract
Arbitrum → Ethereum: Use Arbitrum's outbox (7-day delay for optimistic rollups)
```

Native bridges are the most secure (they use the rollup's own security model) but slowest for withdrawals.

**Message Passing (General Purpose)**:
```
Source chain: Emit event / call bridge contract
Bridge validators: Observe event, sign attestation
Destination chain: Verify attestation, execute action
```

Wormhole, LayerZero, Axelar use this model. They're general-purpose (not just token transfers) but introduce a new trust assumption: the bridge validators.

### Why Bridges Get Exploited

**1. Validator key compromise (Ronin, $625M)**:
Ronin used 9 validators, required 5/9 signatures. Attackers compromised 5 validator keys (4 via social engineering, 1 via a backdoor in a legacy system). With 5 keys, they could authorize any withdrawal.

**2. Smart contract bugs (Wormhole, $320M)**:
A bug in Wormhole's Solana program allowed an attacker to mint 120,000 wETH without depositing any ETH. The bug was in the signature verification logic.

**3. Merkle proof manipulation (Nomad, $190M)**:
A Nomad upgrade introduced a bug where any message could be "proven" valid. Once one attacker discovered this, others copied the exploit transaction and drained the bridge in parallel.

**4. Replay attacks**:
If a bridge doesn't properly track which messages have been processed, the same message can be replayed multiple times, minting assets multiple times.

### Security Models Compared

| Bridge Type | Trust Assumption | Exploit Surface |
|-------------|-----------------|-----------------|
| Native rollup bridge | Rollup's security model | Minimal |
| Liquidity network | LP solvency + smart contracts | Medium |
| Validator-based | Validator set honesty | High (key compromise) |
| ZK bridge | Cryptographic validity proofs | Minimal (but complex) |

---

## Code Walkthrough

Integrating Hop Protocol for fast cross-chain transfers:

```typescript
import { Hop, Chain } from "@hop-protocol/sdk";
import { ethers } from "ethers";

async function bridgeWithHop(
  signer: ethers.Signer,
  fromChain: string,
  toChain: string,
  token: string,
  amount: bigint
) {
  const hop = new Hop("mainnet");

  // Get the bridge for this token
  const bridge = hop.bridge(token);

  // Get a quote
  const amountBN = ethers.toBigInt(amount);
  const quote = await bridge.getSendData(amountBN, fromChain, toChain);

  console.log("Bridge quote:");
  console.log("  Amount out:", ethers.formatUnits(quote.amountOut, 6), token);
  console.log("  Fee:", ethers.formatUnits(quote.totalFee, 6), token);
  console.log("  Estimated time:", quote.estimatedReceiveTime, "seconds");

  // Check if the fee is acceptable (e.g., < 0.5% of amount)
  const feePercent = Number(quote.totalFee) / Number(amountBN) * 100;
  if (feePercent > 0.5) {
    throw new Error(`Bridge fee too high: ${feePercent.toFixed(2)}%`);
  }

  // Execute the bridge
  const tx = await bridge.connect(signer).send(
    amountBN,
    fromChain,
    toChain,
    {
      slippageTolerance: 0.5, // 0.5% slippage tolerance
      recipient: await signer.getAddress(),
    }
  );

  console.log("Bridge tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Bridge initiated. Funds will arrive in ~1-5 minutes.");

  return receipt;
}

// Monitor bridge transfer status
async function monitorBridgeTransfer(
  transferId: string,
  hop: Hop
): Promise<void> {
  const bridge = hop.bridge("USDC");

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const transfer = await bridge.getTransfer(transferId);

        console.log("Transfer status:", transfer.bonded ? "Bonded" : "Pending");

        if (transfer.bonded) {
          console.log("Transfer complete!");
          clearInterval(interval);
          resolve();
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 10_000); // check every 10 seconds
  });
}
```

LayerZero integration for cross-chain messaging:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// LayerZero endpoint interface
interface ILayerZeroEndpoint {
    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable;

    function estimateFees(
        uint16 _dstChainId,
        address _userApplication,
        bytes calldata _payload,
        bool _payInZRO,
        bytes calldata _adapterParam
    ) external view returns (uint256 nativeFee, uint256 zroFee);
}

interface ILayerZeroReceiver {
    function lzReceive(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external;
}

/**
 * @title CrossChainMessage
 * @notice Send and receive messages across chains via LayerZero.
 */
contract CrossChainMessage is ILayerZeroReceiver {
    ILayerZeroEndpoint public immutable endpoint;

    // LayerZero chain IDs (different from EVM chain IDs)
    uint16 public constant LZ_ETHEREUM = 101;
    uint16 public constant LZ_ARBITRUM = 110;
    uint16 public constant LZ_POLYGON = 109;

    // Trusted remote contracts (chain ID → contract address)
    mapping(uint16 => bytes) public trustedRemotes;

    event MessageSent(uint16 dstChainId, bytes payload);
    event MessageReceived(uint16 srcChainId, bytes payload);

    constructor(address _endpoint) {
        endpoint = ILayerZeroEndpoint(_endpoint);
    }

    /**
     * @notice Send a message to another chain.
     * @param dstChainId LayerZero destination chain ID
     * @param payload Message data
     */
    function sendMessage(
        uint16 dstChainId,
        bytes calldata payload
    ) external payable {
        bytes memory destination = trustedRemotes[dstChainId];
        require(destination.length > 0, "No trusted remote");

        // Estimate fee
        (uint256 fee, ) = endpoint.estimateFees(
            dstChainId,
            address(this),
            payload,
            false,
            bytes("")
        );
        require(msg.value >= fee, "Insufficient fee");

        endpoint.send{value: fee}(
            dstChainId,
            destination,
            payload,
            payable(msg.sender), // refund excess fee
            address(0),          // no ZRO payment
            bytes("")            // default adapter params
        );

        emit MessageSent(dstChainId, payload);
    }

    /**
     * @notice Called by LayerZero when a message arrives.
     * @dev Only callable by the LayerZero endpoint.
     */
    function lzReceive(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external override {
        require(msg.sender == address(endpoint), "Not endpoint");
        require(
            keccak256(_srcAddress) == keccak256(trustedRemotes[_srcChainId]),
            "Untrusted source"
        );

        // Process the message
        _processMessage(_srcChainId, _payload);

        emit MessageReceived(_srcChainId, _payload);
    }

    function _processMessage(uint16 srcChainId, bytes calldata payload) internal {
        // Decode and handle the message
        // Implementation depends on your use case
    }

    function setTrustedRemote(uint16 chainId, bytes calldata remote) external {
        // In production: add access control
        trustedRemotes[chainId] = remote;
    }
}
```

---

## Common Mistakes and Gotchas

**1. Using bridges for large amounts without understanding the security model**  
Before bridging significant value, understand the bridge's security model. How many validators? What's the multisig threshold? Has it been audited? What's the TVL (higher TVL = bigger target)? Use native bridges for large amounts when possible.

**2. Not checking bridge liquidity before initiating**  
Liquidity network bridges (Hop, Across) require LPs on the destination chain. If there's insufficient liquidity, your transfer will be delayed or fail. Always check available liquidity before initiating large transfers.

**3. Not handling bridge failures gracefully**  
Bridge transfers can fail or get stuck. Always implement timeout handling and provide users with a way to check transfer status and manually claim if needed.

**4. Trusting bridge-provided prices for financial calculations**  
If your protocol uses a bridge to receive assets and then uses those assets in financial calculations, be aware that the bridge might deliver a different amount than expected (due to fees, slippage). Always use the actual received amount, not the expected amount.

**5. Not validating the source of cross-chain messages**  
When receiving a LayerZero or Wormhole message, always validate that it came from your trusted contract on the source chain. The Nomad exploit happened partly because message validation was broken.

---

## How This Connects to Production

Stargate Finance (built on LayerZero) is one of the largest cross-chain liquidity protocols. Hop Protocol handles hundreds of millions in cross-chain transfers monthly. Across Protocol uses an optimistic verification model for fast, cheap bridging. The Wormhole bridge (despite its $320M exploit) was rebuilt and is now used by many Solana ↔ EVM protocols. Circle's CCTP (Cross-Chain Transfer Protocol) is a native USDC bridge that burns on source and mints on destination — no wrapped tokens, no liquidity pools, just Circle's attestation service.

---

## What to Learn Next

- **What is Caldera? Customizable Rollups and the Modular Blockchain Stack** — understand the infrastructure that makes cross-chain communication easier.
- **Ethereum L2s Explained: Optimistic vs ZK Rollups** — understand the chains you're bridging between.
- **Smart Contract Audit Process: What Auditors Actually Look For** — bridge contracts are among the most audited in the space.
