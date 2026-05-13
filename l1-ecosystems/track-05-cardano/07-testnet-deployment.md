# Preview Testnet Deployment

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 10 min

---

## The Problem

You have a compiled Plutus script and off-chain code. Now you need to deploy it to the Preview testnet, verify it works end-to-end, and understand the full deployment workflow before going to mainnet. Cardano's deployment process is more manual than Ethereum's — there's no `hardhat deploy`, and you need to manage UTXOs, collateral, and validity intervals yourself.

---

## Prerequisites

```bash
# Install cardano-cli (version 8.x for Babbage/Conway era)
# Download from: https://github.com/IntersectMBO/cardano-node/releases
# Last verified: cardano-cli 8.20.3.0 (May 2025)

cardano-cli --version
# cardano-cli 8.20.3.0 - linux-x86_64 - ghc-9.6

# Set the testnet magic (Preview = 2, Preprod = 1, Mainnet = no flag)
export TESTNET_MAGIC=2
export CARDANO_NODE_SOCKET_PATH=/path/to/node.socket
```

---

## Step 1: Generate Keys and Address

```bash
# Generate payment key pair
cardano-cli address key-gen \
  --verification-key-file payment.vkey \
  --signing-key-file payment.skey

# Generate staking key pair (optional but recommended)
cardano-cli stake-address key-gen \
  --verification-key-file stake.vkey \
  --signing-key-file stake.skey

# Build the enterprise address (no staking)
cardano-cli address build \
  --payment-verification-key-file payment.vkey \
  --testnet-magic $TESTNET_MAGIC \
  --out-file payment.addr

cat payment.addr
# addr_test1vq...
```

---

## Step 2: Fund from Faucet

```
Preview Testnet Faucet: https://docs.cardano.org/cardano-testnets/tools/faucet/
- Select: Preview Testnet
- Enter your payment.addr
- Request: 10,000 tADA (test ADA)
- Wait ~20 seconds for confirmation
```

```bash
# Verify funds arrived
cardano-cli query utxo \
  --address $(cat payment.addr) \
  --testnet-magic $TESTNET_MAGIC

# Expected output:
#                            TxHash                                 TxIx  Amount
# -----------------------------------------------------------------------
# abc123def456...                                                   0     10000000000 lovelace
```

---

## Step 3: Deploy the Script

Cardano scripts don't need to be "deployed" like Ethereum contracts — they're just files you reference in transactions. However, you can use **reference scripts** (Babbage era) to store the script on-chain once and reference it in future transactions, saving fees:

```bash
# Get the script address
cardano-cli address build \
  --payment-script-file escrow.plutus \
  --testnet-magic $TESTNET_MAGIC \
  --out-file escrow.addr

cat escrow.addr
# addr_test1wq...

# Store the script on-chain as a reference script
# This costs ~5-10 ADA but saves fees on every future transaction
cardano-cli transaction build \
  --testnet-magic $TESTNET_MAGIC \
  --tx-in abc123def456...#0 \
  --tx-out "$(cat payment.addr)+10000000" \
  --tx-out-reference-script-file escrow.plutus \
  --change-address $(cat payment.addr) \
  --out-file store-script-tx.body

cardano-cli transaction sign \
  --tx-body-file store-script-tx.body \
  --signing-key-file payment.skey \
  --testnet-magic $TESTNET_MAGIC \
  --out-file store-script-tx.signed

cardano-cli transaction submit \
  --tx-file store-script-tx.signed \
  --testnet-magic $TESTNET_MAGIC

# Note the TxHash#TxIx of the output with the reference script
# You'll use this as --spending-reference-tx-in-inline-datum-present in future txs
```

---

## Step 4: Lock Funds

```bash
# Create the datum
BENEFICIARY_PKH=$(cardano-cli address key-hash --payment-verification-key-file bob.vkey)
REFUNDEE_PKH=$(cardano-cli address key-hash --payment-verification-key-file payment.vkey)
DEADLINE_MS=$(($(date +%s) * 1000 + 3600000))  # 1 hour from now

cat > escrow-datum.json << EOF
{
  "constructor": 0,
  "fields": [
    { "bytes": "${BENEFICIARY_PKH}" },
    { "bytes": "${REFUNDEE_PKH}" },
    { "int": ${DEADLINE_MS} }
  ]
}
EOF

# Lock 5 ADA in the escrow
cardano-cli transaction build \
  --testnet-magic $TESTNET_MAGIC \
  --tx-in abc123def456...#0 \
  --tx-out "$(cat escrow.addr)+5000000" \
  --tx-out-datum-embed-file escrow-datum.json \
  --change-address $(cat payment.addr) \
  --out-file lock-tx.body

cardano-cli transaction sign \
  --tx-body-file lock-tx.body \
  --signing-key-file payment.skey \
  --testnet-magic $TESTNET_MAGIC \
  --out-file lock-tx.signed

cardano-cli transaction submit \
  --tx-file lock-tx.signed \
  --testnet-magic $TESTNET_MAGIC

echo "Submitted. Check: https://preview.cardanoscan.io/transaction/<txhash>"
```

---

## Step 5: Verify on Explorer

```
Preview Cardanoscan: https://preview.cardanoscan.io
Preview Cexplorer:   https://preview.cexplorer.io

Check:
1. Your lock transaction appears
2. The script address has a UTXO with your datum
3. The datum is visible (inline datum shows the JSON)
```

---

## Step 6: Claim Funds

```bash
# Find the script UTXO
cardano-cli query utxo \
  --address $(cat escrow.addr) \
  --testnet-magic $TESTNET_MAGIC

# SCRIPT_UTXO=<txhash>#<txix>
SCRIPT_UTXO="def789...#0"

# Get current slot for validity interval
CURRENT_SLOT=$(cardano-cli query tip --testnet-magic $TESTNET_MAGIC | jq .slot)
DEADLINE_SLOT=$((CURRENT_SLOT + 3600))  # ~1 hour in slots

# Create claim redeemer
cat > claim-redeemer.json << 'EOF'
{ "constructor": 0, "fields": [] }
EOF

# Build claim transaction (Bob signs)
cardano-cli transaction build \
  --testnet-magic $TESTNET_MAGIC \
  --tx-in $SCRIPT_UTXO \
  --tx-in-script-file escrow.plutus \
  --tx-in-datum-file escrow-datum.json \
  --tx-in-redeemer-file claim-redeemer.json \
  --tx-in-collateral <bob-utxo>#0 \
  --required-signer bob.vkey \
  --invalid-hereafter $DEADLINE_SLOT \
  --change-address $(cat bob.addr) \
  --out-file claim-tx.body

cardano-cli transaction sign \
  --tx-body-file claim-tx.body \
  --signing-key-file bob.skey \
  --testnet-magic $TESTNET_MAGIC \
  --out-file claim-tx.signed

cardano-cli transaction submit \
  --tx-file claim-tx.signed \
  --testnet-magic $TESTNET_MAGIC
```

---

## Common Pitfalls

1. **Node socket not running** — `cardano-cli query` commands require a running cardano-node with `CARDANO_NODE_SOCKET_PATH` set. Use Blockfrost API as an alternative if you don't want to run a node.

2. **Collateral too small** — Collateral must be at least 150% of the script execution fee. Keep a dedicated UTXO of ~5 ADA for collateral. Never use your main UTXO as collateral.

3. **Slot arithmetic errors** — The Preview testnet started at a different time than mainnet. Don't use mainnet slot calculations. Use `cardano-cli query tip` to get the current slot.

4. **Datum hash vs inline datum** — Use `--tx-out-datum-embed-file` for inline datums (Babbage era). The older `--tx-out-datum-hash-file` requires the datum to be provided separately when spending.

5. **Transaction too large** — Cardano transactions have a 16KB size limit. If your script is large, use reference scripts to avoid embedding the script in every transaction.

---

## What to Learn Next

You've completed the Cardano Development track. Next steps:
- Explore [Aiken](https://aiken-lang.org) — a modern, purpose-built language for Cardano smart contracts that's easier than Plutus/Haskell
- Read the [Cardano Developer Portal](https://developers.cardano.org) for production deployment guides
- Join the [Cardano Stack Exchange](https://cardano.stackexchange.com) for community support
