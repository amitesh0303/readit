# NEAR Token Standards: NEP-141 and NEP-171

**Track:** NEAR Protocol Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You want to create tokens on NEAR — either fungible tokens (like ERC-20) or NFTs (like ERC-721). NEAR has its own standards: NEP-141 for fungible tokens and NEP-171 for NFTs. These standards look similar to their Ethereum counterparts but have critical differences: storage management, registration patterns, and the way transfers work with receiver contracts. Getting these wrong means your tokens won't be compatible with NEAR wallets, DEXes, or marketplaces.

---

## Core Concepts

### NEP-141: Fungible Token Standard

NEP-141 is NEAR's equivalent of ERC-20. Key differences from ERC-20:

| Feature | ERC-20 (Ethereum) | NEP-141 (NEAR) |
|---------|-------------------|----------------|
| Approval model | `approve` + `transferFrom` | `ft_transfer_call` (no approval needed) |
| Storage cost | Paid by contract deployer | Paid by each token holder |
| Receiver notification | No built-in mechanism | `ft_on_transfer` callback |
| Decimal handling | `decimals()` view function | Metadata standard (NEP-148) |

### Implementing NEP-141 with near-sdk

```rust
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

#[derive(BorshStorageKey, BorshSerialize, BorshDeserialize)]
#[near]
enum StorageKey {
    Accounts,
    StorageDeposits,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FungibleToken {
    /// Token balances per account
    accounts: LookupMap<AccountId, u128>,
    /// Storage deposits per account
    storage_deposits: LookupMap<AccountId, u128>,
    /// Total supply
    total_supply: u128,
    /// Token metadata
    name: String,
    symbol: String,
    decimals: u8,
    /// Owner who can mint
    owner: AccountId,
}

#[near]
impl FungibleToken {
    #[init]
    pub fn new(name: String, symbol: String, decimals: u8, total_supply: U128) -> Self {
        let owner = env::predecessor_account_id();
        let mut token = Self {
            accounts: LookupMap::new(StorageKey::Accounts),
            storage_deposits: LookupMap::new(StorageKey::StorageDeposits),
            total_supply: total_supply.0,
            name,
            symbol,
            decimals,
            owner: owner.clone(),
        };
        // Mint total supply to owner
        token.accounts.set(owner, Some(total_supply.0));
        token
    }

    // ─── NEP-141 Core Methods ───────────────────────────────────────

    /// Transfer tokens to a receiver. Requires 1 yoctoNEAR for security.
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires exactly 1 yoctoNEAR attached"
        );

        let sender_id = env::predecessor_account_id();
        let amount = amount.0;

        self.internal_transfer(&sender_id, &receiver_id, amount);

        if let Some(memo) = memo {
            env::log_str(&format!("Memo: {}", memo));
        }
    }

    /// Transfer tokens and call ft_on_transfer on the receiver contract.
    /// This replaces the approve/transferFrom pattern from ERC-20.
    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires exactly 1 yoctoNEAR attached"
        );

        let sender_id = env::predecessor_account_id();
        let amount = amount.0;

        self.internal_transfer(&sender_id, &receiver_id, amount);

        if let Some(memo) = memo {
            env::log_str(&format!("Memo: {}", memo));
        }

        // Call ft_on_transfer on the receiver
        // The receiver can return unused tokens
        Promise::new(receiver_id.clone()).function_call(
            "ft_on_transfer".to_string(),
            serde_json::json!({
                "sender_id": sender_id,
                "amount": U128(amount),
                "msg": msg
            })
            .to_string()
            .into_bytes(),
            NearToken::from_near(0),
            near_sdk::Gas::from_tgas(30),
        )
    }

    /// View: Get token balance for an account
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.accounts.get(&account_id).copied().unwrap_or(0))
    }

    /// View: Get total supply
    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    // ─── NEP-148 Metadata ───────────────────────────────────────────

    pub fn ft_metadata(&self) -> serde_json::Value {
        serde_json::json!({
            "spec": "ft-1.0.0",
            "name": self.name,
            "symbol": self.symbol,
            "decimals": self.decimals
        })
    }

    // ─── Storage Management (NEP-145) ───────────────────────────────

    /// Register an account to hold this token.
    /// Each account must deposit NEAR to cover storage costs.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit();
        let min_deposit = NearToken::from_millinear(50); // 0.05 NEAR covers ~100 bytes

        require!(
            deposit >= min_deposit,
            format!("Minimum storage deposit is {} yoctoNEAR", min_deposit.as_yoctonear())
        );

        if self.accounts.get(&account_id).is_none() {
            self.accounts.set(account_id.clone(), Some(0));
            self.storage_deposits
                .set(account_id, Some(deposit.as_yoctonear()));
        } else {
            // Refund if already registered
            Promise::new(env::predecessor_account_id()).transfer(deposit);
        }
    }

    /// Check if an account is registered
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<U128> {
        self.storage_deposits
            .get(&account_id)
            .map(|d| U128(*d))
    }

    // ─── Internal ───────────────────────────────────────────────────

    fn internal_transfer(&mut self, sender_id: &AccountId, receiver_id: &AccountId, amount: u128) {
        require!(amount > 0, "Transfer amount must be positive");

        let sender_balance = self.accounts.get(sender_id).copied().unwrap_or(0);
        require!(
            sender_balance >= amount,
            format!(
                "Not enough balance. Have: {}, need: {}",
                sender_balance, amount
            )
        );

        require!(
            self.accounts.get(receiver_id).is_some(),
            "Receiver is not registered. Call storage_deposit first."
        );

        self.accounts.set(sender_id.clone(), Some(sender_balance - amount));
        let receiver_balance = self.accounts.get(receiver_id).copied().unwrap_or(0);
        self.accounts.set(receiver_id.clone(), Some(receiver_balance + amount));

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\"}}]}}",
            sender_id, receiver_id, amount
        ));
    }
}
```

### Deploying and Using the Token

```shell
# Deploy the token contract
near contract deploy mytoken.testnet use-file ./target/near/fungible_token.wasm without-init-call network-config testnet sign-with-keychain send

# Initialize with 1 million tokens (18 decimals)
near contract call-function as-transaction mytoken.testnet new json-args '{"name": "My Token", "symbol": "MYT", "decimals": 18, "total_supply": "1000000000000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as mytoken.testnet network-config testnet sign-with-keychain send

# Register alice to hold tokens (storage deposit)
near contract call-function as-transaction mytoken.testnet storage_deposit json-args '{"account_id": "alice.testnet"}' prepaid-gas '10 Tgas' attached-deposit '0.05 NEAR' sign-as alice.testnet network-config testnet sign-with-keychain send

# Transfer tokens (requires 1 yoctoNEAR for security)
near contract call-function as-transaction mytoken.testnet ft_transfer json-args '{"receiver_id": "alice.testnet", "amount": "1000000000000000000", "memo": "First transfer"}' prepaid-gas '10 Tgas' attached-deposit '1 yoctoNEAR' sign-as mytoken.testnet network-config testnet sign-with-keychain send

# Check balance
near contract call-function as-read-only mytoken.testnet ft_balance_of json-args '{"account_id": "alice.testnet"}' network-config testnet now
```

```
Expected output:
"1000000000000000000"
```

### NEP-171: Non-Fungible Token Standard

NEP-171 is NEAR's NFT standard. Like NEP-141, it includes storage management and transfer-call patterns:

```rust
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, UnorderedSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,       // URL to media file
    pub media_hash: Option<String>,  // Base64 SHA-256 hash of media
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    TokensById,
    TokensPerOwner,
    TokensPerOwnerInner { account_hash: Vec<u8> },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NftContract {
    tokens_by_id: LookupMap<String, Token>,
    tokens_per_owner: LookupMap<AccountId, UnorderedSet<String>>,
    owner: AccountId,
    next_token_id: u64,
}

#[near]
impl NftContract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            tokens_by_id: LookupMap::new(StorageKey::TokensById),
            tokens_per_owner: LookupMap::new(StorageKey::TokensPerOwner),
            owner,
            next_token_id: 0,
        }
    }

    /// Mint a new NFT. Only owner can mint.
    #[payable]
    pub fn nft_mint(&mut self, receiver_id: AccountId, metadata: TokenMetadata) -> Token {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only owner can mint"
        );

        // Storage deposit covers the cost of storing the NFT data
        let deposit = env::attached_deposit();
        require!(
            deposit >= NearToken::from_millinear(100),
            "Attach at least 0.1 NEAR for storage"
        );

        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let token = Token {
            token_id: token_id.clone(),
            owner_id: receiver_id.clone(),
            metadata,
        };

        self.tokens_by_id.set(token_id.clone(), Some(token.clone()));

        // Add to owner's token set
        let account_hash = env::sha256(receiver_id.as_bytes());
        let mut token_set = self
            .tokens_per_owner
            .get(&receiver_id)
            .cloned()
            .unwrap_or_else(|| {
                UnorderedSet::new(StorageKey::TokensPerOwnerInner { account_hash })
            });
        token_set.insert(token_id.clone());
        self.tokens_per_owner.set(receiver_id.clone(), Some(token_set));

        // NEP-171 mint event
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.0.0\",\"event\":\"nft_mint\",\"data\":[{{\"owner_id\":\"{}\",\"token_ids\":[\"{}\"]}}]}}",
            receiver_id, token_id
        ));

        token
    }

    /// Transfer an NFT. Requires 1 yoctoNEAR.
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires exactly 1 yoctoNEAR"
        );

        let sender_id = env::predecessor_account_id();
        let mut token = self
            .tokens_by_id
            .get(&token_id)
            .cloned()
            .expect("Token not found");

        require!(token.owner_id == sender_id, "Not the token owner");

        // Update ownership
        token.owner_id = receiver_id.clone();
        self.tokens_by_id.set(token_id.clone(), Some(token));

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.0.0\",\"event\":\"nft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"token_ids\":[\"{}\"]}}]}}",
            sender_id, receiver_id, token_id
        ));
    }

    /// View: Get token info by ID
    pub fn nft_token(&self, token_id: String) -> Option<&Token> {
        self.tokens_by_id.get(&token_id)
    }

    /// View: Get total supply
    pub fn nft_total_supply(&self) -> U128 {
        U128(self.next_token_id as u128)
    }
}
```

### Storage Management Pattern

The storage management pattern (NEP-145) is critical for NEAR token contracts. Every account that holds tokens must first register by depositing NEAR to cover storage costs:

```
┌─────────────────────────────────────────────────────────┐
│ Token Interaction Flow on NEAR                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Alice calls storage_deposit(0.05 NEAR)              │
│     → Registers Alice's account in the token contract   │
│     → 0.05 NEAR locked for storage                      │
│                                                         │
│  2. Bob calls ft_transfer(alice, 100)                   │
│     → Works because Alice is registered                 │
│                                                         │
│  3. Carol calls ft_transfer(dave, 50)                   │
│     → FAILS: Dave not registered (no storage_deposit)   │
│                                                         │
│  4. Dave calls storage_deposit(0.05 NEAR)               │
│     → Now Dave can receive tokens                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Common Pitfalls

1. **Not requiring 1 yoctoNEAR on transfers** — NEP-141 mandates that `ft_transfer` requires exactly 1 yoctoNEAR attached. This is a security measure — it forces the user to sign the transaction with a full-access key (function-call keys can't attach deposits by default). Skipping this check makes your token vulnerable to unauthorized transfers via function-call keys.

2. **Forgetting storage registration before transfers** — Unlike ERC-20 where any address can receive tokens, NEP-141 requires the receiver to be registered first via `storage_deposit`. If you try to transfer to an unregistered account, the transaction panics. Always check registration status or handle the error gracefully.

3. **Not implementing NEP-145 (Storage Management)** — Wallets and DEXes expect the `storage_deposit`, `storage_withdraw`, and `storage_balance_of` methods. Without them, your token won't work with NEAR ecosystem tools like Ref Finance or NEAR Wallet.

4. **Using wrong event format** — NEAR indexers (like NEAR Lake) expect events in the NEP-297 format: `EVENT_JSON:{...}`. If your event format is wrong, transfers won't show up in wallets or explorers. Always use the exact format specified in the standard.

5. **Not handling `ft_transfer_call` refunds** — When you use `ft_transfer_call`, the receiver contract can return unused tokens. If you don't implement the callback to handle refunds, tokens can be permanently lost in the receiver contract.

---

## What to Learn Next

- [Frontend Integration with near-api-js](./05-frontend-integration.md) — Connect your dApp to NEAR contracts using wallet-selector
- [NEP-141 specification](https://nomicon.io/Standards/Tokens/FungibleToken/Core) — Official fungible token standard
- [NEP-171 specification](https://nomicon.io/Standards/Tokens/NonFungibleToken/Core) — Official NFT standard
- [Ref Finance GitHub](https://github.com/ref-finance/ref-contracts) — Production NEP-141 integration example
