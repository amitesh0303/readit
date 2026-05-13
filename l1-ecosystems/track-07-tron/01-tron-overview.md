# Tron: Architecture and Core Concepts

**Track:** Tron Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You've seen Tron handles billions in USDT transfers daily and has some of the lowest fees in crypto, but you don't understand how it actually works under the hood. DPoS, Super Representatives, energy, bandwidth, the 3-layer architecture — these terms get thrown around without explaining how they affect the contracts you write. This lesson breaks down Tron's architecture so you understand the resource model before deploying your first contract.

---

## Core Concepts

### Three-Layer Architecture

Tron's network is organized into three distinct layers:

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (dApps, TronWeb, wallets, APIs)        │
├─────────────────────────────────────────┤
│         Core Layer                      │
│  (Smart contracts, consensus, accounts) │
├─────────────────────────────────────────┤
│         Storage Layer                   │
│  (Block storage, state DB, LevelDB)     │
└─────────────────────────────────────────┘
```

1. **Storage Layer** — Handles block storage and state data using LevelDB and a graph database for complex queries. Blocks are produced every 3 seconds.

2. **Core Layer** — Manages consensus (DPoS), smart contract execution (TVM), and account management. The Tron Virtual Machine (TVM) is EVM-compatible, meaning Solidity contracts compile and run with minimal changes.

3. **Application Layer** — Exposes APIs (Full Node HTTP, Solidity Node, Event Server) for dApps to interact with the chain. TronWeb is the primary JavaScript SDK.

### Delegated Proof of Stake (DPoS)

Tron uses DPoS consensus with 27 Super Representatives (SRs) who produce blocks:

| Parameter | Value |
|-----------|-------|
| Block time | 3 seconds |
| Blocks per round | 27 (one per SR) |
| SR election cycle | Every 6 hours |
| Total SRs | 27 active + 100 partners |
| Voting mechanism | 1 TRX frozen = 1 vote |

```
Election cycle (6 hours):
┌──────────────────────────────────────────┐
│ TRX holders freeze TRX → gain votes      │
│ Vote for SR candidates                    │
│ Top 27 by votes → Super Representatives  │
│ SRs take turns producing blocks           │
│ SRs earn 16 TRX per block + tx fees      │
└──────────────────────────────────────────┘
```

For developers, DPoS means:
- 3-second block times give fast confirmation
- Transactions are final after 19/27 SRs confirm (~57 seconds)
- No MEV concerns like on Ethereum (SRs produce blocks in fixed order)
- Network governance is controlled by SR votes

### Energy and Bandwidth Model

Tron's resource model is fundamentally different from Ethereum's gas model. Instead of paying per-transaction fees, users stake TRX to acquire resources:

**Bandwidth** — consumed by all transactions (transfers, contract calls):
- Each account gets 600 free bandwidth points daily
- 1 bandwidth point ≈ 1 byte of transaction data
- A simple TRX transfer costs ~270 bandwidth points
- Staking 1 TRX ≈ 1-2 bandwidth points per day (varies with network)

**Energy** — consumed only by smart contract execution:
- No free energy allocation
- Must stake TRX or burn TRX to get energy
- 1 energy unit ≈ 1 unit of TVM computation
- A simple TRC-20 transfer costs ~30,000-65,000 energy

```solidity
// Cost comparison for a TRC-20 transfer:
// Option A: Stake TRX for energy (no direct cost, but TRX is locked)
//   - Stake ~50 TRX → get ~65,000 energy/day
//   - Transfer costs 0 TRX in fees
//
// Option B: Burn TRX for energy (pay-per-use)
//   - Energy cost: 65,000 energy × 420 sun/energy = 27,300,000 sun
//   - 27,300,000 sun = 27.3 TRX burned (~$2.70 at $0.10/TRX)
//
// Option C: Use free bandwidth + burn for energy
//   - Bandwidth: free (under 600/day)
//   - Energy: burned from caller's TRX balance
```

### Account Types

Tron has two account types:

| Feature | External Account | Contract Account |
|---------|-----------------|------------------|
| Address format | T + base58 (34 chars) | T + base58 (34 chars) |
| Creation | Implicit (first tx) or explicit | Contract deployment |
| Private key | Yes | No |
| Can hold TRX | Yes | Yes |
| Can hold TRC-20 | Yes | Yes |
| Activation cost | 1 TRX (account creation fee) | Deployment energy cost |

```javascript
// Tron address format examples:
// Base58: TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW
// Hex: 41a614f803b6fd780986a42c78ec9c7f77e6ded13c (41 prefix = mainnet)
//
// Note: Tron addresses are derived from Ethereum-style keys
// but use base58check encoding with a 0x41 prefix instead of 0x
```

### TVM Compatibility

The Tron Virtual Machine (TVM) is compatible with the EVM with some differences:

| Feature | EVM (Ethereum) | TVM (Tron) |
|---------|---------------|------------|
| Language | Solidity | Solidity (same) |
| Compiler | solc | solc (same versions) |
| Address length | 20 bytes | 21 bytes (0x41 prefix) |
| Native token | ETH (18 decimals) | TRX (6 decimals) |
| Block time | ~12 seconds | 3 seconds |
| msg.value unit | wei | sun (1 TRX = 10^6 sun) |
| Energy/Gas | Gas (variable price) | Energy (staked or burned) |

```solidity
// This Solidity contract works on BOTH Ethereum and Tron:
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleStorage {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    function set(uint256 _value) external {
        value = _value;
        emit ValueChanged(_value);
    }

    function get() external view returns (uint256) {
        return value;
    }
}
// The only difference: on Tron, msg.value is in sun (not wei)
// and addresses are 21 bytes internally
```

---

## Common Pitfalls

1. **Confusing energy and bandwidth** — New developers often think bandwidth covers everything. Bandwidth handles transaction data (like gas for calldata on Ethereum), but smart contract execution requires energy separately. If your contract call runs out of energy, it reverts even if you have plenty of bandwidth. Always ensure callers have staked enough TRX for energy or have TRX to burn.

2. **Forgetting the 1 TRX account activation fee** — Unlike Ethereum where any address can receive funds, Tron requires accounts to be "activated" with a 1 TRX transfer. Sending TRC-20 tokens to an unactivated address will fail. Your dApp must check if the recipient account exists before transferring tokens.

3. **Using wei-based math for TRX** — TRX has 6 decimals (1 TRX = 10^6 sun), not 18 like ETH. If you copy Ethereum contract patterns that assume 18 decimals, your math will be off by 10^12. Always use `10**6` as the TRX decimal base in your contracts.

4. **Ignoring the energy estimation step** — Unlike Ethereum where you can set a gas limit and overpay, Tron's energy model means under-estimating energy causes transaction failure with no refund of burned TRX. Always call `triggerConstantContract` (dry-run) before executing to estimate energy consumption accurately.

5. **Assuming instant finality** — While blocks are produced every 3 seconds, finality requires 19/27 SR confirmations (~57 seconds). For high-value operations, wait for solidified blocks rather than just the latest block.

---

## What to Learn Next

- [Development Environment Setup](./02-dev-environment-setup.md) — Install TronBox, configure TronLink wallet, and connect to Shasta testnet
- [Tron Developer Hub](https://developers.tron.network/) — Official documentation and API reference
