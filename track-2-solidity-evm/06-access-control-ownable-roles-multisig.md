# Access Control in Solidity: Ownable, Roles, and Multi-Sig

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You deploy a DeFi protocol. The `setFee` function is protected by `onlyOwner`. The owner is your personal wallet. You get hit by a bus. The protocol is frozen forever.

Or: you're a team of 5. One person has the owner key. They get phished. The attacker drains the treasury.

Or: you use a 2-of-3 multisig. One signer goes rogue. They collude with another. The protocol is drained.

Access control is the most critical security layer in any smart contract system. Get it wrong and you've built a protocol that's either too centralized (single point of failure) or too decentralized (can't respond to emergencies). This blog covers the full spectrum — from simple `Ownable` to role-based access control to on-chain governance — and explains when to use each.

---

## Core Concepts

### The Access Control Spectrum

```
More Centralized ←──────────────────────────────→ More Decentralized

Single Owner → Multi-Sig → Role-Based → Timelock → DAO Governance
   (fast,          (safer,    (granular,   (delayed,    (fully
  dangerous)      still fast)  flexible)   transparent) decentralized)
```

No single point on this spectrum is "correct." The right choice depends on your protocol's maturity, the value at risk, and your operational requirements.

### Pattern 1: Ownable

The simplest pattern. One address has admin rights. Good for early-stage protocols, personal projects, or contracts where a single trusted party makes sense.

```solidity
contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // Two-step ownership transfer — safer than single-step
    // Prevents accidentally transferring to a wrong address
}
```

**Two-step ownership transfer** is a critical improvement. With single-step, if you typo the new owner address, ownership is gone forever. With two-step, the new owner must accept:

```solidity
contract Ownable2Step {
    address public owner;
    address public pendingOwner;

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner; // just sets pending, doesn't transfer yet
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(owner, msg.sender);
    }
}
```

### Pattern 2: Role-Based Access Control (RBAC)

When you have multiple admin functions that should be controlled by different parties, RBAC is the right tool. A minter shouldn't be able to pause the contract. A pauser shouldn't be able to upgrade the implementation.

OpenZeppelin's `AccessControl` is the standard implementation:

```solidity
// Role identifiers are bytes32 hashes of role names
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

// DEFAULT_ADMIN_ROLE (bytes32(0)) can grant/revoke all other roles
// This is the "super admin" — should be a multisig or timelock
```

### Pattern 3: Timelock

A timelock adds a mandatory delay between when an action is proposed and when it can be executed. This gives users time to react to changes they disagree with (by withdrawing funds, for example).

```
Propose action → [48-hour delay] → Execute action
                      ↑
              Users can exit during this window
```

OpenZeppelin's `TimelockController` is the standard. Compound, Uniswap, and Aave all use timelocks for governance execution.

### Pattern 4: Multi-Sig

A multi-sig requires M-of-N signatures to execute a transaction. Safe (formerly Gnosis Safe) is the industry standard. Most serious protocols use a 3-of-5 or 4-of-7 Safe as their protocol owner.

---

## Code Walkthrough

A production-grade RBAC system with timelock integration:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AccessControlled
 * @notice Demonstrates production-grade access control with:
 *   - Role-based permissions
 *   - Role admin hierarchy
 *   - Emergency pause
 *   - Timelock-compatible design
 */
contract AccessControlled {
    // ─── Role Definitions ──────────────────────────────────────────────────

    // DEFAULT_ADMIN_ROLE = bytes32(0) — can grant/revoke all roles
    // Should be assigned to a timelock or multisig, NOT a personal wallet
    bytes32 public constant DEFAULT_ADMIN_ROLE = bytes32(0);

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // ─── State ─────────────────────────────────────────────────────────────

    // role → account → hasRole
    mapping(bytes32 => mapping(address => bool)) private _roles;

    // role → adminRole (who can grant/revoke this role)
    mapping(bytes32 => bytes32) private _roleAdmins;

    bool public paused;
    uint256 public fee; // basis points (100 = 1%)

    // ─── Events ────────────────────────────────────────────────────────────

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdmin, bytes32 indexed newAdmin);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(address admin) {
        // Grant DEFAULT_ADMIN_ROLE to the provided admin address
        // In production: this should be a Safe multisig or timelock
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Set role admins:
        // DEFAULT_ADMIN_ROLE can manage MINTER_ROLE and BURNER_ROLE
        // PAUSER_ROLE manages itself (pausers can add other pausers)
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BURNER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(FEE_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyRole(bytes32 role) {
        require(hasRole(role, msg.sender), _roleError(role));
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }

    // ─── Role Management ───────────────────────────────────────────────────

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function getRoleAdmin(bytes32 role) public view returns (bytes32) {
        return _roleAdmins[role];
    }

    /**
     * @notice Grant a role to an account.
     * @dev Caller must have the admin role for the role being granted.
     */
    function grantRole(bytes32 role, address account) external {
        require(hasRole(getRoleAdmin(role), msg.sender), "Missing admin role");
        _grantRole(role, account);
    }

    /**
     * @notice Revoke a role from an account.
     */
    function revokeRole(bytes32 role, address account) external {
        require(hasRole(getRoleAdmin(role), msg.sender), "Missing admin role");
        _revokeRole(role, account);
    }

    /**
     * @notice Renounce your own role — useful for decentralization.
     * @dev Can only renounce your own roles, not others'.
     */
    function renounceRole(bytes32 role) external {
        _revokeRole(role, msg.sender);
    }

    // ─── Protected Functions ───────────────────────────────────────────────

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        // mint logic
    }

    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) whenNotPaused {
        // burn logic
    }

    /**
     * @notice Pause all transfers. Emergency use only.
     * @dev PAUSER_ROLE should be held by a fast-response multisig (2-of-3)
     *      while DEFAULT_ADMIN_ROLE is held by a slower governance timelock.
     *      This lets you pause quickly in an emergency without waiting for governance.
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        paused = true;
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        paused = false;
    }

    function setFee(uint256 newFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(newFee <= 1000, "Fee too high"); // max 10%
        fee = newFee;
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    function _grantRole(bytes32 role, address account) internal {
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function _revokeRole(bytes32 role, address account) internal {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal {
        bytes32 previousAdmin = _roleAdmins[role];
        _roleAdmins[role] = adminRole;
        emit RoleAdminChanged(role, previousAdmin, adminRole);
    }

    function _roleError(bytes32 role) internal pure returns (string memory) {
        return string(abi.encodePacked("Missing role: ", _toHexString(uint256(role), 32)));
    }

    function _toHexString(uint256 value, uint256 length) internal pure returns (string memory) {
        bytes memory buffer = new bytes(2 * length + 2);
        buffer[0] = "0"; buffer[1] = "x";
        bytes16 symbols = "0123456789abcdef";
        for (uint256 i = 2 * length + 1; i > 1; --i) {
            buffer[i] = symbols[value & 0xf];
            value >>= 4;
        }
        return string(buffer);
    }
}
```

Here's how to set up a production access control hierarchy using Safe + Timelock:

```typescript
// scripts/setup-access-control.ts
import { ethers } from "hardhat";

async function setupProductionAccessControl() {
  const [deployer] = await ethers.getSigners();

  // Addresses (replace with real Safe/Timelock addresses)
  const SAFE_MULTISIG = "0xSafeAddress";        // 3-of-5 Safe — slow governance
  const EMERGENCY_MULTISIG = "0xEmergencyAddr"; // 2-of-3 Safe — fast emergency response
  const MINTER_BOT = "0xMinterBotAddress";      // automated minting service

  const contract = await ethers.getContractAt("AccessControlled", "0xContractAddress");

  // Grant roles to appropriate parties
  await contract.grantRole(await contract.MINTER_ROLE(), MINTER_BOT);
  await contract.grantRole(await contract.PAUSER_ROLE(), EMERGENCY_MULTISIG);
  await contract.grantRole(await contract.FEE_MANAGER_ROLE(), SAFE_MULTISIG);

  // Transfer DEFAULT_ADMIN_ROLE to the Safe multisig
  await contract.grantRole(await contract.DEFAULT_ADMIN_ROLE(), SAFE_MULTISIG);

  // CRITICAL: Renounce deployer's admin role
  // After this, only the Safe can manage roles
  await contract.renounceRole(await contract.DEFAULT_ADMIN_ROLE());

  console.log("Access control configured. Deployer has no more admin rights.");
  console.log("DEFAULT_ADMIN_ROLE:", SAFE_MULTISIG);
  console.log("PAUSER_ROLE:", EMERGENCY_MULTISIG);
  console.log("MINTER_ROLE:", MINTER_BOT);
}
```

---

## Common Mistakes and Gotchas

**1. Leaving DEFAULT_ADMIN_ROLE with the deployer wallet**  
This is the most common mistake. The deployer wallet is a hot wallet — it's online, it can be phished, it can be compromised. After deployment and initial setup, `DEFAULT_ADMIN_ROLE` must be transferred to a multisig or timelock. Then renounce the deployer's role.

**2. Not having an emergency pause mechanism**  
If your protocol is exploited, you need to pause it immediately — not wait 48 hours for a timelock. Have a separate `PAUSER_ROLE` held by a fast-response multisig (2-of-3 with team members who are always reachable). The pause function should be the one thing that doesn't go through a timelock.

**3. Using `tx.origin` instead of `msg.sender` for access control**  
`tx.origin` is the original transaction sender, not the immediate caller. If a user calls your contract through another contract, `tx.origin` is the user but `msg.sender` is the intermediate contract. Using `tx.origin` for access control breaks composability and is a security risk. Always use `msg.sender`.

**4. Not testing role revocation**  
Granting roles is tested. Revoking roles is often not. What happens when you revoke the last minter? What happens when you revoke the pauser during an active pause? Test these edge cases.

**5. Forgetting that role checks are not recursive**  
If Account A has `DEFAULT_ADMIN_ROLE` and Account B has `MINTER_ROLE`, Account A cannot call `mint()` — it only has admin rights, not minter rights. Admin roles grant the ability to manage roles, not to use them. Grant the admin account the specific roles it needs to call functions directly.

---

## How This Connects to Production

Compound's governance uses a timelock with a 48-hour delay — any protocol change must be proposed, pass a vote, then wait 48 hours before execution. Aave uses a similar system with different delays for different risk levels (low-risk parameter changes: 24h, high-risk changes: 7 days). Uniswap's fee switch is controlled by UNI governance with a timelock. Safe (Gnosis Safe) is the multisig of choice for virtually every serious DeFi protocol — Uniswap Labs, Aave, Compound, and hundreds of others use it as their protocol owner. The pattern of "fast multisig for emergencies, slow timelock for governance" is the industry standard for protocols with significant TVL.

---

## What to Learn Next

- **Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running** — access control is one layer of security; understand the others.
- **Events and Logs: How Frontends Listen to Smart Contracts** — learn how to monitor role changes and admin actions in your frontend.
- **Hardhat vs Foundry: Which Testing Framework Should You Use?** — test your access control logic thoroughly before deploying.
