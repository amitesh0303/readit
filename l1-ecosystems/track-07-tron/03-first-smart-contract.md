# Your First Smart Contract: TRC-20 Token on Shasta

**Track:** Tron Development
**Level:** Beginner → Intermediate
**Read time:** 15 min

---

## The Problem

You've set up TronBox and connected to Shasta, but you haven't deployed a real contract yet. TRC-20 is Tron's fungible token standard (equivalent to ERC-20), and it's the most common contract type on the network — USDT on Tron is a TRC-20 token handling billions in daily volume. This lesson walks you through writing, deploying, and verifying a TRC-20 token on Shasta testnet, including energy estimation so you don't get surprised by costs on mainnet.

---

## Core Concepts

### TRC-20 Standard Interface

TRC-20 is functionally identical to ERC-20. The same Solidity interface works on both chains:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITRC20
 * @dev TRC-20 token standard interface (identical to ERC-20)
 */
interface ITRC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
```

### Complete TRC-20 Implementation

```solidity
// contracts/MyToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MyToken
 * @dev A complete TRC-20 token with minting capability
 * @notice Deploy to Shasta testnet for testing
 */
contract MyToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6; // Tron convention: 6 decimals (like TRX)
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "MyToken: caller is not the owner");
        _;
    }

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;

        // Mint initial supply to deployer
        // _initialSupply is in whole tokens, we multiply by 10^decimals
        uint256 supply = _initialSupply * (10 ** uint256(decimals));
        _balances[msg.sender] = supply;
        totalSupply = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "MyToken: transfer to zero address");
        require(_balances[msg.sender] >= amount, "MyToken: insufficient balance");

        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != address(0), "MyToken: approve to zero address");

        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address _owner, address spender) external view returns (uint256) {
        return _allowances[_owner][spender];
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(to != address(0), "MyToken: transfer to zero address");
        require(_balances[from] >= amount, "MyToken: insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "MyToken: insufficient allowance");

        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MyToken: mint to zero address");

        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
```

### Migration Script

```javascript
// migrations/2_deploy_token.js
const MyToken = artifacts.require("MyToken");

module.exports = function (deployer) {
  // Deploy with: name, symbol, initial supply (1,000,000 tokens)
  deployer.deploy(MyToken, "My Test Token", "MTT", 1000000);
};
```

### Energy Estimation Before Deployment

Always estimate energy costs before deploying to avoid failed transactions:

```javascript
// scripts/estimate-energy.js
const TronWeb = require("tronweb@5.3.2");

const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY
});

async function estimateDeploymentEnergy() {
  const contractSource = require("../build/contracts/MyToken.json");

  // Use triggerConstantContract for estimation
  const tx = await tronWeb.transactionBuilder.createSmartContract({
    abi: contractSource.abi,
    bytecode: contractSource.bytecode,
    feeLimit: 1000000000, // 1000 TRX max fee
    callValue: 0,
    parameters: ["My Test Token", "MTT", 1000000]
  }, tronWeb.defaultAddress.hex);

  console.log("Estimated energy:", tx.raw_data.contract[0].parameter.value.new_contract);
  console.log("Fee limit (sun):", tx.raw_data.fee_limit);

  // Typical deployment costs:
  // - Simple TRC-20: ~200,000-400,000 energy
  // - Complex contract: 500,000-1,000,000 energy
  // - At current rates: 1 energy ≈ 420 sun
  // - 400,000 energy × 420 sun = 168,000,000 sun = 168 TRX
}

estimateDeploymentEnergy().catch(console.error);
```

### Deploying to Shasta

```shell
# Ensure you have test TRX
# Faucet: https://www.trongrid.io/shasta

# Compile
tronbox compile

# Deploy to Shasta
tronbox migrate --network shasta

# Expected output:
# Running migration: 2_deploy_token.js
#   Deploying MyToken...
#   > transaction hash: 4a7b2c...
#   > contract address: TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW
#   > energy used: 347,892
#   > bandwidth used: 1,245
#   Saving artifacts...

# Verify on Shasta TronScan:
# https://shasta.tronscan.org/#/contract/TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW
```

### Interacting with the Deployed Contract

```javascript
// scripts/interact.js
const TronWeb = require("tronweb@5.3.2");

const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY
});

async function interact() {
  const contractAddress = "TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW"; // your deployed address
  const contract = await tronWeb.contract().at(contractAddress);

  // Read token info
  const name = await contract.name().call();
  const symbol = await contract.symbol().call();
  const totalSupply = await contract.totalSupply().call();
  console.log(`Token: ${name} (${symbol})`);
  console.log(`Total Supply: ${totalSupply / 1e6} tokens`);

  // Check balance
  const myAddress = tronWeb.defaultAddress.base58;
  const balance = await contract.balanceOf(myAddress).call();
  console.log(`My balance: ${balance / 1e6} ${symbol}`);

  // Transfer tokens (amount in smallest unit: 100 tokens = 100 * 10^6)
  const recipient = "TRecipientAddressHere";
  const amount = 100 * 1e6; // 100 tokens
  const tx = await contract.transfer(recipient, amount).send({
    feeLimit: 100000000 // 100 TRX fee limit
  });
  console.log(`Transfer tx: ${tx}`);
}

interact().catch(console.error);
```

### Writing Tests

```javascript
// test/MyToken.test.js
const MyToken = artifacts.require("MyToken");

contract("MyToken", (accounts) => {
  let token;
  const deployer = accounts[0];
  const recipient = accounts[1];
  const INITIAL_SUPPLY = 1000000;
  const DECIMALS = 6;
  const TOTAL = INITIAL_SUPPLY * (10 ** DECIMALS);

  before(async () => {
    token = await MyToken.deployed();
  });

  it("should have correct name and symbol", async () => {
    const name = await token.name();
    const symbol = await token.symbol();
    assert.equal(name, "My Test Token");
    assert.equal(symbol, "MTT");
  });

  it("should assign total supply to deployer", async () => {
    const balance = await token.balanceOf(deployer);
    assert.equal(balance.toNumber(), TOTAL);
  });

  it("should transfer tokens correctly", async () => {
    const amount = 1000 * (10 ** DECIMALS); // 1000 tokens
    await token.transfer(recipient, amount, { from: deployer });

    const recipientBalance = await token.balanceOf(recipient);
    assert.equal(recipientBalance.toNumber(), amount);
  });

  it("should fail transfer with insufficient balance", async () => {
    try {
      const tooMuch = (INITIAL_SUPPLY + 1) * (10 ** DECIMALS);
      await token.transfer(recipient, tooMuch, { from: deployer });
      assert.fail("Should have thrown");
    } catch (error) {
      assert(error.message.includes("insufficient balance"));
    }
  });
});
```

```shell
# Run tests on Shasta
tronbox test --network shasta

# Expected output:
# Contract: MyToken
#   ✓ should have correct name and symbol (85ms)
#   ✓ should assign total supply to deployer (92ms)
#   ✓ should transfer tokens correctly (3150ms)
#   ✓ should fail transfer with insufficient balance (3200ms)
# 4 passing (6.5s)
```

---

## Common Pitfalls

1. **Using 18 decimals instead of 6** — Tron convention is 6 decimals for fungible tokens (matching TRX itself). USDT-TRC20 uses 6 decimals. If you use 18 decimals like on Ethereum, your token will work but will confuse users and wallets that expect 6. Check what standard your ecosystem partners expect.

2. **Setting feeLimit too low** — The `feeLimit` parameter caps how much TRX can be burned for energy. If your contract deployment needs 400,000 energy (168 TRX at current rates) but you set feeLimit to 50 TRX, the transaction will fail with `OUT_OF_ENERGY` and you lose the burned TRX up to that point. Set feeLimit generously (1000 TRX for deployments) and let the actual cost be lower.

3. **Not checking transaction result** — TronBox's `send()` returns a transaction hash immediately, but the transaction might still fail on-chain. Always check the transaction result on TronScan or poll `tronWeb.trx.getTransactionInfo(txId)` to confirm `receipt.result === 'SUCCESS'`.

4. **Forgetting to handle the address format** — Tron uses base58 addresses externally (T...) but hex internally (41...). When passing addresses to contract functions via TronWeb, you can use either format — TronWeb converts automatically. But if you're building raw transactions or comparing addresses, be aware of both formats.

5. **Deploying without verifying the contract** — Unverified contracts on TronScan show only bytecode, making it impossible for users to audit. After deployment, verify your contract source on TronScan (Shasta or mainnet) so the ABI and source are publicly visible.

---

## What to Learn Next

- [Token Standards Deep Dive](./04-token-standards.md) — TRC-20, TRC-721, and TRC-1155 standards with implementation details
- [TronScan Contract Verification](https://tronscan.org/#/tools/contract-verification) — Verify your deployed contracts
