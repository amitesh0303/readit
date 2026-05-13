# Smart Contracts on Hedera

**Track:** Hedera Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You know Solidity and have deployed contracts on Ethereum or other EVM chains, but you're not sure how Hedera's Smart Contract Service differs. Hedera runs the Besu EVM, which means your Solidity code compiles the same way — but deployment, gas costs, contract size limits, and interaction patterns are different. You need to understand how to deploy via the Hedera SDK (not just a JSON-RPC endpoint), how HTS precompiles let your contracts interact with native tokens, and what EVM limitations exist on Hedera.

## Core Concepts

### Hedera Smart Contract Service (HSC)

Hedera runs Solidity contracts on the HyperLedger Besu EVM. Key differences from Ethereum:

| Property | Ethereum | Hedera HSC |
|----------|----------|------------|
| Deployment | Via JSON-RPC (eth_sendTransaction) | Via SDK or JSON-RPC relay |
| Gas limit | 30M per block | 15M per contract call |
| Contract size | 24KB (EIP-170) | 24KB per contract |
| SELFDESTRUCT | Deprecated (EIP-6780) | Not supported |
| Gas price | Variable (auction) | Fixed schedule |
| Contract ID | 0x address | 0.0.XXXXX + EVM address |

### Writing a Contract for Hedera

Standard Solidity works on Hedera. Here's a simple registry contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SimpleRegistry
/// @notice A key-value registry deployed on Hedera Smart Contract Service
contract SimpleRegistry {
    mapping(string => string) private entries;
    address public owner;

    event EntrySet(string indexed key, string value, address setter);

    error NotOwner();
    error EmptyKey();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Store a key-value pair
    /// @param key The lookup key (must not be empty)
    /// @param value The value to store
    function setEntry(string calldata key, string calldata value) external onlyOwner {
        if (bytes(key).length == 0) revert EmptyKey();
        entries[key] = value;
        emit EntrySet(key, value, msg.sender);
    }

    /// @notice Retrieve a value by key
    /// @param key The lookup key
    /// @return The stored value (empty string if not set)
    function getEntry(string calldata key) external view returns (string memory) {
        return entries[key];
    }
}
```

### Compiling with solc

```shell
# Install solc (Solidity compiler)
npm install solc@0.8.20

# Or use solcjs directly
npx solcjs --bin --abi contracts/SimpleRegistry.sol -o build/
```

### Deploying via Hedera SDK

Unlike Ethereum where you send a transaction to the zero address, Hedera uses `ContractCreateFlow` which handles file upload + contract creation in one step:

```javascript
// deploy.js — Deploy a Solidity contract to Hedera testnet
const {
    Client,
    AccountId,
    PrivateKey,
    ContractCreateFlow,
    ContractFunctionParameters,
    ContractCallQuery,
    Hbar,
} = require("@hashgraph/sdk");
const fs = require("fs");
require("dotenv").config();

async function deployContract() {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = process.env.HEDERA_PRIVATE_KEY;

    if (!accountId || !privateKey) {
        throw new Error("Missing credentials in .env");
    }

    const client = Client.forTestnet();
    client.setOperator(
        AccountId.fromString(accountId),
        PrivateKey.fromStringDer(privateKey)
    );
    client.setDefaultMaxTransactionFee(new Hbar(10));

    // Read compiled bytecode
    const bytecode = fs.readFileSync("build/SimpleRegistry_sol_SimpleRegistry.bin");

    // Deploy using ContractCreateFlow (handles file upload + create)
    const contractTx = new ContractCreateFlow()
        .setBytecode(bytecode)
        .setGas(500000) // Gas for constructor execution
        .setAdminKey(PrivateKey.fromStringDer(privateKey));

    const contractResponse = await contractTx.execute(client);
    const contractReceipt = await contractResponse.getReceipt(client);
    const contractId = contractReceipt.contractId;

    console.log(`Contract deployed!`);
    console.log(`Contract ID: ${contractId.toString()}`);
    console.log(`EVM Address: ${contractId.toSolidityAddress()}`);
    console.log(
        `View on HashScan: https://hashscan.io/testnet/contract/${contractId.toString()}`
    );

    client.close();
    return contractId;
}

deployContract().catch(console.error);
```

```
Expected output:
Contract deployed!
Contract ID: 0.0.4812345
EVM Address: 0x0000000000000000000000000000000000496d79
View on HashScan: https://hashscan.io/testnet/contract/0.0.4812345
```

### Calling Contract Functions

```javascript
// interact.js — Call functions on a deployed contract
const {
    Client,
    AccountId,
    PrivateKey,
    ContractExecuteTransaction,
    ContractCallQuery,
    ContractFunctionParameters,
    Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

async function interactWithContract(contractId) {
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = process.env.HEDERA_PRIVATE_KEY;

    const client = Client.forTestnet();
    client.setOperator(
        AccountId.fromString(accountId),
        PrivateKey.fromStringDer(privateKey)
    );
    client.setDefaultMaxTransactionFee(new Hbar(5));

    // Write: Call setEntry (state-changing, costs gas)
    const setTx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(200000)
        .setFunction(
            "setEntry",
            new ContractFunctionParameters()
                .addString("project")
                .addString("Hedera dApp")
        );

    const setResponse = await setTx.execute(client);
    const setReceipt = await setResponse.getReceipt(client);
    console.log(`setEntry status: ${setReceipt.status.toString()}`);

    // Read: Call getEntry (view function, costs query fee)
    const getQuery = new ContractCallQuery()
        .setContractId(contractId)
        .setGas(100000)
        .setFunction(
            "getEntry",
            new ContractFunctionParameters().addString("project")
        );

    const getResult = await getQuery.execute(client);
    const value = getResult.getString(0);
    console.log(`getEntry("project") = "${value}"`);

    client.close();
}

// Replace with your deployed contract ID
interactWithContract("0.0.4812345").catch(console.error);
```

```
Expected output:
setEntry status: SUCCESS
getEntry("project") = "Hedera dApp"
```

### JSON-RPC Relay (Ethereum-Compatible Access)

Hedera also provides a JSON-RPC relay for tools that expect standard Ethereum RPC:

```javascript
// hardhat.config.js — Use Hedera JSON-RPC relay with Hardhat
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
    solidity: "0.8.20",
    networks: {
        hederaTestnet: {
            url: "https://testnet.hashio.io/api",
            accounts: [process.env.HEDERA_EVM_PRIVATE_KEY],
            chainId: 296,
        },
    },
};
```

This lets you use Hardhat, Foundry, or any EVM tooling — but the native SDK gives you more control over gas, keys, and Hedera-specific features.

### HTS System Contract (Precompile)

Hedera exposes the Token Service as a precompile at address `0x167`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@hashgraph/smart-contracts/contracts/hts-precompile/IHederaTokenService.sol";

/// @title TokenInteractor
/// @notice Interact with HTS tokens from a smart contract
contract TokenInteractor {
    address constant HTS_PRECOMPILE = address(0x167);

    /// @notice Transfer HTS tokens using the precompile
    /// @param token The HTS token address
    /// @param from Sender account
    /// @param to Recipient account
    /// @param amount Amount to transfer
    function transferToken(
        address token,
        address from,
        address to,
        int64 amount
    ) external returns (int responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSelector(
                IHederaTokenService.transferToken.selector,
                token,
                from,
                to,
                amount
            )
        );
        require(success, "HTS precompile call failed");
        responseCode = abi.decode(result, (int));
    }
}
```

## Common Pitfalls

1. **Setting gas too low for deployment** — Hedera's gas costs differ from Ethereum. A contract that costs 200K gas on Ethereum might need 500K+ on Hedera due to different opcode pricing. Start with generous gas limits on testnet and optimize after measuring actual usage.

2. **Forgetting the admin key** — Contracts deployed without `setAdminKey()` are immutable — you cannot update or delete them. Always set an admin key during development. For production, decide intentionally whether immutability is desired.

3. **Using `SELFDESTRUCT` in contracts** — Hedera does not support `SELFDESTRUCT`. Contracts that rely on this opcode will fail. Use a pause/disable pattern instead if you need to deactivate a contract.

4. **Ignoring the HTS precompile** — If your contract needs to create or transfer tokens, use the HTS precompile at `0x167` instead of deploying your own ERC-20. HTS tokens are cheaper, faster, and have built-in compliance features (KYC, freeze, wipe).

## What to Learn Next

- [Hedera Token Service](./04-token-service.md) — Create and manage tokens without writing smart contracts
- [Hedera Smart Contract Docs](https://docs.hedera.com/hedera/sdks-and-apis/smart-contracts) — Full reference for HSC deployment and interaction
