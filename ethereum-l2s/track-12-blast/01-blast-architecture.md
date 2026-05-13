# Blast Architecture: The Optimistic Rollup with Native Yield

**Track:** Blast Development
**Lesson:** 1 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You've heard Blast described as "an L2 with native yield" but you don't understand what that actually means architecturally. How does ETH on Blast automatically earn yield? What's the difference between Blast's rebasing model and simply holding a yield-bearing token? How does the sequencer work, and what are the trust assumptions? Without understanding Blast's unique architecture, you'll mishandle rebasing balances, miss gas revenue opportunities, and make incorrect assumptions about finality and security.

## Core Concepts

### What Makes Blast Different

Blast is an optimistic rollup (built on a modified OP Stack) with two unique properties that no other L2 offers natively:

1. **Native yield on ETH** — ETH bridged to Blast automatically earns yield from Ethereum staking (via Lido). Balances rebase upward over time.
2. **Native yield on stablecoins** — USDB (Blast's native stablecoin) earns yield from MakerDAO's T-Bill backing.
3. **Gas revenue sharing** — Smart contracts can claim the gas fees their users spend, creating a new revenue model for dApp developers.

```
┌─────────────────────────────────────────────────────────┐
│                  Blast Architecture                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users bridge ETH / USDC / USDT / DAI                   │
│       ↓                                                 │
│  Blast Bridge (L1)                                      │
│  └── ETH → Lido stETH (earns ~3.5% APY)                │
│  └── Stablecoins → MakerDAO sDAI (earns ~5% APY)       │
│       ↓                                                 │
│  Blast L2 (Optimistic Rollup)                           │
│  └── ETH balances auto-rebase (reflect staking yield)   │
│  └── USDB balances auto-rebase (reflect T-Bill yield)   │
│  └── Sequencer (centralized, Blast team)                │
│  └── Batch poster → Ethereum L1 calldata/blobs          │
│       ↓                                                 │
│  Gas Revenue Sharing                                    │
│  └── Contracts opt-in to CLAIMABLE gas mode             │
│  └── Contract deployers claim accumulated gas fees      │
│       ↓                                                 │
│  Ethereum L1 (Settlement + Data Availability)           │
│  └── Fraud proof window: 14 days                        │
│  └── Yield source: Lido + MakerDAO                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### The Yield Mechanism

Unlike other L2s where bridged ETH sits idle in a bridge contract, Blast's bridge contract deposits ETH into Lido (stETH) on L1. The staking yield accrues to the bridge, and Blast distributes it to L2 users by rebasing their ETH balances upward.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// On Blast, ETH balances automatically increase over time.
// This is fundamentally different from other L2s.

/// @title YieldAwareVault
/// @notice Demonstrates how rebasing ETH affects contract logic
/// @dev On Blast, address(this).balance grows without receiving transfers
contract YieldAwareVault {
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 yield);

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw deposit plus proportional share of yield
    /// @dev The contract's balance grows from rebasing, so
    ///      address(this).balance > totalDeposited after time passes
    function withdraw() external {
        uint256 userDeposit = deposits[msg.sender];
        require(userDeposit > 0, "No deposit");

        // Calculate user's share of total yield
        uint256 contractBalance = address(this).balance;
        uint256 userShare = (userDeposit * contractBalance) / totalDeposited;
        uint256 yield = userShare - userDeposit;

        deposits[msg.sender] = 0;
        totalDeposited -= userDeposit;

        (bool success, ) = msg.sender.call{value: userShare}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, userDeposit, yield);
    }
}
```

### Yield Modes for Smart Contracts

Smart contracts on Blast can configure how they interact with native yield via the `IBlast` interface:

| Mode | Behavior | Use Case |
|---|---|---|
| **AUTOMATIC** | Balance rebases upward (default for EOAs) | Simple wallets, yield-passing protocols |
| **VOID** | No yield accrues (balance stays constant) | Protocols that need predictable balances |
| **CLAIMABLE** | Yield accumulates separately, claimed on demand | DeFi protocols, treasuries |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Blast precompile interface
// Source: https://github.com/blast-io/blast/blob/master/blast-optimism/packages/contracts-bedrock/src/L2/Blast.sol

enum YieldMode {
    AUTOMATIC,
    VOID,
    CLAIMABLE
}

enum GasMode {
    VOID,
    CLAIMABLE
}

interface IBlast {
    function configureContract(
        address contractAddress,
        YieldMode _yield,
        GasMode gasMode,
        address governor
    ) external;
    function configure(
        YieldMode _yield,
        GasMode gasMode,
        address governor
    ) external;
    function configureClaimableYield() external;
    function configureClaimableGas() external;
    function claimYield(
        address contractAddress,
        address recipientOfYield,
        uint256 amount
    ) external returns (uint256);
    function claimAllYield(
        address contractAddress,
        address recipientOfYield
    ) external returns (uint256);
    function claimAllGas(
        address contractAddress,
        address recipientOfGas
    ) external returns (uint256);
    function readClaimableYield(address contractAddress) external view returns (uint256);
    function readYieldConfiguration(address contractAddress) external view returns (uint8);
}

/// @title BlastYieldManager
/// @notice Configure and claim native yield on Blast
contract BlastYieldManager {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    address public immutable governor;

    constructor(address _governor) {
        governor = _governor;
        // Configure this contract for claimable yield and gas
        BLAST.configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, _governor);
    }

    /// @notice Check how much yield has accumulated
    function checkClaimableYield() external view returns (uint256) {
        return BLAST.readClaimableYield(address(this));
    }

    /// @notice Claim all accumulated yield to the governor
    function claimYield() external returns (uint256) {
        require(msg.sender == governor, "Only governor");
        return BLAST.claimAllYield(address(this), governor);
    }

    /// @notice Claim all accumulated gas revenue to the governor
    function claimGas() external returns (uint256) {
        require(msg.sender == governor, "Only governor");
        return BLAST.claimAllGas(address(this), governor);
    }
}
```

### Sequencer and Finality

Blast uses a centralized sequencer (operated by the Blast team) similar to other OP Stack chains:

| Finality Level | Time | Trust Assumption |
|---|---|---|
| Soft confirmation | ~2 seconds | Trust the sequencer |
| L1 batch posted | ~5-15 min | Data on Ethereum, reconstructible |
| L1 finalized | ~14 days | Challenge window passed |

The 14-day challenge window (vs 7 days on Optimism/Arbitrum) is a Blast-specific parameter that provides additional security margin.

### USDB: The Rebasing Stablecoin

USDB is Blast's native stablecoin. When users bridge USDC, USDT, or DAI to Blast, they receive USDB. On L1, the bridge deposits these stablecoins into MakerDAO's sDAI vault, earning T-Bill yield (~5% APY). This yield is distributed to USDB holders via rebasing.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// USDB interface on Blast
// USDB address: 0x4300000000000000000000000000000000000003

interface IERC20Rebasing {
    enum YieldMode {
        AUTOMATIC,
        VOID,
        CLAIMABLE
    }

    function configure(YieldMode) external returns (uint256);
    function claim(address recipient, uint256 amount) external returns (uint256);
    function getClaimableAmount(address account) external view returns (uint256);
}

/// @title USDBYieldCollector
/// @notice Collect USDB yield in CLAIMABLE mode
contract USDBYieldCollector {
    IERC20Rebasing public constant USDB =
        IERC20Rebasing(0x4300000000000000000000000000000000000003);
    address public owner;

    constructor() {
        owner = msg.sender;
        // Set USDB to claimable mode for this contract
        USDB.configure(IERC20Rebasing.YieldMode.CLAIMABLE);
    }

    function checkClaimable() external view returns (uint256) {
        return USDB.getClaimableAmount(address(this));
    }

    function claimUSDBYield(uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        USDB.claim(owner, amount);
    }
}
```

## Common Pitfalls

1. **Assuming ETH balances are static** — On every other EVM chain, `address(this).balance` only changes when ETH is sent or received. On Blast, balances rebase upward automatically. If your contract logic depends on balance deltas to detect deposits, it will break. Use events or explicit accounting instead.

2. **Not configuring yield mode for contracts** — By default, smart contracts on Blast are in AUTOMATIC mode, meaning their ETH balance rebases. If your protocol needs predictable balances (e.g., an AMM with constant-product invariants), you must explicitly set VOID or CLAIMABLE mode in the constructor.

3. **Confusing the 14-day challenge window with Optimism's 7-day window** — Blast uses a 14-day fraud proof window, not 7 days. This means withdrawals to L1 take 14 days via the native bridge. Plan your liquidity management accordingly.

4. **Treating USDB like a normal ERC-20** — USDB rebases, so `balanceOf()` returns different values over time without any transfers. If you're building a vault or lending protocol, you must account for this in your share calculations or switch to CLAIMABLE mode.

## What to Learn Next

- [Differences from Ethereum Mainnet](./02-differences-from-mainnet.md) — Gas semantics, opcodes, and Blast-specific precompiles
- [Blast Documentation](https://docs.blast.io/) — Official developer documentation
- [Blast GitHub](https://github.com/blast-io/blast) — Source code for Blast contracts and infrastructure
