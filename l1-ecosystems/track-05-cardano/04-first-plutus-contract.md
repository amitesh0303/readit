# Writing Your First Plutus Contract

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 18 min

---

## The Problem

You understand the eUTXO model and Haskell basics. Now you need to write an actual Plutus contract, compile it, and deploy it to the Preview testnet. The gap between "understanding the concepts" and "having a working contract on-chain" is where most developers get stuck — the toolchain is complex, the error messages are cryptic, and the workflow is nothing like deploying a Solidity contract.

---

## What We're Building

A time-locked escrow contract:
- Alice locks ADA in the contract with Bob's public key hash and a deadline
- Bob can claim the ADA any time before the deadline
- Alice can reclaim the ADA after the deadline passes

This covers the core Plutus patterns: datum, redeemer, time validation, and signature checking.

---

## Project Setup

```bash
# Install GHCup (Haskell toolchain manager)
curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh

# Install GHC 9.2.8 and Cabal (versions required by Plutus)
ghcup install ghc 9.2.8
ghcup set ghc 9.2.8
ghcup install cabal 3.8.1.0
ghcup set cabal 3.8.1.0

# Verify
ghc --version   # The Glorious Glasgow Haskell Compilation System, version 9.2.8
cabal --version # cabal-install version 3.8.1.0
```

Create the project:

```bash
mkdir cardano-escrow && cd cardano-escrow
cabal init --non-interactive
```

Edit `cardano-escrow.cabal`:

```cabal
cabal-version: 3.0
name:          cardano-escrow
version:       0.1.0.0

library
  default-language: Haskell2010
  hs-source-dirs:   src
  exposed-modules:  EscrowValidator
  build-depends:
    , base                  >= 4.14 && < 5
    , plutus-tx             >= 1.15 && < 2
    , plutus-tx-plugin      >= 1.15 && < 2
    , plutus-ledger-api     >= 1.15 && < 2
    , plutus-script-utils   >= 1.15 && < 2
    , cardano-api           >= 8.20 && < 9
  ghc-options:
    -Wall
    -fobject-code
    -fno-ignore-interface-pragmas
    -fno-omit-interface-pragmas
```

---

## The Validator

Create `src/EscrowValidator.hs`:

```haskell
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE NoImplicitPrelude   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module EscrowValidator where

import PlutusTx.Prelude
import PlutusTx qualified
import PlutusLedgerApi.V2
import PlutusLedgerApi.V2.Contexts (txSignedBy)
import Plutus.Script.Utils.V2.Typed.Scripts qualified as Scripts
import Cardano.Api
import Cardano.Api.Shelley (PlutusScript (..))
import Data.ByteString.Short qualified as SBS

-- ============================================================
-- Datum: what Alice stores when locking funds
-- ============================================================
data EscrowDatum = EscrowDatum
  { beneficiary :: PubKeyHash  -- Bob's key hash
  , refundee    :: PubKeyHash  -- Alice's key hash
  , deadline    :: POSIXTime   -- Unix timestamp in milliseconds
  }

PlutusTx.makeIsDataIndexed ''EscrowDatum [('EscrowDatum, 0)]

-- ============================================================
-- Redeemer: what the spender provides
-- ============================================================
data EscrowRedeemer
  = Claim   -- Bob claims before deadline
  | Refund  -- Alice reclaims after deadline

PlutusTx.makeIsDataIndexed ''EscrowRedeemer [('Claim, 0), ('Refund, 1)]

-- ============================================================
-- Validator logic
-- ============================================================
{-# INLINABLE mkEscrowValidator #-}
mkEscrowValidator :: EscrowDatum -> EscrowRedeemer -> ScriptContext -> Bool
mkEscrowValidator datum redeemer ctx =
  case redeemer of
    Claim ->
      traceIfFalse "Beneficiary must sign"    (txSignedBy info (beneficiary datum)) &&
      traceIfFalse "Deadline has passed"      (beforeDeadline)

    Refund ->
      traceIfFalse "Refundee must sign"       (txSignedBy info (refundee datum)) &&
      traceIfFalse "Deadline not yet reached" (afterDeadline)

  where
    info :: TxInfo
    info = scriptContextTxInfo ctx

    -- The valid range must be entirely before the deadline
    beforeDeadline :: Bool
    beforeDeadline = ivTo (txInfoValidRange info) < deadline datum

    -- The valid range must start at or after the deadline
    afterDeadline :: Bool
    afterDeadline = ivFrom (txInfoValidRange info) >= deadline datum

    -- Helper: get the upper bound of an interval
    ivTo :: POSIXTimeRange -> POSIXTime
    ivTo (Interval _ (UpperBound (Finite t) _)) = t
    ivTo _                                       = traceError "No upper bound"

    -- Helper: get the lower bound of an interval
    ivFrom :: POSIXTimeRange -> POSIXTime
    ivFrom (Interval (LowerBound (Finite t) _) _) = t
    ivFrom _                                       = traceError "No lower bound"

-- ============================================================
-- Compilation
-- ============================================================
data EscrowTypes
instance Scripts.ValidatorTypes EscrowTypes where
  type DatumType    EscrowTypes = EscrowDatum
  type RedeemerType EscrowTypes = EscrowRedeemer

typedValidator :: Scripts.TypedValidator EscrowTypes
typedValidator = Scripts.mkTypedValidator @EscrowTypes
  $$(PlutusTx.compile [|| mkEscrowValidator ||])
  $$(PlutusTx.compile [|| Scripts.mkUntypedValidator ||])

-- ============================================================
-- Serialization for deployment
-- ============================================================
escrowScript :: PlutusScript PlutusScriptV2
escrowScript = PlutusScriptSerialised
  $ SBS.toShort
  $ serialiseCompiledCode
  $ Scripts.validatorScript typedValidator

-- Write the compiled script to a file
writeEscrowScript :: IO ()
writeEscrowScript = do
  let result = writeFileTextEnvelope "escrow.plutus" Nothing escrowScript
  case result of
    Left err -> print err
    Right () -> putStrLn "Wrote escrow.plutus"
```

---

## Compiling and Generating the Script

```bash
# Build the project
cabal build

# Run the serialization to generate escrow.plutus
cabal repl
> EscrowValidator.writeEscrowScript
# Wrote escrow.plutus

# Get the script address (Preview testnet)
cardano-cli address build \
  --payment-script-file escrow.plutus \
  --testnet-magic 2 \
  --out-file escrow.addr

cat escrow.addr
# addr_test1wq...
```

---

## Deploying to Preview Testnet

```bash
# 1. Get test ADA from faucet
# https://docs.cardano.org/cardano-testnets/tools/faucet/
# Select "Preview Testnet" and enter your wallet address

# 2. Check your UTXOs
cardano-cli query utxo \
  --address $(cat payment.addr) \
  --testnet-magic 2

# Output:
# TxHash                                 TxIx  Amount
# abc123...                              0     10000000 lovelace

# 3. Build the datum (Bob's pkh, Alice's pkh, deadline)
# Get public key hashes
cardano-cli address key-hash \
  --payment-verification-key-file bob.vkey
# Output: d8a4...  (Bob's pkh)

cardano-cli address key-hash \
  --payment-verification-key-file alice.vkey
# Output: f3b2...  (Alice's pkh)

# Deadline: Unix timestamp in milliseconds (1 hour from now)
# $(date -d "+1 hour" +%s)000

# Create datum JSON
cat > escrow-datum.json << 'EOF'
{
  "constructor": 0,
  "fields": [
    { "bytes": "d8a4..." },
    { "bytes": "f3b2..." },
    { "int": 1715000000000 }
  ]
}
EOF

# 4. Lock funds in the contract
cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in abc123...#0 \
  --tx-out "$(cat escrow.addr)+5000000" \
  --tx-out-datum-embed-file escrow-datum.json \
  --change-address $(cat alice.addr) \
  --out-file lock-tx.body

cardano-cli transaction sign \
  --tx-body-file lock-tx.body \
  --signing-key-file alice.skey \
  --testnet-magic 2 \
  --out-file lock-tx.signed

cardano-cli transaction submit \
  --tx-file lock-tx.signed \
  --testnet-magic 2

# 5. Claim funds (Bob's transaction)
# First find the script UTXO
cardano-cli query utxo \
  --address $(cat escrow.addr) \
  --testnet-magic 2

# Build claim transaction
cat > claim-redeemer.json << 'EOF'
{ "constructor": 0, "fields": [] }
EOF

cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in <script-utxo-txhash>#0 \
  --tx-in-script-file escrow.plutus \
  --tx-in-datum-file escrow-datum.json \
  --tx-in-redeemer-file claim-redeemer.json \
  --tx-in-collateral <bob-utxo>#0 \
  --required-signer bob.vkey \
  --invalid-hereafter <slot-before-deadline> \
  --change-address $(cat bob.addr) \
  --out-file claim-tx.body

cardano-cli transaction sign \
  --tx-body-file claim-tx.body \
  --signing-key-file bob.skey \
  --testnet-magic 2 \
  --out-file claim-tx.signed

cardano-cli transaction submit \
  --tx-file claim-tx.signed \
  --testnet-magic 2
```

---

## Common Pitfalls

1. **Missing collateral** — Script transactions require a collateral input (a UTXO you own that will be forfeited if the script fails). Always include `--tx-in-collateral` pointing to a UTXO with enough ADA (typically 5 ADA).

2. **Wrong validity interval** — The `--invalid-hereafter` and `--invalid-before` flags set the transaction's valid range. Your validator checks this range against the deadline. If you don't set these, the range is unbounded and time checks will fail.

3. **Datum not attached** — Use `--tx-out-datum-embed-file` (not `--tx-out-datum-hash-file`) to embed the datum inline. Reference datums require the datum to be available on-chain separately.

4. **Slot vs POSIX time confusion** — Cardano uses POSIX time (milliseconds) in Plutus, but `cardano-cli` uses slot numbers for validity intervals. Convert: `slot = (posix_ms / 1000 - shelley_start) / slot_length`.

5. **Redeemer constructor index** — The `"constructor": 0` in the redeemer JSON must match the index in `makeIsDataIndexed`. `Claim` is index 0, `Refund` is index 1.

---

## What to Learn Next

- [Native Tokens on Cardano](./05-native-tokens.md) — Mint fungible and non-fungible tokens using minting policies
- [Cardano dApp Patterns](./06-dapp-patterns.md) — Concurrency solutions, batchers, and off-chain code with cardano-transaction-lib
