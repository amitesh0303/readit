---
title: "Why I Finally Went All-In on Web3 (After Years of Skepticism)"
date: 2023-02-14
tags: [web3, career, ethereum, personal]
---

I want to be honest about something: I spent most of 2021 and 2022 being the guy in the room who pushed back on crypto.

Not because I didn't understand it. I'd read the Ethereum whitepaper. I understood the mechanics. I just thought the signal-to-noise ratio was terrible — 95% speculation, 5% actual technology. Every week there was a new "revolutionary" project that turned out to be a JPEG with a Discord server.

So what changed?

## The thing that actually got me

In late 2022, I was helping a friend send money to his family in Nigeria. The bank transfer was going to take 5 business days and cost $40 in fees on a $300 transfer. That's 13% just to move money.

He ended up using USDC on Polygon. The transfer took 3 minutes and cost $0.02.

I know that's not a new story. People have been making this argument for years. But watching it happen in real time, for someone I knew, for a real problem — it landed differently than reading about it.

That was December 2022. By February 2023 I was deep in Solidity docs.

## What I actually knew coming in

I had about 6 years of full-stack experience at that point. TypeScript, Node.js, React, some Rust. I'd done a bit of systems programming. I understood cryptography at a conceptual level — hashing, public/private keys, signatures.

What I didn't know: anything about the EVM, gas mechanics, how wallets actually worked under the hood, what a smart contract deployment actually looked like.

The learning curve was steeper than I expected, but not in the ways I expected.

## The parts that were easy

The tooling is actually pretty good. Hardhat is a solid development environment. ethers.js has decent docs. Solidity syntax is close enough to TypeScript that you can read it without much friction.

Deploying a contract to a testnet for the first time felt like magic. You write some code, run a script, and suddenly there's this thing living on a public blockchain that anyone in the world can interact with. That feeling doesn't go away.

## The parts that were hard

The mental model shift. In web2, your backend owns its state. In web3, state is distributed across thousands of nodes and you can't change it once it's there. That sounds obvious but the implications run deep.

The first time I had a bug in a deployed contract and realized I couldn't just push a fix — that was a cold shower moment. You have to think about security before you deploy, not after.

Gas. Understanding that every computation costs money, and that the cost is variable and unpredictable, changes how you write code. You start thinking about storage reads and writes in a way you never do in web2.

The ecosystem fragmentation. Ethereum, Solana, Polygon, Arbitrum, Optimism — they're not just different chains, they're different programming models, different tooling, different communities. Picking where to focus is genuinely hard.

## Where I'm starting

I'm going to focus on Ethereum and the EVM ecosystem first. It has the most mature tooling, the largest developer community, and the most production protocols to learn from. Once I have a solid foundation there, I'll branch out to Solana (which I'm already curious about — the account model is fascinating).

My goal for 2023: ship something real. Not a tutorial project, not a fork of someone else's code. Something that solves an actual problem, deployed on mainnet, used by actual people.

I'll write about what I learn along the way. The good parts and the frustrating parts.

---

*If you're also making this transition from web2 to web3, I'd genuinely like to hear what's tripping you up. The community is better when people are honest about the hard parts.*
