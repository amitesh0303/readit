# Starknet vs Ethereum: What Works Differently

**Track:** Starknet Development
**Level:** Intermediate
**Read time:** 12 min

---

## The Problem

You're an Ethereum developer considering Starknet. Unlike EVM-compatible L2s where you can deploy existing Solidity contracts with minimal changes, Starknet requires a completely different mental model. The execution environment, account model, fee structure, and contract lifecycle are all different. You need to understand these differences before writing your first line of Cairo, or you'll waste time fighting assumptions that don't apply.

## Core Concepts

### Execution Environment Differences

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ethereum / EVM L2s                            │
├─────────────────────────────────────────────────────────────────┤
│  Language: Solidity / Vyper                                     │
│  VM: EVM (256-bit word size)                                    │
│  Native type: uint256 (2^256 - 1)                               │
│  Accounts: EOA (private key) + Smart Contracts                  │
│  Deploy: Single transaction (bytecode + constructor)            │
│  Storage: Key-value (256-bit slots)                             │
│  Gas: Single gas unit for execution + storage                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Starknet / Cairo VM                           │
├─────────────────────────────────────────────────────────────────┤
│  Language: Cairo                                                 │
│  VM: Cairo VM (252-bit field element)                           │
│  Native type: felt252 (prime field element, < 2^251 + 17*2^192) │
│  Accounts: ALL accounts are smart contracts (native AA)         │
│  Deploy: Two steps — declare class, then deploy instance        │
│  Storage: Key-value (felt252 slots, Pedersen hash addressing)   │
│  Gas: Separate computation + storage (L1 data) fees             │
└─────────────────────────────────────────────────────────────────┘
```

### The felt252 Type

The fundamental difference starts at the data type level. Ethereum uses `uint256`. Starknet uses `felt252` — a field element in a prime field:

```cairo
// Cairo — felt252 is the native type
// Range: 0 to P-1 where P = 2^251 + 17 * 2^192 + 1
fn demonstrate_felt() {
    let a: felt252 = 100;
    let b: felt252 = 200;
    let sum = a + b; // 300

    // Arithmetic is modular — overflow wraps around P
    // This is DIFFERENT from Solidity's checked arithmetic
    let max: felt252 = 3618502788666131213697322783095070105623107215331596699973092056135872020480;
    let overflow = max + 1; // Wraps to 0, no revert!
}

// For uint256 behavior, use the u256 type (two felt252s internally)
use core::integer::u256;

fn safe_arithmetic() {
    let a: u256 = 1000_u256;
    let b: u256 = 2000_u256;
    let sum = a + b; // Panics on overflow like Solidity 0.8+
}
```

### Contract Lifecycle: Declare vs Deploy

On Ethereum, deploying a contract uploads code and creates an instance in one transaction. On Starknet, it's two steps:

```shell
# Step 1: DECLARE — Upload the contract class (code) to the network
# This registers the Sierra bytecode and returns a class_hash
starkli declare target/dev/my_contract_MyContract.contract_class.json \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7

# Output: Class hash declared: 0x01a2b3c4...
```

```shell
# Step 2: DEPLOY — Create an instance of the declared class
# Multiple contracts can be deployed from the same class_hash
starkli deploy 0x01a2b3c4... \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  constructor_arg_1 constructor_arg_2

# Output: Contract deployed at address: 0x05e6f7a8...
```

```
Expected output (declare):
Declaring Cairo 1 class... 
Class hash declared:
  0x01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2

Expected output (deploy):
Deploying class 0x01a2b3c4... with salt 0x0...
Contract deployed:
  0x05e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6
```

This pattern enables:
- **Code reuse**: Deploy many instances of the same class without re-uploading code
- **Upgradability**: Replace the class hash a proxy points to
- **Cheaper deployments**: Only pay for code upload once

### Fee Structure

Starknet separates fees into two components:

```typescript
// Starknet fee calculation
interface StarknetFee {
  // Component 1: Computation (L2 execution)
  // Measured in Cairo steps + builtins used
  computationFee: {
    cairoSteps: number;      // Number of VM steps
    builtinsUsed: string[];  // pedersen, range_check, ecdsa, etc.
    gasPrice: bigint;        // Current L2 gas price (in STRK or ETH)
  };

  // Component 2: Data availability (L1 publication)
  // Measured in state diff size posted to Ethereum
  dataAvailabilityFee: {
    storageUpdates: number;  // Number of storage cells modified
    contractDeployments: number;
    l1GasPrice: bigint;      // Ethereum gas price affects this
  };

  // Total fee = computation + data availability
  // Paid in STRK (native token) or ETH
  totalFee: bigint;
}
```

Key difference from Ethereum: modifying storage is expensive because each changed cell must be posted to L1 as part of the state diff. Reading storage is cheap.

### Storage Model

```cairo
// Starknet storage uses a different addressing scheme
#[starknet::contract]
mod StorageExample {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        // Simple values — stored at pedersen(variable_name)
        balance: u256,
        owner: starknet::ContractAddress,

        // Mappings — stored at pedersen(key, pedersen(variable_name))
        // Different from Ethereum's keccak256(key . slot)
        balances: LegacyMap::<starknet::ContractAddress, u256>,

        // Nested mappings
        allowances: LegacyMap::<(starknet::ContractAddress, starknet::ContractAddress), u256>,
    }
}
```

### Transaction Types

Starknet has three transaction types (vs Ethereum's legacy/EIP-1559/EIP-4844):

```typescript
// Starknet transaction types
type StarknetTransaction =
  | DeclareTransaction    // Upload contract class
  | DeployAccountTransaction  // Deploy a new account contract
  | InvokeTransaction;    // Call a contract function (most common)

// There is NO equivalent of Ethereum's "simple ETH transfer"
// Transferring tokens always goes through a contract call
// because all accounts are smart contracts
```

### Events (Starknet Events vs Ethereum Logs)

```cairo
// Cairo events use a different structure than Solidity events
#[starknet::contract]
mod EventExample {
    use starknet::ContractAddress;

    // Events are defined as an enum with #[event] attribute
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    // Each variant is a struct with #[key] for indexed fields
    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]  // Equivalent to Solidity's "indexed"
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        spender: ContractAddress,
        value: u256,
    }
}
```

### No msg.value — Explicit Token Transfers

On Ethereum, you can send ETH with a function call via `msg.value`. On Starknet, there is no native value transfer in function calls. All token transfers (including STRK/ETH) go through explicit contract calls:

```cairo
// WRONG mental model (Ethereum):
// function deposit() external payable {
//     balances[msg.sender] += msg.value;
// }

// Starknet approach: explicit token transfer
#[starknet::interface]
trait IDeposit<TState> {
    fn deposit(ref self: TState, amount: u256);
}

#[starknet::contract]
mod DepositContract {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[storage]
    struct Storage {
        token: ContractAddress,
        balances: LegacyMap::<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl DepositImpl of super::IDeposit<ContractState> {
        fn deposit(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let this = get_contract_address();
            let token = IERC20Dispatcher { contract_address: self.token.read() };

            // User must approve this contract first
            // Then we pull tokens (no msg.value equivalent)
            token.transfer_from(caller, this, amount);
            self.balances.write(caller, self.balances.read(caller) + amount);
        }
    }
}
```

## Common Pitfalls

1. **Trying to use Solidity tools** — Hardhat, Foundry, Remix, and ethers.js do not work with Starknet. You need Scarb (build tool), starkli (CLI), and starknet.js or starknet.py for interaction. The entire toolchain is different.

2. **Assuming uint256 overflow behavior** — `felt252` arithmetic wraps modularly without reverting. If you need checked arithmetic, use `u256`, `u128`, or `u64` types which panic on overflow. Mixing felt252 and unsigned integers without understanding the difference causes subtle bugs.

3. **Forgetting the declare step** — If you try to deploy without first declaring the class, the transaction will fail. Always declare first, note the class hash, then deploy. This is the most common mistake for developers coming from Ethereum.

4. **Ignoring storage costs in fee estimation** — Because Starknet posts state diffs to L1, writing to many storage slots in one transaction can be expensive. Batch operations that modify hundreds of mappings will have high data availability fees regardless of computation cost.

## What to Learn Next

- [Bridging Assets on Starknet](./03-bridging-assets.md) — How to move ETH and tokens between L1 and Starknet
- [Starknet Documentation](https://docs.starknet.io/) — Official developer reference
- [Cairo Book](https://book.cairo-lang.org/) — Comprehensive Cairo language guide
- [Blockchain comparison: Ethereum vs Starknet](https://docs.starknet.io/architecture-and-concepts/network-architecture/starknet-state/) — Official architecture docs
