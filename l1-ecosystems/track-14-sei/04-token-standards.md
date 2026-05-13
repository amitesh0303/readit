# Token Standards and Asset Management on Sei

**Track:** Sei Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

Sei supports both EVM and CosmWasm token standards, and they can interoperate through pointer contracts. You need to understand which standard to use (ERC-20 vs CW-20, ERC-721 vs CW-721), how pointer contracts automatically bridge between them, and how native Cosmos tokens (bank module) fit into the picture. This lesson covers creating, deploying, and managing tokens across both execution environments.

---

## Core Concepts

### Token Standards on Sei

| Standard | Environment | Use Case | Interop |
|----------|-------------|----------|---------|
| ERC-20 | EVM | Fungible tokens (Ethereum-compatible) | Auto-pointer to CW-20 |
| CW-20 | CosmWasm | Fungible tokens (Cosmos-compatible) | Auto-pointer to ERC-20 |
| ERC-721 | EVM | NFTs (Ethereum-compatible) | Auto-pointer to CW-721 |
| CW-721 | CosmWasm | NFTs (Cosmos-compatible) | Auto-pointer to ERC-721 |
| Bank module | Native Cosmos | Native chain tokens (SEI, IBC tokens) | Auto-pointer to ERC-20 |
| TokenFactory | Native Cosmos | Custom native denoms | Auto-pointer to ERC-20 |

### ERC-20 Token with Sei-Specific Features

```solidity
// src/SeiERC20.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts@5.0.0/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title SeiERC20
 * @notice Production-ready ERC-20 token for Sei with permit (gasless approvals)
 * @dev Includes burn, permit (EIP-2612), and capped supply
 */
contract SeiERC20 is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint256 public immutable maxSupply;
    bool public mintingEnabled;

    error MintingDisabled();
    error ExceedsMaxSupply(uint256 requested, uint256 remaining);
    error ZeroAddress();

    event MintingToggled(bool enabled);

    constructor(
        string memory name,
        string memory symbol,
        uint256 _maxSupply,
        uint256 initialMint
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        if (initialMint > _maxSupply) {
            revert ExceedsMaxSupply(initialMint, _maxSupply);
        }
        maxSupply = _maxSupply;
        mintingEnabled = true;
        _mint(msg.sender, initialMint);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (!mintingEnabled) revert MintingDisabled();
        if (to == address(0)) revert ZeroAddress();
        if (totalSupply() + amount > maxSupply) {
            revert ExceedsMaxSupply(amount, maxSupply - totalSupply());
        }
        _mint(to, amount);
    }

    function toggleMinting() external onlyOwner {
        mintingEnabled = !mintingEnabled;
        emit MintingToggled(mintingEnabled);
    }
}
```

```shell
# Deploy ERC-20 to Sei testnet
forge create src/SeiERC20.sol:SeiERC20 \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY \
  --constructor-args "Sei DeFi Token" "SDT" 100000000000000000000000000 10000000000000000000000000

# Expected output:
# Deployed to: 0xTokenAddress...
# Transaction hash: 0x...

# Verify deployment
cast call 0xTokenAddress "name()" --rpc-url https://evm-rpc-testnet.sei-apis.com
# "Sei DeFi Token"

cast call 0xTokenAddress "totalSupply()" --rpc-url https://evm-rpc-testnet.sei-apis.com
# 10000000000000000000000000 (10M tokens with 18 decimals)
```

### CW-20 Token on Sei

```rust
// For CW-20, use the standard cw20-base contract
// Cargo.toml dependencies:
// [dependencies]
// cosmwasm-std = "2.1.0"
// cw20-base = "2.0.0"
// cw2 = "2.0.0"

// src/contract.rs — Thin wrapper around cw20-base
use cosmwasm_std::{
    entry_point, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};
use cw20_base::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use cw20_base::ContractError;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    cw20_base::contract::instantiate(deps, env, info, msg)
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    cw20_base::contract::execute(deps, env, info, msg)
}

#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    cw20_base::contract::query(deps, env, msg)
}
```

```shell
# Instantiate CW-20 token on Sei testnet
# (After uploading the wasm binary and getting code_id)

seid tx wasm instantiate 5678 '{
  "name": "Sei Cosmos Token",
  "symbol": "SCT",
  "decimals": 6,
  "initial_balances": [
    {
      "address": "sei1youraddress",
      "amount": "1000000000000"
    }
  ],
  "mint": {
    "minter": "sei1youraddress",
    "cap": "10000000000000"
  }
}' \
  --label "sei-cosmos-token-v1" \
  --admin $(seid keys show my-wallet -a) \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 100000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y

# Expected output:
# txhash: AABB1122...

# Query token info
seid query wasm contract-state smart sei1tokencontract \
  '{"token_info": {}}' \
  --node https://rpc-testnet.sei-apis.com:443

# Expected output:
# data:
#   name: "Sei Cosmos Token"
#   symbol: "SCT"
#   decimals: 6
#   total_supply: "1000000000000"

# Transfer CW-20 tokens
seid tx wasm execute sei1tokencontract '{
  "transfer": {
    "recipient": "sei1recipientaddress",
    "amount": "500000000"
  }
}' \
  --from my-wallet \
  --gas auto \
  --fees 30000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y
```

### Pointer Contracts: Unified Token Access

When you deploy a CW-20 token, Sei automatically creates an ERC-20 pointer contract. This means EVM users (MetaMask, Uniswap forks) can interact with your CW-20 token using standard ERC-20 interfaces:

```javascript
// Querying a CW-20 token's ERC-20 pointer from JavaScript
// Using ethers.js@6.13.0

import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://evm-rpc-testnet.sei-apis.com");

// Standard ERC-20 ABI works on pointer contracts
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

async function interactWithPointer(pointerAddress) {
  const token = new ethers.Contract(pointerAddress, ERC20_ABI, provider);

  try {
    const name = await token.name();
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    const totalSupply = await token.totalSupply();

    console.log(`Token: ${name} (${symbol})`);
    console.log(`Decimals: ${decimals}`);
    console.log(`Total Supply: ${ethers.formatUnits(totalSupply, decimals)}`);

    // Check balance using EVM address
    const balance = await token.balanceOf("0xYourEVMAddress");
    console.log(`Balance: ${ethers.formatUnits(balance, decimals)}`);
  } catch (error) {
    console.error("Failed to query pointer:", error.message);
  }
}

// The pointer address can be found via seid query:
// seid query evm pointer CW20 sei1tokencontract
interactWithPointer("0xPointerContractAddress");
```

### TokenFactory: Native Denominations

Sei's TokenFactory module lets you create native Cosmos tokens (like `usei`) without writing a smart contract:

```shell
# Create a new native token denomination
seid tx tokenfactory create-denom mytoken \
  --from my-wallet \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 100000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y

# The denom will be: factory/sei1youraddress/mytoken

# Mint tokens
seid tx tokenfactory mint 1000000000factory/sei1youraddress/mytoken \
  --from my-wallet \
  --gas auto \
  --fees 50000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y

# Send tokens using bank module (native transfer, very cheap)
seid tx bank send my-wallet sei1recipientaddress 500000000factory/sei1youraddress/mytoken \
  --gas auto \
  --fees 10000usei \
  --node https://rpc-testnet.sei-apis.com:443 \
  --chain-id atlantic-2 \
  -y

# Query balance
seid query bank balances sei1recipientaddress \
  --denom factory/sei1youraddress/mytoken \
  --node https://rpc-testnet.sei-apis.com:443

# Expected output:
# amount: "500000000"
# denom: factory/sei1youraddress/mytoken
```

### ERC-721 NFT on Sei

```solidity
// src/SeiNFT.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts@5.0.0/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.0.0/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts@5.0.0/access/Ownable.sol";

/**
 * @title SeiNFT
 * @notice ERC-721 NFT collection on Sei with metadata URI storage
 */
contract SeiNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;
    uint256 public constant MAX_SUPPLY = 10000;
    uint256 public mintPrice;

    error MaxSupplyReached();
    error InsufficientPayment(uint256 sent, uint256 required);

    constructor(
        string memory name,
        string memory symbol,
        uint256 _mintPrice
    ) ERC721(name, symbol) Ownable(msg.sender) {
        mintPrice = _mintPrice;
    }

    function mint(string calldata uri) external payable returns (uint256) {
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyReached();
        if (msg.value < mintPrice) {
            revert InsufficientPayment(msg.value, mintPrice);
        }

        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);

        return tokenId;
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

```shell
# Deploy NFT contract (mint price: 0.1 SEI)
forge create src/SeiNFT.sol:SeiNFT \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY \
  --constructor-args "Sei Explorers" "SEXP" 100000000000000000

# Expected output:
# Deployed to: 0xNFTAddress...

# Mint an NFT
cast send 0xNFTAddress \
  "mint(string)" "ipfs://QmExampleHash/metadata.json" \
  --value 0.1ether \
  --rpc-url https://evm-rpc-testnet.sei-apis.com \
  --private-key $PRIVATE_KEY

# Check ownership
cast call 0xNFTAddress "ownerOf(uint256)" 0 \
  --rpc-url https://evm-rpc-testnet.sei-apis.com
# Returns: your address
```

### Token Standard Comparison

| Feature | ERC-20 (EVM) | CW-20 (CosmWasm) | TokenFactory |
|---------|-------------|------------------|--------------|
| Deploy cost | ~200K gas | ~500K Cosmos gas | ~100K Cosmos gas |
| Transfer cost | ~65K gas | ~150K Cosmos gas | ~50K Cosmos gas |
| Composability | EVM DeFi | Cosmos DeFi + IBC | Cosmos DeFi + IBC |
| Auto pointer | → CW-20 | → ERC-20 | → ERC-20 |
| Upgradeable | Proxy pattern | Migrate msg | No |
| Best for | Ethereum DeFi ports | IBC transfers, Cosmos DeFi | Simple tokens, airdrops |

---

## Common Pitfalls

1. **Deploying ERC-20 when you need IBC transfers** — ERC-20 tokens on Sei cannot be sent over IBC directly. If your token needs to move to other Cosmos chains (Osmosis, Neutron, etc.), deploy as CW-20 or use TokenFactory. EVM users can still interact via the auto-generated pointer contract.

2. **Mismatching decimals between pointer and original** — CW-20 tokens commonly use 6 decimals, while ERC-20 tokens use 18. The pointer contract preserves the original decimals. If your CW-20 has 6 decimals, the ERC-20 pointer also reports 6 decimals. Don't assume 18 decimals when reading balances from pointer contracts.

3. **Not registering pointer contracts for custom CW contracts** — Auto-pointers are only created for standard CW-20 and CW-721 contracts. If you have a custom CosmWasm contract with non-standard interfaces, you need to manually register a pointer or use the CosmWasm precompile from EVM.

4. **Burning tokens without checking pointer state** — If a CW-20 token is burned on the CosmWasm side, the ERC-20 pointer's `totalSupply` updates automatically. But if you burn via the ERC-20 pointer, ensure the underlying CW-20 contract supports burn operations. Not all CW-20 implementations include burn.

5. **Using TokenFactory for complex token logic** — TokenFactory tokens are simple native denoms with mint/burn controlled by the creator address. They don't support custom transfer logic, hooks, or allowances. If you need programmable token behavior (vesting, transfer restrictions, fees), use ERC-20 or CW-20 instead.

---

## What to Learn Next

- [Frontend Integration](./05-frontend-integration.md) — Connect wallets, read token balances, and build dApp UIs on Sei
- [Sei Token Standards Docs](https://www.docs.sei.io/dev-tutorials/token-standards) — Official token documentation
- [CW-20 Specification](https://github.com/CosmWasm/cw-plus/tree/main/packages/cw20) — CosmWasm fungible token standard
