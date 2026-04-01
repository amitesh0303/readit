# Solana's Account Model Explained (vs EVM Storage Model)

**Track:** Beginner → Intermediate  
**Read time:** 12 min

---

## The Problem

You're reading Solana docs and you keep seeing "accounts" everywhere. Token accounts, program accounts, data accounts, system accounts. Every instruction requires a list of accounts. You're not sure what an account actually is, why there are so many types, or why you need to pass them explicitly to every function call.

This confusion is the #1 blocker for Ethereum developers learning Solana. Once you understand the account model deeply, everything else — PDAs, CPIs, rent, token accounts — clicks into place. This blog builds that foundation.

---

## Core Concepts

### What an Account Is

In Solana, everything is an account. An account is a fixed-size blob of data stored on-chain with the following fields:

```
Account:
┌─────────────────────────────────────────────────────┐
│ lamports: u64          — SOL balance (in lamports)  │
│ data: Vec<u8>          — arbitrary byte array       │
│ owner: Pubkey          — which program owns this    │
│ executable: bool       — is this a program?         │
│ rent_epoch: u64        — rent accounting (legacy)   │
└─────────────────────────────────────────────────────┘
```

The `owner` field is critical: only the owning program can modify an account's data or debit its lamports. The System Program owns regular wallets. Your deployed program owns the data accounts it creates.

### Types of Accounts

**Wallet accounts (EOAs)** — owned by the System Program. Hold SOL. No data. Controlled by a private key.

**Program accounts** — `executable = true`. Hold compiled BPF bytecode. Owned by the BPF Loader. Immutable data (the code).

**Data accounts** — owned by a program. Hold arbitrary data that the program reads/writes. This is where all application state lives.

**Token accounts** — a specific type of data account owned by the SPL Token Program. Holds a token balance for one specific mint and one specific owner.

**Mint accounts** — another SPL Token Program account. Defines a token type (like an ERC-20 contract). Holds total supply, decimals, mint authority.

```
Ethereum analogy:
ERC-20 contract = Mint account + Token Program
User's token balance = Token account (separate account per user per token)

Ethereum:
USDC contract → balances[alice] = 1000

Solana:
USDC Mint account (defines the token)
Alice's USDC Token account (holds Alice's balance)
Bob's USDC Token account (holds Bob's balance)
```

### Why Separate Token Accounts?

In Ethereum, your USDC balance is a mapping entry inside the USDC contract. In Solana, your USDC balance is a separate account that you own.

This means:
- Before Alice can receive USDC, her USDC token account must be created (and funded with rent)
- Alice has a different token account for each token she holds
- Token accounts are "Associated Token Accounts" (ATAs) — deterministically derived from the owner's wallet and the mint address

```
Associated Token Account address:
= PDA derived from [owner_wallet, token_program_id, mint_address]

Alice's USDC ATA = findProgramAddress(
    [alice.publicKey, TOKEN_PROGRAM_ID, USDC_MINT],
    ASSOCIATED_TOKEN_PROGRAM_ID
)
```

This determinism means anyone can compute Alice's USDC token account address without asking Alice — they just need her wallet address and the mint address.

### The Owner Model vs EVM Storage

```
EVM Storage Model:
┌─────────────────────────────────────────────────────┐
│ Contract Account                                    │
│   code: bytecode                                    │
│   storage:                                          │
│     slot 0: totalSupply = 1000000                   │
│     slot 1: balances[alice] = 500                   │
│     slot 2: balances[bob] = 300                     │
│     ...                                             │
└─────────────────────────────────────────────────────┘

Solana Account Model:
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Program Account  │  │ Alice's Token Acc│  │ Bob's Token Acc  │
│ owner: BPF Loader│  │ owner: Token Prog│  │ owner: Token Prog│
│ executable: true │  │ data:            │  │ data:            │
│ data: bytecode   │  │   mint: USDC     │  │   mint: USDC     │
└──────────────────┘  │   owner: alice   │  │   owner: bob     │
                      │   amount: 500    │  │   amount: 300    │
                      └──────────────────┘  └──────────────────┘
```

### Rent: Paying for Storage

Accounts must maintain a minimum SOL balance to stay alive. This is "rent exemption" — if an account holds enough SOL to cover 2 years of rent, it's exempt from being garbage collected.

```
Rent-exempt minimum ≈ 0.00203928 SOL per 128 bytes of data
(as of 2024 — changes with network parameters)

A typical Anchor data account (200 bytes):
Rent-exempt minimum ≈ 0.00203928 * (200/128) ≈ 0.00318 SOL ≈ $0.50
```

When you create an account, you must fund it with at least the rent-exempt minimum. When you close an account, you get the rent back (minus a small fee).

### Account Size is Fixed at Creation

Unlike Ethereum storage (which can grow dynamically), Solana accounts have a fixed size set at creation. If you need more space, you must close the account and create a new one (or use `realloc` in newer Anchor versions, which has limits).

This means you must plan your data structures carefully. A common pattern: use multiple accounts for variable-length data, or use a linked list of accounts.

---

## Code Walkthrough

Understanding accounts through a user profile example:

```rust
use anchor_lang::prelude::*;

declare_id!("ProfileProgram111111111111111111111111111111");

#[program]
pub mod user_profile {
    use super::*;

    /// Create a user profile account.
    /// The profile account is a data account owned by this program.
    pub fn create_profile(
        ctx: Context<CreateProfile>,
        username: String,
        bio: String,
    ) -> Result<()> {
        require!(username.len() <= 32, ProfileError::UsernameTooLong);
        require!(bio.len() <= 200, ProfileError::BioTooLong);

        let profile = &mut ctx.accounts.profile;
        profile.owner = ctx.accounts.user.key();
        profile.username = username;
        profile.bio = bio;
        profile.created_at = Clock::get()?.unix_timestamp;
        profile.post_count = 0;

        Ok(())
    }

    /// Update profile — only the owner can do this.
    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        new_bio: String,
    ) -> Result<()> {
        require!(new_bio.len() <= 200, ProfileError::BioTooLong);
        ctx.accounts.profile.bio = new_bio;
        Ok(())
    }

    /// Close the profile account and reclaim rent.
    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        // Anchor's `close = user` constraint handles:
        // 1. Zeroing out the account data
        // 2. Transferring lamports to `user`
        // 3. Setting the account's lamports to 0 (marks for garbage collection)
        Ok(())
    }
}

/// Account validation for create_profile
#[derive(Accounts)]
#[instruction(username: String, bio: String)]
pub struct CreateProfile<'info> {
    /// The profile data account to create.
    /// `init` creates it, `payer` funds the rent, `space` sets the size.
    /// Space = 8 (discriminator) + ProfileAccount::INIT_SPACE
    #[account(
        init,
        payer = user,
        space = 8 + ProfileAccount::INIT_SPACE,
        // seeds + bump makes this a PDA — deterministic address
        // derived from ["profile", user.key()]
        seeds = [b"profile", user.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, ProfileAccount>,

    /// The user creating the profile — pays rent, must sign.
    #[account(mut)]
    pub user: Signer<'info>,

    /// System Program is needed to create new accounts.
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    /// `has_one = owner` validates that profile.owner == owner.key()
    /// `mut` allows us to modify the account data
    #[account(
        mut,
        has_one = owner,
        seeds = [b"profile", owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, ProfileAccount>,

    /// Must be the profile owner
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    /// `close = user` closes the account and sends lamports to user
    #[account(
        mut,
        has_one = owner,
        close = user,  // sends rent back to user when account is closed
        seeds = [b"profile", user.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, ProfileAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub owner: Signer<'info>,
}

/// The data stored in the profile account.
/// #[account] adds an 8-byte discriminator prefix automatically.
/// #[derive(InitSpace)] calculates the space needed.
#[account]
#[derive(InitSpace)]
pub struct ProfileAccount {
    pub owner: Pubkey,          // 32 bytes
    #[max_len(32)]
    pub username: String,       // 4 + 32 bytes (length prefix + max chars)
    #[max_len(200)]
    pub bio: String,            // 4 + 200 bytes
    pub created_at: i64,        // 8 bytes
    pub post_count: u64,        // 8 bytes
    pub bump: u8,               // 1 byte (PDA bump seed)
    // Total: 32 + 36 + 204 + 8 + 8 + 1 = 289 bytes
    // + 8 discriminator = 297 bytes total
}

#[error_code]
pub enum ProfileError {
    #[msg("Username must be 32 characters or less")]
    UsernameTooLong,
    #[msg("Bio must be 200 characters or less")]
    BioTooLong,
}
```

TypeScript client showing account creation and reading:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function createAndReadProfile() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.UserProfile as Program<any>;

  const user = provider.wallet.publicKey;

  // Derive the PDA address for this user's profile
  // This is deterministic — same inputs always give same address
  const [profilePda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), user.toBuffer()],
    program.programId
  );

  console.log("Profile PDA:", profilePda.toBase58());

  // Create the profile
  await program.methods
    .createProfile("amitesh", "Full-stack Web3 developer")
    .accounts({
      profile: profilePda,
      user: user,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  // Read the profile account
  const profile = await program.account.profileAccount.fetch(profilePda);
  console.log("Username:", profile.username);
  console.log("Bio:", profile.bio);
  console.log("Owner:", profile.owner.toBase58());
  console.log("Created at:", new Date(profile.createdAt.toNumber() * 1000));

  // Check account info (lamports, owner, etc.)
  const accountInfo = await provider.connection.getAccountInfo(profilePda);
  console.log("Account size:", accountInfo?.data.length, "bytes");
  console.log("Lamports:", accountInfo?.lamports, "(rent deposit)");
  console.log("Owner program:", accountInfo?.owner.toBase58());
}
```

---

## Common Mistakes and Gotchas

**1. Not allocating enough space**  
If you allocate 100 bytes but your data needs 150, the transaction fails. Calculate space carefully using `#[derive(InitSpace)]` or manual calculation. Add a buffer for future fields if you might need to add data later (though resizing is limited).

**2. Forgetting to include all required accounts**  
Every account your instruction reads or writes must be in the accounts list. If you forget one, you get a cryptic error. Anchor's `#[derive(Accounts)]` struct enforces this at compile time for accounts you declare, but dynamic account lookups still require manual inclusion.

**3. Not understanding account ownership for security**  
Only the owning program can modify an account's data. But any program can read any account's data. This means sensitive data in accounts is readable by anyone — don't store secrets on-chain. Also, always validate that accounts passed to your program are owned by the expected program (Anchor does this automatically for typed accounts).

**4. Confusing wallet address with token account address**  
Alice's wallet address ≠ Alice's USDC token account address. If you send USDC to Alice's wallet address (not her token account), the transaction fails or the tokens are lost. Always use the Associated Token Account (ATA) address for token transfers.

**5. Not closing accounts when done**  
Accounts that are no longer needed still hold rent. Close them to reclaim the SOL. This is especially important for temporary accounts created during complex operations (like order book entries that have been filled).

---

## How This Connects to Production

Jupiter's swap aggregator creates temporary accounts during complex multi-hop swaps and closes them at the end to reclaim rent. Drift Protocol's perpetuals system uses hundreds of accounts per user — position accounts, margin accounts, oracle accounts — all carefully managed. Metaplex's NFT standard uses a specific account structure (mint account + metadata account + master edition account) that every NFT marketplace understands. The account model is what enables Solana's parallel execution — because transactions declare their accounts upfront, the runtime can schedule non-conflicting transactions simultaneously. Understanding accounts deeply is the prerequisite for building anything non-trivial on Solana.

---

## What to Learn Next

- **What are PDAs (Program Derived Addresses)?** — the most important account type for building real Solana programs.
- **Getting Started with Anchor: Your First Solana Program** — put account knowledge to work with the standard framework.
- **Solana Token Program and SPL Tokens** — understand the specific account structure for tokens.
