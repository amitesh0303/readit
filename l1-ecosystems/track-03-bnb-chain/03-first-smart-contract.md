# Deploy Your First BEP-20 Token to BSC Testnet

**Track:** BNB Chain Development
**Level:** Beginner → Intermediate
**Read time:** 15 min

---

## The Problem

You understand BSC's architecture and have your dev environment ready, but you haven't actually deployed anything yet. You need to write a BEP-20 token contract, compile it, deploy it to BSC testnet, and verify it on BscScan — all without spending real money. Most tutorials skip error handling, verification, and the actual deployment output, leaving you guessing when something goes wrong.

## Core Concepts

### BEP-20 Token Contract

BEP-20 is functionally identical to ERC-20. We'll use OpenZeppelin's audited implementation as the base:

```shell
# Install OpenZeppelin contracts (Hardhat)
npm install @openzeppelin/contracts@5.0.0
```

```
Expected output:
added 1 package, and audited 300 packages in 3s
```

Create `contracts/MyToken.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.0/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title MyToken
 * @dev A simple BEP-20 token with minting and burning capabilities.
 * Deploys on BSC testnet (chain ID 97) or mainnet (chain ID 56).
 */
contract MyToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; // 1 million tokens

    error MaxSupplyExceeded(uint256 requested, uint256 available);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert MaxSupplyExceeded(initialSupply, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Mint new tokens. Only callable by the contract owner.
     * Reverts if minting would exceed MAX_SUPPLY.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MaxSupplyExceeded(
                totalSupply() + amount,
                MAX_SUPPLY - totalSupply()
            );
        }
        _mint(to, amount);
    }
}
```

### Compile the Contract

```shell
npx hardhat compile
```

```
Expected output:
Compiled 7 Solidity files successfully (evm target: paris).
```

### Write the Deployment Script

Create `scripts/deploy.js`:

```solidity
// scripts/deploy.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "BNB");

  if (balance === 0n) {
    throw new Error(
      "No BNB balance. Get testnet BNB from: https://www.bnbchain.org/en/testnet-faucet"
    );
  }

  const MyToken = await ethers.getContractFactory("MyToken");
  const initialSupply = ethers.parseEther("100000"); // 100,000 tokens

  console.log("Deploying MyToken...");
  const token = await MyToken.deploy("My BSC Token", "MBT", initialSupply);
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log("MyToken deployed to:", address);
  console.log("Transaction hash:", token.deploymentTransaction().hash);
  console.log(
    "View on BscScan: https://testnet.bscscan.com/address/" + address
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error.message);
    process.exit(1);
  });
```

### Deploy to BSC Testnet

Make sure you have testnet BNB from the faucet: https://www.bnbchain.org/en/testnet-faucet

```shell
npx hardhat run scripts/deploy.js --network bscTestnet
```

```
Expected output:
Deploying with account: 0xYourAddress
Account balance: 0.5 BNB
Deploying MyToken...
MyToken deployed to: 0x1234567890abcdef1234567890abcdef12345678
Transaction hash: 0xabcdef...
View on BscScan: https://testnet.bscscan.com/address/0x1234567890abcdef1234567890abcdef12345678
```

### Verify on BscScan

Contract verification lets users read your source code and interact via BscScan's UI:

```shell
npx hardhat verify --network bscTestnet 0xYOUR_CONTRACT_ADDRESS "My BSC Token" "MBT" "100000000000000000000000"
```

```
Expected output:
Successfully submitted source code for contract
contracts/MyToken.sol:MyToken at 0xYOUR_CONTRACT_ADDRESS
for verification on the block explorer. Waiting for verification result...

Successfully verified contract MyToken on the block explorer.
https://testnet.bscscan.com/address/0xYOUR_CONTRACT_ADDRESS#code
```

### Deploy with Foundry (Alternative)

If you're using Foundry, create `script/DeployToken.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MyToken.sol";

contract DeployToken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        MyToken token = new MyToken(
            "My BSC Token",
            "MBT",
            100_000 * 10 ** 18
        );

        console.log("Token deployed at:", address(token));

        vm.stopBroadcast();
    }
}
```

Deploy with forge:

```shell
forge script script/DeployToken.s.sol:DeployToken --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545 --broadcast --verify --etherscan-api-key $BSCSCAN_API_KEY
```

```
Expected output:
[⠊] Compiling...
No files changed, compilation skipped
Script ran successfully.

== Logs ==
  Token deployed at: 0x1234567890abcdef1234567890abcdef12345678

## Setting up 1 EVM.
...
✅ [Success] Hash: 0xabcdef...
Contract Address: 0x1234567890abcdef1234567890abcdef12345678
Block: 12345678
```

### Interact with Your Deployed Token

```shell
# Check token name (Foundry cast)
cast call 0xYOUR_CONTRACT_ADDRESS "name()(string)" --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545
```

```
Expected output:
"My BSC Token"
```

```shell
# Check total supply
cast call 0xYOUR_CONTRACT_ADDRESS "totalSupply()(uint256)" --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545
```

```
Expected output:
100000000000000000000000
```

## Common Pitfalls

1. **Forgetting constructor arguments during verification** — BscScan verification requires the exact constructor arguments used during deployment. If you pass `ethers.parseEther("100000")`, the raw value is `100000000000000000000000` (100,000 × 10^18). Pass the raw value, not the human-readable one.

2. **Deploying without enough gas** — A BEP-20 deployment costs ~0.005-0.01 BNB on testnet. If you have less than 0.01 tBNB, the transaction will revert with "insufficient funds." Always check your balance before deploying.

3. **Not waiting for deployment confirmation** — `await token.waitForDeployment()` is critical. Without it, you'll try to read the contract address before the transaction is mined, getting `undefined`.

4. **Using `msg.sender` without understanding proxies** — If you later upgrade to a proxy pattern, `msg.sender` in the constructor is the deployer EOA, not the proxy. For upgradeable contracts, use an `initialize()` function instead.

## What to Learn Next

- [BEP-20, BEP-721, and BEP-1155 Token Standards](./04-token-standards.md) — Deep dive into all BSC token standards
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) — Source code for the audited base contracts
- [BscScan Verification Docs](https://docs.bscscan.com/tutorials/verifying-contracts) — Official guide for contract verification
