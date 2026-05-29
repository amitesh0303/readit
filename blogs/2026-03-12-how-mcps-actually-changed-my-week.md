---
title: "How MCPs Actually Changed My Week (Not the Marketing Version)"
date: 2026-03-12
tags: [mcp, ai, claude, cursor, productivity, web3-tooling]
---

I've been using AI coding tools daily for over two years now. The shift in my workflow over the last six months — driven mostly by MCP servers becoming actually useful — is bigger than the shift from "ChatGPT helps me write boilerplate" to "Cursor autocompletes well." This isn't the marketing pitch. This is what my Tuesday actually looks like in March 2026 vs what it looked like in September 2025.

## The setup that changed things

Around mid-2025 I rebuilt my MCP config, properly. Six servers:

- filesystem (scoped to my projects directory)
- git (one per active repo)
- github (with a tightly-scoped PAT)
- a custom etherscan-mcp I forked and trimmed
- alchemy's MCP, for multi-chain queries
- a tiny internal MCP I wrote that knows our team's contract addresses across mainnet and three testnets

Plus four skills (my team's audit-finding format, the deploy runbook, a "translate to non-technical" skill for status updates, and a postmortem template) and two subagents (a context-gatherer and a vulnerability-triage agent).

About 500 lines of configuration and prompt engineering across the whole setup. Maybe six hours of work to get it dialed in. I'll talk about whether that was worth it.

## A real Tuesday, walked through

Last Tuesday, three things happened that would have eaten my whole day in 2024.

### 9:14 AM — Audit reviewer flagged a finding I hadn't seen

A junior auditor on a contract we're shipping had flagged a potential reentrancy in a vault function. Their description was vague: "I think there might be a reentrancy in `withdraw()`. The check happens before the external call but I'm not sure."

A year ago: I would have spent 30 minutes reading the contract, building a mental model of every external call path, deciding if the issue was real, then writing up either a confirmation or a "no, here's why" explanation.

Now: I asked my context-gatherer subagent to map every external call from `withdraw()`, then handed the result to the vulnerability-triage subagent with the auditor's claim. Total elapsed time, including writing the prompt: about 8 minutes. The triage agent confirmed the issue was *not* a reentrancy (the external call was a transfer to a known-safe ERC-20, after a state update), explained why, and noted a different issue it had spotted while reading: a slippage check that was using a stale price reference.

I verified that second issue manually (15 minutes). It was real. Medium severity. We'd have shipped without catching it. The agent picking it up wasn't magic — it was systematic. I had asked it to look at the function carefully, it looked at it carefully, and the slippage thing happens to be on its checklist.

I spent the time I'd saved on the original finding writing the new finding properly. Net: maybe 25 minutes of my time used, two findings handled, one of which I wouldn't have caught.

### 11:30 AM — A user reported a reverted transaction

Customer support DM: "Tx 0xABC failed, user is upset, can you check?"

A year ago: open Etherscan, find the tx, look at the trace (Etherscan's trace UI is fine for simple cases, miserable for complex ones), find the failing call, identify the contract, read its source on a separate tab, figure out what condition was failing, check the user's state at the relevant block, write up an explanation. Forty-five minutes minimum.

Now: I asked my agent: "Tx 0xABC on mainnet reverted. Find out why. Suggest a fix to the user."

Under the hood, it called the alchemy MCP for the trace, the etherscan MCP for the verified source, did a few `eth_call`s at the relevant block to read storage, identified the failing `require`, and produced this:

> The transaction reverted at the call to `Vault.withdraw()` because the user's withdrawable balance had decreased between when the UI fetched it and when the tx was confirmed. The UI showed a withdrawable amount of 1.04 ETH, but a block earlier the user had borrowed 0.05 ETH against the same collateral, reducing their unencumbered balance below the requested withdraw amount.
>
> Suggested response: "Your withdrawable balance changed between when you opened the screen and when you submitted. Refresh the page and try again — the displayed amount will reflect your current borrow position."

I read it, double-checked one number against Etherscan myself (the agent was right), and forwarded the suggested response to support. Ten minutes.

The issue here isn't that the agent did something I couldn't have done. It's that the agent did the routine investigation in parallel with me being able to focus on whether its conclusion was actually right. The cost of debugging dropped from "blocking task" to "verify a hypothesis."

### 3:00 PM — A subgraph started lagging

Our subgraph that powers the analytics dashboard fell about 2 hours behind on indexing. Our monitoring noticed; I needed to triage.

I asked the agent to query the subgraph's health metrics (it has tools that hit our internal monitoring stack), then look at our subgraph repo to see what could be causing slow indexing.

It came back with: indexing latency had climbed since a deploy two days earlier. The diff in that deploy added a new entity that was being created in a loop within an event handler — every Transfer event was creating up to 20 PriceSnapshot entities. The handler was correct but doing far more work than necessary. Suggested fix: batch the snapshots by block, reducing entity creation by ~80%.

I looked at the diff myself. The agent's diagnosis was right. I made the change, deployed, indexing caught up over the next 30 minutes.

Without the MCPs, this would have been "I have the symptom, let me trace the cause" — a process where every step (look at deploy history, look at the diff, profile the indexer, find the bottleneck) is its own context-switch. With the MCPs, it became "describe the symptom, evaluate the answer, ship the fix."

## The part where I'm honest about what doesn't work

The agent is *not* a competent senior engineer. It is a competent intermediate engineer with great recall and infinite patience for grunt work. The differences matter:

**It still misses creative attacks.** On the audit triage, it found a known-pattern bug (slippage with stale price) that's literally in its checklist. It would not have found a novel attack that doesn't match a pattern it's seen. The senior auditor on my team still finds bugs the agent misses, and it's not even close on the hard ones.

**It hallucinates plausibly.** Asked about the gas cost of a specific opcode in a specific Solidity version, it'll give me a confident wrong answer about 1 in 20 times. I treat every numerical claim as "verify before acting."

**It's bad at admitting uncertainty.** "I'm not sure" is rare. "Here's a confident answer that turns out to be wrong" is common. Habit: I always ask for the reasoning, not just the answer.

**The setup is annoying.** Six MCP servers, four skills, two subagents — that's not "install one app." It's six configurations to keep working, secrets to rotate, version conflicts when something updates. A non-trivial fraction of my "AI productivity" time is just keeping the AI tooling working.

## Net verdict

I genuinely think my output is up something like 1.5-2x on the kinds of tasks I described above. Not 10x. The work that's the bottleneck — design, novel problem-solving, judgment, the security-critical decisions — those parts didn't speed up much. What sped up is the surrounding work: investigating, triaging, summarizing, drafting, debugging routine cases, formatting output.

That's a smaller productivity win than the breathless takes claim, but it's a genuine and durable one. And the fact that the bottleneck shifted to design and judgment is, to me, the sign that the tools are working as intended. They're absorbing the parts of the job that should have been automated decades ago and freeing me up for the parts that actually need a senior engineer.

The setup investment paid back in about a week. After six months, the compounding has been substantial. If you're a senior dev and you haven't built out a real MCP setup yet, do it. Not because the AI is going to replace you. Because the AI is going to absorb the tax on your day, and you'll spend more time on the parts of the work you actually care about.
