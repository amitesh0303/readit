# Cross-Program Invocations (CPIs): How Solana Programs Call Each Other

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You're building a DeFi protocol on Solana. Your program needs to transfer SPL tokens, create token accounts, and interact with other protocols. In Ethereum, you just call `IERC20(token).transfer(to, amount)` — it's a regular function call. On Solana, calling another program requires a Cross-Program Invocation (CPI), and getting it wrong causes cryptic errors or security vulnerabilities.

CPIs are how Solana programs compose. Understanding them is essential for building anything beyond a toy program. This blog covers the full CPI mechanics, the security model, and the PDA signing pattern that makes trustless program-to-program interactions possible.

---

## Core Concepts

### What a CPI Is

A CPI is when one Solana program calls an instruction on another program during transaction execution. It's the Solana equivalent of an external contract call in Ethereum.

```
Transaction
    ↓
Your Program (instruction handler)
    ↓  CPI
Token Program (transfer instruction)
    ↓  CPI
System Program (create account)
```

CPIs can be nested up to 4 levels deep. Each level can invoke another program.

### The CPI Security Model

CPIs have important security properties:

**Privilege escalation prevention**: A CPI cannot grant more privileges than the calling program has. If your program doesn't have authority over an account, it can't grant that authority to a CPI.

**PDA signing**: A program can sign for PDAs it derived. When you do a CPI with `new_with_signer`, you provide the seeds that prove you derived the PDA. The runtime verifies this.

**Account passing**: All accounts needed by the callee must be passed through the CPI. You can't access accounts that weren't in the original transaction.

### CPI vs Ethereum External Calls

```
Ethereum:
contract MyProtocol {
    function swap(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        // ^ direct call, no special syntax
    }
}

Solana:
pub fn swap(ctx: Context<Swap>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    // ^ explicit CPI with all accounts listed
    Ok(())
}
```

The key difference: in Solana, you must explicitly pass all accounts to the CPI. The callee can only access accounts you provide.

### Two Types of CPIs

**`CpiContext::new`** — for CPIs where the authority is a regular signer (user's wallet):
```rust
token::transfer(
    CpiContext::new(token_program, transfer_accounts),
    amount,
)?;
```

**`CpiContext::new_with_signer`** — for CPIs where the authority is a PDA (program signs):
```rust
token::transfer(
    CpiContext::new_with_signer(
        token_program,
        transfer_accounts,
        signer_seeds,  // proves program derived the PDA
    ),
    amount,
)?;
```

---

## Code Walkthrough

A staking program that uses CPIs to interact with the Token Program:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};

declare_id!("StakingProgram111111111111111111111111111111");

#[program]
pub mod staking {
    use super::*;

    /// Initialize the staking pool.
    /// Creates a vault PDA to hold staked tokens.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        reward_rate: u64,  // reward tokens per second per staked token (scaled by 1e9)
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.staking_mint = ctx.accounts.staking_mint.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.reward_rate = reward_rate;
        pool.total_staked = 0;
        pool.reward_per_token_stored = 0;
        pool.last_update_time = Clock::get()?.unix_timestamp;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Stake tokens: transfer from user to vault, mint receipt tokens.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);

        // Update reward state before changing balances
        _update_rewards(&mut ctx.accounts.pool, Some(&mut ctx.accounts.user_state))?;

        // CPI 1: Transfer staking tokens from user to vault
        // User is the authority — regular CPI (no PDA signing)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_staking_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update state
        ctx.accounts.pool.total_staked += amount;
        ctx.accounts.user_state.staked_amount += amount;

        emit!(Staked {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    /// Unstake tokens: burn receipt tokens, transfer staking tokens back.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        require!(
            ctx.accounts.user_state.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        // Update reward state
        _update_rewards(&mut ctx.accounts.pool, Some(&mut ctx.accounts.user_state))?;

        // Seeds for signing as the vault PDA
        let pool_key = ctx.accounts.pool.key();
        let vault_seeds = &[
            b"vault",
            pool_key.as_ref(),
            &[ctx.accounts.pool.vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];

        // CPI 2: Transfer staking tokens from vault back to user
        // Vault PDA is the authority — use new_with_signer
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_staking_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        ctx.accounts.pool.total_staked -= amount;
        ctx.accounts.user_state.staked_amount -= amount;

        emit!(Unstaked {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    /// Claim accumulated rewards.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        // Update reward state
        _update_rewards(&mut ctx.accounts.pool, Some(&mut ctx.accounts.user_state))?;

        let pending = ctx.accounts.user_state.pending_rewards;
        require!(pending > 0, StakingError::NoRewards);

        ctx.accounts.user_state.pending_rewards = 0;

        // Seeds for signing as the pool PDA (reward mint authority)
        let pool_seeds = &[
            b"pool",
            ctx.accounts.pool.staking_mint.as_ref(),
            &[ctx.accounts.pool.bump],
        ];
        let signer_seeds = &[&pool_seeds[..]];

        // CPI 3: Mint reward tokens to user
        // Pool PDA is the mint authority — use new_with_signer
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.user_reward_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            pending,
        )?;

        emit!(RewardsClaimed {
            user: ctx.accounts.user.key(),
            amount: pending,
        });

        Ok(())
    }
}

// ─── Helper Functions ──────────────────────────────────────────────────────

fn _update_rewards(pool: &mut Pool, user_state: Option<&mut UserState>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let elapsed = (now - pool.last_update_time) as u64;

    if pool.total_staked > 0 && elapsed > 0 {
        // reward_per_token += reward_rate * elapsed / total_staked
        let new_rewards = pool.reward_rate
            .checked_mul(elapsed)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(pool.total_staked)
            .unwrap_or(0);
        pool.reward_per_token_stored = pool.reward_per_token_stored
            .checked_add(new_rewards)
            .ok_or(StakingError::MathOverflow)?;
    }

    pool.last_update_time = now;

    if let Some(state) = user_state {
        // pending += staked * (current_rpt - user_rpt_paid)
        let earned = state.staked_amount
            .checked_mul(
                pool.reward_per_token_stored
                    .saturating_sub(state.reward_per_token_paid)
            )
            .unwrap_or(0)
            .checked_div(1_000_000_000) // scale factor
            .unwrap_or(0);

        state.pending_rewards = state.pending_rewards
            .checked_add(earned)
            .ok_or(StakingError::MathOverflow)?;
        state.reward_per_token_paid = pool.reward_per_token_stored;
    }

    Ok(())
}

// ─── Account Structs ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init, payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", staking_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init, payer = authority,
        token::mint = staking_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    pub staking_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"pool", pool.staking_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [b"user_state", pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,

    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump = pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = user_staking_account.owner == user.key())]
    pub user_staking_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"pool", pool.staking_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"user_state", pool.key().as_ref(), user.key().as_ref()], bump)]
    pub user_state: Account<'info, UserState>,
    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump = pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_staking_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, seeds = [b"pool", pool.staking_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"user_state", pool.key().as_ref(), user.key().as_ref()], bump)]
    pub user_state: Account<'info, UserState>,
    #[account(mut, address = pool.reward_mint)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_reward_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ─── Data Structs ──────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub staking_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_rate: u64,
    pub total_staked: u64,
    pub reward_per_token_stored: u64,
    pub last_update_time: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserState {
    pub staked_amount: u64,
    pub reward_per_token_paid: u64,
    pub pending_rewards: u64,
}

#[event]
pub struct Staked { pub user: Pubkey, pub amount: u64 }
#[event]
pub struct Unstaked { pub user: Pubkey, pub amount: u64 }
#[event]
pub struct RewardsClaimed { pub user: Pubkey, pub amount: u64 }

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    #[msg("No rewards to claim")]
    NoRewards,
    #[msg("Math overflow")]
    MathOverflow,
}
```

---

## Common Mistakes and Gotchas

**1. Passing the wrong account as CPI authority**  
The `authority` in a CPI must be the account that has signing authority over the `from` account. For user-owned token accounts, it's the user's wallet. For PDA-owned token accounts, it's the PDA. Getting this wrong causes `PrivilegeEscalation` errors.

**2. Forgetting to include the program account in CPI accounts**  
Every CPI needs the target program's account info. `ctx.accounts.token_program.to_account_info()` is the first argument to `CpiContext::new`. If you forget it, the CPI fails.

**3. Wrong signer seeds in `new_with_signer`**  
The seeds must exactly match what was used to derive the PDA. Include the bump: `&[b"vault", pool_key.as_ref(), &[vault_bump]]`. A common mistake is forgetting the bump or using the wrong bump.

**4. Not handling CPI errors**  
CPI calls return `Result<()>`. Always use `?` to propagate errors. If a CPI fails (e.g., insufficient token balance), your instruction should fail too. Don't ignore CPI errors.

**5. Exceeding compute unit limits with nested CPIs**  
Each CPI level adds overhead. Complex programs with multiple nested CPIs can hit the 200,000 CU default limit. Use `ComputeBudgetProgram.setComputeUnitLimit` in your transaction to request more CUs when needed.

---

## How This Connects to Production

Jupiter's swap aggregator uses CPIs to call multiple DEX programs (Orca, Raydium, Meteora) in a single transaction — routing through the best path. Marinade Finance uses CPIs to interact with the Stake Program when users stake SOL. Drift Protocol uses CPIs to interact with the Token Program for margin deposits and withdrawals. Every Solana DeFi protocol is a composition of CPIs — your program calls the Token Program, which might call the System Program, all within a single atomic transaction. The CPI model is what makes Solana's composability possible despite programs being stateless.

---

## What to Learn Next

- **Solana Transaction Anatomy: Instructions, Signers, and Compute Units** — understand the full transaction structure that CPIs operate within.
- **Solana Token Program and SPL Tokens** — the most common CPI target.
- **Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic** — build off-chain systems that trigger on-chain CPIs.
