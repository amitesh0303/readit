# Solana Token Program and SPL Tokens: The Equivalent of ERC-20

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

On Ethereum, every token is its own smart contract. On Solana, all tokens share a single program — the SPL Token Program. This is a fundamentally different architecture that confuses most Ethereum developers. Why does Alice need a separate "token account" for each token she holds? Why do you need to "create" a token account before receiving tokens? Why is there a Token-2022 program?

This blog explains the SPL token architecture from scratch, shows you how to create tokens, manage token accounts, and mint/transfer tokens both on-chain (in Anchor programs) and off-chain (in TypeScript).

---

## Core Concepts

### The SPL Token Architecture

```
Ethereum ERC-20:
USDC Contract → balances[alice] = 1000
USDT Contract → balances[alice] = 500

Solana SPL:
USDC Mint Account (defines the token)
  └── Alice's USDC Token Account (holds Alice's USDC balance: 1000)
  └── Bob's USDC Token Account (holds Bob's USDC balance: 200)

USDT Mint Account (defines the token)
  └── Alice's USDT Token Account (holds Alice's USDT balance: 500)
```

**Mint Account** — defines a token type. Contains:
- `mint_authority`: who can mint new tokens
- `freeze_authority`: who can freeze token accounts
- `supply`: total tokens in existence
- `decimals`: decimal places (like ERC-20 decimals)

**Token Account** — holds a balance of one specific token for one specific owner. Contains:
- `mint`: which token this account holds
- `owner`: who controls this account
- `amount`: token balance
- `state`: normal / frozen / closed

**Associated Token Account (ATA)** — a token account at a deterministic address derived from `[owner, token_program, mint]`. This is the standard way to find someone's token account.

### Token-2022: The New Standard

Token-2022 (also called Token Extensions) is the upgraded token program with additional features:
- Transfer fees (protocol can take a cut of every transfer)
- Interest-bearing tokens (balance increases over time)
- Non-transferable tokens (soulbound)
- Confidential transfers (privacy)
- Permanent delegate (protocol can always transfer tokens)

Most new tokens use Token-2022. The original Token Program still works and is widely used (USDC, SOL wrapped, etc.).

### Creating a Token: The Steps

```
1. Create a Mint account (System Program creates it, Token Program initializes it)
2. Set mint authority (who can mint)
3. Create token accounts for holders (ATA is standard)
4. Mint tokens to accounts
5. Transfer between accounts
```

---

## Code Walkthrough

**Creating and managing tokens in TypeScript:**

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getMint,
  getAccount,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// ── Create a New Token ─────────────────────────────────────────────────────

async function createToken(
  payer: Keypair,
  decimals: number = 9,
  mintAuthority: PublicKey = payer.publicKey,
  freezeAuthority: PublicKey | null = null
): Promise<PublicKey> {
  // Generate a new keypair for the mint account
  const mintKeypair = Keypair.generate();

  // Calculate rent-exempt minimum for a mint account
  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    // 1. Create the account (System Program)
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    // 2. Initialize it as a mint (Token Program)
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      mintAuthority,
      freezeAuthority,
      TOKEN_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
  console.log("Mint created:", mintKeypair.publicKey.toBase58());
  return mintKeypair.publicKey;
}

// ── Get or Create Associated Token Account ─────────────────────────────────

async function ensureTokenAccount(
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  // getOrCreateAssociatedTokenAccount handles the "does it exist?" check
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,       // fee payer for account creation
    mint,
    owner
  );

  console.log("Token account:", tokenAccount.address.toBase58());
  return tokenAccount.address;
}

// ── Mint Tokens ────────────────────────────────────────────────────────────

async function mintTokens(
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  mintAuthority: Keypair,
  amount: bigint,
  decimals: number
) {
  // amount is in raw units (multiply by 10^decimals for "whole" tokens)
  const rawAmount = amount * BigInt(10 ** decimals);

  const tx = new Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      mintAuthority.publicKey,
      rawAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintAuthority]);
  console.log(`Minted ${amount} tokens. Tx: ${sig}`);
}

// ── Transfer Tokens ────────────────────────────────────────────────────────

async function transferTokens(
  payer: Keypair,
  mint: PublicKey,
  sender: Keypair,
  recipient: PublicKey,
  amount: bigint,
  decimals: number
) {
  const senderATA = getAssociatedTokenAddressSync(mint, sender.publicKey);
  const recipientATA = getAssociatedTokenAddressSync(mint, recipient);

  const tx = new Transaction();

  // Create recipient's ATA if it doesn't exist
  const recipientAccount = await connection.getAccountInfo(recipientATA);
  if (!recipientAccount) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,  // fee payer
        recipientATA,
        recipient,
        mint
      )
    );
  }

  // Add transfer instruction
  tx.add(
    createTransferInstruction(
      senderATA,
      recipientATA,
      sender.publicKey,
      amount * BigInt(10 ** decimals)
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, sender]);
  console.log(`Transferred ${amount} tokens. Tx: ${sig}`);
}

// ── Read Token Data ────────────────────────────────────────────────────────

async function getTokenInfo(mint: PublicKey, owner: PublicKey) {
  const mintInfo = await getMint(connection, mint);
  console.log("Total supply:", mintInfo.supply.toString());
  console.log("Decimals:", mintInfo.decimals);
  console.log("Mint authority:", mintInfo.mintAuthority?.toBase58());

  const ata = getAssociatedTokenAddressSync(mint, owner);
  const tokenAccount = await getAccount(connection, ata);
  console.log("Balance:", tokenAccount.amount.toString());
  console.log("Owner:", tokenAccount.owner.toBase58());
}
```

**Using SPL tokens in an Anchor program:**

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("TokenDemo111111111111111111111111111111111111");

#[program]
pub mod token_demo {
    use super::*;

    /// Deposit tokens into a protocol vault.
    /// Demonstrates: receiving tokens, creating ATAs, CPI to Token Program.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, TokenError::ZeroAmount);

        // CPI: transfer tokens from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update user's deposit record
        ctx.accounts.user_deposit.amount += amount;
        ctx.accounts.user_deposit.owner = ctx.accounts.user.key();

        emit!(Deposited {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    /// Withdraw tokens from the vault.
    /// Demonstrates: PDA signing for token transfer.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.user_deposit.amount >= amount,
            TokenError::InsufficientDeposit
        );

        // Seeds for signing as the vault PDA
        let mint_key = ctx.accounts.mint.key();
        let vault_seeds = &[
            b"vault",
            mint_key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&vault_seeds[..]];

        // CPI: transfer tokens from vault to user (vault PDA signs)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        ctx.accounts.user_deposit.amount -= amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Account<'info, Mint>,

    /// User's token account — must hold the tokens being deposited
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Vault token account — owned by vault PDA
    #[account(
        init_if_needed,
        payer = user,
        token::mint = mint,
        token::authority = vault,  // vault PDA is the authority
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's deposit record
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [b"deposit", user.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"deposit", user.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,

    /// CHECK: validated by has_one on user_deposit
    pub owner: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Deposited { pub user: Pubkey, pub amount: u64 }

#[error_code]
pub enum TokenError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient deposit balance")]
    InsufficientDeposit,
}
```

---

## Common Mistakes and Gotchas

**1. Sending tokens to a wallet address instead of a token account**  
You cannot send SPL tokens directly to a wallet address. You must send to the wallet's Associated Token Account (ATA). If the ATA doesn't exist, you must create it first (and pay rent). Always use `getOrCreateAssociatedTokenAccount` or check existence before transferring.

**2. Confusing Token Program and Token-2022 Program**  
They have different program IDs. If you create a mint with Token-2022 but try to use Token Program instructions on it, the transaction fails. Always use the correct program ID for the token you're working with.

**3. Not accounting for decimals**  
If a token has 9 decimals, "1 token" = 1,000,000,000 raw units. Always multiply by `10^decimals` when working with human-readable amounts. A common bug: transferring `1` instead of `1_000_000_000`, sending 0.000000001 tokens instead of 1.

**4. Forgetting that token accounts need rent**  
Creating a token account costs ~0.002 SOL in rent. If you're building a protocol that creates token accounts for users, you need to fund this. Either charge users or subsidize it from protocol fees.

**5. Not handling frozen token accounts**  
Token accounts can be frozen by the freeze authority. Transfers to/from frozen accounts fail. If your protocol interacts with tokens that have a freeze authority (like USDC), you need to handle `AccountFrozen` errors gracefully.

---

## How This Connects to Production

USDC on Solana is an SPL token — Circle manages the mint authority and can mint/burn USDC. Jupiter's swap aggregator creates temporary token accounts during swaps and closes them at the end to reclaim rent. Metaplex's NFTs are SPL tokens with supply=1 and no mint authority (so no more can be minted). Marinade's mSOL is an SPL token that represents staked SOL — the Marinade program mints mSOL when you stake and burns it when you unstake. Token-2022's transfer fee extension is used by protocols that want to take a cut of every token transfer — this is how some DeFi protocols implement protocol fees at the token level.

---

## What to Learn Next

- **Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data** — monitor token transfers and account changes in real-time.
- **Cross-Program Invocations (CPIs): How Solana Programs Call Each Other** — go deeper on the CPI patterns used for token operations.
- **Phantom Wallet Integration: Connecting Solana dApps to Users** — build the frontend that displays token balances and initiates transfers.
