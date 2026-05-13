# Cardano Development Environment Setup

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

Cardano's toolchain is different from what most blockchain developers are used to. There's no single "Remix-like" IDE that handles everything. You need cardano-node to connect to the network, cardano-cli for transaction building, and a Haskell/Plutus development environment for writing smart contracts. Getting all of these working together — especially on non-Linux systems — has historically been painful. This lesson gives you a working setup using the current recommended approach.

---

## Core Concepts

### Toolchain Overview

| Tool | Purpose | Version |
|------|---------|---------|
| cardano-node | Runs a Cardano node (full or relay) | 9.2.1 |
| cardano-cli | Command-line interface for transactions, queries | 9.4.1.0 |
| Aiken | Smart contract language (Rust-like, alternative to Plutus) | 1.1.5 |
| Plutus Tx | Haskell-to-Plutus compiler plugin | plutus-tx-1.30.0.0 |
| Ogmios | Lightweight bridge to cardano-node via WebSocket | 6.9.0 |
| Kupo | Chain indexer for UTXO queries | 2.9.0 |

### Installing cardano-cli

The fastest path to a working CLI on any platform:

```shell
# Option 1: Pre-built binaries (recommended for getting started)
# Download from: https://github.com/IntersectMBO/cardano-node/releases/tag/9.2.1

# Linux x86_64
curl -L https://github.com/IntersectMBO/cardano-node/releases/download/9.2.1/cardano-node-9.2.1-linux.tar.gz -o cardano-node.tar.gz
tar -xzf cardano-node.tar.gz
sudo mv cardano-node cardano-cli /usr/local/bin/

# Verify installation
cardano-cli --version
```

```
Expected output:
cardano-cli 9.4.1.0 - linux-x86_64 - ghc-9.6
git rev: abc123...
```

```shell
# Option 2: Using Nix (reproducible builds, recommended for Plutus development)
# Install Nix with flakes enabled
curl --proto '=https' --tlsv1.2 -sSf https://install.determinate.systems/nix | sh -s -- install

# Clone the cardano-node repository
git clone https://github.com/IntersectMBO/cardano-node.git
cd cardano-node
git checkout tags/9.2.1

# Build using Nix
nix build .#cardano-node .#cardano-cli

# Binaries are in ./result/bin/
./result/bin/cardano-cli --version
```

### Connecting to Preview Testnet

Preview is the recommended testnet for development (faster epochs, frequent hard forks for testing):

```shell
# Download Preview testnet configuration files
mkdir -p ~/cardano/preview
cd ~/cardano/preview

# Fetch config files from cardano-configurations repo
curl -L https://book.play.dev.cardano.org/environments/preview/config.json -o config.json
curl -L https://book.play.dev.cardano.org/environments/preview/topology.json -o topology.json
curl -L https://book.play.dev.cardano.org/environments/preview/byron-genesis.json -o byron-genesis.json
curl -L https://book.play.dev.cardano.org/environments/preview/shelley-genesis.json -o shelley-genesis.json
curl -L https://book.play.dev.cardano.org/environments/preview/alonzo-genesis.json -o alonzo-genesis.json
curl -L https://book.play.dev.cardano.org/environments/preview/conway-genesis.json -o conway-genesis.json
```

```shell
# Start cardano-node on Preview testnet
cardano-node run \
  --topology ~/cardano/preview/topology.json \
  --database-path ~/cardano/preview/db \
  --socket-path ~/cardano/preview/node.socket \
  --config ~/cardano/preview/config.json

# In another terminal, set the socket path
export CARDANO_NODE_SOCKET_PATH=~/cardano/preview/node.socket

# Query the tip to verify sync progress
cardano-cli query tip --testnet-magic 2
```

```
Expected output (once synced):
{
    "block": 1234567,
    "epoch": 150,
    "era": "Conway",
    "hash": "abc123...",
    "slot": 45678901,
    "slotInEpoch": 12345,
    "slotsToEpochEnd": 73655,
    "syncProgress": "100.00"
}
```

### Creating a Wallet for Testing

```shell
# Generate payment key pair
cardano-cli address key-gen \
  --verification-key-file payment.vkey \
  --signing-key-file payment.skey

# Generate stake key pair
cardano-cli stake-address key-gen \
  --verification-key-file stake.vkey \
  --signing-key-file stake.skey

# Build the address (Preview testnet)
cardano-cli address build \
  --payment-verification-key-file payment.vkey \
  --stake-verification-key-file stake.vkey \
  --out-file payment.addr \
  --testnet-magic 2

# Display your address
cat payment.addr
```

```
Expected output:
addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjc8
```

### Getting Test ADA from the Faucet

Visit the Preview testnet faucet to receive test ADA:

**Faucet URL**: https://docs.cardano.org/cardano-testnets/tools/faucet/

Select "Preview" network, paste your `addr_test1...` address, and request funds. You'll receive 10,000 test ADA.

```shell
# Verify funds arrived
cardano-cli query utxo --address $(cat payment.addr) --testnet-magic 2
```

```
Expected output:
                           TxHash                                 TxIx        Amount
--------------------------------------------------------------------------------------
abc123def456...                                                    0        10000000000 lovelace
```

Note: 1 ADA = 1,000,000 lovelace.

### Plutus Development with Nix

For writing Plutus smart contracts, you need a Haskell environment with the Plutus libraries:

```shell
# Clone the plutus-apps starter template
git clone https://github.com/IntersectMBO/plutus-tx-template.git
cd plutus-tx-template

# Enter the Nix development shell (includes GHC, cabal, Plutus libraries)
nix develop

# Verify Haskell toolchain
ghc --version
cabal --version
```

```
Expected output:
The Glorious Glasgow Haskell Compilation System, version 9.6.6
cabal-install version 3.10.3.0
```

### Alternative: Aiken for Smart Contracts

If Haskell feels too heavy, Aiken is a newer Rust-inspired language for Cardano smart contracts:

```shell
# Install Aiken
curl -sSfL https://install.aiken-lang.org | bash

# Verify
aiken --version
```

```
Expected output:
aiken v1.1.5
```

```shell
# Create a new Aiken project
aiken new my-first-validator
cd my-first-validator
aiken build
```

---

## Common Pitfalls

1. **Running cardano-node without enough disk space** — A full Preview testnet sync requires ~15 GB. The node will crash silently if disk space runs out. Check with `df -h` before starting.

2. **Forgetting to set CARDANO_NODE_SOCKET_PATH** — Every cardano-cli command needs to know where the node socket is. Export this in your shell profile or you'll get "Network.Socket.connect: does not exist" errors on every query.

3. **Using mainnet magic number on testnet** — Preview testnet uses `--testnet-magic 2`, Preprod uses `--testnet-magic 1`, mainnet uses `--mainnet`. Mixing these up produces cryptic "DecoderError" messages.

4. **Expecting instant sync** — Initial sync of Preview testnet takes 2-4 hours depending on hardware. The node is not usable until `syncProgress` reaches "100.00". Use Ogmios or a public API (Blockfrost) for immediate access while your node syncs.

5. **Nix shell conflicts with system packages** — If you have system-wide GHC or cabal installed, they can conflict with the Nix-provided versions. Always work inside `nix develop` for Plutus projects.

---

## What to Learn Next

- [Plutus Language Fundamentals](./03-plutus-language-fundamentals.md) — Learn the Haskell basics you need to write Plutus validators
- [First Plutus Contract](./04-first-plutus-contract.md) — Write and deploy your first validator script to Preview testnet
