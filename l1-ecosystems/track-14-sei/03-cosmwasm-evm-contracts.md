# CosmWasm and EVM Smart Contracts on Sei

**Track:** Sei Development
**Level:** Beginner → Intermediate
**Read time:** 16 min

---

## The Problem

Sei gives you two ways to write smart contracts: Solidity (EVM) and Rust (CosmWasm). You need to understand when to use each, how they interact through pointer contracts and precompiles, and how to deploy a working contract to Sei's testnet. This lesson walks through writing and deploying contracts in both environments and shows how they communicate with each other.

---

## Core Concepts

### Choosing Your Execution Environment

| Criteria | Use EVM (Solidity) | Use CosmWasm (Rust) |
|----------|-------------------|---------------------|
| Existing codebase | Porting from Ethereum/L2s | Building from scratch |
| Tooling preference | Hardhat, Foundry, MetaMask | seid CLI, Keplr |
| Cross-chain needs | EVM-compatible chains | IBC (Cosmos ecosystem) |
| Performance | Good (parallelized) | Good (parallelized) |
| Token standard | ERC-20, ERC-721 | CW-20, CW-721 |
| DeFi composability | Ethereum DeFi patterns | Cosmos DeFi patterns |

### EVM Contract: Deploying a Token on Sei

```solidity
// src/SeiToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts@5.0.0/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title SeiToken
 * @notice ERC-20 token deployed on Sei's parallelized EVM
 * @dev Standard ERC-20 with mint capability for the owner
 */
contract SeiToken is ERC20, Ownable {
    uint8 private constant TOKEN_DECIMALS = 18;
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**TOKEN_DECIMALS; // 1B tokens

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialSupply > MAX_SUPPLY) {
            revert ExceedsMaxSupply(initialSupply, MAX_SUPPLY);
        }
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(
                totalSupply() + amount,
                MAX_SUPPLY - totalSupply()
            );
        }
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
```

```shell
# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.0 --no-commit

# Add remapping
echo "@openzeppelin/contracts@5.0.0/=lib/openzeppelin-contracts/contracts/" >> remappings.txt

# Compile
forge build

# Expected output:
# [⠊] Compiling...
# [⠊] Compiling 1 files with Solc 0.8.25
# [⠊] Solc 0.8.25 finished in 1.23s
# Compiler run successful!

# Deploy to Sei testnet
source .env
forge create src/SeiToken.sol:SeiToken \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY \
  --constructor-args "Sei Example Token" "SET" 1000000000000000000000000

# Expected output:
# Deployer: 0x7B4f352Cd40114f12e82fC675b5BA8C7582FC513
# Deployed to: 0xE4F5A6B7C8D9...
# Transaction hash: 0xdef456...
```

### EVM Contract: Writing Tests

```solidity
// test/SeiToken.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import "../src/SeiToken.sol";

contract SeiTokenTest is Test {
    SeiToken public token;
    address public owner = address(this);
    address public user1 = address(0x1);
    address public user2 = address(0x2);

    uint256 constant INITIAL_SUPPLY = 1_000_000 * 1e18;

    function setUp() public {
        token = new SeiToken("Sei Example Token", "SET", INITIAL_SUPPLY);
    }

    function test_InitialSupply() public view {
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY);
    }

    function test_Transfer() public {
        uint256 amount = 1000 * 1e18;
        token.transfer(user1, amount);
        assertEq(token.balanceOf(user1), amount);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY - amount);
    }

    function test_MintByOwner() public {
        uint256 mintAmount = 500 * 1e18;
        token.mint(user1, mintAmount);
        assertEq(token.balanceOf(user1), mintAmount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY + mintAmount);
    }

    function test_RevertMintExceedsMax() public {
        uint256 tooMuch = token.MAX_SUPPLY() + 1;
        vm.expectRevert();
        token.mint(user1, tooMuch);
    }

    function test_Burn() public {
        uint256 burnAmount = 100 * 1e18;
        token.burn(burnAmount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY - burnAmount);
    }
}
```

```shell
# Run tests
forge test -vvv

# Expected output:
# [PASS] test_Burn() (gas: 34521)
# [PASS] test_InitialSupply() (gas: 12043)
# [PASS] test_MintByOwner() (gas: 52341)
# [PASS] test_RevertMintExceedsMax() (gas: 15234)
# [PASS] test_Transfer() (gas: 48123)
# Test result: ok. 5 passed; 0 failed; 0 skipped
```

### CosmWasm Contract: Counter Example

```rust
// src/msg.rs
use cosmwasm_schema::{cw_serde, QueryResponses};

#[cw_serde]
pub struct InstantiateMsg {
    pub initial_count: i32,
}

#[cw_serde]
pub enum ExecuteMsg {
    Increment {},
    Decrement {},
    Reset { count: i32 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(CountResponse)]
    GetCount {},
}

#[cw_serde]
pub struct CountResponse {
    pub count: i32,
}
```

```rust
// src/state.rs
use cw_storage_plus::Item;

pub const COUNT: Item<i32> = Item::new("count");
pub const OWNER: Item<cosmwasm_std::Addr> = Item::new("owner");
```

```rust
// src/contract.rs
use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut,
    Env, MessageInfo, Response, StdResult, StdError,
};

use crate::msg::{CountResponse, ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{COUNT, OWNER};

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    COUNT.save(deps.storage, &msg.initial_count)?;
    OWNER.save(deps.storage, &info.sender)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender.to_string())
        .add_attribute("count", msg.initial_count.to_string()))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> StdResult<Response> {
    match msg {
        ExecuteMsg::Increment {} => {
            let count = COUNT.load(deps.storage)?;
            let new_count = count.checked_add(1)
                .ok_or_else(|| StdError::generic_err("Counter overflow"))?;
            COUNT.save(deps.storage, &new_count)?;
            Ok(Response::new()
                .add_attribute("action", "increment")
                .add_attribute("sender", info.sender.to_string())
                .add_attribute("new_count", new_count.to_string()))
        }
        ExecuteMsg::Decrement {} => {
            let count = COUNT.load(deps.storage)?;
            let new_count = count.checked_sub(1)
                .ok_or_else(|| StdError::generic_err("Counter underflow"))?;
            COUNT.save(deps.storage, &new_count)?;
            Ok(Response::new()
                .add_attribute("action", "decrement")
                .add_attribute("sender", info.sender.to_string())
                .add_attribute("new_count", new_count.to_string()))
        }
        ExecuteMsg::Reset { count } => {
            let owner = OWNER.load(deps.storage)?;
            if info.sender != owner {
                return Err(StdError::generic_err("Only owner can reset"));
            }
            COUNT.save(deps.storage, &count)?;
            Ok(Response::new()
                .add_attribute("action", "reset")
                .add_attribute("sender", info.sender.to_string())
                .add_attribute("new_count", count.to_string()))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetCount {} => {
            let count = COUNT.load(deps.storage)?;
            to_json_binary(&CountResponse { count })
        }
    }
}
```

```toml
# Cargo.toml
[package]
name = "sei-counter"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
cosmwasm-std = "2.1.0"
cosmwasm-schema = "2.1.0"
cw-storage-plus = "2.0.0"
schemars = "0.8.21"
serde = { version = "1.0.210", default-features = false, features = ["derive"] }

[dev-dependencies]
cosmwasm-vm = "2.1.0"
```

### Deploying CosmWasm Contract to Sei

```shell
# Compile to wasm
cargo build --target wasm32-unknown-unknown --release

# Optimize (production builds)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0

# Upload wasm to Sei testnet
seid tx wasm store artifacts/sei_counter.wasm \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 100000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  --broadcast-mode sync \
  -y

# Expected output:
# txhash: 8A2B3C4D5E6F...
# Query for code_id:
seid query tx 8A2B3C4D5E6F --node https://rpc-testnet.sei-apis.com:443
# Look for: "key": "code_id", "value": "1234"

# Instantiate the contract
seid tx wasm instantiate 1234 \
  '{"initial_count": 0}' \
  --label "sei-counter-v1" \
  --admin $(seid keys show my-wallet -a) \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 50000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  --broadcast-mode sync \
  -y

# Expected output:
# txhash: 9B8C7D6E5F4A...
# Query for contract address:
seid query tx 9B8C7D6E5F4A --node https://rpc-testnet.sei-apis.com:443
# Look for: "_contract_address": "sei1..."

# Execute: Increment the counter
seid tx wasm execute sei1contractaddress \
  '{"increment": {}}' \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 30000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y

# Query: Get current count
seid query wasm contract-state smart sei1contractaddress \
  '{"get_count": {}}' \
  --node https://rpc-testnet.sei-apis.com:443

# Expected output:
# data:
#   count: 1
```

### Cross-Environment Communication: Precompiles

Sei provides precompiled contracts that allow EVM contracts to interact with Cosmos-native functionality:

```solidity
// src/SeiPrecompileExample.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Sei JSON precompile for CosmWasm interop
interface IJson {
    function extractAsBytes(
        bytes calldata input,
        string calldata key
    ) external pure returns (bytes memory);

    function extractAsBytesList(
        bytes calldata input,
        string calldata key
    ) external pure returns (bytes[] memory);

    function extractAsUint256(
        bytes calldata input,
        string calldata key
    ) external pure returns (uint256);
}

// Sei Address precompile for address conversion
interface IAddr {
    function getSeiAddr(address evmAddr) external view returns (string memory);
    function getEvmAddr(string calldata seiAddr) external view returns (address);
}

// Sei Staking precompile
interface IStaking {
    function delegate(string calldata validator) external payable returns (bool);
    function undelegate(
        string calldata validator,
        uint256 amount
    ) external returns (bool);
}

contract SeiPrecompileExample {
    IAddr constant ADDR_PRECOMPILE = IAddr(
        0x0000000000000000000000000000000000001004
    );

    IStaking constant STAKING_PRECOMPILE = IStaking(
        0x0000000000000000000000000000000000001005
    );

    // Convert EVM address to Sei address
    function getMyCosmosAddress() external view returns (string memory) {
        return ADDR_PRECOMPILE.getSeiAddr(msg.sender);
    }

    // Convert Sei address to EVM address
    function getEvmAddress(
        string calldata seiAddr
    ) external view returns (address) {
        return ADDR_PRECOMPILE.getEvmAddr(seiAddr);
    }

    // Delegate SEI to a validator directly from EVM
    function delegateToValidator(
        string calldata validatorAddr
    ) external payable returns (bool) {
        if (msg.value == 0) revert("Must send SEI to delegate");
        return STAKING_PRECOMPILE.delegate{value: msg.value}(validatorAddr);
    }
}
```

```shell
# Deploy the precompile example
forge create src/SeiPrecompileExample.sol:SeiPrecompileExample \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY

# Call getMyCosmosAddress
cast call 0xYourContractAddress "getMyCosmosAddress()" \
  --from 0xYourAddress \
  --rpc-url https://evm-rpc-testnet.sei-apis.com

# Expected output: sei1... (your Cosmos address)
```

### Pointer Contracts: Bridging ERC-20 and CW-20

When you deploy a CW-20 token on Sei, the protocol automatically creates an ERC-20 pointer contract so EVM users can interact with it using standard ERC-20 interfaces:

```shell
# After deploying a CW-20 token via CosmWasm, query its EVM pointer:
seid query evm pointer CW20 sei1tokencontractaddress \
  --node https://rpc-testnet.sei-apis.com:443

# Expected output:
# pointer: "0xAutoGeneratedERC20Address"
# version: 1
# exists: true

# Now EVM users can call standard ERC-20 methods on the pointer address:
cast call 0xAutoGeneratedERC20Address "balanceOf(address)" 0xUserAddress \
  --rpc-url https://evm-rpc-testnet.sei-apis.com
```

---

## Common Pitfalls

1. **Deploying CosmWasm contracts without optimizing** — Unoptimized wasm binaries can be 2-5MB, exceeding Sei's upload limit. Always use `cosmwasm/optimizer:0.16.0` Docker image for production builds. The optimizer reduces binary size to 100-300KB and strips debug symbols.

2. **Calling CosmWasm from EVM without checking pointer existence** — Not all CosmWasm contracts have EVM pointer contracts. Pointer contracts are auto-generated for CW-20 and CW-721 tokens, but custom contracts need manual pointer registration. Always verify the pointer exists before calling from EVM.

3. **Using wrong gas denomination** — EVM transactions on Sei use `wei` (10^18) for value but gas is priced differently than Ethereum. CosmWasm transactions use `usei` (10^6). Don't mix these up when estimating costs. A transaction costing 50000usei on the Cosmos side is not the same as 50000 wei on the EVM side.

4. **Forgetting the `--admin` flag on instantiate** — If you instantiate a CosmWasm contract without `--admin`, you cannot migrate (upgrade) it later. Always set `--admin` to your address during development. For production immutable contracts, explicitly set `--no-admin`.

5. **Not handling overflow in CosmWasm** — Rust's default integer arithmetic panics on overflow in debug mode but wraps in release mode. Always use `checked_add`, `checked_sub`, etc. in CosmWasm contracts. A wrapping overflow in production could drain funds or corrupt state.

---

## What to Learn Next

- [Token Standards on Sei](./04-token-standards.md) — ERC-20, CW-20, ERC-721, CW-721, and how pointer contracts unify them
- [Sei CosmWasm Docs](https://www.docs.sei.io/dev-tutorials/cosmwasm-general) — Official CosmWasm development guide
- [Sei EVM Docs](https://www.docs.sei.io/dev-tutorials/evm-general) — Official EVM development guide
