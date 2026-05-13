# Tenderly: Debugging and Simulating Transactions Like a Pro

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

A transaction failed on mainnet. The error is "execution reverted" with no reason string. You have a transaction hash and nothing else. How do you figure out what went wrong?

Or: you want to test a complex transaction before sending it — simulate a liquidation, test a governance proposal, or check if a swap will succeed at current prices. You don't want to spend gas on a transaction that might fail.

Tenderly solves both problems. It's the most powerful debugging and simulation tool in the EVM ecosystem.

---

## Core Concepts

### What Tenderly Does

Tenderly is a developer platform for EVM chains that provides:

**Transaction Debugger**: step through any transaction execution, see every opcode, every storage read/write, every event emitted. Works on mainnet, testnets, and your own fork.

**Simulation**: simulate any transaction against current or historical mainnet state without spending gas. Test complex scenarios before executing.

**Alerts**: get notified when specific events happen on-chain (contract called, event emitted, balance changed).

**Monitoring**: track your contracts' health, gas usage, and error rates.

**Virtual TestNets**: fork mainnet with a custom state for testing.

### The Simulation API

Tenderly's simulation API is the most powerful feature for developers. You can:
- Simulate a transaction against current mainnet state
- Override any account's balance, code, or storage
- Simulate as any address (impersonation)
- Get a full execution trace

This is invaluable for:
- Testing liquidations before executing
- Verifying governance proposals
- Debugging failed transactions
- Testing contract interactions with real mainnet state

---

## Code Walkthrough

Using Tenderly's simulation API:

```typescript
import axios from "axios";
import { ethers } from "ethers";

const TENDERLY_API_KEY = process.env.TENDERLY_API_KEY!;
const TENDERLY_ACCOUNT = process.env.TENDERLY_ACCOUNT!; // your username
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT!; // your project slug

interface SimulationRequest {
  network_id: string;
  from: string;
  to: string;
  input: string;
  value?: string;
  gas?: number;
  gas_price?: string;
  save?: boolean;
  save_if_fails?: boolean;
  // Override state for simulation
  state_objects?: Record<string, {
    balance?: string;
    code?: string;
    storage?: Record<string, string>;
  }>;
}

interface SimulationResult {
  transaction: {
    hash: string;
    status: boolean;
    gas_used: number;
    error_message?: string;
  };
  logs: {
    name: string;
    inputs: { name: string; value: string }[];
  }[];
  call_trace: {
    type: string;
    from: string;
    to: string;
    input: string;
    output: string;
    gas: number;
    gas_used: number;
    error?: string;
  }[];
}

async function simulateTransaction(
  request: SimulationRequest
): Promise<SimulationResult> {
  const response = await axios.post(
    `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT}/project/${TENDERLY_PROJECT}/simulate`,
    request,
    {
      headers: {
        "X-Access-Key": TENDERLY_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.simulation;
}

// ── Example 1: Simulate a Uniswap swap ────────────────────────────────────

async function simulateUniswapSwap(
  userAddress: string,
  amountIn: bigint,
  minAmountOut: bigint
) {
  const UNISWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  const routerInterface = new ethers.Interface([
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  ]);

  const calldata = routerInterface.encodeFunctionData("exactInputSingle", [{
    tokenIn: WETH,
    tokenOut: USDC,
    fee: 3000,
    recipient: userAddress,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    amountIn,
    amountOutMinimum: minAmountOut,
    sqrtPriceLimitX96: 0n,
  }]);

  const result = await simulateTransaction({
    network_id: "1", // Ethereum mainnet
    from: userAddress,
    to: UNISWAP_ROUTER,
    input: calldata,
    value: amountIn.toString(), // sending ETH
    gas: 300000,
    save: true, // save to Tenderly dashboard
    save_if_fails: true,
    // Override: give user 10 ETH for the simulation
    state_objects: {
      [userAddress]: {
        balance: ethers.parseEther("10").toString(),
      },
    },
  });

  if (!result.transaction.status) {
    console.error("Simulation failed:", result.transaction.error_message);
    // Print call trace to find where it failed
    result.call_trace.forEach((call) => {
      if (call.error) {
        console.error(`Failed at: ${call.to} - ${call.error}`);
      }
    });
    return null;
  }

  // Find the swap event
  const swapEvent = result.logs.find((log) => log.name === "Swap");
  if (swapEvent) {
    const amountOut = swapEvent.inputs.find((i) => i.name === "amount1")?.value;
    console.log("Simulated swap output:", amountOut, "USDC");
  }

  return result;
}

// ── Example 2: Debug a failed transaction ─────────────────────────────────

async function debugFailedTransaction(txHash: string) {
  const response = await axios.get(
    `https://api.tenderly.co/api/v1/public-contract/1/tx/${txHash}`,
    {
      headers: { "X-Access-Key": TENDERLY_API_KEY },
    }
  );

  const tx = response.data;

  console.log("Transaction status:", tx.status ? "Success" : "Failed");
  console.log("Gas used:", tx.gas_used);

  if (!tx.status) {
    console.log("Error:", tx.error_message);

    // Find the deepest call that failed
    function findFailure(calls: any[], depth = 0): void {
      for (const call of calls) {
        if (call.error) {
          console.log(`${"  ".repeat(depth)}FAILED: ${call.to}`);
          console.log(`${"  ".repeat(depth)}Error: ${call.error}`);
          console.log(`${"  ".repeat(depth)}Input: ${call.input.slice(0, 10)}...`);
        }
        if (call.calls) {
          findFailure(call.calls, depth + 1);
        }
      }
    }

    findFailure(tx.call_trace);
  }

  return tx;
}

// ── Example 3: Simulate governance proposal execution ─────────────────────

async function simulateGovernanceProposal(
  governorAddress: string,
  proposalId: bigint,
  timelockAddress: string
) {
  const governorInterface = new ethers.Interface([
    "function execute(uint256 proposalId) payable",
    "function state(uint256 proposalId) view returns (uint8)",
  ]);

  // Simulate as the timelock (which executes proposals)
  const result = await simulateTransaction({
    network_id: "1",
    from: timelockAddress,
    to: governorAddress,
    input: governorInterface.encodeFunctionData("execute", [proposalId]),
    gas: 1000000,
    save: true,
    // Override: set proposal state to "Queued" (4) so it can be executed
    state_objects: {
      [governorAddress]: {
        storage: {
          // This would need the actual storage slot for the proposal state
          // In practice, use Tenderly's UI to find the right slot
        },
      },
    },
  });

  console.log("Proposal execution simulation:", result.transaction.status ? "Would succeed" : "Would fail");
  if (!result.transaction.status) {
    console.log("Failure reason:", result.transaction.error_message);
  }

  return result;
}
```

Setting up Tenderly alerts:

```typescript
// Set up an alert for when a specific contract is called
async function createAlert(contractAddress: string, eventName: string) {
  const response = await axios.post(
    `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT}/project/${TENDERLY_PROJECT}/alerts`,
    {
      name: `${eventName} on ${contractAddress.slice(0, 8)}`,
      description: `Alert when ${eventName} is emitted`,
      enabled: true,
      alert_type: "LOG_EVENT",
      parameters: {
        network_id: "1",
        contract_address: contractAddress,
        event_name: eventName,
      },
      destinations: [
        {
          type: "webhook",
          url: "https://your-backend.com/webhook/tenderly",
        },
        {
          type: "email",
          email: "alerts@yourprotocol.com",
        },
      ],
    },
    {
      headers: { "X-Access-Key": TENDERLY_API_KEY },
    }
  );

  console.log("Alert created:", response.data.id);
}
```

---

## Common Mistakes and Gotchas

**1. Not using simulation before mainnet transactions**  
Any complex transaction (governance execution, large liquidation, multi-step DeFi operation) should be simulated first. Tenderly simulation is free and takes seconds. A failed mainnet transaction wastes gas and can have side effects.

**2. Not saving simulations for debugging**  
Set `save: true` and `save_if_fails: true` in your simulation requests. This saves the simulation to your Tenderly dashboard where you can inspect it visually, share it with teammates, and reference it later.

**3. Forgetting to override state for realistic simulations**  
If you're simulating a transaction that requires the user to have tokens, override their balance in `state_objects`. Otherwise the simulation will fail for the wrong reason (insufficient balance instead of the actual issue you're testing).

**4. Not using Tenderly for production monitoring**  
Tenderly's monitoring features are underused. Set up alerts for critical events (large withdrawals, admin function calls, unusual gas usage) and you'll know about issues before your users do.

**5. Using Tenderly's public API for sensitive operations**  
Tenderly's simulation API sends your transaction data to their servers. For sensitive operations (testing with private keys, simulating unreleased features), use Tenderly's Virtual TestNets (private forks) instead of the public simulation API.

---

## How This Connects to Production

Uniswap Labs uses Tenderly for transaction debugging and monitoring. Aave uses Tenderly alerts for protocol monitoring. Many DeFi protocols use Tenderly's simulation API to validate complex operations before execution. Tenderly's Virtual TestNets are used for staging environments — fork mainnet, deploy your new contracts, test with real mainnet state, all without spending real ETH. The combination of simulation + debugging + monitoring makes Tenderly the most comprehensive developer tool in the EVM ecosystem.

---

## What to Learn Next

- **GraphQL for Blockchain Data: Building Flexible Query APIs** — build queryable APIs on top of your on-chain data.
- **The Graph Protocol vs Custom Indexers: When to Use Each** — index your contract events for efficient querying.
- **Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale** — deploy your backend infrastructure.
