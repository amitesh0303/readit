# EIP-2771 Meta-Transactions: Gasless UX for Your dApp

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

Your dApp has a great product but users keep dropping off at the "you need ETH for gas" step. New users don't have ETH. Existing users don't want to pay $5 to claim a free NFT. You want to pay gas on behalf of your users — but you can't just send transactions for them, because the transaction must come from their wallet.

Meta-transactions solve this. The user signs a message (free), your relayer submits the transaction (pays gas), and the contract sees the user as the sender. EIP-2771 is the standard for this pattern.

---

## Core Concepts

### How Meta-Transactions Work

```
Traditional transaction:
User → signs tx → broadcasts → pays gas → contract sees msg.sender = user

Meta-transaction:
User → signs message (free) → sends to relayer
Relayer → wraps message in tx → broadcasts → pays gas
Contract → extracts original user from message → sees "sender" = user
```

The key: the contract must be modified to support meta-transactions. It can't use `msg.sender` directly — it must use a `_msgSender()` function that extracts the real sender from the calldata.

### EIP-2771: The Standard

EIP-2771 defines a standard interface for meta-transactions:

```
Trusted Forwarder: a contract that verifies signatures and forwards calls
Context: the contract being called, which trusts the forwarder

Flow:
1. User signs: {from, to, value, gas, nonce, data, deadline}
2. Relayer calls: forwarder.execute(request, signature)
3. Forwarder verifies signature, calls target contract with appended sender
4. Target contract reads sender from last 20 bytes of calldata
```

### The _msgSender() Pattern

```solidity
// Standard contract (NOT meta-tx compatible)
function transfer(address to, uint256 amount) external {
    require(balances[msg.sender] >= amount);  // msg.sender = relayer, not user!
    balances[msg.sender] -= amount;
}

// EIP-2771 compatible contract
function transfer(address to, uint256 amount) external {
    address sender = _msgSender();  // extracts real user from calldata
    require(balances[sender] >= amount);
    balances[sender] -= amount;
}

function _msgSender() internal view returns (address sender) {
    if (msg.sender == trustedForwarder && msg.data.length >= 20) {
        // Extract sender from last 20 bytes of calldata
        assembly {
            sender := shr(96, calldataload(sub(calldatasize(), 20)))
        }
    } else {
        sender = msg.sender;
    }
}
```

### Gelato Relay: The Easy Path

Instead of running your own relayer, use Gelato Relay — a decentralized relayer network that handles meta-transactions for you:

```typescript
import { GelatoRelay } from "@gelatonetwork/relay-sdk";

const relay = new GelatoRelay();

// User signs the request
const { taskId } = await relay.sponsoredCallERC2771(
  request,
  provider,
  apiKey
);
```

---

## Code Walkthrough

**EIP-2771 compatible contract:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ERC2771Context
 * @notice Base contract for EIP-2771 meta-transaction support.
 * Inherit from this to make your contract meta-tx compatible.
 */
abstract contract ERC2771Context {
    address private immutable _trustedForwarder;

    constructor(address trustedForwarder) {
        _trustedForwarder = trustedForwarder;
    }

    function isTrustedForwarder(address forwarder) public view returns (bool) {
        return forwarder == _trustedForwarder;
    }

    /**
     * @dev Returns the actual sender of the transaction.
     * If called via the trusted forwarder, extracts sender from calldata.
     * Otherwise, returns msg.sender.
     */
    function _msgSender() internal view virtual returns (address sender) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            return msg.data[:msg.data.length - 20];
        } else {
            return msg.data;
        }
    }
}

/**
 * @title GaslessNFT
 * @notice NFT contract with gasless minting via meta-transactions.
 * Users sign a mint request, relayer pays gas.
 */
contract GaslessNFT is ERC2771Context {
    mapping(address => bool) public hasMinted;
    mapping(uint256 => address) public ownerOf;
    uint256 public totalSupply;

    // Gelato Relay forwarder address (mainnet)
    address public constant GELATO_RELAY = 0xd8253782c45a12053594b9deB72d8e8aB2Fca54c;

    event Minted(address indexed to, uint256 tokenId);

    constructor() ERC2771Context(GELATO_RELAY) {}

    /**
     * @notice Mint an NFT. Can be called directly or via meta-transaction.
     * @dev Uses _msgSender() instead of msg.sender for meta-tx compatibility.
     */
    function mint() external {
        address sender = _msgSender(); // real user, not relayer

        require(!hasMinted[sender], "Already minted");
        hasMinted[sender] = true;

        uint256 tokenId = ++totalSupply;
        ownerOf[tokenId] = sender;

        emit Minted(sender, tokenId);
    }
}
```

**The Trusted Forwarder:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MinimalForwarder
 * @notice EIP-2771 trusted forwarder.
 * Verifies user signatures and forwards calls to target contracts.
 */
contract MinimalForwarder {
    struct ForwardRequest {
        address from;       // user's address
        address to;         // target contract
        uint256 value;      // ETH to send
        uint256 gas;        // gas limit for the call
        uint256 nonce;      // prevents replay
        bytes data;         // encoded function call
    }

    // EIP-712 domain
    bytes32 private constant _TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
    );

    bytes32 private immutable _DOMAIN_SEPARATOR;
    mapping(address => uint256) private _nonces;

    constructor() {
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MinimalForwarder"),
                keccak256("0.0.1"),
                block.chainid,
                address(this)
            )
        );
    }

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        address signer = _recoverSigner(req, signature);
        return signer == req.from && _nonces[req.from] == req.nonce;
    }

    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public payable returns (bool, bytes memory) {
        require(verify(req, signature), "Invalid signature or nonce");

        _nonces[req.from]++;

        // Append sender address to calldata (EIP-2771 convention)
        (bool success, bytes memory returndata) = req.to.call{
            gas: req.gas,
            value: req.value
        }(abi.encodePacked(req.data, req.from));

        return (success, returndata);
    }

    function _recoverSigner(ForwardRequest calldata req, bytes calldata sig) internal view returns (address) {
        bytes32 structHash = keccak256(abi.encode(
            _TYPEHASH,
            req.from,
            req.to,
            req.value,
            req.gas,
            req.nonce,
            keccak256(req.data)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
        return _recoverECDSA(digest, sig);
    }

    function _recoverECDSA(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(hash, v, r, s);
    }
}
```

**TypeScript: signing and submitting meta-transactions:**

```typescript
import { ethers } from "ethers";

const FORWARDER_ABI = [
  "function getNonce(address from) view returns (uint256)",
  "function execute(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data) req, bytes signature) payable returns (bool, bytes)",
];

async function sendMetaTransaction(
  userSigner: ethers.Signer,
  forwarderAddress: string,
  targetContract: string,
  encodedFunction: string,
  relayerProvider: ethers.Provider
) {
  const userAddress = await userSigner.getAddress();
  const forwarder = new ethers.Contract(forwarderAddress, FORWARDER_ABI, relayerProvider);

  // Get current nonce
  const nonce = await forwarder.getNonce(userAddress);

  // Build the request
  const request = {
    from: userAddress,
    to: targetContract,
    value: 0n,
    gas: 200_000n,
    nonce: nonce,
    data: encodedFunction,
  };

  // EIP-712 domain
  const domain = {
    name: "MinimalForwarder",
    version: "0.0.1",
    chainId: (await relayerProvider.getNetwork()).chainId,
    verifyingContract: forwarderAddress,
  };

  const types = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  };

  // User signs the request (FREE — no gas)
  const signature = await userSigner.signTypedData(domain, types, request);
  console.log("User signed meta-tx (no gas paid)");

  // Relayer submits the transaction (PAYS GAS)
  const relayerSigner = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, relayerProvider);
  const forwarderWithRelayer = forwarder.connect(relayerSigner);

  const tx = await forwarderWithRelayer.execute(request, signature);
  const receipt = await tx.wait();

  console.log("Meta-tx executed by relayer:", receipt.hash);
  return receipt;
}

// Example: gasless NFT mint
async function gaslessMint(userSigner: ethers.Signer) {
  const NFT_ABI = ["function mint() external"];
  const nftInterface = new ethers.Interface(NFT_ABI);
  const encodedMint = nftInterface.encodeFunctionData("mint");

  await sendMetaTransaction(
    userSigner,
    "0xForwarderAddress",
    "0xNFTContractAddress",
    encodedMint,
    new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/YOUR_KEY")
  );
}
```

---

## Common Mistakes and Gotchas

**1. Using `msg.sender` instead of `_msgSender()` in meta-tx contracts**  
This is the most common mistake. If your contract uses `msg.sender` directly, meta-transactions will fail — the contract will see the relayer's address, not the user's. Replace every `msg.sender` with `_msgSender()`.

**2. Not protecting against replay attacks**  
The nonce in the ForwardRequest prevents replay attacks. If you forget to increment the nonce after execution, the same signed request can be submitted multiple times. Always increment nonces atomically with execution.

**3. Not setting a gas limit in the request**  
If `req.gas` is too low, the forwarded call will run out of gas. The forwarder's transaction succeeds (nonce is incremented) but the target call fails. Always estimate gas and add a buffer.

**4. Trusting the wrong forwarder**  
Your contract must only trust specific forwarder addresses. If you trust any address, an attacker can craft a malicious forwarder that appends a fake sender. Hardcode the trusted forwarder address or use a governance-controlled list.

**5. Not handling relayer failures**  
Your relayer can go down. Always have a fallback: let users submit transactions directly (paying their own gas) if the relayer is unavailable. Meta-transactions should be an enhancement, not a requirement.

---

## How This Connects to Production

OpenSea uses meta-transactions for gasless NFT listings — users sign off-chain orders, OpenSea's relayer submits them when a sale occurs. Biconomy is a popular meta-transaction relayer service used by many protocols. Gelato Relay provides decentralized relaying. The ERC-4337 account abstraction standard takes this further — instead of a trusted forwarder, users have smart contract wallets that can pay gas in any token or have gas sponsored by paymasters. Meta-transactions are the stepping stone to full account abstraction.

---

## What to Learn Next

- **Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp** — combine gasless UX with other onboarding improvements.
- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full wallet UX stack.
- **ERC-20 Standard: Building a Token from Scratch** — understand the permit extension (EIP-2612) as an alternative to meta-transactions for token approvals.
