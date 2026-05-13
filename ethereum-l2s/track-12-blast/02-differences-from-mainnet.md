# Blast vs Ethereum Mainnet: Key Differences for Developers

**Track:** Blast Development
**Lesson:** 2 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're porting a contract from Ethereum mainnet to Blast. You know Blast is "EVM-compatible" but you're unsure what actually differs. Rebasing balances break assumptions your code makes about ETH accounting. Gas revenue sharing introduces new precompiles you've never seen. The Blast-specific yield configuration means your constructor needs additional setup. Without understanding these differences, your contracts will either miss yield opportunities, break under rebasing, or fail to compile against Blast's precompile interfaces.

## Core Concepts

### Rebasing ETH: The Fundamental Difference

On Ethereum mainnet, a contract's ETH balance only changes via:
- Receiving ETH (transfers, `selfdestruct`, coinbase rewards)
- Sending ETH (`call`, `transfer`, `send`)

On Blast, there's a third mechanism: **rebasing**. The contract's balance increases over time as staking yield accrues. This breaks common Solidity patterns:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DepositTracker
/// @notice BROKEN on Blast — demonstrates the rebasing problem
contract DepositTrackerBroken {
    mapping(address => uint256) public balances;

    /// @notice This pattern BREAKS on Blast
    /// @dev balance delta != msg.value due to rebasing between transactions
    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice This will NOT equal sum of all deposits on Blast
    /// @dev address(this).balance grows from rebasing yield
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum YieldMode { AUTOMATIC, VOID, CLAIMABLE }
enum GasMode { VOID, CLAIMABLE }

interface IBlast {
    function configure(YieldMode _yield, GasMode gasMode, address governor) external;
}

/// @title DepositTrackerFixed
/// @notice CORRECT on Blast — uses VOID mode for predictable balances
contract DepositTrackerFixed {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    mapping(address => uint256) public balances;

    constructor() {
        // Set to VOID mode — no rebasing, balance behaves like mainnet
        BLAST.configure(YieldMode.VOID, GasMode.CLAIMABLE, msg.sender);
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
}
```

### Gas Revenue Sharing

On Ethereum mainnet, gas fees go to validators. On Blast, smart contracts can claim a portion of the gas their users spend. This is configured via the `IBlast` precompile:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum YieldMode { AUTOMATIC, VOID, CLAIMABLE }
enum GasMode { VOID, CLAIMABLE }

interface IBlast {
    function configure(YieldMode _yield, GasMode gasMode, address governor) external;
    function claimAllGas(address contractAddress, address recipientOfGas) external returns (uint256);
    function claimGasAtMinClaimRate(address contractAddress, address recipientOfGas, uint256 minClaimRateBips) external returns (uint256);
    function readGasParams(address contractAddress) external view returns (uint256 etherSeconds, uint256 etherBalance, uint256 lastUpdated, GasMode);
}

/// @title GasRevenueCollector
/// @notice Demonstrates gas revenue claiming on Blast
contract GasRevenueCollector {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    address public governor;

    constructor(address _governor) {
        governor = _governor;
        // Enable claimable gas mode
        BLAST.configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, _governor);
    }

    /// @notice Any function that users call — gas fees accumulate
    function doSomething() external pure returns (uint256) {
        // Business logic here
        // The gas spent by callers accumulates for the contract to claim
        return 42;
    }

    /// @notice Read accumulated gas revenue parameters
    /// @return etherSeconds Accumulated ether×seconds (for time-weighted claiming)
    /// @return etherBalance Claimable gas balance
    /// @return lastUpdated Timestamp of last gas accumulation
    /// @return gasMode Current gas mode
    function readGasRevenue() external view returns (
        uint256 etherSeconds,
        uint256 etherBalance,
        uint256 lastUpdated,
        GasMode gasMode
    ) {
        return BLAST.readGasParams(address(this));
    }

    /// @notice Claim all accumulated gas revenue
    /// @dev Only callable by governor
    function claimGasRevenue() external returns (uint256) {
        require(msg.sender == governor, "Only governor");
        return BLAST.claimAllGas(address(this), governor);
    }
}
```

### Gas Pricing Differences

Blast uses the OP Stack gas model with L1 data fees:

| Component | Ethereum Mainnet | Blast |
|---|---|---|
| Base fee | ~30 gwei (variable) | ~0.001 gwei (very low) |
| Priority fee | 1-3 gwei | Not applicable |
| L1 data fee | N/A | Variable (based on L1 blob costs) |
| Block time | 12 seconds | 2 seconds |
| Gas limit | 30M per block | 30M per block |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Compare gas costs between Ethereum and Blast
async function compareGasCosts(): Promise<void> {
  const blastProvider = new ethers.JsonRpcProvider("https://rpc.blast.io");
  const ethProvider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");

  const [blastFee, ethFee] = await Promise.all([
    blastProvider.getFeeData(),
    ethProvider.getFeeData()
  ]);

  console.log("=== Gas Price Comparison ===");
  console.log(`Ethereum base fee: ${ethers.formatUnits(ethFee.gasPrice ?? 0n, "gwei")} gwei`);
  console.log(`Blast base fee: ${ethers.formatUnits(blastFee.gasPrice ?? 0n, "gwei")} gwei`);

  // ERC-20 transfer gas estimate
  const gasUsed = 52000n;
  const ethCost = gasUsed * (ethFee.gasPrice ?? 30_000_000_000n);
  const blastCost = gasUsed * (blastFee.gasPrice ?? 1_000_000n);

  console.log(`\nERC-20 Transfer Cost:`);
  console.log(`  Ethereum: ${ethers.formatEther(ethCost)} ETH`);
  console.log(`  Blast (L2 only): ${ethers.formatEther(blastCost)} ETH`);
  console.log(`  Note: Blast also charges L1 data fee (~$0.01-0.05)`);
}

compareGasCosts();
```

### Blast-Specific Precompile Addresses

Blast exposes functionality through precompile contracts at fixed addresses:

| Address | Contract | Purpose |
|---|---|---|
| `0x4300000000000000000000000000000000000002` | Blast | Yield + gas configuration |
| `0x4300000000000000000000000000000000000003` | USDB | Rebasing stablecoin |
| `0x2fc95838c71e76ec69ff817983BFf17c710F34E0` | Blast Points | Points operator |
| `0x2536FE9ab3F511540F2f9e2eC2A805005C3Dd800` | WETH (rebasing) | Wrapped ETH with yield |

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BlastPrecompileChecker
/// @notice Utility to verify Blast precompile availability
contract BlastPrecompileChecker {
    address constant BLAST_PRECOMPILE = 0x4300000000000000000000000000000000000002;
    address constant USDB_ADDRESS = 0x4300000000000000000000000000000000000003;

    /// @notice Check if we're running on Blast by testing precompile existence
    function isBlast() external view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(0x4300000000000000000000000000000000000002)
        }
        return size > 0;
    }
}
```

### Block Semantics

| Property | Ethereum | Blast |
|---|---|---|
| `block.timestamp` | 12s intervals | 2s intervals |
| `block.number` | L1 block number | L2 block number (different from L1) |
| `block.basefee` | Dynamic (EIP-1559) | Very low (~0.001 gwei) |
| `tx.gasprice` | Includes priority fee | L2 execution price only |
| `block.chainid` | 1 | 81457 (mainnet), 168587773 (testnet) |

### Opcode Differences

Blast is EVM-equivalent (via OP Stack), but some opcodes behave differently:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OpcodeDemo
/// @notice Shows opcode behavior differences on Blast
contract OpcodeDemo {
    /// @notice block.number returns L2 block number, not L1
    function getBlockInfo() external view returns (
        uint256 blockNumber,
        uint256 timestamp,
        uint256 chainId,
        uint256 baseFee
    ) {
        return (
            block.number,      // L2 block number (much higher than L1)
            block.timestamp,   // 2-second intervals
            block.chainid,     // 81457 on Blast mainnet
            block.basefee      // Very low on Blast
        );
    }

    /// @notice ORIGIN and CALLER behave the same as mainnet
    /// @dev No L1-to-L2 message aliasing issues for normal transactions
    function getSenderInfo() external view returns (
        address origin,
        address caller
    ) {
        return (tx.origin, msg.sender);
    }
}
```

## Common Pitfalls

1. **Using `address(this).balance` for accounting** — On Blast with AUTOMATIC yield mode, the contract balance increases without any transfer events. Use explicit deposit tracking or switch to VOID mode if you need deterministic balance behavior.

2. **Forgetting to configure yield mode in the constructor** — If you don't call `BLAST.configure()` in your constructor, the contract defaults to AUTOMATIC mode. This means your contract's ETH balance will rebase, which may break invariants in AMMs, lending pools, or any protocol that tracks balances precisely.

3. **Not claiming gas revenue** — If you set `GasMode.CLAIMABLE` but never call `claimAllGas()`, the revenue accumulates indefinitely but you never receive it. Set up a periodic claim mechanism or allow your governor to trigger claims.

4. **Hardcoding gas prices from mainnet** — Blast gas prices are orders of magnitude lower than Ethereum mainnet. If your contract has gas price checks or minimum fee requirements based on mainnet values, they'll be wrong on Blast. Use relative comparisons or chain-specific constants.

5. **Assuming `block.number` correlates with L1** — Blast produces blocks every 2 seconds. Block numbers increment much faster than Ethereum L1. If your contract uses block numbers for time-based logic, recalculate your constants (e.g., blocks per day = 43,200 on Blast vs 7,200 on Ethereum).

## What to Learn Next

- [Bridging Assets on Blast](./03-bridging-assets.md) — Move ETH and stablecoins between Ethereum and Blast
- [Blast Developer Docs: Yield](https://docs.blast.io/building/guides/eth-yield) — Official yield configuration guide
- [OP Stack Specification](https://specs.optimism.io/) — Underlying rollup architecture that Blast modifies
