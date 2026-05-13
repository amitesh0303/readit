# Sei: Architecture and Parallel Execution

**Track:** Sei Development
**Level:** Beginner
**Read time:** 11 min

---

## The Problem

You've heard Sei is the "fastest chain" with parallelized EVM execution, but you don't understand what that actually means for your contracts. How does Sei run EVM transactions in parallel when Ethereum processes them sequentially? What's the relationship between CosmWasm and EVM on Sei? How does optimistic parallelization work without breaking state consistency? This lesson breaks down Sei's architecture so you understand the execution model before writing your first contract.

---

## Core Concepts

### Sei V2: The Parallelized EVM

Sei V2 introduced a parallelized EVM that runs alongside CosmWasm, making it the first blockchain to offer both execution environments with shared state. The key innovation is **optimistic parallelization** — transactions execute concurrently by default and only re-execute sequentially when conflicts are detected.

```
┌─────────────────────────────────────────────────────┐
│                   Sei Network                        │
├─────────────────────────────────────────────────────┤
│              Consensus Layer (Twin-Turbo)            │
│  - Optimistic block processing                      │
│  - Intelligent block propagation                    │
│  - ~400ms block time                                │
├─────────────────────────────────────────────────────┤
│           Parallel Execution Engine                  │
│  ┌──────────────┐    ┌──────────────────┐          │
│  │   EVM        │    │   CosmWasm       │          │
│  │  (Solidity)  │◄──►│   (Rust/Wasm)    │          │
│  └──────────────┘    └──────────────────┘          │
│         │  Shared State via Pointer Contracts  │    │
├─────────────────────────────────────────────────────┤
│              Storage Layer (SeiDB)                   │
│  - Optimized state storage                          │
│  - Parallel read/write paths                        │
└─────────────────────────────────────────────────────┘
```

### Optimistic Parallelization

Traditional EVM chains (Ethereum, Arbitrum, etc.) execute transactions sequentially — one after another. Sei takes a different approach:

1. **Optimistic execution** — All transactions in a block execute in parallel across multiple threads
2. **Conflict detection** — The runtime tracks which storage slots each transaction reads and writes
3. **Re-execution** — If two transactions touch the same state, the conflicting one re-executes with updated state
4. **Deterministic ordering** — Final state is identical to sequential execution (same result, faster throughput)

```
Sequential execution (Ethereum):
TX1 → TX2 → TX3 → TX4 → TX5
Total time: 5 × avg_tx_time

Parallel execution (Sei):
Thread 1: TX1 → TX4
Thread 2: TX2 → TX5
Thread 3: TX3
Total time: ~2 × avg_tx_time (with no conflicts)

Conflict scenario:
Thread 1: TX1 (writes slot A)
Thread 2: TX2 (reads slot A) ← CONFLICT detected
→ TX2 re-executes with TX1's updated state
```

For developers, this means:
- Your Solidity contracts work without modification — parallelization is transparent
- Contracts that touch independent state (different users, different tokens) benefit most
- Contracts with heavy shared state (single global counter, AMM pools) see less parallelization benefit
- Gas costs are lower because throughput is higher (more transactions per block = lower per-tx cost)

### Twin-Turbo Consensus

Sei uses a modified Tendermint consensus called Twin-Turbo with two optimizations:

| Feature | Standard Tendermint | Sei Twin-Turbo |
|---------|-------------------|----------------|
| Block propagation | Full block broadcast | Intelligent propagation (only tx hashes) |
| Block processing | After consensus | Optimistic (during consensus) |
| Block time | 6-7 seconds | ~400 milliseconds |
| Finality | 1 block | 1 block (~400ms) |
| Throughput | ~100 TPS | ~12,500 TPS (theoretical) |

**Optimistic block processing** — Validators begin executing transactions as soon as a block is proposed, before consensus is finalized. If the block is accepted (which happens >99% of the time), execution is already complete. If rejected, the pre-execution is discarded.

**Intelligent block propagation** — Instead of broadcasting full transaction data, Sei propagates compact block proposals containing only transaction hashes. Validators already have the transactions in their mempool, so they reconstruct the block locally.

### Dual Execution Environments

Sei supports two smart contract runtimes that can interoperate:

| Feature | EVM (Solidity) | CosmWasm (Rust) |
|---------|---------------|-----------------|
| Language | Solidity | Rust (compiled to Wasm) |
| Compatibility | Ethereum tooling (Hardhat, Foundry, MetaMask) | Cosmos tooling (seid CLI, Keplr) |
| Gas model | EVM gas units | Cosmos gas units |
| Address format | 0x... (20 bytes) | sei1... (Bech32) |
| Token standard | ERC-20 | CW-20 |
| Best for | DeFi, existing Ethereum dApps | Custom logic, IBC interop |

The two environments share state through **pointer contracts** — automatically generated bridge contracts that allow EVM contracts to call CosmWasm contracts and vice versa:

```solidity
// EVM contract calling a CosmWasm contract via pointer
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISeiCosmWasmPrecompile {
    function execute(
        string memory contractAddress,
        bytes memory msg,
        bytes memory coins
    ) external payable returns (bytes memory);

    function query(
        string memory contractAddress,
        bytes memory req
    ) external view returns (bytes memory);
}

contract SeiInterop {
    // Sei precompile address for CosmWasm interop
    ISeiCosmWasmPrecompile constant COSMWASM = ISeiCosmWasmPrecompile(
        0x0000000000000000000000000000000000001002
    );

    function queryCosmWasmContract(
        string calldata cosmwasmAddr,
        string calldata queryMsg
    ) external view returns (bytes memory) {
        bytes memory response = COSMWASM.query(
            cosmwasmAddr,
            bytes(queryMsg)
        );
        return response;
    }
}
```

### SeiDB: Optimized Storage

Sei uses a custom storage layer (SeiDB) designed for parallel access:

- **Write-ahead log** — Parallel transactions write to separate buffers, merged after conflict resolution
- **State separation** — Hot state (frequently accessed) is kept in memory; cold state on disk
- **Pruning** — Aggressive state pruning reduces disk I/O for validators
- **Archive nodes** — Full historical state available on dedicated archive nodes

### Network Parameters

| Parameter | Value |
|-----------|-------|
| Block time | ~400 ms |
| Finality | Single-slot (~400 ms) |
| Theoretical TPS | ~12,500 |
| Practical TPS | ~5,000 (mainnet observed) |
| Native token | SEI |
| Token decimals | 6 (1 SEI = 10^6 usei) |
| EVM chain ID | 1329 (mainnet), 1328 (testnet) |
| Consensus | Twin-Turbo (modified Tendermint) |
| Validator set | ~40 active validators |
| Staking | Delegated Proof of Stake |

### Address Interoperability

Sei has a unique address system where every account has both an EVM address and a Cosmos address:

```
EVM address:    0x7B4f352Cd40114f12e82fC675b5BA8C7582FC513
Cosmos address: sei1ld5ewfgc0gn5eqhp5n5ademnymaftxrfqmkp4v

Both addresses point to the SAME account.
Tokens sent to either address are accessible from both.
```

```typescript
// Converting between address formats using @sei-js/core@0.5.0
import { getEVMAddress, getSeiAddress } from "@sei-js/core";

// Cosmos → EVM
const evmAddr = getEVMAddress("sei1ld5ewfgc0gn5eqhp5n5ademnymaftxrfqmkp4v");
// "0x7B4f352Cd40114f12e82fC675b5BA8C7582FC513"

// EVM → Cosmos
const seiAddr = getSeiAddress("0x7B4f352Cd40114f12e82fC675b5BA8C7582FC513");
// "sei1ld5ewfgc0gn5eqhp5n5ademnymaftxrfqmkp4v"
```

---

## Common Pitfalls

1. **Assuming parallel execution means faster individual transactions** — Parallelization increases throughput (more transactions per block), not latency of a single transaction. Your contract call still takes ~400ms to finalize. The benefit is that the network handles thousands of concurrent users without congestion or gas spikes.

2. **Designing contracts with unnecessary shared state** — If every transaction writes to the same storage slot (e.g., a global counter), parallelization can't help — transactions will conflict and re-execute sequentially. Design contracts to minimize shared mutable state. Use per-user mappings instead of global accumulators where possible.

3. **Confusing EVM and Cosmos addresses** — Every Sei account has both an `0x...` EVM address and a `sei1...` Cosmos address. They reference the same balance. Sending SEI to either address credits the same account. But using the wrong format in contract calls will fail — EVM contracts expect `0x` addresses, CosmWasm contracts expect `sei1` addresses.

4. **Expecting Ethereum gas prices** — While Sei has higher throughput, gas is priced in `usei` not `gwei`. The gas model differs from Ethereum. Don't copy gas estimation logic from Ethereum dApps — use Sei-specific RPC methods (`eth_estimateGas` works but returns Sei gas units).

5. **Ignoring CosmWasm for IBC use cases** — If your dApp needs cross-chain communication via IBC (Cosmos Inter-Blockchain Communication), you must use CosmWasm contracts. EVM contracts on Sei cannot directly send IBC packets. Use pointer contracts to bridge EVM logic to CosmWasm for IBC operations.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install seid CLI, configure wallets, and connect to Sei testnet
- [Sei Documentation](https://www.docs.sei.io/) — Official documentation and developer guides
- [Sei GitHub](https://github.com/sei-protocol/sei-chain) — Source code and protocol specifications
