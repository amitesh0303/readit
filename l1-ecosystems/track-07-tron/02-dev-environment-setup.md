# Development Environment Setup

**Track:** Tron Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You want to start building on Tron but don't know which tools to install, which testnet to use, or how to get test TRX. Tron's tooling ecosystem is different from Ethereum's Hardhat/Foundry world — it uses TronBox (a Truffle fork), TronLink (browser wallet), and has two testnets (Shasta and Nile) with different purposes. This lesson gets your local environment running so you can compile, deploy, and test contracts.

---

## Core Concepts

### Tooling Overview

| Tool | Purpose | Ethereum Equivalent |
|------|---------|-------------------|
| TronBox | Compile, deploy, test contracts | Truffle |
| TronLink | Browser wallet extension | MetaMask |
| TronWeb | JavaScript SDK | ethers.js / web3.js |
| TronIDE | Browser-based IDE | Remix |
| Shasta testnet | Free testing (unlimited faucet) | Sepolia |
| Nile testnet | Staging (closer to mainnet) | Holesky |

### Installing TronBox

TronBox is the primary CLI tool for Tron smart contract development. It's a fork of Truffle adapted for the TVM.

```shell
# Prerequisites: Node.js >= 16.x
node --version
# v18.19.0

# Install TronBox globally
npm install -g tronbox@4.0.1

# Verify installation
tronbox version
# TronBox v4.0.1

# Initialize a new project
mkdir my-tron-project && cd my-tron-project
tronbox init

# Project structure:
# my-tron-project/
# ├── contracts/
# │   └── Migrations.sol
# ├── migrations/
# │   └── 1_initial_migration.js
# ├── test/
# └── tronbox.js          ← network configuration
```

### Configuring tronbox.js

The `tronbox.js` file defines your network connections and compiler settings:

```javascript
// tronbox.js
module.exports = {
  networks: {
    // Shasta testnet — free faucet, best for development
    shasta: {
      privateKey: process.env.TRON_PRIVATE_KEY,
      fullHost: "https://api.shasta.trongrid.io",
      network_id: "2"
    },
    // Nile testnet — staging environment
    nile: {
      privateKey: process.env.TRON_PRIVATE_KEY,
      fullHost: "https://nile.trongrid.io",
      network_id: "3"
    },
    // Mainnet — production (use with caution)
    mainnet: {
      privateKey: process.env.TRON_PRIVATE_KEY,
      fullHost: "https://api.trongrid.io",
      network_id: "1"
    },
    // Local development (tron-docker or java-tron)
    development: {
      privateKey: process.env.TRON_PRIVATE_KEY,
      fullHost: "http://127.0.0.1:9090",
      network_id: "9"
    }
  },
  compilers: {
    solc: {
      version: "0.8.20",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
};
```

### Setting Up TronLink Wallet

TronLink is the standard browser wallet for Tron (equivalent to MetaMask):

```
1. Install TronLink extension:
   - Chrome: https://chrome.google.com/webstore/detail/tronlink
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/tronlink/

2. Create a new wallet:
   - Click "Create Wallet"
   - Set a strong password
   - Back up your 12-word mnemonic phrase
   - Confirm the mnemonic

3. Switch to Shasta testnet:
   - Click the network dropdown (top-right)
   - Select "Shasta Testnet"
   - Your address will show a "T..." format

4. Export private key (for TronBox):
   - Settings → Security → Export Private Key
   - Copy the hex string (no 0x prefix on Tron)
```

### Getting Test TRX from Shasta Faucet

Shasta testnet provides free TRX for development:

```shell
# Shasta Faucet URL:
# https://www.trongrid.io/shasta

# Steps:
# 1. Copy your TronLink address (starts with T...)
# 2. Visit https://www.trongrid.io/shasta
# 3. Paste your address and request TRX
# 4. You'll receive 10,000 test TRX (can request multiple times)

# Verify balance via API:
curl -s "https://api.shasta.trongrid.io/v1/accounts/YOUR_ADDRESS_HERE" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Balance: {d[\"data\"][0][\"balance\"]/1e6} TRX')"
```

### Environment Variables

Set up your environment securely:

```shell
# Create .env file (add to .gitignore!)
echo "TRON_PRIVATE_KEY=your_private_key_hex_here" > .env

# .gitignore
echo ".env" >> .gitignore
echo "node_modules/" >> .gitignore
echo "build/" >> .gitignore

# Load env vars (Linux/Mac)
export $(cat .env | xargs)

# Or use dotenv in tronbox.js:
# require('dotenv').config();
```

### Compiling and Deploying a Test Contract

Verify your setup works end-to-end:

```solidity
// contracts/HelloTron.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HelloTron {
    string public greeting = "Hello, Tron!";

    function setGreeting(string calldata _greeting) external {
        greeting = _greeting;
    }
}
```

```javascript
// migrations/2_deploy_hello.js
const HelloTron = artifacts.require("HelloTron");

module.exports = function (deployer) {
  deployer.deploy(HelloTron);
};
```

```shell
# Compile contracts
tronbox compile

# Expected output:
# Compiling ./contracts/HelloTron.sol...
# Compiling ./contracts/Migrations.sol...
# Writing artifacts to ./build/contracts

# Deploy to Shasta testnet
tronbox migrate --network shasta

# Expected output:
# Running migration: 2_deploy_hello.js
#   Deploying HelloTron...
#   HelloTron: 41a614f803b6fd780986a42c78ec9c7f77e6ded13c
#   Saving artifacts...
# Summary:
#   Total deployments: 1
#   Total cost: ~100 energy

# Verify on Shasta explorer:
# https://shasta.tronscan.org/#/contract/YOUR_CONTRACT_ADDRESS
```

### Running Tests

TronBox supports Mocha-based testing:

```javascript
// test/HelloTron.test.js
const HelloTron = artifacts.require("HelloTron");

contract("HelloTron", (accounts) => {
  let instance;

  before(async () => {
    instance = await HelloTron.deployed();
  });

  it("should have default greeting", async () => {
    const greeting = await instance.greeting();
    assert.equal(greeting, "Hello, Tron!");
  });

  it("should update greeting", async () => {
    await instance.setGreeting("Hello, Shasta!");
    const greeting = await instance.greeting();
    assert.equal(greeting, "Hello, Shasta!");
  });
});
```

```shell
# Run tests against Shasta
tronbox test --network shasta

# Expected output:
# Contract: HelloTron
#   ✓ should have default greeting (120ms)
#   ✓ should update greeting (3200ms)
# 2 passing (3.3s)
```

---

## Common Pitfalls

1. **Using a 0x-prefixed private key** — Tron private keys are raw hex without the `0x` prefix. If you export from MetaMask or an Ethereum tool, strip the `0x` prefix before using in `tronbox.js`. TronBox will silently fail or produce cryptic errors if the key format is wrong.

2. **Forgetting to fund the deployer account** — TronBox deployments require both bandwidth and energy. If your Shasta account has 0 TRX, deployment will fail with `BANDWITH_ERROR` or `OUT_OF_ENERGY`. Always request test TRX from the faucet (https://www.trongrid.io/shasta) before deploying.

3. **Using the wrong network endpoint** — Shasta and Nile have different API endpoints. Using `api.trongrid.io` (mainnet) in development will deploy to mainnet and cost real TRX. Double-check your `tronbox.js` network configuration before running `tronbox migrate`.

4. **Not waiting for transaction confirmation** — TronBox migrations return immediately after broadcast. The contract address is available, but the transaction may not be confirmed for 3-57 seconds. If you immediately try to interact with the contract, calls may fail. Add a small delay or poll for confirmation in scripts.

5. **Ignoring Solidity version compatibility** — TVM supports Solidity up to 0.8.20 as of January 2025. Using newer Solidity features (like transient storage from 0.8.24) will compile but may not execute correctly on TVM. Always check TronBox release notes for supported compiler versions.

---

## What to Learn Next

- [Your First Smart Contract](./03-first-smart-contract.md) — Deploy a TRC-20 token to Shasta testnet with full energy estimation
- [TronBox Documentation](https://developers.tron.network/docs/tronbox) — Official TronBox reference
