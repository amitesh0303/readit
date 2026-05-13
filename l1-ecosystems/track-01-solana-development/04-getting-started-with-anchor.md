# Getting Started with Anchor: Your First Solana Program

**Track:** Beginner → Intermediate  
**Read time:** 13 min

---

## The Problem

You've decided to build on Solana. You open the raw Solana docs and immediately face hundreds of lines of boilerplate: manual account iteration, manual deserialization, manual error handling. Writing a simple counter takes 150 lines of raw Rust.

Anchor is the framework that makes Solana development approachable. It handles the boilerplate, provides a clean declarative syntax for account validation, generates TypeScript types automatically, and is used by virtually every serious Solana protocol. This blog gets you from zero to a deployed, tested Anchor program.

---

## Core Concepts

### What Anchor Does

Anchor provides:
- **`#[program]` macro** — marks your instruction handlers
- **`#[derive(Accounts)]`** — declarative account validation with constraints
- **`#[account]`** — serialization/deserialization of account data
- **`#[error_code]`** — typed error handling
- **IDL generation** — JSON interface description (like ABI for Solana)
- **TypeScript client generation** — type-safe client from IDL
- **Testing framework** — built-in test utilities

### Project Structure

```
my-program/
├── programs/
│   └── my-program/
│       ├── src/
│       │   └── lib.rs          ← your program code
│       └── Cargo.toml
├── tests/
│   └── my-program.ts           ← TypeScript tests
├── migrations/
│   └── deploy.ts               ← deployment script
├── Anchor.toml                 ← project config
└── package.json
```

### The Anchor Program Lifecycle

```
1. Write program (lib.rs)
2. Build: anchor build
   → Compiles to BPF bytecode
   → Generates IDL (target/idl/my_program.json)
   → Generates TypeScript types (target/types/my_program.ts)
3. Test: anchor test
   → Starts local validator
   → Deploys program
   → Runs TypeScript tests
4. Deploy: anchor deploy --provider.cluster devnet
```

### Account Constraints Reference

Anchor's constraint system is the most important thing to understand:

```rust
#[account(
    // Creation constraints
    init,                           // create this account
    payer = user,                   // who pays rent
    space = 8 + MyAccount::INIT_SPACE,  // account size

    // PDA constraints
    seeds = [b"seed", user.key().as_ref()],
    bump,                           // find and store bump

    // Mutation
    mut,                            // account will be modified

    // Ownership/relationship validation
    has_one = owner,                // account.owner == owner.key()
    constraint = x.amount > 0 @ MyError::ZeroAmount,  // custom constraint

    // Closing
    close = recipient,              // close account, send lamports to recipient

    // Token-specific
    token::mint = mint,             // token account's mint
    token::authority = authority,   // token account's authority

    // Address validation
    address = SOME_PUBKEY,          // must be this exact address
)]
pub my_account: Account<'info, MyAccount>,
```

---

## Code Walkthrough

A complete Anchor program: a simple on-chain todo list demonstrating all core patterns:

```rust
// programs/todo-list/src/lib.rs
use anchor_lang::prelude::*;

declare_id!("TodoProgram111111111111111111111111111111111");

#[program]
pub mod todo_list {
    use super::*;

    /// Initialize a user's todo list.
    /// Creates a UserList PDA that tracks the user's todos.
    pub fn initialize_list(ctx: Context<InitializeList>) -> Result<()> {
        let list = &mut ctx.accounts.user_list;
        list.owner = ctx.accounts.user.key();
        list.todo_count = 0;
        list.bump = ctx.bumps.user_list;
        msg!("Todo list initialized for {}", ctx.accounts.user.key());
        Ok(())
    }

    /// Add a new todo item.
    /// Creates a separate Todo PDA for each item.
    pub fn add_todo(
        ctx: Context<AddTodo>,
        title: String,
        description: String,
    ) -> Result<()> {
        require!(title.len() <= 50, TodoError::TitleTooLong);
        require!(description.len() <= 200, TodoError::DescriptionTooLong);

        let list = &mut ctx.accounts.user_list;
        let todo = &mut ctx.accounts.todo;

        todo.owner = ctx.accounts.user.key();
        todo.title = title;
        todo.description = description;
        todo.completed = false;
        todo.created_at = Clock::get()?.unix_timestamp;
        todo.index = list.todo_count;
        todo.bump = ctx.bumps.todo;

        list.todo_count += 1;

        emit!(TodoAdded {
            owner: ctx.accounts.user.key(),
            index: todo.index,
            title: todo.title.clone(),
        });

        Ok(())
    }

    /// Mark a todo as complete.
    pub fn complete_todo(ctx: Context<UpdateTodo>) -> Result<()> {
        let todo = &mut ctx.accounts.todo;
        require!(!todo.completed, TodoError::AlreadyCompleted);
        todo.completed = true;

        emit!(TodoCompleted {
            owner: ctx.accounts.user.key(),
            index: todo.index,
        });

        Ok(())
    }

    /// Delete a todo and reclaim rent.
    pub fn delete_todo(ctx: Context<DeleteTodo>) -> Result<()> {
        // Anchor's `close = user` handles the account closure
        // The todo_count is NOT decremented — indices are permanent
        emit!(TodoDeleted {
            owner: ctx.accounts.user.key(),
            index: ctx.accounts.todo.index,
        });
        Ok(())
    }
}

// ─── Account Validation Structs ────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeList<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserList::INIT_SPACE,
        seeds = [b"user_list", user.key().as_ref()],
        bump
    )]
    pub user_list: Account<'info, UserList>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(title: String, description: String)]
pub struct AddTodo<'info> {
    #[account(
        mut,
        seeds = [b"user_list", user.key().as_ref()],
        bump = user_list.bump,
        has_one = owner  // user_list.owner == user.key()
    )]
    pub user_list: Account<'info, UserList>,

    #[account(
        init,
        payer = user,
        space = 8 + TodoItem::INIT_SPACE,
        // Each todo has a unique PDA: [user, index]
        seeds = [
            b"todo",
            user.key().as_ref(),
            &user_list.todo_count.to_le_bytes()  // index = current count
        ],
        bump
    )]
    pub todo: Account<'info, TodoItem>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: validated by has_one constraint on user_list
    pub owner: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTodo<'info> {
    #[account(
        mut,
        has_one = owner,
        seeds = [b"todo", owner.key().as_ref(), &todo.index.to_le_bytes()],
        bump = todo.bump
    )]
    pub todo: Account<'info, TodoItem>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeleteTodo<'info> {
    #[account(
        mut,
        has_one = owner,
        close = owner,  // send rent back to owner
        seeds = [b"todo", owner.key().as_ref(), &todo.index.to_le_bytes()],
        bump = todo.bump
    )]
    pub todo: Account<'info, TodoItem>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

// ─── Account Data Structs ──────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct UserList {
    pub owner: Pubkey,      // 32
    pub todo_count: u64,    // 8
    pub bump: u8,           // 1
}

#[account]
#[derive(InitSpace)]
pub struct TodoItem {
    pub owner: Pubkey,          // 32
    #[max_len(50)]
    pub title: String,          // 4 + 50
    #[max_len(200)]
    pub description: String,    // 4 + 200
    pub completed: bool,        // 1
    pub created_at: i64,        // 8
    pub index: u64,             // 8
    pub bump: u8,               // 1
}

// ─── Events ────────────────────────────────────────────────────────────────

#[event]
pub struct TodoAdded {
    pub owner: Pubkey,
    pub index: u64,
    #[max_len(50)]
    pub title: String,
}

#[event]
pub struct TodoCompleted {
    pub owner: Pubkey,
    pub index: u64,
}

#[event]
pub struct TodoDeleted {
    pub owner: Pubkey,
    pub index: u64,
}

// ─── Errors ────────────────────────────────────────────────────────────────

#[error_code]
pub enum TodoError {
    #[msg("Title must be 50 characters or less")]
    TitleTooLong,
    #[msg("Description must be 200 characters or less")]
    DescriptionTooLong,
    #[msg("Todo is already completed")]
    AlreadyCompleted,
}
```

Complete TypeScript test suite:

```typescript
// tests/todo-list.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TodoList } from "../target/types/todo_list";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

describe("todo-list", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TodoList as Program<TodoList>;
  const user = provider.wallet.publicKey;

  // Derive PDAs
  const [userListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_list"), user.toBuffer()],
    program.programId
  );

  function getTodoPda(index: number): PublicKey {
    const indexBuffer = Buffer.alloc(8);
    indexBuffer.writeBigUInt64LE(BigInt(index));
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("todo"), user.toBuffer(), indexBuffer],
      program.programId
    );
    return pda;
  }

  it("initializes a user list", async () => {
    await program.methods
      .initializeList()
      .accounts({
        userList: userListPda,
        user,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const list = await program.account.userList.fetch(userListPda);
    expect(list.owner.toBase58()).to.equal(user.toBase58());
    expect(list.todoCount.toNumber()).to.equal(0);
  });

  it("adds a todo", async () => {
    const todoPda = getTodoPda(0);

    await program.methods
      .addTodo("Buy groceries", "Milk, eggs, bread")
      .accounts({
        userList: userListPda,
        todo: todoPda,
        user,
        owner: user,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const todo = await program.account.todoItem.fetch(todoPda);
    expect(todo.title).to.equal("Buy groceries");
    expect(todo.completed).to.equal(false);
    expect(todo.index.toNumber()).to.equal(0);

    const list = await program.account.userList.fetch(userListPda);
    expect(list.todoCount.toNumber()).to.equal(1);
  });

  it("completes a todo", async () => {
    const todoPda = getTodoPda(0);

    await program.methods
      .completeTodo()
      .accounts({ todo: todoPda, owner: user })
      .rpc();

    const todo = await program.account.todoItem.fetch(todoPda);
    expect(todo.completed).to.equal(true);
  });

  it("fails to complete an already-completed todo", async () => {
    const todoPda = getTodoPda(0);

    try {
      await program.methods
        .completeTodo()
        .accounts({ todo: todoPda, owner: user })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AlreadyCompleted");
    }
  });

  it("deletes a todo and reclaims rent", async () => {
    const todoPda = getTodoPda(0);
    const balanceBefore = await provider.connection.getBalance(user);

    await program.methods
      .deleteTodo()
      .accounts({ todo: todoPda, owner: user })
      .rpc();

    const balanceAfter = await provider.connection.getBalance(user);
    // Balance should increase (rent reclaimed minus tx fee)
    expect(balanceAfter).to.be.greaterThan(balanceBefore - 5000);

    // Account should no longer exist
    const accountInfo = await provider.connection.getAccountInfo(todoPda);
    expect(accountInfo).to.be.null;
  });
});
```

---

## Common Mistakes and Gotchas

**1. Forgetting `#[instruction(...)]` when using instruction args in constraints**  
If your account constraint uses an instruction argument (like `space = 8 + 4 + title.len()`), you must add `#[instruction(title: String)]` to the `Accounts` struct. Without it, Anchor can't access the argument in the constraint.

**2. Wrong space calculation**  
`8` bytes for the Anchor discriminator is always required. Then add the size of each field. Strings need `4 + max_len` (4 bytes for the length prefix). Vectors need `4 + element_size * max_elements`. Use `#[derive(InitSpace)]` with `#[max_len(n)]` to let Anchor calculate it automatically.

**3. Not using `msg!()` for debugging**  
Solana's equivalent of `console.log`. `msg!("Value: {}", my_value)` writes to the transaction log. Use it liberally during development — it's the primary debugging tool. View logs with `solana logs` or in the Anchor test output with `-vvv`.

**4. Anchor version mismatches**  
Anchor updates frequently and breaking changes are common. Make sure your `anchor-lang` version in `Cargo.toml`, `@coral-xyz/anchor` in `package.json`, and the Anchor CLI version all match. Check `anchor --version` and the Anchor changelog before upgrading.

**5. Not handling `AccountNotInitialized` errors**  
If you try to fetch an account that doesn't exist, you get `AccountNotInitialized`. Always check if an account exists before fetching it, especially for optional accounts or first-time users.

---

## How This Connects to Production

Anchor is used by virtually every major Solana protocol: Drift Protocol, Mango Markets, Marinade Finance, Orca, Raydium, and hundreds of others. The IDL it generates is the standard interface format — Solscan, Solana Explorer, and third-party tools all use IDLs to decode transactions. Anchor's account validation constraints have prevented entire classes of bugs that plagued early Solana programs (missing signer checks, wrong account ownership). The framework has become so standard that "Solana development" and "Anchor development" are nearly synonymous for application-layer programs.

---

## What to Learn Next

- **Cross-Program Invocations (CPIs): How Solana Programs Call Each Other** — compose your program with others.
- **Solana Transaction Anatomy: Instructions, Signers, and Compute Units** — understand what's happening under the hood.
- **Solana Token Program and SPL Tokens** — integrate token functionality into your program.
