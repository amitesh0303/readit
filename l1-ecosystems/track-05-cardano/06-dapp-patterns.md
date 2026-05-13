# Cardano dApp Patterns

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've written a Plutus validator and deployed it to testnet. Now you need to build the off-chain code that constructs transactions, manages UTXOs, and handles the concurrency challenges unique to the eUTXO model. Cardano dApps require a fundamentally different architecture than Ethereum dApps — there's no `eth_call`, no event subscriptions, and the concurrency problem means naive implementations break under load.

---

## The Concurrency Problem

On Ethereum, multiple users can call the same contract simultaneously — each call is a separate transaction that modifies shared state. On Cardano, if two users try to spend the same UTXO in the same block, only one succeeds. The other fails with "input already spent."

This is the core architectural challenge for Cardano dApps.

### Pattern 1: UTXO Splitting

Instead of one shared UTXO, maintain many UTXOs at the script address:

```
❌ Naive (bottleneck):
Script address: 1 UTXO with all liquidity

✅ Split (parallel):
Script address: 100 UTXOs, each with 1% of liquidity
Users pick different UTXOs to interact with
```

```haskell
-- Validator that allows splitting a UTXO into N outputs
{-# INLINABLE mkSplitValidator #-}
mkSplitValidator :: () -> () -> ScriptContext -> Bool
mkSplitValidator _ _ ctx =
  traceIfFalse "Must produce at least 2 outputs at script" enoughOutputs
  where
    info = scriptContextTxInfo ctx
    ownAddress = txOutAddress (txInInfoResolved (head (txInfoInputs info)))
    
    scriptOutputs = filter (\o -> txOutAddress o == ownAddress) (txInfoOutputs info)
    enoughOutputs = length scriptOutputs >= 2
```

### Pattern 2: Order Batching

A trusted batcher aggregates user orders off-chain and submits them in a single transaction:

```
User A → Order UTXO ─┐
User B → Order UTXO ─┤→ Batcher → Single batch transaction
User C → Order UTXO ─┘
```

```haskell
-- Order datum: what the user wants
data OrderDatum = OrderDatum
  { orderOwner  :: PubKeyHash
  , orderAction :: OrderAction
  , orderAmount :: Integer
  }

data OrderAction = Buy | Sell

-- Order validator: allow batcher to execute, or owner to cancel
{-# INLINABLE mkOrderValidator #-}
mkOrderValidator :: PubKeyHash -> OrderDatum -> () -> ScriptContext -> Bool
mkOrderValidator batcherPkh datum _ ctx =
  traceIfFalse "Must be batcher or owner"
    (txSignedBy info batcherPkh || txSignedBy info (orderOwner datum))
  where
    info = scriptContextTxInfo ctx
```

---

## Off-Chain Code with cardano-transaction-lib

[cardano-transaction-lib (CTL)](https://github.com/Plutonomicon/cardano-transaction-lib) is a PureScript library for building Cardano transactions in the browser or Node.js.

```bash
# Install CTL via npm
npm install @mlabs-haskell/cardano-transaction-lib@^7.0.0
```

```purescript
-- Lock funds in the escrow contract
module Escrow.Contract where

import Contract.Prelude
import Contract.Monad (Contract, liftedE)
import Contract.PlutusData (Datum(..), Redeemer(..), toData)
import Contract.ScriptLookups as Lookups
import Contract.TxConstraints as Constraints
import Contract.Value as Value

-- Lock ADA in the escrow
lockEscrow
  :: EscrowDatum
  -> Value.Value
  -> Contract Unit
lockEscrow datum value = do
  let
    -- Build the datum
    datumData = Datum $ toData datum
    
    -- Build constraints
    constraints = Constraints.mustPayToScript
      escrowValidatorHash
      datumData
      Constraints.DatumInline
      value
    
    -- Build lookups
    lookups = Lookups.validator escrowValidator
  
  -- Build and submit the transaction
  unbalancedTx <- liftedE $ Lookups.mkUnbalancedTx lookups constraints
  balancedTx   <- liftedE $ balanceTx unbalancedTx
  signedTx     <- signTransaction balancedTx
  txId         <- submit signedTx
  
  logInfo' $ "Locked funds in escrow: " <> show txId
  awaitTxConfirmed txId

-- Claim from the escrow
claimEscrow :: TransactionInput -> EscrowDatum -> Contract Unit
claimEscrow scriptUtxo datum = do
  let
    redeemer = Redeemer $ toData Claim
    
    constraints =
      Constraints.mustSpendScriptOutput scriptUtxo redeemer
      <> Constraints.mustBeSignedBy (beneficiary datum)
      <> Constraints.mustValidateIn (to (deadline datum))
    
    lookups =
      Lookups.validator escrowValidator
      <> Lookups.unspentOutputs (Map.singleton scriptUtxo scriptTxOut)
  
  unbalancedTx <- liftedE $ Lookups.mkUnbalancedTx lookups constraints
  balancedTx   <- liftedE $ balanceTx unbalancedTx
  signedTx     <- signTransaction balancedTx
  txId         <- submit signedTx
  awaitTxConfirmed txId
```

---

## Querying the Chain with Blockfrost

[Blockfrost](https://blockfrost.io) provides a REST API for querying Cardano — no need to run a full node:

```bash
# Get a free API key at https://blockfrost.io
# Preview testnet endpoint: https://cardano-preview.blockfrost.io/api/v0
```

```typescript
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";

const api = new BlockFrostAPI({
  projectId: "previewXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "preview",
});

// Get UTXOs at a script address
async function getScriptUtxos(scriptAddress: string) {
  const utxos = await api.addressesUtxos(scriptAddress);
  return utxos.map((utxo) => ({
    txHash: utxo.tx_hash,
    txIndex: utxo.tx_index,
    amount: utxo.amount,
    // Inline datum (Babbage era)
    datum: utxo.inline_datum,
  }));
}

// Watch for new UTXOs at an address
async function watchAddress(address: string, callback: (utxo: any) => void) {
  let knownTxs = new Set<string>();

  setInterval(async () => {
    const utxos = await api.addressesUtxos(address);
    for (const utxo of utxos) {
      const key = `${utxo.tx_hash}#${utxo.tx_index}`;
      if (!knownTxs.has(key)) {
        knownTxs.add(key);
        callback(utxo);
      }
    }
  }, 20_000); // Poll every 20 seconds (1 block time)
}
```

---

## Lucid: Simpler Off-Chain SDK

[Lucid](https://lucid.spacebudz.io) is a TypeScript library that simplifies transaction building:

```bash
npm install lucid-cardano@^0.10.7
```

```typescript
import { Lucid, Blockfrost, Data, toUnit } from "lucid-cardano";

// Initialize Lucid with Blockfrost
const lucid = await Lucid.new(
  new Blockfrost(
    "https://cardano-preview.blockfrost.io/api/v0",
    "previewXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  ),
  "Preview"
);

// Connect wallet (browser)
const api = await window.cardano.nami.enable();
lucid.selectWallet(api);

// Define datum schema
const EscrowDatum = Data.Object({
  beneficiary: Data.Bytes(),
  refundee: Data.Bytes(),
  deadline: Data.Integer(),
});
type EscrowDatum = Data.Static<typeof EscrowDatum>;

// Lock funds
async function lockFunds(datum: EscrowDatum, lovelace: bigint) {
  const tx = await lucid
    .newTx()
    .payToContract(
      scriptAddress,
      { inline: Data.to(datum, EscrowDatum) },
      { lovelace }
    )
    .complete();

  const signedTx = await tx.sign().complete();
  const txHash = await signedTx.submit();
  console.log("Locked:", txHash);
  return txHash;
}

// Claim funds
async function claimFunds(utxo: UTxO, datum: EscrowDatum) {
  const tx = await lucid
    .newTx()
    .collectFrom([utxo], Data.to("Claim", Data.Enum(["Claim", "Refund"])))
    .attachSpendingValidator(escrowScript)
    .addSigner(datum.beneficiary)
    .validTo(Number(datum.deadline) - 1)
    .complete();

  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}
```

---

## Common Pitfalls

1. **Not handling "input already spent" errors** — Always implement retry logic with exponential backoff. When a UTXO gets spent between query and submission, catch the error and re-query for available UTXOs.

2. **Polling instead of streaming** — Cardano has no native event subscriptions. You must poll Blockfrost or use a WebSocket service like Ogmios. Set polling intervals to ~20 seconds (one block time).

3. **Ignoring min-ADA in outputs** — Every output must meet the minimum ADA requirement. Lucid and CTL calculate this automatically, but if you're building raw transactions, calculate it with `cardano-cli transaction calculate-min-required-utxo`.

4. **Not testing concurrency** — Test your dApp with multiple simultaneous users hitting the same script. A single-UTXO design will fail under any real load.

5. **Hardcoding slot numbers** — Slot numbers change between testnets and mainnet. Always calculate validity intervals relative to the current slot, not hardcoded values.

---

## What to Learn Next

- [Preview Testnet Deployment](./07-testnet-deployment.md) — Full end-to-end deployment workflow with faucet, cardano-cli, and verification
