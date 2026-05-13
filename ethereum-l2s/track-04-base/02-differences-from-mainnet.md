# Base vs Ethereum Mainnet: What's Different for Developers

**Track:** Base Development
**Level:** Beginner → Intermediate
**Read time:** 9 min

---

## The Problem

You have a working Ethereum contract and want to deploy it on Base. The marketing says "EVM-equivalent" — but that hides subtle differences in gas calculation, block timing, opcode behavior, and transaction types that can break your contract logic or drain user funds if you're not aware of them. You need a concrete list of what changes and what stays the same.

## Core Concepts

### What Stays the Same

Base is EVM-equivalent (Type 1 rollup), so the vast majority of Ethereum tooling works unchanged:

- Solidity/Vyper compilation and ABI encoding
- All standard EVM opcodes including `PUSH0` (EIP-3855)
- OpenZeppelin contracts deploy without modification
- Hardhat, Foundry, Remix — same workflow, different RPC
- ERC-20, ERC-721, ERC-1155 standards
- ethers.js, viem, wagmi — same APIs

### Gas Model: Two-Component Fees

The biggest difference is gas pricing. On Base, every transaction pays two fees:

1. **L2 execution fee** — gas used × L2 gas price (very low, ~0.001 gwei typical)
2. **L1 data fee** — cost of posting your transaction's calldata to Ethereum L1

```typescript
// ethers.js@6.9.0
import { ethers } from "ethers";

// Base's GasPriceOracle precompile (same as Optimism)
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";

const GAS_PRICE_ORACLE_ABI = [
  "function l1BaseFee() view returns (uint256)",
  "function baseFeeScalar() view returns (uint32)",
  "function blobBaseFeeScalar() view returns (uint32)",
  "function blobBaseFee() view returns (uint256)",
  "function getL1Fee(bytes memory _data) view returns (uint256)",
  "function gasPrice() view returns (uint256)",
  "function overhead() view returns (uint256)",
];

async function estimateBaseFees(provider: ethers.Provider): Promise<void> {
  const oracle = new ethers.Contract(
    GAS_PRICE_ORACLE,
    GAS_PRICE_ORACLE_ABI,
    provider
  );

  try {
    const l1BaseFee = await oracle.l1BaseFee();
    const l2GasPrice = await oracle.gasPrice();
    const blobBaseFee = await oracle.blobBaseFee();

    console.log("L1 base fee:", ethers.formatUnits(l1BaseFee, "gwei"), "gwei");
    console.log("L2 gas price:", ethers.formatUnits(l2GasPrice, "gwei"), "gwei");
    console.log("Blob base fee:", ethers.formatUnits(blobBaseFee, "gwei"), "gwei");

    // Estimate L1 data fee for a sample ERC-20 transfer calldata
    const sampleCalldata = ethers.solidityPacked(
      ["bytes4", "address", "uint256"],
      ["0xa9059cbb", "0x1234567890123456789012345678901234567890", ethers.parseEther("1.0")]
    );

    const l1Fee = await oracle.getL1Fee(sampleCalldata);
    console.log("L1 data fee for ERC-20 transfer:", ethers.formatEther(l1Fee), "ETH");
  } catch (error) {
    console.error("Failed to read gas oracle:", (error as Error).message);
  }
}
```

After EIP-4844 (Dencun upgrade), Base posts data as blobs instead of calldata, reducing L1 data fees by ~10-100x.

### Block Timing Differences

| Property | Ethereum Mainnet | Base |
|----------|-----------------|------|
| Block time | ~12 seconds | 2 seconds |
| `block.number` | L1 block number | L2 block number |
| `block.timestamp` | L1 timestamp | L2 timestamp |
| Blocks per day | ~7,200 | ~43,200 |

This matters for any contract using `block.number` for timing:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// BAD: This vesting schedule behaves differently on Base vs Ethereum
contract BadVesting {
    uint256 public constant VESTING_BLOCKS = 100_000;
    // On Ethereum: ~14 days (100k × 12s)
    // On Base: ~2.3 days (100k × 2s)
}

// GOOD: Use timestamps for time-based logic
contract GoodVesting {
    uint256 public constant VESTING_DURATION = 14 days;
    uint256 public immutable vestingStart;

    constructor() {
        vestingStart = block.timestamp;
    }

    function vestedAmount(uint256 totalAmount) public view returns (uint256) {
        if (block.timestamp >= vestingStart + VESTING_DURATION) {
            return totalAmount;
        }
        return (totalAmount * (block.timestamp - vestingStart)) / VESTING_DURATION;
    }
}
```

### Transaction Types

Base supports all Ethereum transaction types:

- **Type 0** (Legacy): `gasPrice` field
- **Type 1** (EIP-2930): access lists
- **Type 2** (EIP-1559): `maxFeePerGas` + `maxPriorityFeePerGas`

EIP-1559 works on Base, but the dynamics differ. The L2 base fee is extremely low and stable (often <0.01 gwei). The priority fee is also minimal since there's a single sequencer — no MEV competition for block inclusion.

```typescript
// ethers.js@6.9.0
import { ethers } from "ethers";

async function sendTransactionOnBase(
  wallet: ethers.Wallet,
  to: string,
  value: bigint
): Promise<ethers.TransactionResponse> {
  const feeData = await wallet.provider!.getFeeData();

  // On Base, priority fee is minimal (sequencer doesn't auction block space)
  const tx = await wallet.sendTransaction({
    to,
    value,
    type: 2, // EIP-1559
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1000000n, // ~0.001 gwei fallback
  });

  console.log("Tx hash:", tx.hash);
  console.log("Explorer:", `https://basescan.org/tx/${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Transaction failed: no receipt");
  }
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Effective gas price:", ethers.formatUnits(receipt.gasPrice, "gwei"), "gwei");

  return tx;
}
```

### Opcode Differences

Base supports all standard EVM opcodes. Notable behaviors:

- `PUSH0` (EIP-3855): Supported. Compile with Solidity ≥0.8.20 safely.
- `SELFDESTRUCT`: Deprecated (EIP-6049). Avoid in new contracts.
- `PREVRANDAO` (`DIFFICULTY`): Returns a pseudo-random value from the sequencer, not a true random beacon. Do not use for security-critical randomness.
- `COINBASE`: Returns the sequencer's fee vault address, not a miner address.

### Contract Size and Deployment Limits

- Maximum contract bytecode: 24,576 bytes (same as Ethereum, EIP-170)
- Maximum initcode: 49,152 bytes (same as Ethereum, EIP-3860)
- No additional Base-specific limits

## Common Pitfalls

1. **Using `block.number` for time calculations** — Base produces blocks every 2 seconds vs Ethereum's 12 seconds. Any logic that assumes "X blocks ≈ Y time" will be 6x faster on Base. Always use `block.timestamp` for time-dependent logic.

2. **Ignoring L1 data fees in gas estimates** — The L2 execution fee is tiny, but the L1 data fee can dominate total cost for data-heavy transactions. Use the GasPriceOracle precompile to estimate total fees accurately.

3. **Relying on `PREVRANDAO` for randomness** — On Base, this value comes from the sequencer and is predictable. Use Chainlink VRF or a commit-reveal scheme for any randomness that affects value.

4. **Assuming MEV works the same way** — Base has a single sequencer (Coinbase). There's no public mempool for MEV searchers to frontrun. However, the sequencer itself could theoretically reorder transactions. Don't assume MEV protection is permanent.

5. **Not testing with realistic L1 data fees** — On testnets, L1 data fees may be artificially low. Test your gas estimation logic against mainnet fee levels before launch.

## What to Learn Next

- [Bridging Assets to and from Base](./03-bridging-assets.md) — Move ETH and tokens between Ethereum and Base
- [Base Gas Price Oracle](https://docs.base.org/docs/fees) — Official documentation on fee mechanics
- [OP Stack Differences from Ethereum](https://docs.optimism.io/chain/differences) — Comprehensive list of OP Stack behavioral differences
