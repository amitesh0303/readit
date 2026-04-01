---
title: "My First Smart Contract Bug Cost Me Nothing (But Taught Me Everything)"
date: 2023-04-03
tags: [solidity, security, reentrancy, learning]
---

I shipped my first real smart contract last week. A simple escrow — depositor locks ETH, arbiter approves, recipient claims. Nothing fancy. I deployed it to Sepolia, tested it manually, felt good about it.

Then I showed it to a friend who's been in the space for a few years. He looked at it for about 90 seconds and said: "your withdraw function is reentrant."

I didn't know what that meant. I do now.

## What I had written

```solidity
function release() external {
    require(msg.sender == recipient, "Not recipient");
    require(isApproved, "Not approved");
    require(amount > 0, "Nothing to release");

    uint256 payout = amount;

    // I thought this was fine because I'm checking amount > 0 above
    (bool success, ) = recipient.call{value: payout}("");
    require(success, "Transfer failed");

    amount = 0; // set to zero AFTER the transfer
}
```

See the problem? The `amount = 0` line comes after the external call. If `recipient` is a contract with a malicious `receive()` function, it can call `release()` again before `amount` is set to zero. The check `require(amount > 0)` passes every time because the state hasn't been updated yet.

## The attack

Here's what a malicious recipient contract would look like:

```solidity
contract MaliciousRecipient {
    Escrow public escrow;
    uint256 public attackCount;

    constructor(address _escrow) {
        escrow = Escrow(_escrow);
    }

    // This gets called when the escrow sends ETH
    receive() external payable {
        attackCount++;
        if (attackCount < 5 && address(escrow).balance > 0) {
            escrow.release(); // re-enter before amount is set to 0
        }
    }
}
```

If the escrow holds 1 ETH, this contract would drain it 5 times — getting 5 ETH total (assuming the escrow had that much). In my case it was a testnet contract with no real money, so the cost was zero. But the lesson was real.

## The fix

The pattern is called Checks-Effects-Interactions (CEI). You do your checks first, update your state second, make external calls last. The state update must happen before any external call.

```solidity
function release() external {
    // CHECKS
    require(msg.sender == recipient, "Not recipient");
    require(isApproved, "Not approved");
    require(amount > 0, "Nothing to release");

    uint256 payout = amount;

    // EFFECTS — update state BEFORE the external call
    amount = 0;

    // INTERACTIONS — external call last
    (bool success, ) = recipient.call{value: payout}("");
    require(success, "Transfer failed");
}
```

Now even if `recipient` tries to re-enter, `amount` is already 0 and the `require(amount > 0)` check fails.

I also added a `nonReentrant` modifier as a second layer of defense:

```solidity
uint256 private _status = 1;

modifier nonReentrant() {
    require(_status == 1, "Reentrant call");
    _status = 2;
    _;
    _status = 1;
}
```

Belt and suspenders. The CEI pattern is the primary defense. The mutex is the backup.

## What this taught me about smart contract security

The thing that struck me most: this bug is completely invisible to normal testing. I tested my contract manually. I called `release()`, the ETH transferred, everything worked. The bug only manifests when the recipient is a malicious contract — which you'd never do in your own tests unless you specifically wrote a test for it.

This is why smart contract security is different from regular software security. In web2, a bug usually means something breaks visibly. In web3, a bug can sit dormant for months and then drain your entire protocol in one transaction.

I went back and read about The DAO hack after this. Same vulnerability, $60 million, 2016. The pattern has been known for seven years and people still write it wrong.

I'm now running Slither on everything I write. It would have caught this:

```bash
$ slither contracts/Escrow.sol
INFO:Detectors:
Reentrancy in Escrow.release() (contracts/Escrow.sol#45-58):
    External calls:
    - (success) = recipient.call{value: payout}() (contracts/Escrow.sol#53)
    State variables written after the call(s):
    - amount = 0 (contracts/Escrow.sol#56)
```

There it is. Slither found it in seconds. I should have run it before deploying.

## The broader lesson

I think the reason this bug is so common is that the "wrong" version feels natural. You send the money, then you update the record. That's how you'd think about it in the real world — you hand over the cash, then you mark the transaction as complete.

But in smart contracts, the "hand over the cash" step can trigger arbitrary code execution. The mental model has to shift: update your records first, then hand over the cash.

I've been writing this on a sticky note and putting it on my monitor: **state before calls, always.**

---

*The escrow contract is on GitHub if you want to see the before/after. I kept both versions in the commit history as a reminder.*
