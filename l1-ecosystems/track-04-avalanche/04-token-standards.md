# Token Standards on Avalanche: ERC-20, Wrapped AVAX, and Cross-Chain Tokens

**Track:** Avalanche Development
**Level:** Intermediate
**Read time:** 13 min

---

## The Problem

You want to create tokens on Avalanche, but the ecosystem has layers of complexity beyond a basic ERC-20 deployment. There's WAVAX (wrapped AVAX) that behaves differently from WETH on Ethereum, cross-chain tokens that exist on multiple Subnets, and the question of whether to use C-Chain ERC-20s or X-Chain native assets. Understanding these token patterns is essential for building DeFi protocols, bridges, or any application that handles value on Avalanche.

---

## Core Concepts

### ERC-20 on C-Chain

Since C-Chain is fully EVM-compatible, standard ERC-20 tokens work identically to Ethereum. The key difference is cost and speed — deploying and interacting with tokens is significantly cheaper and faster on Avalanche.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.1/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.1/access/Ownable.sol";

/**
 * @title AvalancheToken
 * @notice A production-ready ERC-20 token deployed on Avalanche C-Chain.
 * @dev Uses OpenZeppelin v5.0.1 contracts for battle-tested implementations.
 */
contract AvalancheToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18; // 100M tokens

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (initialSupply_ > MAX_SUPPLY) {
            revert ExceedsMaxSupply(initialSupply_, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply_);
    }

    /**
     * @notice Mint new tokens. Only callable by owner.
     * @param to Recipient address
     * @param amount Amount to mint (in wei units, i.e., amount * 10^18)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(
                totalSupply() + amount,
                MAX_SUPPLY - totalSupply()
            );
        }
        _mint(to, amount);
    }
}
```

Deploy with Hardhat:

```typescript
// scripts/deploy-token.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AvalancheToken from:", deployer.address);

  const Token = await ethers.getContractFactory("AvalancheToken");
  const initialSupply = ethers.parseEther("10000000"); // 10M tokens

  const token = await Token.deploy("Avalanche Token", "AVTKN", initialSupply);
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log("✅ AvalancheToken deployed to:", address);
  console.log("Initial supply:", ethers.formatEther(await token.totalSupply()));
  console.log("Max supply:", ethers.formatEther(await token.MAX_SUPPLY()));

  // Gas cost comparison:
  // Ethereum mainnet: ~$15-50 for ERC-20 deployment (at 30 gwei, 1.5M gas)
  // Avalanche C-Chain: ~$0.10-0.30 for same deployment (at 25 nAVAX)
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/deploy-token.ts --network fuji
```

```
Expected output:
Deploying AvalancheToken from: 0xYourAddress...
✅ AvalancheToken deployed to: 0xTokenAddress...
Initial supply: 10000000.0
Max supply: 100000000.0
```

### Wrapped AVAX (WAVAX)

WAVAX is the ERC-20 wrapped version of native AVAX, similar to WETH on Ethereum. It's essential for DeFi protocols because native AVAX doesn't conform to the ERC-20 interface.

**WAVAX contract address:**
- Mainnet: `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7`
- Fuji: `0xd00ae08403B9bbb9124bB305C09058E32C39A48c`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IWAVAX
 * @notice Interface for the Wrapped AVAX contract.
 */
interface IWAVAX {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title WAVAXInteraction
 * @notice Demonstrates wrapping and unwrapping AVAX.
 */
contract WAVAXInteraction {
    // Fuji WAVAX address
    IWAVAX public constant WAVAX = IWAVAX(0xd00ae08403B9bbb9124bB305C09058E32C39A48c);

    event Wrapped(address indexed user, uint256 amount);
    event Unwrapped(address indexed user, uint256 amount);

    /**
     * @notice Wrap AVAX into WAVAX (ERC-20).
     * @dev Send native AVAX with this call — it gets converted to WAVAX.
     */
    function wrapAVAX() external payable {
        require(msg.value > 0, "Must send AVAX");
        WAVAX.deposit{value: msg.value}();
        // WAVAX is now held by this contract
        // Transfer to the caller
        WAVAX.transfer(msg.sender, msg.value);
        emit Wrapped(msg.sender, msg.value);
    }

    /**
     * @notice Unwrap WAVAX back to native AVAX.
     * @dev Caller must approve this contract to spend their WAVAX first.
     */
    function unwrapAVAX(uint256 amount) external {
        // Transfer WAVAX from caller to this contract
        require(
            IWAVAX(address(WAVAX)).balanceOf(msg.sender) >= amount,
            "Insufficient WAVAX"
        );
        // Note: caller must call WAVAX.approve(thisContract, amount) first
        WAVAX.withdraw(amount);
        // Send native AVAX back to caller
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "AVAX transfer failed");
        emit Unwrapped(msg.sender, amount);
    }

    receive() external payable {}
}
```

### Interacting with WAVAX via ethers.js

```typescript
// scripts/wavax-interaction.ts
import { ethers } from "hardhat";

const WAVAX_FUJI = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

const WAVAX_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const wavax = new ethers.Contract(WAVAX_FUJI, WAVAX_ABI, signer);

  // Check initial WAVAX balance
  const initialBalance = await wavax.balanceOf(signer.address);
  console.log("Initial WAVAX balance:", ethers.formatEther(initialBalance));

  // Wrap 0.1 AVAX → WAVAX
  console.log("\nWrapping 0.1 AVAX...");
  const wrapTx = await wavax.deposit({ value: ethers.parseEther("0.1") });
  await wrapTx.wait();

  const newBalance = await wavax.balanceOf(signer.address);
  console.log("WAVAX balance after wrap:", ethers.formatEther(newBalance));

  // Unwrap 0.05 WAVAX → AVAX
  console.log("\nUnwrapping 0.05 WAVAX...");
  const unwrapTx = await wavax.withdraw(ethers.parseEther("0.05"));
  await unwrapTx.wait();

  const finalBalance = await wavax.balanceOf(signer.address);
  console.log("WAVAX balance after unwrap:", ethers.formatEther(finalBalance));
}

main().catch(console.error);
```

```shell
npx hardhat run scripts/wavax-interaction.ts --network fuji
```

```
Expected output:
Initial WAVAX balance: 0.0
Wrapping 0.1 AVAX...
WAVAX balance after wrap: 0.1
Unwrapping 0.05 WAVAX...
WAVAX balance after unwrap: 0.05
```

### Cross-Chain Tokens (Avalanche Interchain Token Transfer)

Avalanche supports cross-chain token transfers between C-Chain and Subnets using Teleporter (Avalanche's native cross-chain messaging protocol). This enables tokens to exist on multiple chains within the Avalanche ecosystem.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts@5.0.1/token/ERC20/ERC20.sol";

/**
 * @title CrossChainToken
 * @notice A token designed for cross-Subnet transfers via Teleporter.
 * @dev In production, integrate with ITeleporterMessenger for actual cross-chain calls.
 *      This example shows the token-side interface pattern.
 */
contract CrossChainToken is ERC20 {
    address public bridge;
    mapping(bytes32 => bool) public processedMessages;

    error OnlyBridge();
    error MessageAlreadyProcessed(bytes32 messageId);

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address bridge_
    ) ERC20(name_, symbol_) {
        bridge = bridge_;
    }

    /**
     * @notice Called by the bridge when tokens arrive from another chain.
     * @param to Recipient on this chain
     * @param amount Amount to mint
     * @param messageId Unique cross-chain message identifier (prevents replay)
     */
    function bridgeMint(
        address to,
        uint256 amount,
        bytes32 messageId
    ) external onlyBridge {
        if (processedMessages[messageId]) {
            revert MessageAlreadyProcessed(messageId);
        }
        processedMessages[messageId] = true;
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens to initiate a cross-chain transfer.
     * @param amount Amount to send to the destination chain
     * @dev In production, this would call Teleporter to send a message
     *      to the destination chain's bridge contract.
     */
    function bridgeBurn(uint256 amount) external {
        _burn(msg.sender, amount);
        // In production: call ITeleporterMessenger.sendCrossChainMessage(...)
    }
}
```

### Token Comparison: C-Chain vs X-Chain

| Feature | C-Chain ERC-20 | X-Chain Native Asset |
|---------|---------------|---------------------|
| Smart contract logic | ✅ Full Solidity | ❌ No smart contracts |
| DeFi composability | ✅ Works with Uniswap forks, Aave, etc. | ❌ Not composable |
| Transfer speed | ~2 seconds | Sub-second |
| Transfer cost | ~0.001 AVAX | ~0.001 AVAX |
| Programmable rules | ✅ Mint caps, vesting, access control | ❌ Fixed at creation |
| Best for | DeFi, NFTs, complex token logic | Simple asset transfers, payments |

---

## Common Pitfalls

1. **Using the wrong WAVAX address per network** — WAVAX has different contract addresses on Mainnet (`0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7`) and Fuji (`0xd00ae08403B9bbb9124bB305C09058E32C39A48c`). Hardcoding the wrong address means your contract silently interacts with a non-existent or wrong contract. Always use environment-based configuration.

2. **Forgetting to approve before transferFrom** — This is the same as Ethereum, but worth repeating: any contract that needs to move your ERC-20 tokens (DEX routers, lending protocols, bridges) must first be approved via `token.approve(spenderAddress, amount)`. Without approval, `transferFrom` reverts.

3. **Not accounting for AVAX's 18 decimals in calculations** — Like ETH, AVAX uses 18 decimal places. `1 AVAX = 1e18 wei`. When displaying balances in a UI, always use `ethers.formatEther()` or divide by `10**18`. Forgetting this leads to displaying astronomically large numbers or sending dust amounts.

4. **Assuming cross-chain transfers are instant** — While C-Chain transactions finalize in ~2 seconds, cross-chain transfers between C-Chain and Subnets (via Teleporter) require message relay and confirmation on both chains. Expect 10-30 seconds for cross-Subnet transfers. Design your UX to show pending states.

5. **Deploying tokens without a max supply cap** — Tokens with unlimited minting capability are a red flag for users and auditors. Always implement a `MAX_SUPPLY` constant and check it in your `mint` function. Even if you plan to never hit the cap, having it signals responsible tokenomics.

---

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect Core wallet and MetaMask to your dApp, read token balances from C-Chain
- [Trader Joe DEX documentation](https://docs.traderjoexyz.com/) — The largest DEX on Avalanche, useful for understanding token liquidity
- [Avalanche Teleporter](https://github.com/ava-labs/teleporter) — Official cross-chain messaging protocol for Subnet-to-Subnet communication
