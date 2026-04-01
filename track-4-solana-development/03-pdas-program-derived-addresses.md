# What are PDAs (Program Derived Addresses)? Solana's Most Important Concept

**Track:** Intermediate  
**Read time:** 13 min

---

## The Problem

You're reading Solana code and you see `findProgramAddress`, `seeds`, `bump` everywhere. You know PDAs are important but the explanations you've found are either too abstract ("it's a deterministic address") or too low-level (elliptic curve math). Neither helps you understand when to use them, how to design your seed structure, or why they're the foundation of almost every Solana program.

PDAs are the Solana equivalent of contract storage — they're how programs store and own data. Get this concept wrong and your program architecture will be fundamentally broken. This blog explains PDAs from first principles with real design patterns.

---

## Core Concepts

### What a PDA Is

A PDA (Program Derived Address) is an account address that:
1. Is derived deterministically from a set of seeds + a program ID
2. Does NOT have a corresponding private key
3. Can only be "signed for" by the program that derived it

```
Normal Solana address:
- Generated from a keypair (public key + private key)
- Anyone with the private key can sign transactions

PDA:
- Derived from: hash(seeds + program_id + bump)
- No private key exists
- Only the program can authorize actions on it
```

The "bump" is a nonce (0-255) that ensures the derived address falls off the ed25519 curve — meaning no private key can exist for it. `findProgramAddressSync` tries bump=255, then 254, etc., until it finds one that produces a valid off-curve address.

### Why PDAs Exist

PDAs solve a fundamental problem: how can a program own and control accounts without a private key?

In Ethereum, a contract can hold ETH and tokens because the contract itself is an account with an address. In Solana, programs are stateless — they can't hold tokens or data directly. PDAs give programs a way to "own" accounts:

```
Program wants to hold user funds in escrow:

Without PDAs:
- Program can't sign transactions (no private key)
- Can't create or control accounts
- Can't hold tokens

With PDAs:
- Program derives a PDA: hash(["escrow", user.key, program_id, bump])
- Program creates an account at that PDA address
- Program is the "signer" for that PDA (via CPI with seeds)
- Program can transfer tokens from the PDA account
```

### The Seed Design Pattern

Seeds are the inputs to the PDA derivation. Good seed design is critical for your program's architecture.

**Single-instance PDA** (one per program):
```rust
seeds = [b"config"]  // global config account
```

**Per-user PDA** (one per user):
```rust
seeds = [b"user_profile", user.key().as_ref()]
```

**Per-user-per-token PDA** (one per user per token):
```rust
seeds = [b"vault", user.key().as_ref(), mint.key().as_ref()]
```

**Per-order PDA** (one per order):
```rust
seeds = [b"order", user.key().as_ref(), order_id.to_le_bytes().as_ref()]
```

**Nested relationship PDA**:
```rust
seeds = [b"position", market.key().as_ref(), user.key().as_ref()]
```

The seeds encode the "identity" of the account. Anyone who knows the seeds and program ID can derive the address — this is the key property that makes PDAs useful for lookups.

### PDAs as Program Signers (CPI)

The most powerful use of PDAs: a program can sign transactions on behalf of a PDA it derived. This is how programs transfer tokens, create accounts, and interact with other programs without a private key.

```rust
// Program signs for a PDA during a CPI (Cross-Program Invocation)
let seeds = &[
    b"vault",
    user.key().as_ref(),
    &[ctx.accounts.vault.bump],  // bump must match the derived bump
];
let signer_seeds = &[&seeds[..]];

// Transfer tokens FROM the vault PDA (program signs for it)
token::transfer(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(), // PDA is the authority
        },
        signer_seeds,  // program provides seeds to "sign" for the PDA
    ),
    amount,
)?;
```

---

## Code Walkthrough

A complete escrow program demonstrating PDAs as program-controlled vaults:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("EscrowProgram1111111111111111111111111111111");

#[program]
pub mod escrow {
    use super::*;

    /// Create an escrow: deposit tokens that can only be released
    /// when the counterparty fulfills their side.
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        amount: u64,
        expected_amount: u64,  // what the maker expects in return
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        escrow.maker = ctx.accounts.maker.key();
        escrow.maker_mint = ctx.accounts.maker_mint.key();
        escrow.taker_mint = ctx.accounts.taker_mint.key();
        escrow.amount = amount;
        escrow.expected_amount = expected_amount;
        escrow.bump = ctx.bumps.escrow_state;

        // Transfer tokens from maker to the vault PDA
        // The vault is a token account owned by the escrow_state PDA
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.maker_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.maker.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    /// Taker accepts the escrow: sends their tokens, receives maker's tokens.
    pub fn accept_escrow(ctx: Context<AcceptEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow_state;

        // Seeds for signing as the escrow_state PDA
        let seeds = &[
            b"escrow",
            escrow.maker.as_ref(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // 1. Transfer taker's tokens to maker
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.taker_token_account.to_account_info(),
                    to: ctx.accounts.maker_receive_account.to_account_info(),
                    authority: ctx.accounts.taker.to_account_info(),
                },
            ),
            escrow.expected_amount,
        )?;

        // 2. Transfer maker's tokens from vault to taker
        // The escrow_state PDA is the vault's authority — program signs for it
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.taker_receive_account.to_account_info(),
                    authority: ctx.accounts.escrow_state.to_account_info(),
                },
                signer_seeds,  // program signs for the PDA
            ),
            escrow.amount,
        )?;

        Ok(())
    }

    /// Maker cancels the escrow and reclaims their tokens.
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow_state;
        let seeds = &[b"escrow", escrow.maker.as_ref(), &[escrow.bump]];
        let signer_seeds = &[&seeds[..]];

        // Return tokens from vault to maker
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.maker_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_state.to_account_info(),
                },
                signer_seeds,
            ),
            escrow.amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    /// The escrow state PDA — stores escrow metadata
    /// Seeds: ["escrow", maker.key()] — one escrow per maker (simplified)
    #[account(
        init,
        payer = maker,
        space = 8 + EscrowState::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref()],
        bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// The vault token account — owned by escrow_state PDA
    /// This is where maker's tokens are held during escrow
    #[account(
        init,
        payer = maker,
        token::mint = maker_mint,
        token::authority = escrow_state,  // PDA is the authority
    )]
    pub vault: Account<'info, TokenAccount>,

    pub maker_mint: Account<'info, anchor_spl::token::Mint>,
    pub taker_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        mut,
        constraint = maker_token_account.owner == maker.key(),
        constraint = maker_token_account.mint == maker_mint.key()
    )]
    pub maker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptEscrow<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_state.maker.as_ref()],
        bump = escrow_state.bump,
        // close = maker reclaims rent when escrow is complete
        close = maker
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// CHECK: validated by escrow_state.maker
    #[account(mut, address = escrow_state.maker)]
    pub maker: AccountInfo<'info>,

    #[account(
        mut,
        constraint = vault.mint == escrow_state.maker_mint,
        constraint = vault.owner == escrow_state.key()
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = taker_token_account.owner == taker.key())]
    pub taker_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = taker_receive_account.owner == taker.key())]
    pub taker_receive_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub maker_receive_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", maker.key().as_ref()],
        bump = escrow_state.bump,
        has_one = maker,
        close = maker
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(mut, constraint = vault.owner == escrow_state.key())]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = maker_token_account.owner == maker.key())]
    pub maker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowState {
    pub maker: Pubkey,
    pub maker_mint: Pubkey,
    pub taker_mint: Pubkey,
    pub amount: u64,
    pub expected_amount: u64,
    pub bump: u8,
}
```

TypeScript: deriving and using PDAs:

```typescript
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

// Derive a PDA off-chain (same result as on-chain findProgramAddress)
function deriveEscrowPDA(
  makerPublicKey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), makerPublicKey.toBuffer()],
    programId
  );
}

async function createEscrow(
  program: anchor.Program<any>,
  makerTokenAccount: PublicKey,
  makerMint: PublicKey,
  takerMint: PublicKey,
  amount: bigint,
  expectedAmount: bigint
) {
  const maker = (program.provider as anchor.AnchorProvider).wallet.publicKey;

  // Derive the escrow state PDA
  const [escrowStatePda] = deriveEscrowPDA(maker, program.programId);

  // Derive the vault token account (owned by escrow state PDA)
  // This is a regular token account, not a PDA — but its authority is the PDA
  const vaultKeypair = anchor.web3.Keypair.generate();

  await program.methods
    .createEscrow(new anchor.BN(amount.toString()), new anchor.BN(expectedAmount.toString()))
    .accounts({
      maker,
      escrowState: escrowStatePda,
      vault: vaultKeypair.publicKey,
      makerMint,
      takerMint,
      makerTokenAccount,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([vaultKeypair])
    .rpc();

  console.log("Escrow created at:", escrowStatePda.toBase58());
  return escrowStatePda;
}
```

---

## Common Mistakes and Gotchas

**1. Not storing the bump in the account**  
The bump is needed every time you sign for the PDA. If you don't store it in the account data, you have to call `findProgramAddress` again (which is expensive on-chain). Always store the bump: `escrow.bump = ctx.bumps.escrow_state`.

**2. Using the wrong seeds when signing**  
If your seeds at account creation were `[b"escrow", maker.key()]`, your signing seeds must be exactly the same. A common mistake: using `user.key()` in one place and `maker.key()` in another when they refer to the same account. The seeds must match exactly.

**3. Seed collision**  
If two different logical accounts use the same seeds, they'll derive the same PDA — one will overwrite the other. Design seeds to be unique for each logical entity. Include enough context: `[b"order", market.key(), user.key(), order_id]` is better than just `[b"order", order_id]`.

**4. Not validating PDA ownership in account constraints**  
When you receive a PDA account as input, validate that it was derived with the expected seeds. Anchor's `seeds` constraint does this automatically. Without it, an attacker could pass a different account at the same address.

**5. Trying to use a PDA as a signer without `new_with_signer`**  
PDAs can only sign in CPIs (Cross-Program Invocations) using `CpiContext::new_with_signer`. You can't use a PDA as a signer in a regular instruction — only the program that derived it can authorize actions on its behalf.

---

## How This Connects to Production

Jupiter's swap aggregator uses PDAs to track user positions and fee accounts. Drift Protocol uses PDAs for every user's margin account, position account, and order account — the deterministic addressing means the frontend can compute all account addresses without querying the chain. Metaplex's NFT metadata is stored in a PDA derived from the mint address — `[b"metadata", metadata_program_id, mint_address]`. This is why any program can find an NFT's metadata without being told the address. Serum's order book uses PDAs for open order accounts. PDAs are the fundamental building block of Solana program architecture — every non-trivial program uses them extensively.

---

## What to Learn Next

- **Getting Started with Anchor: Your First Solana Program** — build a complete program using PDAs.
- **Cross-Program Invocations (CPIs): How Solana Programs Call Each Other** — learn how programs sign for PDAs in CPIs.
- **Solana Token Program and SPL Tokens** — see how PDAs are used in the token program.
