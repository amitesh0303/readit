# Aptos Development Environment Setup

**Track:** Aptos Development
**Level:** Beginner
**Read time:** 8 min

---

## The Problem

You want to start building on Aptos but don't know which tools to install, how to configure testnet access, or how to get test tokens. The Aptos ecosystem has its own CLI, wallet, and SDK stack that differs from EVM tooling. This lesson gets your local environment ready so you can compile, test, and deploy Move modules.

---

## Core Concepts

### Installing the Aptos CLI

The Aptos CLI is your primary tool for compiling Move code, managing accounts, and interacting with the network.

```shell
# Install Aptos CLI v3.0.0 (recommended)
# macOS / Linux
curl -fsSL "https://aptos.dev/scripts/install_cli.py" | python3 -- --bin-dir ~/.local/bin --tag aptos-cli-v3.0.0

# Verify installation
aptos --version
```

```
Expected output:
aptos 3.0.0
```

```shell
# Alternative: Install via Homebrew (macOS)
brew install aptos

# Alternative: Install via cargo (any platform with Rust)
cargo install aptos --tag aptos-cli-v3.0.0
```

### Initializing a Local Profile

The CLI uses profiles to manage accounts and network configuration:

```shell
# Initialize a new profile for testnet development
aptos init --network testnet
```

```
Expected output:
Configuring for profile default
Choose network: testnet
Enter your private key as a hex literal (0x...) [Current: None | No input: Generate new key]:
# Press Enter to generate a new key

Account 0x<your-address> doesn't exist, creating it and funding it with 100000000 Octas
Account 0x<your-address> funded successfully

---
Aptos CLI is now set up for account 0x<your-address> as profile default!
See the account here: https://explorer.aptoslabs.com/account/0x<your-address>?network=testnet
Run `aptos --help` for more information about commands
```

Your configuration is stored at `.aptos/config.yaml`:

```yaml
# ~/.aptos/config.yaml
profiles:
  default:
    private_key: "0x..."
    public_key: "0x..."
    account: "0x..."
    rest_url: "https://fullnode.testnet.aptoslabs.com"
    faucet_url: "https://faucet.testnet.aptoslabs.com"
```

### Funding Your Testnet Account

Use the Aptos testnet faucet to get test APT tokens:

```shell
# Fund via CLI (uses configured faucet URL)
aptos account fund-with-faucet --account default --amount 100000000
```

```
Expected output:
{
  "Result": "Added 100000000 Octas (1 APT) to account 0x<your-address>"
}
```

You can also use the web faucet directly: https://aptos.dev/en/network/faucet

```shell
# Check your balance
aptos account list --query balance --account default
```

```
Expected output:
{
  "Result": [
    {
      "coin": {
        "value": "100000000"
      }
    }
  ]
}
```

Note: 1 APT = 100,000,000 Octas (8 decimal places).

### Setting Up Petra Wallet

Petra is the official Aptos wallet browser extension:

1. Install from [Chrome Web Store](https://chromewebstore.google.com/detail/petra-aptos-wallet/ejjladinnckdgjemekebdpeokbikhfci)
2. Create a new wallet or import an existing key
3. Switch to Testnet: Settings → Network → Testnet
4. Fund via the faucet button in the wallet UI

For development, you can import your CLI-generated private key into Petra:
- Open Petra → Settings → Manage Account → Import Private Key
- Paste the hex private key from `.aptos/config.yaml`

### Creating a Move Project

```shell
# Create a new Move project
mkdir my-aptos-project && cd my-aptos-project
aptos move init --name my_first_module
```

```
Expected output:
{
  "Result": "Success"
}
```

This creates the standard Move project structure:

```
my-aptos-project/
├── Move.toml          # Package manifest (dependencies, addresses)
├── sources/           # Move source files (.move)
└── tests/             # Move test files
```

The generated `Move.toml`:

```toml
[package]
name = "my_first_module"
version = "1.0.0"
authors = []

[addresses]
my_first_module = "_"

[dev-addresses]
my_first_module = "0x42"

[dependencies.AptosFramework]
git = "https://github.com/aptos-labs/aptos-core.git"
rev = "mainnet"
subdir = "aptos-move/framework/aptos-framework"
```

### Compiling and Testing

```shell
# Compile your Move modules
aptos move compile --named-addresses my_first_module=default
```

```
Expected output:
{
  "Result": [
    "0x<your-address>::my_first_module"
  ]
}
```

```shell
# Run Move unit tests
aptos move test --named-addresses my_first_module=default
```

```
Expected output:
Running Move unit tests
[ PASS ] 0x42::my_first_module::test_example
Test result: OK. Total tests: 1; passed: 1; failed: 0
```

### Network Configuration

| Network | REST URL | Faucet URL | Chain ID |
|---------|----------|------------|----------|
| Mainnet | https://fullnode.mainnet.aptoslabs.com | N/A | 1 |
| Testnet | https://fullnode.testnet.aptoslabs.com | https://faucet.testnet.aptoslabs.com | 2 |
| Devnet | https://fullnode.devnet.aptoslabs.com | https://faucet.devnet.aptoslabs.com | varies |

Last verified: 2025-01-15. For current URLs, see https://aptos.dev/en/network/nodes/networks

---

## Common Pitfalls

1. **Using devnet instead of testnet for development** — Devnet resets frequently (weekly) and your deployed modules will disappear. Use testnet for persistent development. Devnet is only useful for testing against bleeding-edge protocol changes.

2. **Forgetting `--named-addresses` during compilation** — Move modules use named addresses (like `my_module = "_"`) that must be resolved at compile time. If you don't pass `--named-addresses my_module=default`, compilation fails with an unresolved address error. In CI, use the hex address directly.

3. **Not setting the correct `rev` in Move.toml dependencies** — The AptosFramework dependency must match the network you're deploying to. Use `rev = "mainnet"` for mainnet, `rev = "testnet"` for testnet. Mismatched framework versions cause bytecode verification failures on deployment.

4. **Confusing Octas and APT** — All CLI commands and on-chain values use Octas (1 APT = 10^8 Octas). Passing `1` to a transfer means 1 Octa (essentially nothing), not 1 APT. Always multiply by 10^8 or use the `--amount` flag which expects Octas.

---

## What to Learn Next

- [Move Language Fundamentals](./03-move-language-fundamentals.md) — Learn Move syntax, resources, abilities, and module structure
- [Aptos CLI Reference](https://aptos.dev/en/build/cli) — Complete CLI command documentation
- [Aptos Explorer](https://explorer.aptoslabs.com/?network=testnet) — View transactions and modules on testnet

