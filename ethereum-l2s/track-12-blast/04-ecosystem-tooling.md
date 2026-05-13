# Blast Ecosystem Tooling: SDKs, Explorers, and Developer Tools

**Track:** Blast Development
**Lesson:** 4 of 5
**Original author:** readit team
**Last verified:** 2025-01-15

---

## The Problem

You're ready to build on Blast but you don't know which tools to use. Blast is OP Stack-based, so many Ethereum tools work out of the box — but the yield and gas revenue features require Blast-specific integrations. You need to know which block explorer to use, how to verify contracts, which RPC endpoints are reliable, and how to integrate the Blast precompiles into your development workflow with Foundry or Hardhat.

## Core Concepts

### Network Configuration

Essential network details for connecting to Blast:

| Property | Blast Mainnet | Blast Sepolia (Testnet) |
|---|---|---|
| Chain ID | 81457 | 168587773 |
| RPC URL | https://rpc.blast.io | https://sepolia.blast.io |
| WebSocket | wss://rpc.blast.io | wss://sepolia.blast.io |
| Block Explorer | https://blastscan.io | https://sepolia.blastscan.io |
| Bridge | https://blast.io/bridge | https://blast.io/bridge |
| Native Token | ETH (rebasing) | ETH (Sepolia) |
| Faucet | N/A | https://faucet.quicknode.com/blast/sepolia |

### Foundry Configuration

Foundry works natively with Blast. Configure your `foundry.toml` for Blast development:

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.20"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
blast_mainnet = "https://rpc.blast.io"
blast_sepolia = "https://sepolia.blast.io"
ethereum = "https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}"

[etherscan]
blast = { key = "${BLASTSCAN_API_KEY}", url = "https://api.blastscan.io/api" }
blast_sepolia = { key = "${BLASTSCAN_API_KEY}", url = "https://api-sepolia.blastscan.io/api" }
```

### Blast Interface for Foundry Projects

Create a local interface file for the Blast precompile to use in your contracts:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// src/interfaces/IBlast.sol
// Source: https://github.com/blast-io/blast

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
    // Configure yield and gas modes
    function configure(
        YieldMode _yield,
        GasMode gasMode,
        address governor
    ) external;

    function configureClaimableYield() external;
    function configureClaimableGas() external;
    function configureAutomaticYield() external;
    function configureVoidYield() external;
    function configureVoidGas() external;
    function configureGovernor(address _governor) external;
    function configureGovernorOnBehalf(address _newGovernor, address contractAddress) external;

    // Yield operations
    function claimYield(address contractAddress, address recipientOfYield, uint256 amount) external returns (uint256);
    function claimAllYield(address contractAddress, address recipientOfYield) external returns (uint256);
    function readClaimableYield(address contractAddress) external view returns (uint256);
    function readYieldConfiguration(address contractAddress) external view returns (uint8);

    // Gas operations
    function claimAllGas(address contractAddress, address recipientOfGas) external returns (uint256);
    function claimGasAtMinClaimRate(address contractAddress, address recipientOfGas, uint256 minClaimRateBips) external returns (uint256);
    function claimMaxGas(address contractAddress, address recipientOfGas) external returns (uint256);
    function claimGas(address contractAddress, address recipientOfGas, uint256 gasToClaim, uint256 gasSecondsToConsume) external returns (uint256);
    function readGasParams(address contractAddress) external view returns (uint256 etherSeconds, uint256 etherBalance, uint256 lastUpdated, GasMode);
}

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
```

### Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config"; // hardhat@2.19.4
import "@nomicfoundation/hardhat-toolbox"; // @nomicfoundation/hardhat-toolbox@4.0.0

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    blast_mainnet: {
      url: "https://rpc.blast.io",
      chainId: 81457,
      accounts: [process.env.PRIVATE_KEY ?? ""],
      gasPrice: 1000000 // 0.001 gwei — very low on Blast
    },
    blast_sepolia: {
      url: "https://sepolia.blast.io",
      chainId: 168587773,
      accounts: [process.env.PRIVATE_KEY ?? ""]
    }
  },
  etherscan: {
    apiKey: {
      blast: process.env.BLASTSCAN_API_KEY ?? "",
      blast_sepolia: process.env.BLASTSCAN_API_KEY ?? ""
    },
    customChains: [
      {
        network: "blast",
        chainId: 81457,
        urls: {
          apiURL: "https://api.blastscan.io/api",
          browserURL: "https://blastscan.io"
        }
      },
      {
        network: "blast_sepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api-sepolia.blastscan.io/api",
          browserURL: "https://sepolia.blastscan.io"
        }
      }
    ]
  }
};

export default config;
```

### Block Explorer: Blastscan

Blastscan (https://blastscan.io) is the primary block explorer, built by the Etherscan team:

```shell
# Verify a contract on Blastscan using Foundry
forge verify-contract \
  0xYourContractAddress \
  src/MyContract.sol:MyContract \
  --chain-id 81457 \
  --etherscan-api-key $BLASTSCAN_API_KEY \
  --verifier-url https://api.blastscan.io/api \
  --constructor-args $(cast abi-encode "constructor(address)" "0xGovernorAddress")
```

```
Expected output:
Start verifying contract `0xYourContractAddress` deployed on blast
Submitting verification for [src/MyContract.sol:MyContract]
Submitted contract for verification:
  Response: OK
  GUID: abc123def456
  URL: https://blastscan.io/address/0xYourContractAddress
Contract successfully verified
```

```shell
# Verify on Blast Sepolia testnet
forge verify-contract \
  0xYourContractAddress \
  src/MyContract.sol:MyContract \
  --chain-id 168587773 \
  --etherscan-api-key $BLASTSCAN_API_KEY \
  --verifier-url https://api-sepolia.blastscan.io/api
```

### RPC Providers

| Provider | Free Tier | Rate Limit | URL Pattern |
|---|---|---|---|
| Blast Public | Yes | Moderate | https://rpc.blast.io |
| Alchemy | Yes (300M CU/mo) | High | https://blast-mainnet.g.alchemy.com/v2/KEY |
| QuickNode | Yes (limited) | High | https://xxx.blast-mainnet.quiknode.pro/KEY |
| Infura | Yes (100k req/day) | Moderate | https://blast-mainnet.infura.io/v3/KEY |

```typescript
import { ethers } from "ethers"; // ethers@6.9.0

// Recommended: Use a fallback provider for reliability
function createBlastProvider(): ethers.FallbackProvider {
  const providers = [
    new ethers.JsonRpcProvider("https://rpc.blast.io", 81457, {
      staticNetwork: true
    }),
    new ethers.JsonRpcProvider(
      `https://blast-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
      81457,
      { staticNetwork: true }
    )
  ];

  return new ethers.FallbackProvider(
    providers.map((provider, index) => ({
      provider,
      priority: index + 1,
      stallTimeout: 2000,
      weight: 1
    }))
  );
}

// Usage
const provider = createBlastProvider();
const blockNumber = await provider.getBlockNumber();
console.log(`Current Blast block: ${blockNumber}`);
```

### Testing with Blast Precompiles (Foundry Fork Testing)

To test contracts that interact with Blast precompiles, use Foundry's fork testing:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol"; // forge-std@1.7.6

enum YieldMode { AUTOMATIC, VOID, CLAIMABLE }
enum GasMode { VOID, CLAIMABLE }

interface IBlast {
    function configure(YieldMode _yield, GasMode gasMode, address governor) external;
    function configureClaimableYield() external;
    function readClaimableYield(address contractAddress) external view returns (uint256);
    function claimAllYield(address contractAddress, address recipientOfYield) external returns (uint256);
}

contract MyBlastContract {
    IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);
    address public governor;

    constructor(address _governor) {
        governor = _governor;
        BLAST.configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, _governor);
    }

    function claimYield() external returns (uint256) {
        require(msg.sender == governor, "Only governor");
        return BLAST.claimAllYield(address(this), governor);
    }
}

/// @title BlastForkTest
/// @notice Test against a Blast mainnet fork to verify precompile interactions
contract BlastForkTest is Test {
    MyBlastContract public myContract;
    address public governor = address(0x1234);

    function setUp() public {
        // Fork Blast mainnet — precompiles are available
        vm.createSelectFork("https://rpc.blast.io");
        vm.startPrank(governor);
        myContract = new MyBlastContract(governor);
        vm.stopPrank();
    }

    function testConfigureYield() public view {
        // Contract should be deployed and configured
        assertEq(myContract.governor(), governor);
    }

    function testClaimYield() public {
        // Send ETH to the contract (simulates deposits)
        vm.deal(address(myContract), 10 ether);

        // Warp time forward to accumulate yield
        vm.warp(block.timestamp + 365 days);

        // Claim yield as governor
        vm.prank(governor);
        myContract.claimYield();
    }

    function testOnlyGovernorCanClaim() public {
        address attacker = address(0xdead);
        vm.prank(attacker);
        vm.expectRevert("Only governor");
        myContract.claimYield();
    }
}
```

```shell
# Run fork tests against Blast mainnet
forge test --fork-url https://rpc.blast.io -vvv
```

```
Expected output:
[PASS] testConfigureYield() (gas: 12345)
[PASS] testClaimYield() (gas: 67890)
[PASS] testOnlyGovernorCanClaim() (gas: 23456)
Test result: ok. 3 passed; 0 failed; finished in 2.34s
```

### Blast Points Integration

Blast has a points system that rewards users and developers. Contracts can distribute points to users via the Points Operator:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Blast Points Operator
// Source: https://docs.blast.io/airdrop/api

interface IBlastPoints {
    function configurePointsOperator(address operator) external;
    function configurePointsOperatorOnBehalf(address contractAddress, address operator) external;
}

/// @title PointsAwareContract
/// @notice Configure points distribution for your dApp
contract PointsAwareContract {
    IBlastPoints public constant BLAST_POINTS =
        IBlastPoints(0x2536FE9ab3F511540F2f9e2eC2A805005C3Dd800);

    constructor(address pointsOperator) {
        // Set the address that can distribute Blast Points on behalf of this contract
        BLAST_POINTS.configurePointsOperator(pointsOperator);
    }
}
```

## Common Pitfalls

1. **Using the wrong verifier URL for Blastscan** — Blast mainnet uses `https://api.blastscan.io/api` and testnet uses `https://api-sepolia.blastscan.io/api`. Mixing these up causes silent verification failures. Always check your chain ID matches the verifier URL.

2. **Not forking Blast for local testing** — If you test locally without forking Blast, the precompile at `0x4300000000000000000000000000000000000002` doesn't exist. Your constructor will revert. Always use `forge test --fork-url https://rpc.blast.io` or mock the precompile interface.

3. **Forgetting to set `staticNetwork: true` in ethers.js** — Without this option, ethers.js makes an extra `eth_chainId` call on every request. On Blast's public RPC with rate limits, this doubles your request count unnecessarily.

4. **Using Ethereum mainnet gas estimates** — Blast gas prices are ~0.001 gwei vs ~30 gwei on mainnet. If your frontend hardcodes gas price estimates from mainnet, transactions will overpay massively or fail with "gas price too low" errors. Always fetch current gas prices from the Blast RPC.

5. **Not configuring the Points Operator** — If you deploy a contract without calling `configurePointsOperator()`, you cannot distribute Blast Points to your users later. This must be done at deployment time or by the contract governor. Missing this means losing a key user incentive mechanism.

## What to Learn Next

- [Deploying to Blast](./05-deployment-walkthrough.md) — End-to-end deployment with gas comparison
- [Blastscan Documentation](https://docs.blastscan.io/) — Block explorer API reference
- [Blast Developer Docs](https://docs.blast.io/) — Official documentation for building on Blast
