---
title: "Two Years In: What the Space Looks Like From Here"
date: 2024-11-18
tags: [web3, career, ethereum, solana, reflection]
---

Two years ago I wrote my first Solidity contract. It was a counter. It incremented a number. I was unreasonably excited about it.

I want to write an honest retrospective — not a highlight reel, but an actual accounting of what I've learned, what surprised me, what disappointed me, and where I think this is going.

## What I've shipped

In two years:
- A lending protocol on Ethereum mainnet (v1 immutable, v2 with proxy)
- A yield aggregator on Arbitrum (audited, ~$2M TVL at peak)
- A liquidation bot on Solana (running for 8 months, profitable)
- A ZK age verification demo (Sepolia, educational)
- Several smaller tools and scripts that I use personally

None of these are Uniswap. None of them have made me rich. But they're real things that real people use, and building them has taught me more than any course or tutorial could.

## What surprised me (good)

**The composability is real.** When I first heard "money legos," I thought it was marketing. It's not. Being able to call Uniswap, Aave, and Chainlink from a single transaction, atomically, is genuinely powerful. I've built things that would have required months of API integrations and trust agreements in web2, and done them in a few hundred lines of Solidity.

**The community is better than I expected.** I've gotten help from people who've shipped protocols with hundreds of millions in TVL, just by asking good questions in the right places. The knowledge-sharing culture is real. People write detailed post-mortems about exploits. Audit reports are public. The ecosystem is more open than most of web2.

**The tooling has improved dramatically.** Foundry didn't exist when I started (well, it did, but it wasn't mainstream). Wagmi v2 is significantly better than v1. The Anchor framework has matured. The developer experience in 2024 is meaningfully better than 2022.

**EIP-4844 actually worked.** I was skeptical that the blob upgrade would deliver the promised fee reductions. It did. L2 fees dropped 10-20x overnight. That's a real improvement for real users.

## What surprised me (bad)

**Security is harder than I thought.** I knew smart contract security was important. I didn't appreciate how many ways there are to get it wrong. The donation attack on my yield aggregator — I had read about it, I thought I'd protected against it, I hadn't. The gap between "understanding a vulnerability" and "writing code that's immune to it" is larger than I expected.

**The oracle problem is unsolved.** Every DeFi protocol that needs real-world data has to trust an oracle. Chainlink is the best option but it's still a centralized service with a trust assumption. The oracle manipulation attacks keep happening because the fundamental problem — getting trustworthy off-chain data on-chain — doesn't have a perfect solution.

**Cross-chain is still a mess.** I've integrated three different bridges. They all work differently, they all have different security models, and they've all had significant exploits. The vision of a seamlessly interoperable multi-chain ecosystem is still far from reality.

**The speculation drowns out the signal.** Every time there's a bull market, the noise-to-signal ratio gets terrible. Serious technical work gets buried under token launches and influencer content. It's exhausting to filter.

## What I think about the technology now

I'm more bullish on the technology and more skeptical of the ecosystem than I was two years ago.

The technology is genuinely interesting. ZK proofs are enabling things that weren't possible before. L2s are making Ethereum usable for a much wider range of applications. The account abstraction work (ERC-4337) is slowly making wallets less terrible. These are real technical advances.

The ecosystem has real problems. Too much of the value creation is extractive rather than productive. MEV is a tax on users. Many "protocols" are just token distribution mechanisms with no sustainable business model. The regulatory uncertainty is real and it's slowing down legitimate development.

I think the technology will outlast the speculation. The useful applications — payments, DeFi, identity, ownership — will survive the cycles. The speculative applications will mostly not.

## What I'm working on now

I'm deep in a perpetuals protocol on Solana. It's the most technically complex thing I've built — vAMM pricing, funding rates, cross-margin accounting, liquidation logic. I've been at it for three months and I'm probably halfway done.

The Solana ecosystem has matured significantly in the past year. The tooling is better, the documentation is better, the community is larger. I'm glad I invested time in learning it.

I'm also spending more time on ZK. The age verification demo was a learning project. I want to build something with real privacy properties — not just a demo, but something that actually protects user data in a meaningful way.

## The honest answer to "is it worth it?"

Yes, but not for the reasons most people think.

It's not worth it because you'll get rich. Most people don't. The ones who do are usually early to a specific thing at a specific time, and that's mostly luck.

It's worth it because the problems are genuinely hard and the solutions have to be correct in a way that most software doesn't. It's worth it because the composability enables things that aren't possible elsewhere. It's worth it because the community, at its best, is unusually open and collaborative.

And honestly, it's worth it because I find it interesting. That's not nothing. Spending your working hours on problems you find genuinely interesting is a privilege, and I don't take it for granted.

---

*Three years in, I'll write another one of these. I'm curious what will have changed.*
