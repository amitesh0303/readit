# Native Tokens on Cardano

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

On Ethereum, every token is a smart contract. On Cardano, tokens are a first-class feature of the ledger — you can mint fungible tokens (like ERC-20) and NFTs without writing a smart contract at all. But you still need a minting policy to control who can mint and burn. Understanding how native tokens work is essential for any Cardano dApp that involves assets.

---

## How Native Tokens Work

Every asset on Cardano is identified by a **policy ID** (hash of the minting policy script) and an **asset name** (arbitrary bytes up to 32 bytes). ADA itself is the special case with an empty policy ID.

```
Asset identifier = PolicyID + AssetName

Examples:
- ADA:          "" + ""
- DJED:         "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61" + "446a6564"
- SpaceBudz #1: "d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc" + "SpaceBud1"
```

### Value Type

```haskell
-- Value is a map of PolicyID -> AssetName -> Integer
-- Positive = minting, Negative = burning
type Value = Map CurrencySymbol (Map TokenName Integer)

-- ADA in lovelace
adaValue :: Integer -> Value
adaValue n = singleton adaSymbol adaToken n

-- A custom token
tokenValue :: CurrencySymbol -> TokenName -> Integer -> Value
tokenValue policy name amount = singleton policy name amount
```

---

## Simple Minting Policy: One-Shot NFT

A one-shot policy can only mint once — it requires a specific UTXO to be consumed, making the policy ID unique and the token provably scarce:

```haskell
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell   #-}

module OneShotPolicy where

import PlutusTx.Prelude
import PlutusTx qualified
import PlutusLedgerApi.V2
import Plutus.Script.Utils.V2.Scripts qualified as Scripts

-- The UTXO that must be consumed (set at policy creation time)
{-# INLINABLE mkOneShotPolicy #-}
mkOneShotPolicy :: TxOutRef -> () -> ScriptContext -> Bool
mkOneShotPolicy utxoRef _ ctx =
  traceIfFalse "Required UTXO not consumed" utxoConsumed
  where
    info :: TxInfo
    info = scriptContextTxInfo ctx

    utxoConsumed :: Bool
    utxoConsumed = any (\i -> txInInfoOutRef i == utxoRef) (txInfoInputs info)

-- Compile with the specific UTXO baked in
mkOneShotPolicyScript :: TxOutRef -> Scripts.MintingPolicy
mkOneShotPolicyScript utxoRef = Scripts.mkMintingPolicyScript $
  $$(PlutusTx.compile [|| mkOneShotPolicy ||])
  `PlutusTx.applyCode`
  PlutusTx.liftCode utxoRef
```

### Minting the NFT

```bash
# 1. Choose the UTXO to consume (this makes the policy unique)
cardano-cli query utxo --address $(cat payment.addr) --testnet-magic 2
# abc123...#0  5000000 lovelace

# 2. Generate the policy script with that UTXO baked in
# (done in Haskell, outputs nft-policy.plutus)

# 3. Get the policy ID
cardano-cli transaction policyid \
  --script-file nft-policy.plutus
# Output: d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc

# 4. Mint the NFT
POLICY_ID="d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc"
TOKEN_NAME=$(echo -n "MyNFT001" | xxd -p)  # hex-encode the name

cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in abc123...#0 \
  --mint "1 ${POLICY_ID}.${TOKEN_NAME}" \
  --mint-script-file nft-policy.plutus \
  --mint-redeemer-value '{}' \
  --tx-out "$(cat payment.addr)+2000000+1 ${POLICY_ID}.${TOKEN_NAME}" \
  --change-address $(cat payment.addr) \
  --out-file mint-tx.body

cardano-cli transaction sign \
  --tx-body-file mint-tx.body \
  --signing-key-file payment.skey \
  --testnet-magic 2 \
  --out-file mint-tx.signed

cardano-cli transaction submit \
  --tx-file mint-tx.signed \
  --testnet-magic 2
```

---

## Fungible Token Policy: Signature-Gated

A policy that allows minting only when a specific key signs — useful for stablecoins or governance tokens:

```haskell
{-# INLINABLE mkSignaturePolicy #-}
mkSignaturePolicy :: PubKeyHash -> () -> ScriptContext -> Bool
mkSignaturePolicy authorizedKey _ ctx =
  traceIfFalse "Not signed by authorized key"
    (txSignedBy (scriptContextTxInfo ctx) authorizedKey)

-- Compile
mkSignaturePolicyScript :: PubKeyHash -> Scripts.MintingPolicy
mkSignaturePolicyScript pkh = Scripts.mkMintingPolicyScript $
  $$(PlutusTx.compile [|| mkSignaturePolicy ||])
  `PlutusTx.applyCode`
  PlutusTx.liftCode pkh
```

```bash
# Mint 1,000,000 fungible tokens
POLICY_ID="..."
TOKEN_NAME=$(echo -n "MYTOKEN" | xxd -p)

cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in <utxo>#0 \
  --mint "1000000 ${POLICY_ID}.${TOKEN_NAME}" \
  --mint-script-file sig-policy.plutus \
  --mint-redeemer-value '{}' \
  --required-signer payment.vkey \
  --tx-out "$(cat payment.addr)+2000000+1000000 ${POLICY_ID}.${TOKEN_NAME}" \
  --change-address $(cat payment.addr) \
  --out-file mint-ft-tx.body
```

---

## Sending Tokens

```bash
# Send 100 tokens to another address
cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in <utxo-with-tokens>#0 \
  --tx-out "addr_test1q...recipient...+2000000+100 ${POLICY_ID}.${TOKEN_NAME}" \
  --change-address $(cat payment.addr) \
  --out-file send-tx.body

# Note: every UTXO must contain at least ~1.5 ADA (minUTxOValue)
# The 2000000 lovelace (2 ADA) satisfies this requirement
```

---

## Burning Tokens

```bash
# Burn 500 tokens (negative mint amount)
cardano-cli transaction build \
  --testnet-magic 2 \
  --tx-in <utxo-with-tokens>#0 \
  --mint "-500 ${POLICY_ID}.${TOKEN_NAME}" \
  --mint-script-file sig-policy.plutus \
  --mint-redeemer-value '{}' \
  --required-signer payment.vkey \
  --change-address $(cat payment.addr) \
  --out-file burn-tx.body
```

---

## Common Pitfalls

1. **Minimum ADA requirement** — Every UTXO containing native tokens must also contain a minimum amount of ADA (typically 1.5–2 ADA depending on the number of different tokens). You can't send tokens without ADA.

2. **Token name encoding** — Token names must be hex-encoded in CLI commands. Use `echo -n "MyToken" | xxd -p` to convert. In Haskell, use `fromBuiltin $ encodeUtf8 "MyToken"`.

3. **Policy ID is permanent** — Once you mint with a policy, the policy ID is fixed. If you lose the policy script, you can never mint or burn those tokens again. Store the script file securely.

4. **One-shot policy timing** — The UTXO you reference in a one-shot policy must exist when you build the transaction. If it gets spent before you submit, the transaction fails and you need a new policy.

5. **Confusing CurrencySymbol and PolicyID** — In Plutus code, `CurrencySymbol` is the on-chain type. In CLI commands, it's called `policyid`. They're the same thing — the hash of the minting policy script.

---

## What to Learn Next

- [Cardano dApp Patterns](./06-dapp-patterns.md) — Concurrency solutions, batchers, and off-chain code with cardano-transaction-lib
- [Preview Testnet Deployment](./07-testnet-deployment.md) — Full deployment workflow with cardano-cli and testnet faucet
