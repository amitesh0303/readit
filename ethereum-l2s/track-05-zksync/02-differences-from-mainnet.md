# zkSync Era vs Ethereum Mainnet: What's Different

**Track:** zkSync Era Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You have Solidity contracts that work on Ethereum mainnet. You want to deploy them to zkSync Era. The marketing says "EVM-compatible," but the reality is more nuanced. zkSync Era is a Type 3 zkEVM — most Solidity code works, but there are meaningful differences in gas costs, opcode behavior, contract deployment, and system contracts that can break your code or produce unexpected results. This lesson catalogs every difference that matters for developers.

## Core Concepts

### EVM Compatibility Classification

zkSync Era is classified as a **Type 3 zkEVM**:

```
Type 1: Fully EVM-equivalent (bytecode identical) — Scroll
Type 2: EVM-equivalent with minor gas differences — Polygon zkEVM
Type 3: EVM-compatible (most opcodes work, some differ) — zkSync Era
Type 4: High-level language compatible (different VM) — StarkNet
```

This means: your Solidity source code compiles and runs, but the compiled bytecode is different, some opcodes behave differently, and gas costs don't match Ethereum.

### Compilation Differences

On Ethereum, you compile Solidity → EVM bytecode. On zkSync Era, there's an extra step:

```shell
# Ethereum compilation
solc --bin MyContract.sol → EVM bytecode (deployable to Ethereum)

# zkSync Era compilation
solc → Yul IR → zksolc → EraVM bytecode (deployable to zkSync only)
```

Key implications:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AddressPredictor {
    // CREATE2 address prediction — DIFFERENT on zkSync Era
    function predictAddress(
        bytes32 salt,
        bytes32 bytecodeHash,
        bytes memory constructorArgs
    ) public view returns (address) {
        // On Ethereum:
        // address = keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))

        // On zkSync Era:
        // address = keccak256(
        //   keccak256("zksyncCreate2") ++
        //   sender ++
        //   salt ++
        //   bytecodeHash ++
        //   keccak256(constructorArgs)
        // )
        // The bytecodeHash is the hash of EraVM bytecode, not EVM bytecode

        // Use the system contract for correct prediction:
        // IContractDeployer(0x0000000000000000000000000000000000008006)
        //   .getNewAddressCreate2(sender, bytecodeHash, salt, constructorArgs)

        // This is a simplified illustration — use the system contract in practice
        return address(0);
    }
}
```

### Gas Model Differences

zkSync Era's gas model is fundamentally different from Ethereum:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract GasDifferences {
    // On Ethereum: SSTORE costs 20,000 gas (cold) or 5,000 gas (warm)
    // On zkSync Era: storage writes cost varies based on:
    //   - Whether the slot was previously empty
    //   - The pubdata cost (state diff published to L1)
    //   - The computational cost in the zkEVM circuit

    mapping(address => uint256) public balances;

    // This function costs ~50,000 gas on Ethereum
    // On zkSync Era it might cost 200,000-500,000 "gas" units
    // BUT the actual USD cost is lower because gas price is much lower
    function updateBalance(address user, uint256 amount) external {
        balances[user] = amount;
    }

    // Pubdata cost: every byte of state diff published to L1 costs gas
    // Writing a 32-byte value to a new slot = 32 bytes of pubdata
    // This is the dominant cost on zkSync Era for storage-heavy operations
}
```

**Gas price comparison** (approximate, January 2025):

| Operation | Ethereum Mainnet | zkSync Era | Savings |
|-----------|-----------------|------------|---------|
| ETH transfer | ~21,000 gas × 30 gwei = $1.50 | ~0.000045 ETH = $0.14 | ~90% |
| ERC-20 transfer | ~65,000 gas × 30 gwei = $4.70 | ~0.00015 ETH = $0.45 | ~90% |
| Uniswap swap | ~150,000 gas × 30 gwei = $10.80 | ~0.0004 ETH = $1.20 | ~89% |
| Contract deploy (simple) | ~300,000 gas × 30 gwei = $21.60 | ~0.001 ETH = $3.00 | ~86% |

### Opcode and Precompile Differences

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OpcodeDifferences {
    // ❌ SELFDESTRUCT — not supported, will revert
    // function destroy() external { selfdestruct(payable(msg.sender)); }

    // ⚠️ EXTCODECOPY — works only for the contract's own code
    // Cannot copy arbitrary contract bytecode

    // ⚠️ CODECOPY — returns EraVM bytecode, not EVM bytecode
    // If you rely on bytecode introspection, results will differ

    // ✅ block.number — returns L2 batch number (not L1 block number)
    function getCurrentBatch() external view returns (uint256) {
        return block.number; // This is the L2 batch number
    }

    // ✅ block.timestamp — works as expected
    function getCurrentTime() external view returns (uint256) {
        return block.timestamp;
    }

    // ⚠️ tx.origin — works but may differ for account abstraction txs
    // In AA transactions, tx.origin is the bootloader address
    function getOrigin() external view returns (address) {
        return tx.origin;
    }

    // ⚠️ gasleft() — returns remaining "ergs" (zkSync gas units)
    // Not directly comparable to Ethereum gas
    function checkGas() external view returns (uint256) {
        return gasleft();
    }

    // ✅ ecrecover — works identically
    function verifySignature(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address) {
        return ecrecover(hash, v, r, s);
    }
}
```

### System Contracts

zkSync Era has system contracts at fixed addresses that provide L2-specific functionality:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// System contract addresses on zkSync Era
interface IZkSyncSystemContracts {
    // 0x0000000000000000000000000000000000008001 — ContractDeployer
    // All contract deployments go through this contract

    // 0x0000000000000000000000000000000000008002 — NonceHolder
    // Manages nonces for accounts (supports arbitrary nonce ordering)

    // 0x0000000000000000000000000000000000008006 — ContractDeployer
    // Handles CREATE and CREATE2 deployments

    // 0x0000000000000000000000000000000000008008 — L1Messenger
    // Sends messages from L2 to L1

    // 0x0000000000000000000000000000000000008010 — L2BaseToken (ETH)
    // ETH is handled as an ERC-20 internally
}

import "@matterlabs/zk-contracts/l2/system-contracts/Constants.sol";

contract SystemContractExample {
    // Get the deployment nonce for an account
    function getDeploymentNonce(address account) external view returns (uint256) {
        return INonceHolder(NONCE_HOLDER_SYSTEM_CONTRACT)
            .getDeploymentNonce(account);
    }

    // Send a message to L1 (for custom bridge logic)
    function sendToL1(bytes memory message) external returns (bytes32) {
        return IL1Messenger(L1_MESSENGER_SYSTEM_CONTRACT)
            .sendToL1(message);
    }
}
```

### Contract Deployment Differences

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DeploymentDifferences {
    // On Ethereum: deploy with CREATE or CREATE2 directly
    // On zkSync Era: all deployments go through the ContractDeployer system contract

    // Factory pattern — must declare dependencies at compile time
    // zkSync requires knowing all bytecode hashes upfront

    // ❌ This pattern doesn't work on zkSync Era:
    // bytes memory bytecode = type(ChildContract).creationCode;
    // assembly { addr := create(0, add(bytecode, 0x20), mload(bytecode)) }

    // ✅ Use the system deployer or Hardhat's deployer utilities:
    // import "@matterlabs/hardhat-zksync-deploy";
    // const deployer = new Deployer(hre, wallet);
    // const artifact = await deployer.loadArtifact("ChildContract");
    // const child = await deployer.deploy(artifact, [constructorArgs]);
}
```

### Libraries and Linking

On zkSync Era, libraries are handled differently:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Libraries that use internal functions only — work fine (inlined)
library MathLib {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
}

// Libraries with public/external functions — require explicit deployment and linking
// On Ethereum: linked at compile time via bytecode replacement
// On zkSync Era: linked at compile time via zksolc configuration
library ExternalMathLib {
    function multiply(uint256 a, uint256 b) public pure returns (uint256) {
        return a * b;
    }
}

// In hardhat.config.ts for zkSync:
// zksolc: {
//   settings: {
//     libraries: {
//       "contracts/ExternalMathLib.sol": {
//         "ExternalMathLib": "0xDeployedLibraryAddress"
//       }
//     }
//   }
// }
```

## Common Pitfalls

1. **Using `type(Contract).creationCode` in factory patterns** — On zkSync Era, you cannot access raw creation code in assembly. Factory contracts must use the `ContractDeployer` system contract or declare factory dependencies in the compiler configuration. This breaks many existing factory patterns from Ethereum.

2. **Relying on `msg.sender == tx.origin` for EOA checks** — With native account abstraction, smart contract wallets are common on zkSync Era. The `tx.origin == msg.sender` check to detect EOAs will reject legitimate smart wallet users. Use proper access control instead.

3. **Hardcoding gas limits from Ethereum** — Gas units on zkSync Era ("ergs") are not equivalent to Ethereum gas. A function that costs 50,000 gas on Ethereum might cost 500,000 ergs on zkSync. Never hardcode gas limits — always use `gasleft()` checks or let the RPC estimate gas.

4. **Expecting identical `CREATE2` addresses** — Because bytecode is different (EraVM vs EVM), `CREATE2` produces different addresses on zkSync Era than on Ethereum for the same Solidity source. If your protocol relies on deterministic cross-chain addresses, you need a different approach.

5. **Not testing with the zkSync compiler** — Code that compiles with `solc` may fail with `zksolc` due to unsupported patterns (inline assembly using specific opcodes, certain Yul constructs). Always compile and test with the zkSync toolchain before deployment.

## What to Learn Next

- [Bridging Assets on zkSync Era](./03-bridging-assets.md) — How to move ETH and tokens between Ethereum and zkSync Era
- [zkSync Era EVM Differences Reference](https://docs.zksync.io/build/developer-reference/ethereum-differences) — Official compatibility documentation
- [EraVM Specification](https://github.com/matter-labs/era-compiler-llvm-context) — Technical details of the zkSync virtual machine
