# Development Environment Setup

**Track:** Sei Development
**Level:** Beginner
**Read time:** 13 min

---

## The Problem

You want to start building on Sei but face a choice: use familiar Ethereum tooling (Hardhat, Foundry, MetaMask) via the EVM side, or use Cosmos tooling (seid CLI, Keplr) for CosmWasm contracts. Sei supports both, but the setup differs depending on your path. This lesson gets both environments running so you can compile, deploy, and test contracts on Sei's testnet regardless of which execution environment you choose.

---

## Core Concepts

### Tooling Overview

| Tool | Purpose | Path |
|------|---------|------|
| Foundry (forge) | Compile, deploy, test EVM contracts | EVM |
| Hardhat | Alternative EVM development framework | EVM |
| MetaMask | Browser wallet for EVM interactions | EVM |
| seid CLI | Cosmos-native CLI for chain interaction | CosmWasm |
| Keplr | Browser wallet for Cosmos interactions | CosmWasm |
| Compass | Sei-native wallet (supports both) | Both |
| @sei-js/core | JavaScript SDK for Sei | Both |

### EVM Path: Foundry Setup

Foundry is the recommended tool for EVM development on Sei due to its speed and Solidity-native testing.

```shell
# Install Foundry (forge, cast, anvil)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify installation
forge --version
# forge 0.2.0 (nightly-2024-12-01)

# Create a new project
forge init sei-evm-project
cd sei-evm-project

# Project structure:
# sei-evm-project/
# ├── src/
# │   └── Counter.sol
# ├── test/
# │   └── Counter.t.sol
# ├── script/
# │   └── Counter.s.sol
# ├── lib/
# └── foundry.toml
```

### Configuring Foundry for Sei

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.25"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
sei_testnet = "https://evm-rpc-testnet.sei-apis.com"
sei_mainnet = "https://evm-rpc.sei-apis.com"

[etherscan]
sei_testnet = { key = "${SEITRACE_API_KEY}", url = "https://seitrace.com/api/v2" }
sei_mainnet = { key = "${SEITRACE_API_KEY}", url = "https://seitrace.com/api/v2" }
```

### EVM Path: Hardhat Setup (Alternative)

```shell
# Create project directory
mkdir sei-hardhat-project && cd sei-hardhat-project

# Initialize with Hardhat
npm init -y
npm install --save-dev hardhat@2.22.0 @nomicfoundation/hardhat-toolbox@4.0.0

# Initialize Hardhat project
npx hardhat init
# Select: "Create a TypeScript project"

# Project structure:
# sei-hardhat-project/
# ├── contracts/
# │   └── Lock.sol
# ├── test/
# │   └── Lock.ts
# ├── scripts/
# │   └── deploy.ts
# ├── hardhat.config.ts
# └── package.json
```

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    sei_testnet: {
      url: "https://evm-rpc-testnet.sei-apis.com",
      chainId: 1328,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    sei_mainnet: {
      url: "https://evm-rpc.sei-apis.com",
      chainId: 1329,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};

export default config;
```

### MetaMask Configuration for Sei

Add Sei networks to MetaMask:

```
Sei Mainnet:
  Network Name: Sei
  RPC URL: https://evm-rpc.sei-apis.com
  Chain ID: 1329
  Currency Symbol: SEI
  Block Explorer: https://seitrace.com

Sei Testnet (atlantic-2):
  Network Name: Sei Testnet
  RPC URL: https://evm-rpc-testnet.sei-apis.com
  Chain ID: 1328
  Currency Symbol: SEI
  Block Explorer: https://testnet.seitrace.com
```

```javascript
// Programmatically add Sei to MetaMask
// Using window.ethereum (MetaMask provider)
async function addSeiNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x530",  // 1328 in hex (testnet)
        chainName: "Sei Testnet",
        nativeCurrency: {
          name: "SEI",
          symbol: "SEI",
          decimals: 18
        },
        rpcUrls: ["https://evm-rpc-testnet.sei-apis.com"],
        blockExplorerUrls: ["https://testnet.seitrace.com"]
      }]
    });
    console.log("Sei Testnet added to MetaMask");
  } catch (error) {
    console.error("Failed to add network:", error);
  }
}
```

### CosmWasm Path: seid CLI Setup

For CosmWasm development, you need the `seid` CLI:

```shell
# Install seid CLI (requires Go 1.21+)
# Option 1: Build from source
git clone https://github.com/sei-protocol/sei-chain.git
cd sei-chain
git checkout v5.9.0
make install

# Verify installation
seid version
# v5.9.0

# Option 2: Download pre-built binary (Linux/Mac)
# Check releases: https://github.com/sei-protocol/sei-chain/releases
wget https://github.com/sei-protocol/sei-chain/releases/download/v5.9.0/seid-v5.9.0-linux-amd64
chmod +x seid-v5.9.0-linux-amd64
sudo mv seid-v5.9.0-linux-amd64 /usr/local/bin/seid

# Configure for testnet
seid config chain-id atlantic-2
seid config node https://rpc-testnet.sei-apis.com:443

# Create or import a wallet
seid keys add my-wallet
# Save the mnemonic phrase securely!

# Or import existing mnemonic
seid keys add my-wallet --recover
# Enter your 24-word mnemonic when prompted
```

### CosmWasm Development Setup (Rust)

```shell
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Add wasm32 target for CosmWasm compilation
rustup target add wasm32-unknown-unknown

# Install cargo-generate for project templates
cargo install cargo-generate@0.21.0

# Install CosmWasm optimizer (for production builds)
# Requires Docker
docker pull cosmwasm/optimizer:0.16.0

# Verify Rust setup
rustc --version
# rustc 1.78.0

cargo --version
# cargo 1.78.0

# Create a new CosmWasm project from template
cargo generate --git https://github.com/CosmWasm/cw-template.git --name my-sei-contract
cd my-sei-contract

# Project structure:
# my-sei-contract/
# ├── src/
# │   ├── contract.rs    ← Main contract logic
# │   ├── error.rs       ← Custom errors
# │   ├── msg.rs         ← Message types (instantiate, execute, query)
# │   ├── state.rs       ← State storage definitions
# │   └── lib.rs         ← Module exports
# ├── Cargo.toml
# └── .cargo/
#     └── config.toml
```

### Getting Testnet SEI

<!-- Last verified: 2025-07-14 -->
<!-- If the faucet URL is unavailable, check https://www.docs.sei.io/dev-tutorials/building-a-frontend#fund-your-wallet -->

```shell
# Sei Testnet Faucet (atlantic-2):
# Discord faucet: https://discord.gg/sei — use #atlantic-2-faucet channel
# Command in Discord: !faucet <your-sei-address>

# Web faucet (if available):
# https://atlantic-2.app.sei.io/faucet

# For EVM address funding, use the same faucet with your sei1... address
# Both addresses (0x and sei1) share the same balance

# Verify balance (Cosmos side):
seid query bank balances sei1your_address_here --node https://rpc-testnet.sei-apis.com:443

# Expected output:
# balances:
# - amount: "1000000"
#   denom: usei
# pagination:
#   total: "1"

# Verify balance (EVM side):
cast balance 0xYourEVMAddress --rpc-url https://evm-rpc-testnet.sei-apis.com

# Expected output:
# 1000000000000000000  (1 SEI in wei, 18 decimals on EVM side)
```

### Environment Variables

```shell
# Create .env file (add to .gitignore!)
cat > .env << 'EOF'
# EVM private key (no 0x prefix for seid, with 0x for Foundry/Hardhat)
PRIVATE_KEY=0xYourPrivateKeyHere

# Sei testnet RPC endpoints
SEI_EVM_RPC=https://evm-rpc-testnet.sei-apis.com
SEI_COSMOS_RPC=https://rpc-testnet.sei-apis.com

# SeiTrace API key (for contract verification)
SEITRACE_API_KEY=your_api_key_here
EOF

# Add to .gitignore
echo ".env" >> .gitignore
echo "node_modules/" >> .gitignore
echo "out/" >> .gitignore
echo "artifacts/" >> .gitignore
echo "cache/" >> .gitignore
```

### Verifying Your Setup: EVM Deployment Test

```solidity
// src/HelloSei.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract HelloSei {
    string public greeting = "Hello, Sei!";
    uint256 public blockTimeMs = 400;

    event GreetingChanged(address indexed sender, string newGreeting);

    function setGreeting(string calldata _greeting) external {
        greeting = _greeting;
        emit GreetingChanged(msg.sender, _greeting);
    }

    function getChainInfo() external view returns (uint256 chainId, uint256 blockNum) {
        chainId = block.chainid;
        blockNum = block.number;
    }
}
```

```shell
# Deploy with Foundry to Sei testnet
source .env

forge create src/HelloSei.sol:HelloSei \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY

# Expected output:
# Deployer: 0x7B4f352Cd40114f12e82fC675b5BA8C7582FC513
# Deployed to: 0xA1B2C3D4E5F6...
# Transaction hash: 0xabc123...

# Verify the contract on SeiTrace:
forge verify-contract \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --verifier-url https://seitrace.com/api/v2 \
  --etherscan-api-key $SEITRACE_API_KEY \
  0xYourContractAddress \
  src/HelloSei.sol:HelloSei

# Interact with deployed contract:
cast call 0xYourContractAddress "greeting()" \
  --rpc-url https://evm-rpc-testnet.sei-apis.com

# Expected output:
# "Hello, Sei!"
```

### Verifying Your Setup: CosmWasm Compilation Test

```shell
# In your CosmWasm project directory
cd my-sei-contract

# Compile the contract
cargo build --target wasm32-unknown-unknown --release

# Optimize for deployment (requires Docker)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0

# Output: artifacts/my_sei_contract.wasm

# Check wasm file size (should be < 800KB for deployment)
ls -la artifacts/my_sei_contract.wasm

# Upload to testnet
seid tx wasm store artifacts/my_sei_contract.wasm \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 50000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  --broadcast-mode sync \
  -y

# Expected output:
# txhash: ABC123DEF456...
# Query the code ID:
seid query tx ABC123DEF456 --node https://rpc-testnet.sei-apis.com:443
# Look for: code_id in the logs
```

---

## Common Pitfalls

1. **Using the wrong chain ID** — Sei mainnet is 1329, testnet (atlantic-2) is 1328. If MetaMask or Hardhat is configured with the wrong chain ID, transactions will be rejected. Double-check your network configuration before deploying.

2. **Confusing SEI decimals between EVM and Cosmos** — On the EVM side, SEI uses 18 decimals (like ETH). On the Cosmos side, the base unit is `usei` with 6 decimals (1 SEI = 10^6 usei). When bridging between environments or reading balances, make sure you're using the correct decimal conversion.

3. **Not funding both address formats** — Your EVM (0x) and Cosmos (sei1) addresses share the same balance, but you need to fund the account through one of them first. If you request testnet tokens to your sei1 address, the balance is immediately available at your 0x address too. Don't request tokens to both — it's the same account.

4. **Forgetting to install the wasm32 target** — CosmWasm contracts compile to WebAssembly. If you skip `rustup target add wasm32-unknown-unknown`, cargo will fail with a cryptic "can't find crate" error. Always add the target before attempting to build CosmWasm contracts.

5. **Using outdated RPC endpoints** — Sei's testnet infrastructure evolves rapidly. If RPC calls fail with connection errors, check the official docs at https://www.docs.sei.io/ for current endpoint URLs. The endpoints listed here were verified as of July 2025.

---

## What to Learn Next

- [CosmWasm and EVM Contracts](./03-cosmwasm-evm-contracts.md) — Write and deploy smart contracts using both execution environments on Sei
- [Sei Developer Docs](https://www.docs.sei.io/) — Official setup guides and API reference
- [Sei GitHub](https://github.com/sei-protocol/sei-chain) — Source code and release notes
