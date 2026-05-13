# Testnets vs Mainnets: Where Developers Practice Before Going Live

**Track:** Beginner  
**Read time:** 8 min

---

## The Problem

You've written your first smart contract. It compiles. Now what? You're not going to deploy it to Ethereum mainnet and spend real ETH to test it — but you also can't just run it locally forever. You need a middle ground: an environment that behaves like the real chain but uses fake money.

That's what testnets are for. But there are multiple testnets, they have different properties, and choosing the wrong one (or not understanding its limitations) will waste your time. This blog maps out the full testing landscape — from local dev to mainnet — so you know exactly where to test what.

---

## Core Concepts

### The Testing Pyramid for Smart Contracts

Think of smart contract testing in layers:

```
                    ┌─────────────┐
                    │   Mainnet   │  Real money, real users, irreversible
                    └──────┬──────┘
                    ┌──────┴──────┐
                    │   Testnet   │  Fake money, real network conditions
                    └──────┬──────┘
                    ┌──────┴──────┐
                    │  Local Fork │  Mainnet state, instant, free
                    └──────┬──────┘
                    ┌──────┴──────┐
                    │  Unit Tests │  Isolated, fast, no network
                    └─────────────┘
```

You work bottom-up. Unit tests first, then local fork testing, then testnet, then mainnet. Each layer catches different classes of bugs.

### Local Development: Hardhat Network and Anvil

Before touching any network, you run a local blockchain on your machine. Two main options:

**Hardhat Network** — built into Hardhat. Spins up an in-memory EVM with pre-funded accounts. Resets between test runs. Supports `console.log` in Solidity (invaluable for debugging).

**Anvil** — Foundry's local node. Faster than Hardhat Network, supports more advanced features like time manipulation, impersonating accounts, and forking mainnet state.

```bash
# Start Anvil with 10 pre-funded accounts (10,000 ETH each)
anvil

# Fork mainnet at a specific block — your local chain has all mainnet state
anvil --fork-url https://mainnet.infura.io/v3/YOUR_KEY --fork-block-number 19000000
```

Forking is powerful: you can test your contract's interaction with Uniswap, Aave, or any other mainnet protocol without spending real ETH. Your local fork has the exact state of mainnet at that block.

### Public Testnets

Public testnets are real networks with real nodes, real block times, and real consensus — but the native token has no monetary value. You get testnet ETH from "faucets" (websites that drip free tokens).

**Sepolia** — the primary Ethereum testnet as of 2024. Proof of Stake, maintained by the Ethereum Foundation. Use this for most Ethereum development.

**Holesky** — newer Ethereum testnet, designed for staking and validator testing. Larger validator set than Sepolia.

**Goerli** — deprecated. Don't use it. Faucets dried up, it's being wound down.

For L2s:
- **Arbitrum Sepolia** — Arbitrum's testnet (replaced Arbitrum Goerli)
- **Optimism Sepolia** — OP Stack testnet
- **Polygon Amoy** — replaced Mumbai as Polygon's testnet
- **Base Sepolia** — Base's testnet

**Solana:**
- **Devnet** — primary development network, faucet available
- **Testnet** — used for validator testing, less relevant for dApp developers
- **Localnet** — `solana-test-validator` running locally

### What Testnets Are Good For

- Testing deployment scripts
- Testing wallet integration (MetaMask connecting, signing, etc.)
- Testing frontend interactions with real RPC calls
- Testing cross-contract interactions
- Sharing a deployed contract with teammates or auditors
- Testing gas estimation in real network conditions

### What Testnets Are Bad For

- **Performance testing** — testnet block times and congestion don't match mainnet
- **MEV/front-running testing** — no real searchers on testnet
- **Oracle price feeds** — testnet Chainlink feeds use fake prices that don't move realistically
- **Liquidity testing** — no real liquidity in testnet DEX pools
- **Long-running tests** — testnet faucets are rate-limited, and testnet ETH can be hard to get in bulk

For these scenarios, mainnet forking is better.

### Mainnet Forking: The Best of Both Worlds

Mainnet forking (via Anvil or Hardhat) gives you:
- Real mainnet state (real Uniswap pools, real Aave positions, real token balances)
- Instant block times (no waiting)
- Free transactions (no real ETH needed)
- The ability to impersonate any address (for testing edge cases)

```typescript
// hardhat.config.ts — configure mainnet forking
import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: "https://mainnet.infura.io/v3/YOUR_KEY",
        blockNumber: 19500000, // pin to a specific block for reproducibility
      },
    },
  },
};

export default config;
```

```typescript
// In your test — impersonate a whale to test with real tokens
import { ethers } from "hardhat";

it("should swap USDC for ETH on Uniswap", async () => {
  // Impersonate a USDC whale — we can now send transactions as this address
  const whaleAddress = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
  await ethers.provider.send("hardhat_impersonateAccount", [whaleAddress]);
  const whale = await ethers.getSigner(whaleAddress);

  // Give the whale some ETH for gas
  await ethers.provider.send("hardhat_setBalance", [
    whaleAddress,
    "0x56BC75E2D63100000", // 100 ETH in hex wei
  ]);

  // Now interact with real Uniswap using real USDC
  const uniswapRouter = await ethers.getContractAt(
    "ISwapRouter",
    "0xE592427A0AEce92De3Edee1F18E0157C05861564" // real Uniswap V3 router
  );

  // ... test your swap logic with real mainnet state
});
```

---

## Code Walkthrough

Here's a complete workflow showing how to deploy and verify a contract on Sepolia testnet using Hardhat:

```typescript
// scripts/deploy.ts
import { ethers, run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Deploy the contract
  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");
  const contract = await SimpleStorage.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Deployed to:", address);

  // Wait for a few block confirmations before verifying
  // Etherscan needs time to index the deployment
  console.log("Waiting for block confirmations...");
  await contract.deploymentTransaction()?.wait(5);

  // Verify on Etherscan (Sepolia uses the same Etherscan API)
  console.log("Verifying on Etherscan...");
  await run("verify:verify", {
    address: address,
    constructorArguments: [], // pass constructor args if any
  });

  console.log("Verified! View at: https://sepolia.etherscan.io/address/" + address);
}

main().catch(console.error);
```

```typescript
// hardhat.config.ts — full config for Sepolia deployment
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY!], // testnet private key only — never mainnet key in config
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
```

```bash
# Deploy to Sepolia
npx hardhat run scripts/deploy.ts --network sepolia

# Get testnet ETH from faucet
# https://sepoliafaucet.com
# https://faucet.quicknode.com/ethereum/sepolia
```

---

## Common Mistakes and Gotchas

**1. Using a mainnet private key on testnet configs**  
Your `.env` file has your mainnet private key for production deployments. If you accidentally use it in a testnet config and that config file gets committed or leaked, your mainnet funds are at risk. Use a dedicated testnet wallet with no real funds. Ever.

**2. Assuming testnet behavior matches mainnet exactly**  
Testnet validators are run by a small set of known operators. There's no MEV, no realistic mempool congestion, and block times can be irregular. A contract that works perfectly on Sepolia can behave differently on mainnet under load.

**3. Not pinning fork block numbers**  
If you fork mainnet without specifying a block number, your tests run against the current state — which changes every 12 seconds. This makes tests non-deterministic. Always pin to a specific block number for reproducible tests.

**4. Forgetting that testnet contract addresses differ from mainnet**  
Uniswap, Aave, Chainlink — they all have different addresses on testnet vs mainnet. And testnet deployments are often older versions or have limited functionality. Don't hardcode addresses; use a config file that maps network → address.

**5. Skipping the testnet phase entirely**  
Some developers go straight from local testing to mainnet. Local tests can't catch issues with real wallet UX, real RPC behavior, or real block explorer integration. Always do a testnet deployment before mainnet, even if it's brief.

---

## How This Connects to Production

Every serious protocol has a staged deployment process. Uniswap deploys to testnet, runs an internal audit period, then deploys to mainnet. Aave has a governance process where new features are deployed to testnet, reviewed by the community, then deployed to mainnet via a governance proposal. Chainlink runs its oracle network on testnet before adding new price feeds to mainnet. The testnet → mainnet pipeline isn't just a developer convenience — it's a risk management process. The cost of a bug on mainnet (lost user funds, protocol insolvency, reputational damage) is orders of magnitude higher than the cost of finding it on testnet.

---

## What to Learn Next

- **RPC Nodes Explained: How Your dApp Talks to the Blockchain** — understand the infrastructure you're connecting to when you deploy to testnet or mainnet.
- **Hardhat vs Foundry: Which Testing Framework Should You Use?** — go deep on the local testing layer before you ever touch a testnet.
- **Smart Contract Audit Process: What Auditors Actually Look For** — understand what happens between testnet and mainnet for production protocols.
