---
title: "Why I Started Learning Solana After a Year on Ethereum"
date: 2023-11-07
tags: [solana, ethereum, rust, anchor, learning]
---

I've been an Ethereum developer for about nine months. I know Solidity reasonably well. I understand the EVM, gas mechanics, storage layout, proxy patterns. I've shipped two contracts to mainnet. I was comfortable.

Then I started looking at Solana and felt like a complete beginner again.

That feeling is uncomfortable. It's also, I think, exactly where you want to be if you're trying to grow.

## Why Solana, why now

A few things pushed me in this direction.

First, the fee environment on Ethereum mainnet is still brutal for certain use cases. I've been thinking about building a trading protocol — something with frequent small transactions. On Ethereum mainnet, the gas costs would make it economically unviable for most users. On Solana, the same transaction costs a fraction of a cent.

Second, I kept seeing interesting technical work happening in the Solana ecosystem. Drift Protocol's perpetuals architecture, Jupiter's aggregation, the Geyser plugin system for real-time data streaming. These aren't just "cheaper Ethereum" — they're architecturally different in ways that enable different things.

Third, honestly, I was getting a bit comfortable on Ethereum. Learning Solana is forcing me to think about fundamentals again.

## The account model is the hardest part

I've been at this for about three weeks. The hardest thing by far is the account model.

On Ethereum, a contract owns its own storage. You write `uint256 public totalSupply` and that variable lives inside the contract. Simple.

On Solana, programs are stateless. All state lives in separate "accounts" that get passed to every instruction. The program just processes them.

This means:
- Before a user can interact with your program, you often need to create accounts for them (and pay rent)
- Every instruction must explicitly list all the accounts it will read or write
- The program validates that the accounts are what it expects

Here's the same "store a value" operation in both:

```solidity
// Ethereum — state lives in the contract
contract Counter {
    uint256 public count;
    function increment() external { count++; }
}
```

```rust
// Solana — state lives in a separate account
#[program]
pub mod counter {
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub counter: Account<'info, CounterAccount>,
    pub user: Signer<'info>,
}

#[account]
pub struct CounterAccount {
    pub count: u64,
}
```

The Solana version is more verbose, but the verbosity is doing something — it's making explicit exactly which accounts this instruction touches. That explicitness is what enables parallel execution.

## PDAs are the thing that finally made it click

Program Derived Addresses (PDAs) are how Solana programs own accounts without a private key. You derive an address from seeds + program ID, and only your program can sign for it.

This is the Solana equivalent of a contract holding ETH or tokens. On Ethereum, the contract has an address and can hold assets. On Solana, the program derives a PDA and creates an account at that address.

Once I understood PDAs, the whole account model made more sense. The escrow pattern, the vault pattern, the staking pattern — they all use PDAs as the "program-controlled" accounts.

```rust
// Derive a PDA for a user's vault
let (vault_pda, bump) = Pubkey::find_program_address(
    &[b"vault", user.key().as_ref()],
    program_id
);

// Only this program can sign for vault_pda
// No private key exists for it
```

## Rust is actually fine

I was worried about Rust. I'd heard it was hard. The borrow checker, lifetimes, ownership — these have a reputation.

With Anchor, you don't fight the borrow checker much. The framework handles most of the memory management. What you're mostly writing is business logic, account validation, and error handling.

The parts of Rust I've found genuinely useful:
- The type system catches a lot of bugs at compile time
- Pattern matching is expressive
- The `Result<T, E>` type makes error handling explicit

The parts that are still confusing:
- Lifetimes in complex scenarios
- The difference between `&str` and `String` (and when to use each)
- Trait bounds in generic functions

But for writing Anchor programs, you don't need to be a Rust expert. You need to understand the basics and know how to read error messages.

## What I'm building

I'm building a small token swap program as a learning project. Nothing that will compete with Jupiter — just something that forces me to understand CPIs (Cross-Program Invocations), token accounts, and the SPL Token Program.

The goal is to understand the primitives well enough that I could build something real on top of them. I'm not trying to ship a production Solana protocol in the next month. I'm trying to understand the architecture deeply enough that I could.

## The honest comparison

After three weeks with Solana, here's my honest take:

**Ethereum is better for:** composability with existing DeFi, developer tooling maturity, security tooling (Slither, Echidna, Foundry fuzzing), auditor availability, and anything where you need to compose with Uniswap/Aave/etc.

**Solana is better for:** high-frequency applications, anything where gas costs matter for UX, real-time data (Geyser is genuinely impressive), and applications that benefit from parallel execution.

They're not competing for the same use cases. The mistake is treating them as interchangeable.

I'm going to keep building on both. The mental model shift between them is making me a better developer on each.

---

*Next: I'll write about the specific Anchor patterns I've been learning — PDAs, CPIs, and the token program. The docs are decent but there are gaps that took me a while to fill in.*
