# Plutus Language Fundamentals

**Track:** Cardano Development
**Level:** Intermediate
**Read time:** 15 min

---

## The Problem

Plutus is Cardano's smart contract language, and it's built on Haskell. If you've never written Haskell, the syntax looks alien — type signatures everywhere, no mutation, monads, and a compiler that refuses to let you write incorrect code. But you don't need to become a Haskell expert to write Plutus validators. You need to understand enough Haskell to read and write the patterns that appear repeatedly in Plutus code.

---

## Haskell Basics for Plutus

### Types and Type Signatures

Haskell is statically typed. Every function has a type signature:

```haskell
-- Function that takes an Integer and returns an Integer
double :: Integer -> Integer
double x = x * 2

-- Function that takes two Integers and returns a Bool
isGreater :: Integer -> Integer -> Bool
isGreater x y = x > y

-- Function that takes a String and returns a String
greet :: String -> String
greet name = "Hello, " <> name
```

The `::` means "has type". The `->` separates argument types from the return type. Multiple `->` means multiple arguments (Haskell uses currying).

### Data Types

```haskell
-- A simple enum
data Direction = North | South | East | West

-- A record type (like a struct)
data Person = Person
  { personName :: String
  , personAge  :: Integer
  }

-- A type with a type parameter (like generics)
data Maybe a = Nothing | Just a

-- Pattern matching on a Maybe
describeValue :: Maybe Integer -> String
describeValue Nothing  = "No value"
describeValue (Just n) = "Value is: " <> show n
```

### Pattern Matching

Pattern matching is how you branch on data in Haskell:

```haskell
-- Pattern match on a list
describeList :: [a] -> String
describeList []     = "empty"
describeList [_]    = "one element"
describeList [_, _] = "two elements"
describeList _      = "many elements"

-- Pattern match with guards
classify :: Integer -> String
classify n
  | n < 0    = "negative"
  | n == 0   = "zero"
  | n < 100  = "small positive"
  | otherwise = "large positive"
```

### The `where` Clause

```haskell
-- Break complex logic into named sub-expressions
calculateFee :: Integer -> Integer -> Integer
calculateFee amount rate = baseFee + networkFee
  where
    baseFee    = amount * rate `div` 1000
    networkFee = 155381  -- minimum fee in lovelace
```

---

## Plutus Core Concepts

### The Validator Type

A Plutus validator is a function with this signature:

```haskell
-- The three arguments every validator receives:
-- 1. Datum    - data attached to the UTXO being spent
-- 2. Redeemer - data provided by the spending transaction
-- 3. ScriptContext - information about the transaction
validator :: Datum -> Redeemer -> ScriptContext -> Bool
```

In practice, you use typed validators where Datum and Redeemer are your own types:

```haskell
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE NoImplicitPrelude   #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module MyValidator where

import PlutusTx.Prelude
import Plutus.Script.Utils.V2.Typed.Scripts qualified as Scripts
import PlutusLedgerApi.V2

-- Define your datum type
data MyDatum = MyDatum
  { owner    :: PubKeyHash
  , deadline :: POSIXTime
  }

-- Define your redeemer type
data MyRedeemer = Claim | Cancel

-- The actual validator logic
{-# INLINABLE mkValidator #-}
mkValidator :: MyDatum -> MyRedeemer -> ScriptContext -> Bool
mkValidator datum redeemer ctx =
  case redeemer of
    Claim  -> traceIfFalse "Not signed by owner" signedByOwner
           && traceIfFalse "Deadline not reached" deadlineReached
    Cancel -> traceIfFalse "Not signed by owner" signedByOwner
  where
    info :: TxInfo
    info = scriptContextTxInfo ctx

    signedByOwner :: Bool
    signedByOwner = txSignedBy info (owner datum)

    deadlineReached :: Bool
    deadlineReached = contains (from (deadline datum)) (txInfoValidRange info)
```

### PlutusTx.Prelude

Plutus uses its own Prelude instead of Haskell's standard one. Key differences:

```haskell
-- Standard Haskell uses String, Plutus uses BuiltinByteString
-- Standard Haskell uses Int/Integer, Plutus uses Integer (same)
-- Standard Haskell uses Bool, Plutus uses Bool (same)

-- Plutus error/trace functions
traceError :: BuiltinString -> a
traceIfFalse :: BuiltinString -> Bool -> Bool
traceIfTrue  :: BuiltinString -> Bool -> Bool

-- Example: fail with a message
{-# INLINABLE myValidator #-}
myValidator :: () -> () -> ScriptContext -> Bool
myValidator _ _ ctx =
  traceIfFalse "Transaction not valid" (someCheck ctx)
```

### Working with ScriptContext

The `ScriptContext` contains everything about the spending transaction:

```haskell
-- ScriptContext structure
data ScriptContext = ScriptContext
  { scriptContextTxInfo  :: TxInfo      -- the transaction
  , scriptContextPurpose :: ScriptPurpose -- why this script is running
  }

-- TxInfo contains all transaction details
data TxInfo = TxInfo
  { txInfoInputs      :: [TxInInfo]     -- inputs being consumed
  , txInfoOutputs     :: [TxOut]        -- outputs being created
  , txInfoFee         :: Value          -- transaction fee
  , txInfoMint        :: Value          -- tokens being minted/burned
  , txInfoSignatories :: [PubKeyHash]   -- required signers
  , txInfoValidRange  :: POSIXTimeRange -- valid time window
  , ...
  }

-- Common helper functions
{-# INLINABLE getOutputs #-}
getOutputs :: ScriptContext -> [TxOut]
getOutputs = txInfoOutputs . scriptContextTxInfo

{-# INLINABLE getSigner #-}
getSigner :: ScriptContext -> [PubKeyHash]
getSigner = txInfoSignatories . scriptContextTxInfo

{-# INLINABLE txSignedBy #-}
-- Check if a specific key signed the transaction
txSignedBy :: TxInfo -> PubKeyHash -> Bool
txSignedBy info pkh = pkh `elem` txInfoSignatories info
```

### Value and Ada

```haskell
-- Value represents ADA + native tokens
-- Ada is measured in lovelace (1 ADA = 1,000,000 lovelace)

import PlutusLedgerApi.V1.Value

-- Get the Ada value from a Value
lovelaceValueOf :: Integer -> Value
lovelaceValueOf = singleton adaSymbol adaToken

-- Check if a Value contains at least N lovelace
containsAda :: Value -> Integer -> Bool
containsAda v n = valueOf v adaSymbol adaToken >= n

-- Example: validator that requires a minimum payment
{-# INLINABLE paymentValidator #-}
paymentValidator :: PubKeyHash -> Integer -> () -> ScriptContext -> Bool
paymentValidator recipient minAmount _ ctx =
  traceIfFalse "Insufficient payment" paymentSufficient
  where
    info = scriptContextTxInfo ctx
    
    -- Find outputs going to the recipient
    recipientOutputs :: [TxOut]
    recipientOutputs = filter goesToRecipient (txInfoOutputs info)
    
    goesToRecipient :: TxOut -> Bool
    goesToRecipient o = txOutAddress o == pubKeyHashAddress recipient Nothing
    
    totalPaid :: Integer
    totalPaid = sum $ map (valueOf (txOutValue o) adaSymbol adaToken) recipientOutputs
    
    paymentSufficient :: Bool
    paymentSufficient = totalPaid >= minAmount
```

---

## Compiling Plutus to On-Chain Code

Plutus validators must be compiled to Untyped Plutus Core (UPLC) to run on-chain. This uses Template Haskell:

```haskell
import PlutusTx qualified
import PlutusTx.Prelude

-- Make your types serializable
PlutusTx.makeIsDataIndexed ''MyDatum    [('MyDatum, 0)]
PlutusTx.makeIsDataIndexed ''MyRedeemer [('Claim, 0), ('Cancel, 1)]

-- Compile the validator
compiledValidator :: PlutusTx.CompiledCode (PlutusTx.BuiltinData -> PlutusTx.BuiltinData -> PlutusTx.BuiltinData -> ())
compiledValidator = $$(PlutusTx.compile [|| wrappedValidator ||])
  where
    wrappedValidator = Scripts.mkUntypedValidator mkValidator

-- Serialize to CBOR for deployment
import Cardano.Api
import Cardano.Api.Shelley

serialisedScript :: PlutusScript PlutusScriptV2
serialisedScript = PlutusScriptSerialised $ serialiseCompiledCode compiledValidator
```

---

## Common Pitfalls

1. **Forgetting `{-# INLINABLE #-}` pragma** — Every function called inside a validator must have this pragma. Without it, Template Haskell can't inline the function into the compiled code and you'll get a compile error.

2. **Using standard Prelude functions** — Always import `PlutusTx.Prelude` and use `{-# LANGUAGE NoImplicitPrelude #-}`. Standard Haskell functions like `map`, `filter`, and `foldr` are not available on-chain without this.

3. **Expensive on-chain computation** — Every operation costs execution units (CPU and memory). Avoid complex loops or large data structures in validators. Move computation off-chain and only verify the result on-chain.

4. **Not using `traceIfFalse`** — Without trace messages, failed transactions give no indication of why they failed. Always wrap your checks with `traceIfFalse "descriptive message"`.

5. **Mutable state confusion** — There is no mutable state. If you need to "update" a datum, you consume the old UTXO and produce a new one with the updated datum. Think in terms of state transitions, not mutations.

---

## What to Learn Next

- [Writing Your First Plutus Contract](./04-first-plutus-contract.md) — Build a complete time-locked escrow contract from scratch
- [Native Tokens on Cardano](./05-native-tokens.md) — Mint and manage tokens without smart contracts using minting policies
