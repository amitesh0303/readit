---
title: "Six Months In: What I Wish Someone Had Told Me About Web3 Development"
date: 2023-06-18
tags: [web3, ethereum, solana, learning, career]
---

Six months ago I wrote about going all-in on Web3. I've been heads-down since then — building, breaking things, reading audit reports, lurking in Discord servers at 2am trying to understand why my Anchor program keeps throwing `AccountNotInitialized`.

Here's what I actually learned, as opposed to what I thought I'd learn.

## The tooling is better than I expected, the debugging is worse

Hardhat and Foundry are genuinely good. The testing experience in Foundry especially — writing tests in Solidity, fuzzing with a single annotation, gas snapshots — is better than most web2 testing setups I've used.

But debugging a failed transaction is still painful. You get "execution reverted" and a transaction hash. That's it. You have to reconstruct what happened from the call trace, which requires either Tenderly (excellent, but another tool to learn) or a lot of `console.log` statements in your Solidity.

On Solana it's worse. The error messages from Anchor programs are often just error codes. You learn to read them eventually, but the first few weeks you're just guessing.

## Gas optimization is a real skill and it matters more than I thought

I knew gas was a thing. I didn't realize how much it would shape how I write code.

In web2, you don't think about the cost of reading a variable. In Solidity, reading from storage costs 2,100 gas (cold) or 100 gas (warm). Writing to a new storage slot costs 20,000 gas. These numbers change how you structure data.

I spent a week optimizing a staking contract and got the gas cost per stake operation from 85,000 to 52,000. That's a 39% reduction. At scale, that's real money for users.

The main things that moved the needle:
- Caching storage variables in memory before loops
- Packing struct fields to minimize storage slots
- Using `calldata` instead of `memory` for external function parameters
- Using `unchecked` for arithmetic that can't overflow

None of these are complicated. They just require knowing they exist.

## The Solana account model broke my brain (in a good way)

I started looking at Solana in April. The account model — where programs are stateless and all state lives in separate accounts that get passed to every instruction — is genuinely different from anything I'd worked with before.

The first week I kept trying to think of it like Ethereum. "Where does the contract store its data?" It doesn't. The data lives in accounts that the program owns. The program is just logic.

Once that clicked, a lot of other things clicked too. Why you need to create accounts before using them (and pay rent). Why PDAs exist (programs need a way to own accounts without a private key). Why transactions declare their accounts upfront (enables parallel execution).

The Anchor framework makes this much more approachable. Without it, writing Solana programs is extremely verbose. With it, the account validation is declarative and the boilerplate is handled.

## Reading audit reports is the best free education in this space

I've read probably 30 audit reports cover to cover. Trail of Bits, OpenZeppelin, Spearbit. They're public, they're detailed, and they show you exactly what experienced security researchers look for.

The pattern I keep seeing: the most critical vulnerabilities are almost never in the obvious places. They're in the interactions between components. The reentrancy that happens across two functions, not one. The oracle that can be manipulated because of how it's called in a specific sequence. The access control that works correctly in isolation but fails when combined with another feature.

Reading these reports has made me a better developer even when I'm not thinking about security. I now naturally ask "what happens if this function is called in an unexpected order?" and "what if this external call fails?"

## The community is genuinely helpful but you have to ask good questions

I've gotten help from people I deeply respect in this space — people who've shipped protocols with hundreds of millions in TVL — just by asking specific, well-researched questions in the right Discord servers.

The key is specificity. "My contract doesn't work" gets ignored. "My Anchor program throws `ConstraintHasOne` when I call `update_position` even though I'm passing the correct owner account — here's the relevant code and the full error" gets a response within an hour.

## What I'm building now

I've been working on a small DeFi protocol — a lending pool with a twist on the interest rate model. Nothing revolutionary, but it's mine and it's real. I'm targeting a mainnet deployment in Q3.

The process of building something real has taught me more than any tutorial. You hit edge cases that tutorials don't cover. You have to make actual design decisions with real tradeoffs. You have to think about what happens when things go wrong.

I'll write more about the specific technical decisions as I get closer to deployment.

## The honest take

Six months in, I'm more convinced than ever that this is where interesting engineering is happening. Not because of the speculation or the token prices — those are noise. But because the problems are genuinely hard and the solutions have to be correct in a way that web2 software rarely does.

When you deploy a smart contract, you're making a commitment. The code will run exactly as written, forever, for anyone. That constraint forces a kind of rigor that I find genuinely satisfying.

It's also humbling. I've been writing software for six years and I still feel like a beginner here. That's uncomfortable and exciting at the same time.

---

*Next post: the specific technical decisions I made in my lending protocol and why. Including the ones I'm not sure about.*
