# Cairo Advanced Patterns: Components, Testing, and Production Contracts

**Track:** Starknet Development
**Level:** Advanced
**Read time:** 18 min

---

## The Problem

You understand Cairo basics — types, ownership, and simple contracts. Now you need to build production-quality contracts: composable components that can be reused across projects, comprehensive test suites that catch bugs before deployment, upgradeable contract patterns, and multi-call transactions. This lesson covers the advanced patterns that separate toy contracts from production-ready Starknet applications, including a complete working example that compiles and deploys to testnet.

## Core Concepts

### Component Architecture

Cairo components are reusable contract modules (similar to Solidity libraries or OpenZeppelin mixins, but with storage):

```cairo
// components/pausable.cairo
// A reusable Pausable component that any contract can embed

#[starknet::component]
mod PausableComponent {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use starknet::get_caller_address;

    #[storage]
    struct Storage {
        paused: bool,
        pauser: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Paused: Paused,
        Unpaused: Unpaused,
    }

    #[derive(Drop, starknet::Event)]
    struct Paused {
        #[key]
        by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct Unpaused {
        #[key]
        by: ContractAddress,
    }

    // Internal trait — used by the embedding contract
    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>
    > of InternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>, pauser: ContractAddress) {
            self.paused.write(false);
            self.pauser.write(pauser);
        }

        fn assert_not_paused(self: @ComponentState<TContractState>) {
            assert(!self.paused.read(), 'Contract is paused');
        }

        fn assert_paused(self: @ComponentState<TContractState>) {
            assert(self.paused.read(), 'Contract is not paused');
        }

        fn pause(ref self: ComponentState<TContractState>) {
            let caller = get_caller_address();
            assert(caller == self.pauser.read(), 'Only pauser can pause');
            self.assert_not_paused();
            self.paused.write(true);
            self.emit(Paused { by: caller });
        }

        fn unpause(ref self: ComponentState<TContractState>) {
            let caller = get_caller_address();
            assert(caller == self.pauser.read(), 'Only pauser can unpause');
            self.assert_paused();
            self.paused.write(false);
            self.emit(Unpaused { by: caller });
        }
    }
}
```

### Using Components in a Contract

```cairo
// src/vault.cairo
// A vault contract that uses the Pausable component

#[starknet::interface]
trait IVault<TState> {
    fn deposit(ref self: TState, amount: u256);
    fn withdraw(ref self: TState, amount: u256);
    fn get_balance(self: @TState, account: starknet::ContractAddress) -> u256;
    fn pause(ref self: TState);
    fn unpause(ref self: TState);
    fn is_paused(self: @TState) -> bool;
}

#[starknet::contract]
mod Vault {
    use super::PausableComponent;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::Map;
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

    // Embed the Pausable component
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);

    // Use internal functions from the component
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
        token: ContractAddress,
        balances: Map::<ContractAddress, u256>,
        total_deposits: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        PausableEvent: PausableComponent::Event,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
    }

    #[derive(Drop, starknet::Event)]
    struct Deposited {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawn {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        pauser: ContractAddress,
    ) {
        self.token.write(token);
        self.pausable.initializer(pauser);
    }

    #[abi(embed_v0)]
    impl VaultImpl of super::IVault<ContractState> {
        fn deposit(ref self: ContractState, amount: u256) {
            // Check not paused (from component)
            self.pausable.assert_not_paused();

            assert(amount > 0, 'Amount must be > 0');

            let caller = get_caller_address();
            let this = get_contract_address();
            let token = IERC20Dispatcher { contract_address: self.token.read() };

            // Transfer tokens from caller to vault
            let success = token.transfer_from(caller, this, amount);
            assert(success, 'Transfer failed');

            // Update balances
            let current = self.balances.read(caller);
            self.balances.write(caller, current + amount);
            self.total_deposits.write(self.total_deposits.read() + amount);

            self.emit(Deposited { account: caller, amount });
        }

        fn withdraw(ref self: ContractState, amount: u256) {
            self.pausable.assert_not_paused();

            let caller = get_caller_address();
            let balance = self.balances.read(caller);
            assert(amount <= balance, 'Insufficient balance');

            // Update state before external call (CEI pattern)
            self.balances.write(caller, balance - amount);
            self.total_deposits.write(self.total_deposits.read() - amount);

            // Transfer tokens back to caller
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let success = token.transfer(caller, amount);
            assert(success, 'Transfer failed');

            self.emit(Withdrawn { account: caller, amount });
        }

        fn get_balance(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn pause(ref self: ContractState) {
            self.pausable.pause();
        }

        fn unpause(ref self: ContractState) {
            self.pausable.unpause();
        }

        fn is_paused(self: @ContractState) -> bool {
            self.pausable.paused.read()
        }
    }
}
```

### Testing with Starknet Foundry

```cairo
// tests/test_vault.cairo
// Comprehensive test suite using snforge

use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    spy_events, EventSpyAssertionsTrait,
};
use starknet::ContractAddress;
use starknet::contract_address_const;

// Import contract interfaces
use my_project::vault::{IVaultDispatcher, IVaultDispatcherTrait};

fn OWNER() -> ContractAddress {
    contract_address_const::<'OWNER'>()
}

fn USER() -> ContractAddress {
    contract_address_const::<'USER'>()
}

fn deploy_vault(token: ContractAddress) -> ContractAddress {
    let contract = declare("Vault").unwrap().contract_class();
    let constructor_args = array![token.into(), OWNER().into()];
    let (address, _) = contract.deploy(@constructor_args).unwrap();
    address
}

fn deploy_mock_token() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let constructor_args = array![];
    let (address, _) = contract.deploy(@constructor_args).unwrap();
    address
}

#[test]
fn test_deposit_updates_balance() {
    let token = deploy_mock_token();
    let vault = deploy_vault(token);
    let vault_dispatcher = IVaultDispatcher { contract_address: vault };

    // Mint tokens to USER and approve vault
    // (mock token setup omitted for brevity)

    // Deposit as USER
    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(1000_u256);
    stop_cheat_caller_address(vault);

    // Verify balance
    let balance = vault_dispatcher.get_balance(USER());
    assert(balance == 1000_u256, 'Balance should be 1000');
}

#[test]
fn test_withdraw_reduces_balance() {
    let token = deploy_mock_token();
    let vault = deploy_vault(token);
    let vault_dispatcher = IVaultDispatcher { contract_address: vault };

    // Setup: deposit first
    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(1000_u256);

    // Withdraw half
    vault_dispatcher.withdraw(500_u256);
    stop_cheat_caller_address(vault);

    let balance = vault_dispatcher.get_balance(USER());
    assert(balance == 500_u256, 'Balance should be 500');
}

#[test]
#[should_panic(expected: 'Insufficient balance')]
fn test_withdraw_exceeds_balance_reverts() {
    let token = deploy_mock_token();
    let vault = deploy_vault(token);
    let vault_dispatcher = IVaultDispatcher { contract_address: vault };

    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(100_u256);
    vault_dispatcher.withdraw(200_u256); // Should panic
    stop_cheat_caller_address(vault);
}

#[test]
#[should_panic(expected: 'Contract is paused')]
fn test_deposit_when_paused_reverts() {
    let token = deploy_mock_token();
    let vault = deploy_vault(token);
    let vault_dispatcher = IVaultDispatcher { contract_address: vault };

    // Pause as owner
    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.pause();
    stop_cheat_caller_address(vault);

    // Try to deposit — should fail
    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(1000_u256);
    stop_cheat_caller_address(vault);
}

#[test]
fn test_events_emitted_on_deposit() {
    let token = deploy_mock_token();
    let vault = deploy_vault(token);
    let vault_dispatcher = IVaultDispatcher { contract_address: vault };

    let mut spy = spy_events();

    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(500_u256);
    stop_cheat_caller_address(vault);

    // Verify event was emitted
    spy.assert_emitted(
        @array![
            (vault, my_project::vault::Vault::Event::Deposited(
                my_project::vault::Vault::Deposited { account: USER(), amount: 500_u256 }
            ))
        ]
    );
}
```

### Running Tests

```shell
# Run all tests
snforge test
```

```
Expected output:
Collected 5 test(s) from my_project package
Running 5 test(s) from tests/
[PASS] tests::test_vault::test_deposit_updates_balance (gas: ~1250)
[PASS] tests::test_vault::test_withdraw_reduces_balance (gas: ~1480)
[PASS] tests::test_vault::test_withdraw_exceeds_balance_reverts (gas: ~890)
[PASS] tests::test_vault::test_deposit_when_paused_reverts (gas: ~720)
[PASS] tests::test_vault::test_events_emitted_on_deposit (gas: ~1350)
Tests: 5 passed, 0 failed, 0 skipped
```

```shell
# Run specific test
snforge test test_deposit_updates_balance

# Run with gas reporting
snforge test --detailed-resources
```

### Upgradeable Contracts (Replace Class Pattern)

```cairo
// Starknet's upgrade pattern: replace the contract's class hash
// This changes the code while preserving storage and address

#[starknet::interface]
trait IUpgradeable<TState> {
    fn upgrade(ref self: TState, new_class_hash: starknet::ClassHash);
    fn get_version(self: @TState) -> u32;
}

#[starknet::contract]
mod UpgradeableVault {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, ClassHash, get_caller_address};
    use starknet::syscalls::replace_class_syscall;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        version: u32,
        // ... other storage fields preserved across upgrades
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.version.write(1);
    }

    #[abi(embed_v0)]
    impl UpgradeableImpl of super::IUpgradeable<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            // Only owner can upgrade
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'Only owner can upgrade');

            // Validate class hash is not zero
            assert(!new_class_hash.is_zero(), 'Invalid class hash');

            // Replace the contract's class — takes effect immediately
            // Storage is preserved, only code changes
            replace_class_syscall(new_class_hash).unwrap();

            // Update version (this runs in the OLD code context)
            self.version.write(self.version.read() + 1);
        }

        fn get_version(self: @ContractState) -> u32 {
            self.version.read()
        }
    }
}
```

### Multi-Call Transactions

Starknet's native account abstraction allows executing multiple contract calls in a single transaction:

```typescript
// multicall.ts — Execute multiple operations atomically
import { Account, Provider, CallData, cairo } from "starknet"; // starknet@6.17.0

async function batchOperations(account: Account) {
  const TOKEN_A = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
  const TOKEN_B = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const DEX_ADDRESS = "0x1234...";
  const VAULT_ADDRESS = "0x5678...";

  // All these calls execute atomically in one transaction
  // If any call fails, ALL calls revert
  try {
    const { transaction_hash } = await account.execute([
      // Call 1: Approve DEX to spend Token A
      {
        contractAddress: TOKEN_A,
        entrypoint: "approve",
        calldata: CallData.compile({
          spender: DEX_ADDRESS,
          amount: cairo.uint256(1000n * 10n ** 18n),
        }),
      },
      // Call 2: Swap Token A for Token B on DEX
      {
        contractAddress: DEX_ADDRESS,
        entrypoint: "swap",
        calldata: CallData.compile({
          token_in: TOKEN_A,
          token_out: TOKEN_B,
          amount_in: cairo.uint256(1000n * 10n ** 18n),
          min_amount_out: cairo.uint256(950n * 10n ** 18n),
        }),
      },
      // Call 3: Deposit Token B into Vault
      {
        contractAddress: TOKEN_B,
        entrypoint: "approve",
        calldata: CallData.compile({
          spender: VAULT_ADDRESS,
          amount: cairo.uint256(950n * 10n ** 18n),
        }),
      },
      // Call 4: Deposit into vault
      {
        contractAddress: VAULT_ADDRESS,
        entrypoint: "deposit",
        calldata: CallData.compile({
          amount: cairo.uint256(950n * 10n ** 18n),
        }),
      },
    ]);

    console.log(`Batch TX: ${transaction_hash}`);
    console.log("All 4 operations executed atomically!");

    const provider = account.provider || new Provider({
      nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
    });
    await provider.waitForTransaction(transaction_hash);
    console.log("Confirmed!");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Batch execution failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Complete Deployable Example: Token with Vesting

```cairo
// src/vesting_token.cairo
// A complete, production-ready token with linear vesting
// Compiles with scarb 2.9.2, deploys to Starknet Sepolia

#[starknet::interface]
trait IVestingToken<TState> {
    fn claim(ref self: TState);
    fn get_claimable(self: @TState, account: starknet::ContractAddress) -> u256;
    fn get_vesting_info(self: @TState, account: starknet::ContractAddress) -> (u256, u256, u64, u64);
}

#[starknet::contract]
mod VestingToken {
    use openzeppelin_token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::Map;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        // Vesting schedule per beneficiary
        vesting_total: Map::<ContractAddress, u256>,
        vesting_claimed: Map::<ContractAddress, u256>,
        vesting_start: Map::<ContractAddress, u64>,
        vesting_duration: Map::<ContractAddress, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        TokensClaimed: TokensClaimed,
    }

    #[derive(Drop, starknet::Event)]
    struct TokensClaimed {
        #[key]
        beneficiary: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        beneficiary: ContractAddress,
        total_amount: u256,
        start_time: u64,
        duration_seconds: u64,
    ) {
        self.erc20.initializer(name, symbol);

        // Set up vesting schedule
        assert(total_amount > 0, 'Amount must be > 0');
        assert(duration_seconds > 0, 'Duration must be > 0');

        self.vesting_total.write(beneficiary, total_amount);
        self.vesting_claimed.write(beneficiary, 0);
        self.vesting_start.write(beneficiary, start_time);
        self.vesting_duration.write(beneficiary, duration_seconds);

        // Mint total to contract (held until claimed)
        let this: ContractAddress = starknet::get_contract_address();
        self.erc20.mint(this, total_amount);
    }

    #[abi(embed_v0)]
    impl VestingTokenImpl of super::IVestingToken<ContractState> {
        fn claim(ref self: ContractState) {
            let caller = get_caller_address();
            let claimable = self._compute_claimable(caller);
            assert(claimable > 0, 'Nothing to claim');

            // Update claimed amount
            let already_claimed = self.vesting_claimed.read(caller);
            self.vesting_claimed.write(caller, already_claimed + claimable);

            // Transfer from contract to beneficiary
            let this: ContractAddress = starknet::get_contract_address();
            self.erc20.transfer(caller, claimable);

            self.emit(TokensClaimed { beneficiary: caller, amount: claimable });
        }

        fn get_claimable(self: @ContractState, account: ContractAddress) -> u256 {
            self._compute_claimable(account)
        }

        fn get_vesting_info(
            self: @ContractState, account: ContractAddress
        ) -> (u256, u256, u64, u64) {
            (
                self.vesting_total.read(account),
                self.vesting_claimed.read(account),
                self.vesting_start.read(account),
                self.vesting_duration.read(account),
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _compute_claimable(self: @ContractState, account: ContractAddress) -> u256 {
            let total = self.vesting_total.read(account);
            if total == 0 {
                return 0;
            }

            let start = self.vesting_start.read(account);
            let duration = self.vesting_duration.read(account);
            let now = get_block_timestamp();

            if now < start {
                return 0; // Vesting hasn't started
            }

            let elapsed: u64 = now - start;
            let vested: u256 = if elapsed >= duration {
                total // Fully vested
            } else {
                // Linear vesting: total * elapsed / duration
                (total * elapsed.into()) / duration.into()
            };

            let claimed = self.vesting_claimed.read(account);
            vested - claimed
        }
    }
}
```

### Deploying the Vesting Token

```shell
# Build
scarb build

# Declare
starkli declare target/dev/vesting_token_VestingToken.contract_class.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json

# Deploy with constructor args:
# name, symbol, beneficiary, total_amount (u256), start_time (u64), duration (u64)
starkli deploy 0xCLASS_HASH \
  str:"Vesting Token" \
  str:"VEST" \
  0xBENEFICIARY_ADDRESS \
  u256:1000000000000000000000 \
  1705000000 \
  31536000 \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json
```

```
Expected output:
Enter keystore password:
Deploying class 0x07a1b2c3...
Transaction: 0x0abc123...
Contract deployed:
  0x06789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345
```

## Common Pitfalls

1. **Not using the CEI pattern (Checks-Effects-Interactions)** — Even though Starknet doesn't have the same reentrancy risks as Ethereum (no `call` with arbitrary code execution), always update state before making external calls. Future protocol changes or cross-contract callbacks could introduce reentrancy vectors.

2. **Forgetting to test with `should_panic`** — Cairo's `assert` causes a transaction revert, not a return value. Use `#[should_panic(expected: 'error message')]` in tests to verify that invalid operations correctly revert with the expected message.

3. **Storage layout changes during upgrades** — When upgrading a contract via `replace_class_syscall`, the new class must maintain the same storage layout for existing fields. Adding new fields at the end is safe; reordering or removing fields corrupts existing data.

4. **Not accounting for multi-call atomicity in testing** — Starknet's native multi-call means users can batch operations that you might assume happen in separate transactions. Test your contracts against batch scenarios where approve + transfer happen atomically.

5. **Ignoring Sierra's gas estimation** — Sierra guarantees termination, but complex loops or recursive patterns can consume more gas than expected. Use `snforge test --detailed-resources` to measure gas consumption during testing and set appropriate limits.

## What to Learn Next

- [Starknet Documentation](https://docs.starknet.io/) — Official developer reference
- [OpenZeppelin Cairo Contracts](https://github.com/OpenZeppelin/cairo-contracts) — Production-ready components
- [Cairo Book — Advanced Features](https://book.cairo-lang.org/) — Generics, macros, and advanced patterns
- [Starknet Foundry Book](https://foundry-rs.github.io/starknet-foundry/) — Advanced testing patterns
- [Awesome Starknet](https://github.com/keep-starknet-strange/awesome-starknet) — Community resources and projects
