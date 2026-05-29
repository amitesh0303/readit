# Building a Smart Account from Scratch with Solidity

**Track:** Intermediate → Advanced
**Read time:** 11 min

---

## The Problem

The minimal smart account in the previous lesson works, but it's a toy. Real smart accounts need: multiple owners or a multisig pattern, modular validators (so you can swap auth methods), session keys with limits, recovery, hooks for analytics or rate limiting, and they need to fit gas budgets that don't price out small users. Building one from scratch teaches you why every production smart wallet (Safe, Kernel, BiconomyV2, Coinbase Smart Wallet) ends up with a similar shape.

---

## Core Concepts

### Modular accounts: ERC-7579 and friends

The pattern that emerged across implementations: split the smart account into a **kernel** and **modules**. The kernel handles the EntryPoint interface (`validateUserOp`, `execute`). Modules plug in to extend behavior:

- **Validators**: define what counts as a valid signature for a UserOp (ECDSA, multisig, passkey, ZK)
- **Executors**: contracts that can call into the account on behalf of users (e.g. a session-key executor)
- **Hooks**: run before/after every action (e.g. log all transfers, enforce a rate limit)
- **Fallbacks**: handle calls to undefined functions (e.g. ERC-721 `onERC721Received`)

ERC-7579 (finalized in 2024) standardized this so different vendors' modules can be composed. A Kernel (ZeroDev's implementation) account in 2026 can install a Safe-authored validator. That cross-vendor compatibility is what made AA actually usable as infrastructure.

### Storage layout

Your smart account is an upgradeable contract that holds its own state. Plan the storage layout carefully:

```solidity
// abusing slots to be cute
contract SmartAccount {
    // slot 0
    uint256 public nonce;
    // slot 1
    mapping(address => bool) public isOwner;
    // slot 2
    mapping(bytes4 => address) public fallbackHandler;
    // slot 3
    mapping(address => bool) public installedValidator;
    // ...
}
```

Two warnings:

1. **Don't change storage layout in upgrades**. If the account is upgradeable (most production accounts are, via UUPS or transparent proxy), changing the order of state variables corrupts existing accounts. Use ERC-7201 namespaced storage to avoid this: each module gets a hashed namespace slot.

2. **Validation-phase storage rules**. Per ERC-4337, during `validateUserOp` your account can only read slots associated with itself. Reading from arbitrary mappings means the bundler can't safely simulate, so it'll reject. Keep validator state in storage namespaces tied to the validator module.

### The signature trick: aggregator + module ID

When you have multiple validators (one for ECDSA, one for passkey, one for session keys), how does the account know which one to use for a given UserOp? The answer in ERC-7579: encode the validator address (or module ID) in the first N bytes of the signature.

```
userOp.signature = abi.encodePacked(validatorAddress, validatorSpecificSig)
```

When `validateUserOp` runs, the account decodes the validator address, calls into that validator with the rest of the signature, and uses its return value as the validation result. Adding a new auth method = installing a new validator module.

### Recovery: the part that actually changes lives

Lost-key recovery is what most users want from a smart wallet, even if they don't say it. Patterns:

- **Social recovery**: N-of-M trusted contacts (other addresses) can vote to replace the owner. Argent's original model. Used in production for years.
- **Time-locked recovery**: any "recovery" address can replace the owner, but only after a delay (24-72h). The current owner can veto during the delay window. Safer if your recovery contacts collude.
- **2FA-style recovery**: recovery requires both an alternate device key AND a code from your email/SMS gateway, with a delay.

The implementation detail: recovery is just another validator module. You install a "RecoveryValidator" that, when invoked correctly, can call `setOwner(newOwner)` on the account. It's a permission grant, not a magic feature.

---

## Code Walkthrough

A modular smart account with pluggable validators, in roughly 200 lines. This is the shape every production wallet has.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAccount, PackedUserOperation} from "account-abstraction/interfaces/IAccount.sol";

interface IValidator {
    /// Returns 0 on success, 1 on signature failure. Optionally encodes time bounds.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256);
}

contract ModularAccount is IAccount {
    address public immutable entryPoint;

    // ERC-7201 namespaced storage to avoid layout collisions across modules
    bytes32 private constant STORAGE_SLOT =
        keccak256(abi.encode(uint256(keccak256("modular.account.storage")) - 1)) & ~bytes32(uint256(0xff));

    struct AccountStorage {
        uint256 nonce;
        mapping(address => bool) installedValidator;
        address defaultValidator;
    }

    function _s() private pure returns (AccountStorage storage s) {
        bytes32 slot = STORAGE_SLOT;
        assembly { s.slot := slot }
    }

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "only EntryPoint");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "only self");
        _;
    }

    constructor(address _entryPoint, address _defaultValidator) {
        entryPoint = _entryPoint;
        AccountStorage storage s = _s();
        s.installedValidator[_defaultValidator] = true;
        s.defaultValidator = _defaultValidator;
    }

    /// Decode the validator address from the signature prefix, dispatch to it.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        AccountStorage storage s = _s();

        // First 20 bytes of signature = validator address
        require(userOp.signature.length >= 20, "no validator");
        address validator = address(bytes20(userOp.signature[0:20]));
        require(s.installedValidator[validator], "validator not installed");

        // Hand the (modified) UserOp to the validator
        // The validator inspects userOp.signature[20:] and returns 0 / 1
        validationData = IValidator(validator).validateUserOp(userOp, userOpHash);

        // Prefund the EntryPoint
        if (missingAccountFunds > 0) {
            (bool ok, ) = msg.sender.call{value: missingAccountFunds}("");
            ok; // bundler will revert if it cared
        }
    }

    function execute(address dest, uint256 value, bytes calldata data)
        external onlyEntryPoint
    {
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
    }

    function executeBatch(address[] calldata dests, uint256[] calldata values, bytes[] calldata datas)
        external onlyEntryPoint
    {
        require(dests.length == datas.length && dests.length == values.length, "len");
        for (uint256 i; i < dests.length; ++i) {
            (bool ok, bytes memory ret) = dests[i].call{value: values[i]}(datas[i]);
            if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    /// Module management — only callable by the account itself (via execute)
    function installValidator(address v) external onlySelf {
        _s().installedValidator[v] = true;
    }

    function uninstallValidator(address v) external onlySelf {
        _s().installedValidator[v] = false;
    }

    receive() external payable {}
}
```

A simple ECDSA validator that goes with it:

```solidity
contract ECDSAValidator is IValidator {
    mapping(address => address) public owner; // smart account => its owner key

    function setOwner(address newOwner) external {
        owner[msg.sender] = newOwner;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view returns (uint256) {
        bytes memory sig = userOp.signature[20:]; // strip validator address prefix
        bytes32 ethSigned = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", userOpHash
        ));
        address recovered = _recover(ethSigned, sig);
        return recovered == owner[userOp.sender] ? 0 : 1;
    }

    function _recover(bytes32 h, bytes memory s) internal pure returns (address) {
        if (s.length != 65) return address(0);
        bytes32 r; bytes32 ss; uint8 v;
        assembly {
            r := mload(add(s, 32))
            ss := mload(add(s, 64))
            v := byte(0, mload(add(s, 96)))
        }
        return ecrecover(h, v, r, ss);
    }
}
```

Now installing a second validator (say, a multisig validator) is just `account.execute(account, 0, abi.encode(installValidator.selector, multisigValidator))` — itself routed through the EntryPoint.

### Account factory

You don't deploy a smart account directly via a regular `new` — the EntryPoint deploys it from `initCode` on the first UserOp. You need a factory:

```solidity
contract AccountFactory {
    address public immutable accountImplementation;
    address public immutable entryPoint;

    constructor(address _impl, address _ep) {
        accountImplementation = _impl;
        entryPoint = _ep;
    }

    /// Creates a new account if it doesn't exist, returns the address either way.
    function createAccount(address owner, uint256 salt) external returns (address) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) return predicted;
        // CREATE2 deploy of a minimal proxy pointing at accountImplementation
        // ... (deploy logic)
        return predicted;
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        // CREATE2 prediction
        return /* keccak hashing dance */;
    }
}
```

`initCode` in the UserOp is `factoryAddress + abi.encodeWithSelector(createAccount, owner, salt)`. The EntryPoint calls the factory if the sender's code is empty.

The CREATE2 trick means the account's address is **deterministic before deployment**. You can ship UI showing "your wallet address is 0xAlice..." before the user has done anything on-chain. The first UserOp deploys the account at exactly that address.

---

## Common Mistakes and Gotchas

**1. Letting modules read each others' storage**
If your validator module reads state from your fallback module's slot, you've coupled them. Worse, the bundler's storage-access rules during validation may break. Keep modules' state strictly in their own namespaces.

**2. Forgetting `onlySelf` on module management**
`installValidator` should only be callable by the account itself (which means: via the EntryPoint, signed by the user). If anyone can call it, anyone can install a malicious validator and own the account.

**3. CREATE2 salt collisions**
If two users use the same salt with different owners, they'd get different addresses (since the owner is part of the init args). But if you let users pick the salt and forget to incorporate the owner, you'll deploy the same address for everyone. Always derive the address from owner + salt.

**4. Hardcoding the EntryPoint address**
EntryPoint v0.6 → v0.7 → v0.8 are all real, deployed contracts. Hardcoding one means your account can't migrate. Make EntryPoint settable in some upgrade path, or be ready to deploy a new account version.

**5. Skipping signature replay protection across chains**
A signature valid for `userOpHash` on chain A is *not* automatically valid on chain B because the EntryPoint hash includes `chainId`. But validators that hash extra context (e.g. for off-chain auth) need to include chainId themselves or risk replays.

**6. Burning gas on every validation by reading from cold storage**
Every read in `validateUserOp` is paid for on every UserOp. Hot storage (a single `address public owner`) is fine. Mappings with cold accesses each time will eat your gas budget. Prefer immutable / packed storage for validator state.

**7. Not testing the deploy-with-first-userop path**
Almost every team tests the "account already exists" path heavily and ships with a broken first-UserOp deploy. Test it explicitly: send a UserOp from an account that has never been deployed, verify the EntryPoint deploys it correctly, verify gas estimates account for the deployment cost.

---

## How This Connects to Production

The Safe Smart Account, Kernel by ZeroDev, Biconomy V2, and Coinbase Smart Wallet all follow this modular pattern in slightly different shapes. The differences are in: which modules are pre-installed, how upgrades work, the gas tradeoffs in validation, and integrations with paymaster providers. ERC-7579 standardized enough of the surface that you can mix and match — install an Alchemy paymaster on a Safe smart account, use a ZeroDev session key validator on a Coinbase Smart Wallet (in theory).

For most teams, **don't roll your own**. Use Safe or Kernel as the base. Build your custom modules (a ZK-validator for a privacy app, a custom recovery flow) and plug them in. This lesson exists so you understand what's happening when you do.

---

## What to Learn Next

- **Paymaster Design: Sponsored Gas, ERC-20 Gas, and Rate Limiting** — the gas-paying side of the architecture, with all its economic gotchas.
- **Session Keys and Permission Systems for dApps and Games** — installing scoped, time-bounded validators is where AA shines.
- **Sign-In With Ethereum (SIWE)** — the auth layer that pairs naturally with smart accounts.
