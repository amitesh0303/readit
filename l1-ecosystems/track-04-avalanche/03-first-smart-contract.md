# Deploy Your First Smart Contract to Avalanche Fuji C-Chain

**Track:** Avalanche Development
**Level:** Beginner → Intermediate
**Read time:** 14 min

---

## The Problem

You've set up your development environment and have testnet AVAX in your wallet. Now you need to actually write, compile, test, and deploy a smart contract to Fuji C-Chain. The process is nearly identical to Ethereum (same Solidity, same Hardhat), but there are Avalanche-specific details around gas pricing, block confirmation behavior, and contract verification on Snowtrace that trip up developers coming from Ethereum.

This lesson walks through a complete deployment cycle — from writing the contract to verifying it on the Fuji block explorer — with every command and its expected output.

---

## Core Concepts

### Writing the Contract

We'll build a simple storage contract with access control — practical enough to demonstrate real patterns, simple enough to focus on the deployment process:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AvalancheVault
 * @notice A simple vault contract that stores AVAX deposits per user.
 * @dev Demonstrates payable functions, mappings, events, and withdrawal patterns.
 *      Deployed and verified on Avalanche Fuji C-Chain.
 */
contract AvalancheVault {
    // ─── State ─────────────────────────────────────────────────────────────

    address public owner;
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;
    bool public paused;

    // ─── Events ────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 remaining);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ─── Errors ────────────────────────────────────────────────────────────

    error NotOwner();
    error ContractPaused();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();
    error ZeroAmount();

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Core Functions ────────────────────────────────────────────────────

    /**
     * @notice Deposit AVAX into the vault.
     * @dev msg.value is automatically added to the contract's balance.
     */
    function deposit() external payable whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }

    /**
     * @notice Withdraw AVAX from the vault.
     * @param amount The amount of AVAX (in wei) to withdraw.
     */
    function withdraw(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) {
            revert InsufficientBalance(amount, balances[msg.sender]);
        }

        // Effects before interactions (CEI pattern — prevents reentrancy)
        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        // Interaction — send AVAX
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    /**
     * @notice Get the contract's total AVAX balance.
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Admin Functions ───────────────────────────────────────────────────

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
```

### Compiling

```shell
npx hardhat compile
```

```
Expected output:
Generating typings for: 1 artifacts in dir: typechain-types for target: ethers-v6
Successfully generated 6 typings!
Compiled 1 Solidity file successfully (using solc-js compiler version 0.8.20)
```

### Writing Tests

Always test before deploying — even on testnet:

```typescript
// test/AvalancheVault.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { AvalancheVault } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AvalancheVault", function () {
  let vault: AvalancheVault;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("AvalancheVault");
    vault = await Vault.deploy();
    await vault.waitForDeployment();
  });

  describe("Deposits", function () {
    it("should accept AVAX deposits", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await vault.connect(user1).deposit({ value: depositAmount });

      expect(await vault.balances(user1.address)).to.equal(depositAmount);
      expect(await vault.totalDeposits()).to.equal(depositAmount);
    });

    it("should revert on zero deposit", async function () {
      await expect(
        vault.connect(user1).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("should emit Deposited event", async function () {
      const amount = ethers.parseEther("0.5");
      await expect(vault.connect(user1).deposit({ value: amount }))
        .to.emit(vault, "Deposited")
        .withArgs(user1.address, amount, amount);
    });
  });

  describe("Withdrawals", function () {
    it("should allow withdrawal of deposited funds", async function () {
      const amount = ethers.parseEther("1.0");
      await vault.connect(user1).deposit({ value: amount });

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const tx = await vault.connect(user1).withdraw(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(user1.address);

      expect(balanceAfter + gasUsed - balanceBefore).to.equal(amount);
    });

    it("should revert on insufficient balance", async function () {
      const amount = ethers.parseEther("1.0");
      await expect(
        vault.connect(user1).withdraw(amount)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  describe("Pause", function () {
    it("should prevent deposits when paused", async function () {
      await vault.connect(owner).pause();
      await expect(
        vault.connect(user1).deposit({ value: ethers.parseEther("1.0") })
      ).to.be.revertedWithCustomError(vault, "ContractPaused");
    });

    it("should only allow owner to pause", async function () {
      await expect(
        vault.connect(user1).pause()
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });
  });
});
```

```shell
npx hardhat test
```

```
Expected output:
  AvalancheVault
    Deposits
      ✔ should accept AVAX deposits
      ✔ should revert on zero deposit
      ✔ should emit Deposited event
    Withdrawals
      ✔ should allow withdrawal of deposited funds
      ✔ should revert on insufficient balance
    Pause
      ✔ should prevent deposits when paused
      ✔ should only allow owner to pause

  7 passing (1s)
```

### Deploying to Fuji C-Chain

Create the deployment script:

```typescript
// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Deploying AvalancheVault...");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "AVAX");
  console.log("Network:", (await ethers.provider.getNetwork()).chainId);

  const Vault = await ethers.getContractFactory("AvalancheVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("\n✅ AvalancheVault deployed to:", address);
  console.log("View on Snowtrace:", `https://testnet.snowtrace.io/address/${address}`);

  // Verify deployment
  const owner = await vault.owner();
  console.log("Owner:", owner);
  console.log("Paused:", await vault.paused());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

```shell
# Deploy to Fuji testnet
npx hardhat run scripts/deploy.ts --network fuji
```

```
Expected output:
Deploying AvalancheVault...
Deployer: 0xYourAddress...
Balance: 1.95 AVAX
Network: 43113n

✅ AvalancheVault deployed to: 0xContractAddress...
View on Snowtrace: https://testnet.snowtrace.io/address/0xContractAddress...
Owner: 0xYourAddress...
Paused: false
```

### Verifying on Snowtrace

Snowtrace is Avalanche's block explorer (powered by Etherscan). Verify your contract to make the source code publicly readable:

```shell
# Verify the deployed contract
npx hardhat verify --network fuji 0xYourDeployedContractAddress
```

```
Expected output:
Nothing to compile
Successfully submitted source code for contract
contracts/AvalancheVault.sol:AvalancheVault at 0xContractAddress...
for verification on the block explorer. Waiting for verification result...

Successfully verified contract AvalancheVault on the block explorer.
https://testnet.snowtrace.io/address/0xContractAddress...#code
```

### Interacting with the Deployed Contract

```typescript
// scripts/interact.ts
import { ethers } from "hardhat";

async function main() {
  const contractAddress = "0xYourDeployedContractAddress";
  const vault = await ethers.getContractAt("AvalancheVault", contractAddress);

  // Deposit 0.1 AVAX
  console.log("Depositing 0.1 AVAX...");
  const depositTx = await vault.deposit({
    value: ethers.parseEther("0.1"),
  });
  const receipt = await depositTx.wait();
  console.log("Deposit tx hash:", receipt!.hash);
  console.log("Gas used:", receipt!.gasUsed.toString());
  // Note: On Avalanche, finality is ~2 seconds — no need to wait for confirmations

  // Check balance
  const [signer] = await ethers.getSigners();
  const balance = await vault.balances(signer.address);
  console.log("Vault balance:", ethers.formatEther(balance), "AVAX");

  // Withdraw 0.05 AVAX
  console.log("\nWithdrawing 0.05 AVAX...");
  const withdrawTx = await vault.withdraw(ethers.parseEther("0.05"));
  await withdrawTx.wait();
  console.log("Withdrawal complete");

  const remaining = await vault.balances(signer.address);
  console.log("Remaining vault balance:", ethers.formatEther(remaining), "AVAX");
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/interact.ts --network fuji
```

```
Expected output:
Depositing 0.1 AVAX...
Deposit tx hash: 0xabc123...
Gas used: 65432
Vault balance: 0.1 AVAX

Withdrawing 0.05 AVAX...
Withdrawal complete
Remaining vault balance: 0.05 AVAX
```

---

## Common Pitfalls

1. **Not setting the Snowtrace API key for verification** — Contract verification requires a free API key from [Snowtrace](https://snowtrace.io/). Without it, `hardhat verify` will fail with an authentication error. Sign up at snowtrace.io and add the key to your `.env` file.

2. **Expecting multiple block confirmations** — On Ethereum, you might `await tx.wait(5)` for 5 confirmations. On Avalanche C-Chain, `await tx.wait(1)` is sufficient because finality is deterministic after 1 block (~2 seconds). Waiting for more confirmations just wastes time.

3. **Using Ethereum gas estimation without adjustment** — While C-Chain is EVM-compatible, gas prices differ. Fuji typically uses 25 nAVAX base fee. If you hardcode Ethereum-style gas prices (e.g., 30 gwei), your transactions may overpay significantly or fail if the network minimum changes.

4. **Forgetting the Fuji faucet rate limit during rapid iteration** — Each deployment costs ~0.01-0.05 AVAX. If you're iterating quickly, you'll burn through your 2 AVAX faucet allocation. Use `npx hardhat test` (local Hardhat network) for development, and only deploy to Fuji for final integration testing.

5. **Not using custom errors** — Solidity 0.8.4+ supports custom errors (`error NotOwner()`) which are cheaper than `require(condition, "string message")`. On Avalanche where gas is already cheap, this matters less for cost but improves the developer experience with typed error handling in frontends.

---

## What to Learn Next

- [Token Standards on Avalanche](./04-token-standards.md) — Deploy ERC-20 tokens on C-Chain, understand wrapped AVAX, and explore cross-chain token patterns
- [Hardhat documentation](https://hardhat.org/docs) — Complete reference for the Hardhat development framework
- [Snowtrace API documentation](https://docs.snowtrace.io/) — Block explorer API for programmatic contract interaction
