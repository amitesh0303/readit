# Merlin Chain: ZK-Rollup on Bitcoin

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 8 of 8
**Level:** Advanced
**Read time:** 11 min

---

## The Problem

You want EVM-compatible smart contracts with the scalability of a ZK-rollup, but anchored to Bitcoin rather than Ethereum. Merlin Chain is a Bitcoin-native L2 that uses ZK proofs to batch transactions and posts proof data to Bitcoin via Taproot. It's EVM-compatible, so you can deploy existing Solidity contracts, but the underlying architecture and bridging mechanics are fundamentally different from Ethereum L2s. You need to understand how Merlin works, how to bridge BTC, and how to deploy contracts.

## Core Concepts

### Merlin Architecture

Merlin Chain combines ZK-proof technology with Bitcoin's data availability layer. Transaction data is compressed and posted to Bitcoin using Taproot inscriptions, while ZK proofs verify state transitions.

```
┌─────────────────────────────────────────────────────────┐
│              Merlin Chain Architecture                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Users submit EVM transactions                          │
│       ↓                                                 │
│  Sequencer                                              │
│  └── Orders transactions, produces L2 blocks            │
│  └── Batches transactions for proving                   │
│       ↓                                                 │
│  ZK Prover (zkEVM circuit)                              │
│  └── Generates validity proofs for state transitions    │
│  └── Compresses transaction data                        │
│       ↓                                                 │
│  Oracle Network (decentralized)                         │
│  └── Verifies ZK proofs                                 │
│  └── Posts proof commitments to Bitcoin                  │
│       ↓                                                 │
│  Bitcoin L1 (Data Availability via Taproot)             │
│  └── Stores compressed tx data in Taproot outputs       │
│  └── Provides ordering and timestamping                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Differences from Ethereum ZK-Rollups

| Feature | Ethereum ZK-Rollup (zkSync) | Merlin Chain |
|---|---|---|
| DA Layer | Ethereum calldata/blobs | Bitcoin Taproot inscriptions |
| Proof verification | On-chain L1 contract | Oracle network + Bitcoin |
| Bridge mechanism | Smart contract escrow | Multi-party computation |
| Settlement | Ethereum finality (~12 min) | Bitcoin finality (~60 min) |
| EVM compatibility | Full | Full (EVM-equivalent) |
| Native gas token | ETH | BTC (bridged) |

### Setting Up for Merlin Development

```shell
# Merlin Chain uses standard EVM tooling
# Configure Hardhat for Merlin testnet - hardhat@2.19.4

mkdir merlin-project && cd merlin-project
npm init -y
npm install --save-dev hardhat@2.19.4 @nomicfoundation/hardhat-toolbox@4.0.0
npx hardhat init
```

```typescript
// hardhat.config.ts
// hardhat@2.19.4
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    merlinTestnet: {
      url: "https://testnet-rpc.merlinchain.io",
      chainId: 686868,
      accounts: [process.env.PRIVATE_KEY || ""],
      gasPrice: 50000000, // 0.05 gwei
    },
    merlinMainnet: {
      url: "https://rpc.merlinchain.io",
      chainId: 4200,
      accounts: [process.env.PRIVATE_KEY || ""],
    },
  },
};

export default config;
```

### Deploying a Contract on Merlin

Since Merlin is EVM-compatible, standard Solidity contracts work without modification:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MerlinVault
/// @notice A simple BTC vault contract on Merlin Chain
/// @dev Demonstrates basic DeFi patterns on Bitcoin L2
contract MerlinVault {
    mapping(address => uint256) public deposits;
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    error InsufficientBalance(uint256 requested, uint256 available);
    error ZeroAmount();

    /// @notice Deposit BTC (native token on Merlin) into the vault
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();

        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw BTC from the vault
    /// @param amount Amount to withdraw in wei
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (deposits[msg.sender] < amount) {
            revert InsufficientBalance(amount, deposits[msg.sender]);
        }

        deposits[msg.sender] -= amount;
        totalDeposits -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Get user's deposit balance
    /// @param user Address to query
    /// @return balance User's deposited amount
    function getBalance(address user) external view returns (uint256 balance) {
        return deposits[user];
    }
}
```

```typescript
// scripts/deploy-vault.ts
// hardhat@2.19.4
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MerlinVault with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "BTC");

  const Vault = await ethers.getContractFactory("MerlinVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("MerlinVault deployed to:", address);
  console.log(`Explorer: https://testnet-scan.merlinchain.io/address/${address}`);

  // Test deposit
  const depositTx = await vault.deposit({ value: ethers.parseEther("0.001") });
  await depositTx.wait();
  console.log("Deposited 0.001 BTC");

  const vaultBalance = await vault.getBalance(deployer.address);
  console.log("Vault balance:", ethers.formatEther(vaultBalance), "BTC");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Get testnet BTC from Merlin faucet: https://testnet-faucet.merlinchain.io/
# Deploy to Merlin testnet
npx hardhat run scripts/deploy-vault.ts --network merlinTestnet
```

```
Expected output:
Deploying MerlinVault with: 0x1234...
Balance: 0.1 BTC
MerlinVault deployed to: 0x5678...
Explorer: https://testnet-scan.merlinchain.io/address/0x5678...
Deposited 0.001 BTC
Vault balance: 0.001 BTC
```

### Bridging BTC to Merlin

Merlin uses a bridge protocol to move BTC from Bitcoin mainnet to the Merlin L2:

```typescript
// Interacting with Merlin Bridge contract
// ethers@6.9.0
import { ethers } from "ethers";

const MERLIN_BRIDGE_ADDRESS = "0x..."; // Merlin official bridge contract

const provider = new ethers.JsonRpcProvider("https://rpc.merlinchain.io");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

// Check bridge status
const bridgeAbi = [
  "function getDepositStatus(bytes32 txHash) view returns (uint8 status)",
  "function getPendingDeposits(address user) view returns (uint256)",
];

const bridge = new ethers.Contract(MERLIN_BRIDGE_ADDRESS, bridgeAbi, wallet);

// After sending BTC to the bridge address on Bitcoin L1,
// check if the deposit has been credited on Merlin
const btcTxHash = "0x..."; // Bitcoin transaction hash
const status = await bridge.getDepositStatus(btcTxHash);
console.log(`Deposit status: ${status === 1 ? "Confirmed" : "Pending"}`);
```

### Merlin Ecosystem and BRC-20 Integration

Merlin has native support for BRC-20 tokens (Bitcoin Ordinals-based tokens) bridged from Bitcoin L1:

```typescript
// Reading BRC-20 token balances on Merlin
// ethers@6.9.0
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://rpc.merlinchain.io");

// BRC-20 tokens are represented as ERC-20 on Merlin after bridging
const BRC20_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

async function checkBRC20Balance(tokenAddress: string, userAddress: string) {
  const token = new ethers.Contract(tokenAddress, BRC20_TOKEN_ABI, provider);

  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const balance = await token.balanceOf(userAddress);
  const supply = await token.totalSupply();

  console.log(`Token: ${symbol}`);
  console.log(`Balance: ${ethers.formatUnits(balance, decimals)}`);
  console.log(`Total Supply: ${ethers.formatUnits(supply, decimals)}`);
}

// Example: Check ORDI token balance on Merlin
await checkBRC20Balance(
  "0x...", // ORDI contract address on Merlin
  "0x..." // User address
);
```

## Common Pitfalls

1. **Assuming instant Bitcoin finality** — While Merlin transactions confirm quickly on L2 (~seconds), final settlement on Bitcoin takes ~60 minutes (6 confirmations). For high-value operations, wait for Bitcoin-level finality before considering the transaction irreversible.

2. **Confusing Merlin BTC with native Bitcoin** — BTC on Merlin is a bridged representation. It's not the same as holding BTC in a Bitcoin wallet. Bridge security depends on the oracle network and multi-party computation, not Bitcoin consensus alone.

3. **Not verifying bridge contract addresses** — Always verify bridge contract addresses through official Merlin documentation. Phishing attacks commonly target bridge interactions with fake contract addresses.

4. **Ignoring ZK proof generation delays** — While users get fast soft confirmations, the ZK proof generation and Bitcoin posting can take longer. State that depends on L1 finality (like cross-chain messages) must account for this delay.

## What to Learn Next

- [Bitcoin Programmability Overview](./01-bitcoin-programmability-overview.md) — Review the full landscape of Bitcoin L2 solutions
- [Merlin Chain Documentation](https://docs.merlinchain.io/) — Official developer documentation
- [Merlin Chain GitHub](https://github.com/MerlinLayer2) — Source code and developer resources
- [Bitcoin Ordinals and BRC-20](https://docs.ordinals.com/) — Understanding the inscription standard that Merlin bridges
