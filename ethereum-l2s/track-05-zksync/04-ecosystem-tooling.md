# zkSync Era Tooling and Development Environment

**Track:** zkSync Era Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

You want to build on zkSync Era but the tooling landscape is different from standard Ethereum development. You can't just point Hardhat at a new RPC and call it a day — zkSync requires a custom compiler (`zksolc`), specialized deployment plugins, and its own SDK. You need to set up a development environment that handles the two-step compilation, deploys to the correct network, and gives you access to zkSync-specific features like paymasters and account abstraction.

## Core Concepts

### Development Stack Overview

```
Standard Ethereum Stack:          zkSync Era Stack:
─────────────────────────         ─────────────────────────
Hardhat / Foundry                 Hardhat + zkSync plugins
solc compiler                     solc → zksolc (two-step)
ethers.js / viem                  zksync-ethers (extends ethers)
Ethereum RPC                      zkSync Era RPC (+ extensions)
Etherscan                         zkSync Era Explorer
```

### Project Setup with Hardhat

Create a new zkSync Era project from scratch:

```shell
mkdir zksync-project && cd zksync-project
npm init -y
npm install --save-dev hardhat@2.19.4 \
  @matterlabs/hardhat-zksync@1.1.0 \
  @matterlabs/hardhat-zksync-solc@1.2.5 \
  @matterlabs/hardhat-zksync-deploy@1.5.0 \
  @matterlabs/hardhat-zksync-verify@1.6.0 \
  zksync-ethers@6.8.0 \
  ethers@6.9.0 \
  typescript@5.3.3 \
  ts-node@10.9.2 \
  @types/node@20.10.0 \
  dotenv@16.3.1
```

```
Expected output:
added 487 packages, and audited 488 packages in 25s
found 0 vulnerabilities
```

### Hardhat Configuration

Create `hardhat.config.ts`:

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@matterlabs/hardhat-zksync";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  defaultNetwork: "zkSyncSepoliaTestnet",

  networks: {
    zkSyncSepoliaTestnet: {
      url: "https://sepolia.era.zksync.dev",
      ethNetwork: "sepolia", // L1 network for bridging
      zksync: true,
      verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification",
    },
    zkSyncMainnet: {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "mainnet",
      zksync: true,
      verifyURL: "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
    },
    // Local testing with era-test-node
    inMemoryNode: {
      url: "http://127.0.0.1:8011",
      ethNetwork: "localhost",
      zksync: true,
    },
    // Standard Hardhat network for comparison testing
    hardhat: {
      zksync: false, // Disable zkSync for standard EVM testing
    },
  },

  zksolc: {
    version: "1.5.7", // Pin the zksolc version
    settings: {
      // Enable optimizer for smaller bytecode
      optimizer: {
        enabled: true,
        mode: "3", // Optimization level: 0-3 (3 = most aggressive)
      },
      // Required for factory contracts that deploy other contracts
      // List all contracts that will be deployed by factories
      factoryDeps: [],
    },
  },

  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris", // zkSync Era supports up to Paris
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache-zk",
    artifacts: "./artifacts-zk",
  },
};

export default config;
```

### Environment Configuration

Create `.env`:

```shell
# .env — NEVER commit this file
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
ETHERSCAN_API_KEY=your_etherscan_key
```

Create `tsconfig.json`:

```typescript
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "declaration": true
  },
  "include": ["./deploy", "./test", "./hardhat.config.ts"],
  "files": ["./hardhat.config.ts"]
}
```

### Writing a Contract

Create `contracts/Greeter.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Greeter — A simple contract for testing zkSync deployment
/// @notice Stores and retrieves a greeting string
contract Greeter {
    string private greeting;

    event GreetingChanged(string oldGreeting, string newGreeting, address changedBy);

    error EmptyGreeting();

    constructor(string memory _greeting) {
        if (bytes(_greeting).length == 0) revert EmptyGreeting();
        greeting = _greeting;
    }

    function greet() public view returns (string memory) {
        return greeting;
    }

    function setGreeting(string memory _greeting) public {
        if (bytes(_greeting).length == 0) revert EmptyGreeting();
        string memory oldGreeting = greeting;
        greeting = _greeting;
        emit GreetingChanged(oldGreeting, _greeting, msg.sender);
    }
}
```

### Compilation

```shell
npx hardhat compile
```

```
Expected output:
Compiling 1 Solidity file
Successfully compiled 1 Solidity file
zksolc version: 1.5.7
Compiling contracts for zkSync Era with zksolc v1.5.7 and solc v0.8.24
Compiled successfully!
```

The compiled artifacts are in `artifacts-zk/` — these contain EraVM bytecode, not EVM bytecode.

### Deployment Script

Create `deploy/deploy-greeter.ts`:

```typescript
// deploy/deploy-greeter.ts
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Wallet } from "zksync-ethers";
import * as dotenv from "dotenv";

dotenv.config();

export default async function (hre: HardhatRuntimeEnvironment) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not set in .env file");
  }

  console.log("Deploying Greeter contract to zkSync Era...");

  // Create wallet from private key
  const wallet = new Wallet(privateKey);
  const deployer = new Deployer(hre, wallet);

  // Load the compiled artifact
  const artifact = await deployer.loadArtifact("Greeter");

  // Estimate deployment cost
  const deploymentFee = await deployer.estimateDeployFee(artifact, ["Hello, zkSync!"]);
  console.log(`Estimated deployment cost: ${hre.ethers.formatEther(deploymentFee)} ETH`);

  // Check wallet balance
  const balance = await deployer.zkWallet.getBalance();
  if (balance < deploymentFee) {
    throw new Error(
      `Insufficient balance. Have: ${hre.ethers.formatEther(balance)} ETH, ` +
      `Need: ${hre.ethers.formatEther(deploymentFee)} ETH. ` +
      `Get testnet ETH from https://faucet.triangleplatform.com/zksync/sepolia`
    );
  }

  // Deploy with constructor arguments
  const greeter = await deployer.deploy(artifact, ["Hello, zkSync!"]);
  const contractAddress = await greeter.getAddress();

  console.log(`Greeter deployed to: ${contractAddress}`);
  console.log(`Explorer: https://sepolia.explorer.zksync.io/address/${contractAddress}`);

  // Verify the contract
  console.log("Verifying contract...");
  await hre.run("verify:verify", {
    address: contractAddress,
    constructorArguments: ["Hello, zkSync!"],
  });
  console.log("Contract verified!");
}
```

### Deploy Command

```shell
npx hardhat deploy-zksync --script deploy-greeter.ts --network zkSyncSepoliaTestnet
```

```
Expected output:
Deploying Greeter contract to zkSync Era...
Estimated deployment cost: 0.00025 ETH
Greeter deployed to: 0x1234...abcd
Explorer: https://sepolia.explorer.zksync.io/address/0x1234...abcd
Verifying contract...
Contract verified!
```

### Local Testing with era-test-node

For fast local development, use the zkSync Era test node:

```shell
# Install era-test-node (Rust required)
# Last verified: 2025-01-15
# See: https://github.com/matter-labs/era-test-node
cargo install era-test-node@0.1.0-alpha.27

# Or use Docker
docker run --rm -p 8011:8011 matterlabs/era-test-node:latest
```

```
Expected output:
Rich Accounts
=============
Account #0: 0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 (10000 ETH)
Account #1: 0xa61464658AfeAf65CccaaFD3a512b69A83B77618 (10000 ETH)
...
Node is ready at 127.0.0.1:8011
```

### Testing with Hardhat

Create `test/greeter.test.ts`:

```typescript
// test/greeter.test.ts
import { expect } from "chai";
import { Wallet, Provider, Contract } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as hre from "hardhat";

describe("Greeter", function () {
  let greeter: Contract;
  let wallet: Wallet;

  before(async function () {
    // Use rich wallet from era-test-node
    const provider = new Provider("http://127.0.0.1:8011");
    wallet = new Wallet(
      "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110",
      provider
    );

    const deployer = new Deployer(hre, wallet);
    const artifact = await deployer.loadArtifact("Greeter");
    greeter = await deployer.deploy(artifact, ["Hello, test!"]);
  });

  it("should return the initial greeting", async function () {
    expect(await greeter.greet()).to.equal("Hello, test!");
  });

  it("should update the greeting", async function () {
    const tx = await greeter.setGreeting("New greeting");
    await tx.wait();
    expect(await greeter.greet()).to.equal("New greeting");
  });

  it("should revert on empty greeting", async function () {
    await expect(greeter.setGreeting("")).to.be.reverted;
  });

  it("should emit GreetingChanged event", async function () {
    const tx = await greeter.setGreeting("Event test");
    const receipt = await tx.wait();

    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === "GreetingChanged"
    );
    expect(event).to.not.be.undefined;
  });
});
```

Run tests against the local node:

```shell
# Start era-test-node in one terminal, then:
npx hardhat test --network inMemoryNode
```

```
Expected output:
  Greeter
    ✓ should return the initial greeting (120ms)
    ✓ should update the greeting (85ms)
    ✓ should revert on empty greeting (45ms)
    ✓ should emit GreetingChanged event (90ms)

  4 passing (340ms)
```

### zkSync CLI (zksync-cli)

The `zksync-cli` provides scaffolding and utilities:

```shell
# Install globally
# Last verified: 2025-01-15
npm install -g zksync-cli@1.8.0

# Create a new project from template
zksync-cli create my-project --template hardhat_solidity

# Check wallet balance
zksync-cli wallet balance --chain zksync-sepolia

# Bridge ETH from L1 to L2
zksync-cli bridge deposit --chain zksync-sepolia --amount 0.01
```

```
Expected output (balance check):
zkSync Era Sepolia balance:
  ETH: 0.5
  Address: 0xYourAddress
```

### Foundry Support (foundry-zksync)

For Foundry users, there's experimental zkSync support:

```shell
# Install foundry-zksync fork
# Last verified: 2025-01-15
# See: https://github.com/matter-labs/foundry-zksync
curl -L https://raw.githubusercontent.com/matter-labs/foundry-zksync/main/install | bash
foundryup-zksync

# Compile with zkSync support
forge build --zksync

# Deploy
forge create contracts/Greeter.sol:Greeter \
  --constructor-args "Hello" \
  --rpc-url https://sepolia.era.zksync.dev \
  --private-key $PRIVATE_KEY \
  --zksync
```

## Common Pitfalls

1. **Using standard Hardhat without zkSync plugins** — Standard `hardhat compile` produces EVM bytecode that cannot be deployed to zkSync Era. You must use `@matterlabs/hardhat-zksync-solc` which invokes `zksolc` for the second compilation step. Without it, deployment will fail with cryptic errors.

2. **Version mismatches between `solc` and `zksolc`** — `zksolc` 1.5.x requires `solc` 0.8.x. Using an incompatible combination produces compilation errors. Always check the [compatibility matrix](https://docs.zksync.io/build/tooling/hardhat/hardhat-zksync-solc#supported-versions) and pin both versions.

3. **Deploying with standard ethers.js instead of zksync-ethers** — The standard `ethers.ContractFactory.deploy()` doesn't work on zkSync Era because deployment goes through the `ContractDeployer` system contract. Use the `Deployer` class from `@matterlabs/hardhat-zksync-deploy` or `zksync-ethers` wallet methods.

4. **Not setting `evmVersion` to "paris" or earlier** — zkSync Era doesn't support the Shanghai EVM version's `PUSH0` opcode in all contexts. Set `evmVersion: "paris"` in your Solidity compiler settings to avoid unexpected behavior.

5. **Forgetting to fund the testnet wallet** — zkSync Era Sepolia requires SepoliaETH bridged from L1. The faucet at [https://faucet.triangleplatform.com/zksync/sepolia](https://faucet.triangleplatform.com/zksync/sepolia) provides testnet ETH directly on L2 (last verified: 2025-01-15). Alternatively, bridge from Sepolia using the [zkSync bridge](https://bridge.zksync.io/).

## What to Learn Next

- [Deploying to zkSync Era](./05-deployment-walkthrough.md) — Complete deployment walkthrough with gas comparison to Ethereum mainnet
- [zkSync Era Documentation](https://docs.zksync.io/) — Official developer documentation
- [Hardhat zkSync Plugins](https://github.com/matter-labs/hardhat-zksync) — Source code and examples for all Hardhat plugins
- [era-test-node](https://github.com/matter-labs/era-test-node) — Local testing node for fast development iteration
