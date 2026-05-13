# Bridging Assets on Linea: L1↔L2 Deposits and Withdrawals

**Track:** Linea Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You have ETH or ERC-20 tokens on Ethereum mainnet and need them on Linea to deploy contracts and interact with dApps. Or you have assets on Linea that you need to withdraw back to L1. Linea's canonical bridge uses a message service contract that differs from optimistic rollup bridges — there's no 7-day challenge period, but you still need to understand the proof-based finality model, fee structures, and how to handle both manual and automatic claiming. Getting bridging wrong means stuck funds or failed transactions.

## Core Concepts

### Linea's Bridge Architecture

Linea uses a canonical message service for L1↔L2 communication:

```
┌─────────────────────────────────────────────────────────┐
│  Ethereum L1                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  LineaRollup.sol                                │   │
│  │  - Stores L2 state roots                        │   │
│  │  - Verifies zk-proofs                           │   │
│  │  - Anchors message hashes                       │   │
│  ├─────────────────────────────────────────────────┤   │
│  │  L1MessageService.sol                           │   │
│  │  - sendMessage() → L1 to L2                     │   │
│  │  - claimMessage() → finalize L2 to L1           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │ ▲
          Deposit (fast) │ │ Withdrawal (after proof)
                         ▼ │
┌─────────────────────────────────────────────────────────┐
│  Linea L2                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  L2MessageService.sol                           │   │
│  │  - sendMessage() → L2 to L1                     │   │
│  │  - claimMessage() → finalize L1 to L2           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Depositing ETH: L1 → L2

Deposits are fast (minutes) because the sequencer can include them as soon as the L1 transaction is confirmed:

```typescript
// bridge/deposit-eth.ts
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Linea L1 Message Service address (Ethereum mainnet)
const L1_MESSAGE_SERVICE = "0xd19d4B5d358258f05D7B411E21A1460D11B0876F";

// Minimal ABI for sending messages
const L1_MESSAGE_SERVICE_ABI = [
  "function sendMessage(address _to, uint256 _fee, bytes calldata _calldata) external payable",
  "event MessageSent(address indexed _from, address indexed _to, uint256 _fee, uint256 _value, uint256 _nonce, bytes _calldata, bytes32 _messageHash)",
];

async function depositETH(amountEth: string): Promise<string> {
  // Connect to Ethereum mainnet (or Sepolia for testing)
  const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);

  const messageService = new ethers.Contract(
    L1_MESSAGE_SERVICE,
    L1_MESSAGE_SERVICE_ABI,
    wallet
  );

  const amount = ethers.parseEther(amountEth);

  // Fee for the L2 execution (postman fee)
  // This compensates the relayer that delivers the message on L2
  const fee = ethers.parseEther("0.001"); // Adjust based on current rates

  // Total value = amount to bridge + fee
  const totalValue = amount + fee;

  console.log(`Depositing ${amountEth} ETH from L1 to L2...`);
  console.log(`  Amount: ${ethers.formatEther(amount)} ETH`);
  console.log(`  Fee: ${ethers.formatEther(fee)} ETH`);
  console.log(`  Total: ${ethers.formatEther(totalValue)} ETH`);

  try {
    // Send message with empty calldata (pure ETH transfer)
    // _to: your own address on L2 (same address)
    // _fee: postman fee for automatic claiming
    // _calldata: empty for simple ETH bridge
    const tx = await messageService.sendMessage(
      wallet.address, // Receive on L2 at same address
      fee,
      "0x", // No calldata — just bridging ETH
      { value: totalValue }
    );

    console.log(`\nL1 TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`L1 TX confirmed in block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    // Parse the MessageSent event
    const event = receipt.logs.find(
      (log: ethers.Log) => log.address.toLowerCase() === L1_MESSAGE_SERVICE.toLowerCase()
    );
    if (event) {
      const parsed = messageService.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      console.log(`\nMessage hash: ${parsed?.args._messageHash}`);
      console.log(`Message nonce: ${parsed?.args._nonce.toString()}`);
    }

    console.log(`\n✅ Deposit initiated!`);
    console.log(`   ETH will arrive on Linea in ~5-20 minutes`);
    console.log(`   (Automatic claiming via postman service)`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        throw new Error(
          `Insufficient ETH. Need ${ethers.formatEther(totalValue)} ETH (amount + fee)`
        );
      }
      throw new Error(`Deposit failed: ${error.message}`);
    }
    throw error;
  }
}

// Execute
depositETH("0.1").catch(console.error);
```

```shell
npx ts-node bridge/deposit-eth.ts
```

```
Expected output:
Depositing 0.1 ETH from L1 to L2...
  Amount: 0.1 ETH
  Fee: 0.001 ETH
  Total: 0.101 ETH

L1 TX submitted: 0xabc123...
L1 TX confirmed in block: 19234567
Gas used: 68432

Message hash: 0xdef456...
Message nonce: 12345

✅ Deposit initiated!
   ETH will arrive on Linea in ~5-20 minutes
   (Automatic claiming via postman service)
```

### Depositing ERC-20 Tokens: L1 → L2

ERC-20 bridging requires approval + bridge call through the token bridge contract:

```typescript
// bridge/deposit-erc20.ts
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Linea Token Bridge on L1 (Ethereum mainnet)
const L1_TOKEN_BRIDGE = "0x051F1D88f0aF5763fB888eC4378b4D8B29ea3319";

const TOKEN_BRIDGE_ABI = [
  "function bridgeToken(address _token, uint256 _amount, address _recipient) external payable",
  "event BridgingInitiatedV2(address indexed sender, address indexed recipient, address indexed token, uint256 amount)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

async function depositERC20(
  tokenAddress: string,
  amount: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const bridge = new ethers.Contract(L1_TOKEN_BRIDGE, TOKEN_BRIDGE_ABI, wallet);

  // Get token info
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const parsedAmount = ethers.parseUnits(amount, decimals);

  // Check balance
  const balance = await token.balanceOf(wallet.address);
  if (balance < parsedAmount) {
    throw new Error(
      `Insufficient ${symbol} balance. Have: ${ethers.formatUnits(balance, decimals)}, Need: ${amount}`
    );
  }

  // Check and set approval
  const currentAllowance = await token.allowance(wallet.address, L1_TOKEN_BRIDGE);
  if (currentAllowance < parsedAmount) {
    console.log(`Approving ${amount} ${symbol} for bridge...`);
    const approveTx = await token.approve(L1_TOKEN_BRIDGE, parsedAmount);
    await approveTx.wait();
    console.log(`Approval confirmed.`);
  }

  // Bridge the tokens
  // msg.value covers the L2 claiming fee (postman fee)
  const fee = ethers.parseEther("0.001");

  console.log(`\nBridging ${amount} ${symbol} to Linea...`);

  try {
    const tx = await bridge.bridgeToken(
      tokenAddress,
      parsedAmount,
      wallet.address, // Recipient on L2
      { value: fee }
    );

    console.log(`TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`TX confirmed. Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`\n✅ ${amount} ${symbol} bridging initiated!`);
    console.log(`   Tokens will arrive on Linea in ~5-20 minutes`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Bridge failed: ${error.message}`);
    }
    throw error;
  }
}

// Bridge 100 USDC to Linea
// USDC on Ethereum: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
depositERC20("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "100").catch(console.error);
```

### Withdrawing ETH: L2 → L1

Withdrawals require waiting for the zk-proof to be verified on L1 before claiming:

```typescript
// bridge/withdraw-eth.ts
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// L2 Message Service on Linea
const L2_MESSAGE_SERVICE = "0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec";

const L2_MESSAGE_SERVICE_ABI = [
  "function sendMessage(address _to, uint256 _fee, bytes calldata _calldata) external payable",
  "event MessageSent(address indexed _from, address indexed _to, uint256 _fee, uint256 _value, uint256 _nonce, bytes _calldata, bytes32 _messageHash)",
];

// L1 Message Service for claiming
const L1_MESSAGE_SERVICE = "0xd19d4B5d358258f05D7B411E21A1460D11B0876F";

const L1_CLAIM_ABI = [
  "function claimMessage(address _from, address _to, uint256 _fee, uint256 _value, address _feeRecipient, bytes calldata _calldata, uint256 _nonce) external",
];

async function initiateWithdrawal(amountEth: string): Promise<{
  txHash: string;
  messageHash: string;
  nonce: bigint;
}> {
  // Connect to Linea
  const l2Provider = new ethers.JsonRpcProvider(
    "https://linea-sepolia.infura.io/v3/" + process.env.INFURA_KEY
  );
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l2Provider);

  const messageService = new ethers.Contract(
    L2_MESSAGE_SERVICE,
    L2_MESSAGE_SERVICE_ABI,
    wallet
  );

  const amount = ethers.parseEther(amountEth);
  const fee = 0n; // No postman fee for L2→L1 (you claim manually or use a service)

  console.log(`Initiating withdrawal of ${amountEth} ETH from Linea to L1...`);

  try {
    const tx = await messageService.sendMessage(
      wallet.address, // Receive on L1 at same address
      fee,
      "0x", // No calldata
      { value: amount }
    );

    console.log(`L2 TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`L2 TX confirmed in block: ${receipt.blockNumber}`);

    // Parse MessageSent event
    const event = receipt.logs.find(
      (log: ethers.Log) => log.address.toLowerCase() === L2_MESSAGE_SERVICE.toLowerCase()
    );

    let messageHash = "";
    let nonce = 0n;

    if (event) {
      const parsed = messageService.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      messageHash = parsed?.args._messageHash || "";
      nonce = parsed?.args._nonce || 0n;
    }

    console.log(`\n✅ Withdrawal initiated!`);
    console.log(`   Message hash: ${messageHash}`);
    console.log(`   Nonce: ${nonce.toString()}`);
    console.log(`\n⏳ Wait for proof finalization (~1-3 hours)`);
    console.log(`   Then claim on L1 using claimMessage()`);

    return { txHash: tx.hash, messageHash, nonce };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Withdrawal failed: ${error.message}`);
    }
    throw error;
  }
}

async function claimOnL1(
  nonce: bigint,
  amount: string,
  senderAddress: string
): Promise<string> {
  const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);

  const l1MessageService = new ethers.Contract(
    L1_MESSAGE_SERVICE,
    L1_CLAIM_ABI,
    wallet
  );

  console.log(`\nClaiming withdrawal on L1...`);
  console.log(`  Nonce: ${nonce.toString()}`);
  console.log(`  Amount: ${amount} ETH`);

  try {
    const tx = await l1MessageService.claimMessage(
      senderAddress,        // _from (L2 sender)
      wallet.address,       // _to (L1 recipient)
      0n,                   // _fee
      ethers.parseEther(amount), // _value
      ethers.ZeroAddress,   // _feeRecipient
      "0x",                 // _calldata
      nonce                 // _nonce
    );

    console.log(`L1 claim TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`\n✅ Withdrawal claimed! Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   ETH is now in your L1 wallet.`);

    return tx.hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Message not yet finalized")) {
        throw new Error(
          "Proof not yet verified on L1. Wait for finalization (~1-3 hours after L2 tx)."
        );
      }
      throw new Error(`Claim failed: ${error.message}`);
    }
    throw error;
  }
}

// Step 1: Initiate on L2
initiateWithdrawal("0.05").catch(console.error);

// Step 2: After proof finalization (~1-3 hours), claim on L1
// claimOnL1(12345n, "0.05", "0xYourAddress").catch(console.error);
```

### Withdrawal Timeline Comparison

```
Linea (zk-rollup):
  L2 TX → Batch submitted → Proof verified → Claim on L1
  ~2s      ~5-20 min         ~1-3 hours       ~12 seconds
  Total: ~1-3 hours

Optimistic Rollups (Arbitrum, Optimism, Base):
  L2 TX → Batch submitted → Challenge period → Claim on L1
  ~2s      ~5-10 min         7 days             ~12 seconds
  Total: ~7 days

Linea advantage: Withdrawals finalize in hours, not days.
No challenge period needed because validity proofs guarantee correctness.
```

### Using the Linea SDK for Bridging

```typescript
// bridge/sdk-bridge.ts
// The Linea SDK provides a higher-level interface for bridging
import { LineaSDK } from "@consensys/linea-sdk@0.3.0";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function bridgeWithSDK() {
  const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const l2Provider = new ethers.JsonRpcProvider(
    `https://linea-sepolia.infura.io/v3/${process.env.INFURA_KEY}`
  );

  const sdk = new LineaSDK({
    l1: {
      provider: l1Provider,
      contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
    },
    l2: {
      provider: l2Provider,
      contractAddress: "0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec",
    },
  });

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, l1Provider);

  // Get message status
  const messageHash = "0xYOUR_MESSAGE_HASH";
  const status = await sdk.getMessageStatus(messageHash);
  console.log(`Message status: ${status}`);
  // Possible statuses: SENT, ANCHORED, CLAIMED

  // Check if a withdrawal is ready to claim
  if (status === "ANCHORED") {
    console.log("Message is anchored on L1 — ready to claim!");
  } else if (status === "SENT") {
    console.log("Message sent but not yet proven. Wait for finalization.");
  }
}

bridgeWithSDK().catch(console.error);
```

### Automatic vs Manual Claiming

```
Automatic Claiming (Deposits L1→L2):
  - Include a postman fee in msg.value
  - Linea's postman service automatically claims on L2
  - No user action needed after L1 TX confirms
  - Fee: ~0.001 ETH (varies)

Manual Claiming (Withdrawals L2→L1):
  - User must call claimMessage() on L1 after proof finalization
  - Requires L1 gas for the claim transaction
  - Can use third-party services for automatic claiming
  - More control but requires monitoring
```

## Common Pitfalls

1. **Not including the postman fee for deposits** — If you send `msg.value` equal to only the bridge amount without the fee, the message won't be automatically claimed on L2. You'll need to manually claim it, which requires a separate L2 transaction. Always add the postman fee (check current rates via the Linea bridge UI).

2. **Trying to claim a withdrawal before proof finalization** — The L1 `claimMessage()` will revert if the batch containing your withdrawal hasn't been proven yet. Unlike optimistic rollups where you wait a fixed 7 days, Linea's wait time varies (1-3 hours). Check the message status before attempting to claim.

3. **Bridging tokens that aren't supported** — Not all ERC-20 tokens have a canonical bridge mapping on Linea. Bridging an unsupported token through the canonical bridge may result in a wrapped version that has no liquidity on Linea. Check the [Linea token list](https://docs.linea.build/developers/quickstart/info-contracts) before bridging.

4. **Confusing L1 and L2 contract addresses** — The message service has different addresses on L1 and L2. Using the wrong address will cause transactions to fail or send funds to the wrong contract. Always verify you're interacting with the correct chain's contract.

## What to Learn Next

- [Ecosystem Tooling on Linea](./04-ecosystem-tooling.md) — SDKs, explorers, and developer tools for Linea
- [Linea Bridge Documentation](https://docs.linea.build/developers/guides/bridge) — Official bridging guide
- [Linea Bridge UI](https://bridge.linea.build/) — Web interface for bridging (useful for testing)
- [Linea Message Service GitHub](https://github.com/Consensys/linea-contracts) — Bridge contract source code
