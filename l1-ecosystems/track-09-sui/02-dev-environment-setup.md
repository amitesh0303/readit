# Development Environment Setup

**Track:** Sui Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to start building on Sui, but the toolchain is different from anything in the EVM world. There's no Hardhat or Foundry — Sui has its own CLI that handles compilation, testing, publishing, and wallet management. You need to install the Sui CLI, create a wallet, fund it from the testnet faucet, and verify your connection before writing any Move code. Getting this wrong means cryptic errors later when you try to publish your first package.

## Core Concepts

### Installing Sui CLI

The Sui CLI (`sui`) is your primary development tool. It handles everything: compiling Move code, managing keys, interacting with the network, and publishing packages.

```shell
# Install Sui CLI via Homebrew (macOS/Linux) — sui-cli@1.15.0
brew install sui

# Or install from pre-built binaries (all platforms)
# Download from: https://github.com/MystenLabs/sui/releases/tag/testnet-v1.15.0
# Extract and add to PATH

# Verify installation
sui --version
```

```
Expected output:
sui 1.15.0-abc1234
```

For Windows, download the pre-built binary from the [Sui releases page](https://github.com/MystenLabs/sui/releases) and add it to your system PATH.

```shell
# Alternative: Install via cargo (requires Rust toolchain)
cargo install --locked --git https://github.com/MystenLabs/sui.git --tag testnet-v1.15.0 sui
```

### Creating a Wallet

Sui uses Ed25519 keypairs by default. The CLI manages your keystore locally:

```shell
# Generate a new keypair and address
sui client new-address ed25519
```

```
Expected output:
╭─────────────────────────────────────────────────────────────────────╮
│ Created new keypair and saved it to keystore.                       │
├────────────────┬────────────────────────────────────────────────────┤
│ alias          │ romantic-sapphire                                  │
│ address        │ 0x7d20dcdb2bca4f508ea9613994683eb4e76e9c4ed371e...│
│ keyScheme      │ ed25519                                           │
│ recoveryPhrase │ word1 word2 word3 ... word12                      │
╰────────────────┴────────────────────────────────────────────────────╯
```

```shell
# List all addresses in your keystore
sui client addresses
```

```
Expected output:
╭───────────────┬──────────────────────────────────────────────────────────────────────┬────────────────╮
│ alias         │ address                                                              │ active address │
├───────────────┼──────────────────────────────────────────────────────────────────────┼────────────────┤
│ romantic-sap… │ 0x7d20dcdb2bca4f508ea9613994683eb4e76e9c4ed371e...                   │ *              │
╰───────────────┴──────────────────────────────────────────────────────────────────────┴────────────────╯
```

### Configuring Testnet

Switch the CLI to point at Sui testnet:

```shell
# Switch to testnet environment
sui client switch --env testnet
```

```
Expected output:
Active environment switched to [testnet]
```

If the testnet environment doesn't exist yet, add it:

```shell
# Add testnet environment
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443

# Verify current environment
sui client envs
```

```
Expected output:
╭─────────┬─────────────────────────────────────────────┬────────╮
│ alias   │ url                                         │ active │
├─────────┼─────────────────────────────────────────────┼────────┤
│ devnet  │ https://fullnode.devnet.sui.io:443          │        │
│ testnet │ https://fullnode.testnet.sui.io:443         │ *      │
╰─────────┴─────────────────────────────────────────────┴────────╯
```

### Funding from Testnet Faucet

Get free SUI tokens for testing. The faucet provides 1 SUI per request on testnet.

Faucet documentation: https://docs.sui.io/guides/developer/getting-started/get-coins

```shell
# Request testnet SUI tokens via CLI
sui client faucet
```

```
Expected output:
Request successful. It can take up to 1 minute to get the coin.
```

```shell
# Verify your balance
sui client gas
```

```
Expected output:
╭────────────────────────────────────────────────────────────────────┬─────────────╮
│ gasCoinId                                                          │ gasBalance  │
├────────────────────────────────────────────────────────────────────┼─────────────┤
│ 0x4a3c8f...                                                        │ 1000000000  │
╰────────────────────────────────────────────────────────────────────┴─────────────╯
```

The balance is in MIST (1 SUI = 1,000,000,000 MIST). So 1000000000 MIST = 1 SUI.

### Sui Wallet Browser Extension

For frontend development, you'll need the Sui Wallet:

1. Install [Sui Wallet](https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil) from Chrome Web Store
2. Create or import a wallet
3. Switch to Testnet network in wallet settings
4. Request tokens from the faucet within the wallet UI

Alternative wallets: [Suiet](https://suiet.app/), [Ethos Wallet](https://ethoswallet.xyz/), [Martian Wallet](https://martianwallet.xyz/)

### Project Structure

A Sui Move project has a specific directory layout:

```shell
# Create a new Move project
sui move new my_first_package
```

```
Expected output:
Created "my_first_package" package.
```

```
my_first_package/
├── Move.toml          # Package manifest (dependencies, addresses)
├── sources/           # Move source files (.move)
│   └── my_first_package.move
└── tests/             # Test files
    └── my_first_package_tests.move
```

The generated `Move.toml`:

```toml
[package]
name = "my_first_package"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }

[addresses]
my_first_package = "0x0"
```

### Running Tests

```shell
# Run all tests in the package
sui move test
```

```
Expected output:
BUILDING my_first_package
Running Move unit tests
Test result: OK. Total tests: 0; passed: 0; failed: 0
```

### Building and Checking

```shell
# Compile the package (checks for errors without publishing)
sui move build
```

```
Expected output:
UPDATING GIT DEPENDENCY https://github.com/MystenLabs/sui.git
BUILDING my_first_package
```

## Common Pitfalls

1. **Using an outdated CLI version** — Sui moves fast. Testnet and devnet reset periodically, and older CLI versions may be incompatible. Always match your CLI version to the target network. Pin to `sui-cli@1.15.0` for testnet compatibility as of January 2025.

2. **Forgetting to switch environments** — The CLI remembers your last active environment. If you're on mainnet and run `sui client faucet`, it will fail. Always verify with `sui client envs` before transacting.

3. **Not saving your recovery phrase** — The CLI generates a 12-word mnemonic on first address creation. If you lose it and your keystore file gets corrupted, your testnet objects are gone. For testnet this is just inconvenient; for mainnet it's catastrophic.

4. **Confusing MIST and SUI** — All CLI outputs show balances in MIST (10^9 MIST = 1 SUI). A balance of `1000000000` is 1 SUI, not 1 billion SUI.

## What to Learn Next

- [Sui Move Fundamentals](./03-sui-move-fundamentals.md) — Learn Sui Move syntax, objects, ownership, and transfer patterns
- [Sui CLI Reference](https://docs.sui.io/references/cli) — Complete CLI command documentation
- [Sui Developer Portal](https://docs.sui.io/guides/developer) — Official developer guides
