# Development Environment Setup for BNB Chain

**Track:** BNB Chain Development
**Level:** Beginner
**Read time:** 12 min

---

## The Problem

You want to deploy contracts to BSC testnet, but you're not sure which tools to use, how to configure them for BNB Chain's network, or where to get testnet BNB. Ethereum tutorials assume you're targeting mainnet or Sepolia — BSC has different RPC endpoints, chain IDs, and faucets. Without proper setup, your first deployment attempt will fail with cryptic RPC errors.

## Core Concepts

### Tooling Options

BSC is EVM-compatible, so standard Ethereum development tools work out of the box:

| Tool | Version | Best For |
|------|---------|----------|
| Hardhat | 2.19.x | Testing, scripting, plugins |
| Foundry | 0.2.0 (forge) | Fast compilation, fuzz testing |
| Remix IDE | Browser | Quick prototyping |

### Option A: Hardhat Setup

Initialize a Hardhat project configured for BSC:

```shell
mkdir bnb-chain-project && cd bnb-chain-project
npm init -y
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0 dotenv@16.3.1
npx hardhat init
```

```
Expected output:
888    888                      888 888               888
888    888                      888 888               888
...
✔ What do you want to do? · Create a JavaScript project
✔ Hardhat project root: · /path/to/bnb-chain-project
✔ Do you want to add a .gitignore? (Y/n) · y
✨ Project created ✨
```

Configure `hardhat.config.js` for BSC networks:

```solidity
// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 5000000000, // 5 gwei
    },
    bscMainnet: {
      url: "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 3000000000, // 3 gwei
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
    },
  },
};
```

Create a `.env` file (never commit this):

```shell
echo "PRIVATE_KEY=your_testnet_private_key_here" > .env
echo "BSCSCAN_API_KEY=your_bscscan_api_key_here" >> .env
echo ".env" >> .gitignore
```

### Option B: Foundry Setup

Install Foundry and configure for BSC:

```shell
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge init bnb-chain-foundry && cd bnb-chain-foundry
```

```
Expected output:
Initializing /path/to/bnb-chain-foundry from https://github.com/foundry-rs/forge-template...
Installing forge-std in /path/to/bnb-chain-foundry/lib/forge-std
    Installed forge-std v1.7.6
    Initialized forge project
```

Create `foundry.toml` with BSC configuration:

```shell
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
bsc_testnet = "https://data-seed-prebsc-1-s1.binance.org:8545"
bsc_mainnet = "https://bsc-dataseed.binance.org"

[etherscan]
bsc_testnet = { key = "${BSCSCAN_API_KEY}", chain = 97, url = "https://api-testnet.bscscan.com/api" }
bsc_mainnet = { key = "${BSCSCAN_API_KEY}", chain = 56, url = "https://api.bscscan.com/api" }
```

### Getting Testnet BNB

You need testnet tBNB to deploy contracts. Use the official faucet:

**BSC Testnet Faucet:** https://www.bnbchain.org/en/testnet-faucet

```shell
# Verify your testnet balance using cast (Foundry)
cast balance 0xYourAddress --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545
```

```
Expected output:
500000000000000000
```

That's 0.5 tBNB (the faucet typically dispenses 0.5-1 tBNB per request).

### Verify Your Setup

Compile a test contract to confirm everything works:

```shell
# Hardhat
npx hardhat compile
```

```
Expected output:
Compiled 1 Solidity file successfully (evm target: paris).
```

```shell
# Foundry
forge build
```

```
Expected output:
[⠊] Compiling...
[⠒] Compiling 24 files with 0.8.20
[⠑] Solc 0.8.20 finished in 2.31s
Compiler run successful!
```

### MetaMask Configuration

Add BSC Testnet to MetaMask for manual testing:

| Field | Value |
|-------|-------|
| Network Name | BSC Testnet |
| RPC URL | https://data-seed-prebsc-1-s1.binance.org:8545 |
| Chain ID | 97 |
| Currency Symbol | tBNB |
| Block Explorer | https://testnet.bscscan.com |

## Common Pitfalls

1. **Using the wrong chain ID** — BSC Testnet is chain ID 97, not 56 (mainnet). Deploying with the wrong chain ID will either fail silently or send your transaction to the wrong network.

2. **Committing your `.env` file** — Your private key gives full access to your wallet. Always add `.env` to `.gitignore` before your first commit. Use a dedicated testnet wallet with no mainnet funds.

3. **RPC rate limiting** — The public BSC RPC endpoints have rate limits. For production dApps, use a dedicated provider like [NodeReal](https://nodereal.io/) or [Ankr](https://www.ankr.com/). Free tier handles development fine.

4. **Forgetting the optimizer** — BSC has a 24KB contract size limit (same as Ethereum). Enable the Solidity optimizer with 200 runs to keep deployment costs low and stay under the limit.

## What to Learn Next

- [Your First Smart Contract on BSC](./03-first-smart-contract.md) — Write and deploy a BEP-20 token to BSC testnet
- [Hardhat Documentation](https://hardhat.org/docs) — Full reference for Hardhat configuration and plugins
- [Foundry Book](https://book.getfoundry.sh/) — Complete Foundry toolchain documentation
