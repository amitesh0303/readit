# Starknet Ecosystem Tooling: SDKs, CLI, and Dev Environment

**Track:** Starknet Development
**Level:** Intermediate
**Read time:** 11 min

---

## The Problem

You're ready to start building on Starknet, but the tooling landscape is completely different from Ethereum. There's no Hardhat, no Foundry, no ethers.js. You need to set up Scarb (the Cairo package manager), starkli (the CLI), configure a wallet, connect to a testnet, and understand which SDK to use for frontend integration. This lesson gets your development environment running and walks through the core tools you'll use daily.

## Core Concepts

### Starknet Development Stack

```
┌─────────────────────────────────────────────────────────────────┐
│  Development Tools                                               │
├─────────────────────────────────────────────────────────────────┤
│  Scarb 2.9.2        — Cairo package manager + build tool        │
│  Cairo 2.9.2        — Smart contract language (bundled w/ Scarb)│
│  starkli 0.3.6      — CLI for interacting with Starknet         │
│  Katana 1.0.0       — Local Starknet devnet (from Dojo)         │
│  snforge 0.34.0     — Testing framework (Starknet Foundry)      │
│  sncast 0.34.0      — Deployment tool (Starknet Foundry)        │
├─────────────────────────────────────────────────────────────────┤
│  Frontend SDKs                                                   │
├─────────────────────────────────────────────────────────────────┤
│  starknet.js@6.17.0 — JavaScript/TypeScript SDK                 │
│  starknet.py@0.24.2 — Python SDK                                │
│  starknet-rs        — Rust SDK                                   │
├─────────────────────────────────────────────────────────────────┤
│  Wallet Integration                                              │
├─────────────────────────────────────────────────────────────────┤
│  get-starknet@4.0.0 — Wallet discovery library                  │
│  ArgentX            — Browser wallet extension                   │
│  Braavos            — Browser wallet extension                   │
├─────────────────────────────────────────────────────────────────┤
│  Block Explorers                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Starkscan          — https://starkscan.co/                      │
│  Voyager            — https://voyager.online/                    │
└─────────────────────────────────────────────────────────────────┘
```

### Installing Scarb (Cairo Build Tool)

Scarb is the official Cairo package manager and build tool — equivalent to Cargo for Rust or Foundry for Solidity:

```shell
# Install Scarb via asdf (recommended for version management)
# Requires: asdf (https://asdf-vm.com/)
asdf plugin add scarb
asdf install scarb 2.9.2
asdf global scarb 2.9.2

# Verify installation
scarb --version
```

```
Expected output:
scarb 2.9.2 (f0dab9bba 2024-12-18)
cairo: 2.9.2 (https://crates.io/crates/cairo-lang-compiler/2.9.2)
sierra: 1.6.0
```

```shell
# Alternative: Install via curl (Linux/macOS)
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh -s -- -v 2.9.2
```

### Installing starkli (CLI Tool)

starkli is the command-line interface for interacting with Starknet — declaring contracts, deploying, invoking functions, and querying state:

```shell
# Install starkli via starkliup
curl https://get.starkli.sh | sh
starkliup --version 0.3.6

# Verify installation
starkli --version
```

```
Expected output:
starkli 0.3.6
```

### Installing Starknet Foundry (Testing + Deployment)

```shell
# Install snfoundryup
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh
snfoundryup --version 0.34.0

# Verify
snforge --version
sncast --version
```

```
Expected output:
snforge 0.34.0
sncast 0.34.0
```

### Setting Up a Wallet for Testnet

```shell
# Create a new keystore (encrypted private key)
starkli signer keystore new ~/.starkli-wallets/deployer/keystore.json
# Enter a password when prompted

# Get the public key
starkli signer keystore inspect ~/.starkli-wallets/deployer/keystore.json
```

```
Expected output:
Created new encrypted keystore file: /home/user/.starkli-wallets/deployer/keystore.json
Public key: 0x0123456789abcdef...
```

```shell
# For testnet, use a pre-funded account or deploy via ArgentX/Braavos
# Then fetch the account descriptor:
starkli account fetch 0xYOUR_ACCOUNT_ADDRESS \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  --output ~/.starkli-wallets/deployer/account.json
```

### Testnet Configuration

```shell
# Set environment variables for convenience
export STARKNET_RPC="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
export STARKNET_ACCOUNT="~/.starkli-wallets/deployer/account.json"
export STARKNET_KEYSTORE="~/.starkli-wallets/deployer/keystore.json"

# Testnet faucets (Last verified: 2025-01-15):
# - Starknet Sepolia: https://starknet-faucet.vercel.app/
# - Blast API: https://blastapi.io/faucets/starknet-sepolia-eth
```

### Creating a New Cairo Project

```shell
# Initialize a new Scarb project
scarb new my_starknet_contract
cd my_starknet_contract
```

```
Expected output:
Created `my_starknet_contract` package.
```

The generated project structure:

```
my_starknet_contract/
├── Scarb.toml          # Package manifest (like Cargo.toml)
├── src/
│   └── lib.cairo       # Main source file
└── tests/
    └── test_contract.cairo  # Test file (if using snforge)
```

Configure `Scarb.toml` for Starknet contracts:

```toml
# Scarb.toml
[package]
name = "my_starknet_contract"
version = "0.1.0"
edition = "2024_07"
cairo-version = "2.9.2"

[dependencies]
starknet = "2.9.2"
openzeppelin_token = { git = "https://github.com/OpenZeppelin/cairo-contracts.git", tag = "v0.20.0" }

[[target.starknet-contract]]
sierra = true
casm = true

[tool.snforge]
```

### Building and Testing

```shell
# Compile Cairo contracts
scarb build
```

```
Expected output:
   Compiling my_starknet_contract v0.1.0 (/path/to/my_starknet_contract/Scarb.toml)
    Finished `dev` profile target(s) in 2 secs
```

```shell
# Run tests with Starknet Foundry
snforge test
```

```
Expected output:
Collected 3 test(s) from my_starknet_contract package
Running 3 test(s) from src/
[PASS] my_starknet_contract::tests::test_deploy (gas: ~320)
[PASS] my_starknet_contract::tests::test_transfer (gas: ~580)
[PASS] my_starknet_contract::tests::test_balance (gas: ~210)
Tests: 3 passed, 0 failed, 0 skipped
```

### Frontend Integration with starknet.js

```typescript
// frontend-connect.ts
import { connect, disconnect } from "get-starknet"; // get-starknet@4.0.0
import { Account, Provider, Contract, CallData, cairo } from "starknet"; // starknet@6.17.0

// Connect to user's wallet (ArgentX or Braavos)
async function connectWallet() {
  const starknet = await connect();

  if (!starknet?.isConnected) {
    throw new Error("Wallet not connected. Install ArgentX or Braavos.");
  }

  await starknet.enable();

  const provider = new Provider({
    nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
  });

  const account = new Account(
    provider,
    starknet.selectedAddress!,
    starknet.account!.signer
  );

  console.log(`Connected: ${account.address}`);
  return account;
}

// Read from a contract (free, no transaction)
async function getBalance(
  tokenAddress: string,
  accountAddress: string
): Promise<bigint> {
  const provider = new Provider({
    nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
  });

  const erc20ABI = [
    {
      name: "balance_of",
      type: "function",
      inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
      outputs: [{ type: "core::integer::u256" }],
      state_mutability: "view",
    },
  ];

  const contract = new Contract(erc20ABI, tokenAddress, provider);
  const result = await contract.balance_of(accountAddress);

  return BigInt(result.toString());
}

// Write to a contract (requires transaction signing)
async function transferTokens(
  account: Account,
  tokenAddress: string,
  recipient: string,
  amount: bigint
): Promise<string> {
  try {
    const { transaction_hash } = await account.execute([
      {
        contractAddress: tokenAddress,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: recipient,
          amount: cairo.uint256(amount),
        }),
      },
    ]);

    console.log(`Transfer TX: ${transaction_hash}`);

    // Wait for confirmation
    const provider = account.provider || new Provider({
      nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
    });
    await provider.waitForTransaction(transaction_hash);
    console.log("Transfer confirmed!");

    return transaction_hash;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("insufficient")) {
        throw new Error("Insufficient token balance for transfer");
      }
      throw new Error(`Transfer failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Local Development with Katana

```shell
# Install Katana (local Starknet devnet from Dojo)
# Requires: dojoup installer
curl -L https://install.dojoengine.org | bash
dojoup --version 1.0.0

# Start local devnet
katana --seed 0
```

```
Expected output:
██╗  ██╗ █████╗ ████████╗ █████╗ ███╗   ██╗ █████╗
██║ ██╔╝██╔══██╗╚══██╔══╝██╔══██╗████╗  ██║██╔══██╗
█████╔╝ ███████║   ██║   ███████║██╔██╗ ██║███████║
██╔═██╗ ██╔══██║   ██║   ██╔══██║██║╚██╗██║██╔══██║
██║  ██╗██║  ██║   ██║   ██║  ██║██║ ╚████║██║  ██║
╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝

PREFUNDED ACCOUNTS
==================
| Account address |  0x6162896d1d7ab204c7ccac6dd5f8e9e7c25ecd5ae4fcb4ad32e57786bb46e03
| Private key     |  0x1800000000300000180000000000030000000000003006001800006600
...

🚀 JSON-RPC server started: http://0.0.0.0:5050
```

## Common Pitfalls

1. **Version mismatches between Scarb and Cairo** — Scarb bundles a specific Cairo compiler version. If your `Scarb.toml` specifies a different Cairo version than what Scarb bundles, compilation fails with cryptic errors. Always check `scarb --version` to see the bundled Cairo version.

2. **Using starkli without environment variables** — Every starkli command requires `--rpc`, `--account`, and `--keystore` flags. Set the `STARKNET_RPC`, `STARKNET_ACCOUNT`, and `STARKNET_KEYSTORE` environment variables to avoid repeating them.

3. **Forgetting to fund the account on L2** — Unlike Ethereum where you fund an address directly, Starknet accounts must be deployed first (they're smart contracts). Use ArgentX or Braavos to create and fund a testnet account before using starkli.

4. **Not enabling the starknet-contract target** — If `Scarb.toml` doesn't include `[[target.starknet-contract]]`, the build won't generate the contract class JSON needed for declaration. Your project compiles but produces no deployable artifacts.

## What to Learn Next

- [Deployment Walkthrough](./05-deployment-walkthrough.md) — Complete testnet deployment with gas comparison
- [Starknet Foundry Book](https://foundry-rs.github.io/starknet-foundry/) — Testing and deployment framework docs
- [Scarb Documentation](https://docs.swmansion.com/scarb/) — Package manager reference
- [starknet.js Documentation](https://www.starknetjs.com/) — JavaScript SDK reference
- [Katana Documentation](https://book.dojoengine.org/toolchain/katana) — Local devnet reference
