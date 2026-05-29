# AI-Augmented Web3 Workflows: Audits, Indexing, and Debugging

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Knowing the building blocks — MCPs, skills, subagents — doesn't tell you how to *use* them on real work. The pieces are individually obvious. The compositions are not. How do you actually run an audit prep with these tools? What does "AI-assisted indexer development" look like in practice? How do you debug a reverted mainnet transaction in a way that's faster than just reading Etherscan yourself?

This lesson is the worked examples. Three concrete workflows that show how the pieces fit together for working Web3 engineers in 2026.


---

## Workflow 1: Audit Prep on a New Codebase

You're auditing an unfamiliar protocol. 30 contracts, 10k lines of Solidity. The clock is running.

**Setup**: filesystem MCP scoped to the audit repo, foundry MCP, etherscan MCP, a `solidity-audit-report` skill, a `vulnerability-triage` subagent.

**Pass 1 — Map the system (10 minutes)**.

Prompt: "Walk this repo. Produce: (1) a one-paragraph summary of what the protocol does, (2) a list of every externally-callable function across all contracts with a one-line description, (3) the contract dependency graph."

What happens under the hood:

- Parent agent invokes the `context-gatherer` subagent.
- Subagent scans `src/`, reads each `.sol` file, identifies external/public functions.
- Subagent runs `forge inspect` via the foundry MCP to get accurate ABIs.
- Returns a structured markdown report.

You read it for 5 minutes. You now know the system better than from any 30-page docs site.

**Pass 2 — Vulnerability sweep (30 minutes)**.

Prompt: "Run the audit checklist on every contract. For each finding, use the `vulnerability-triage` subagent to verify and classify."

What happens:

- Parent agent loads the `solidity-audit-report` skill.
- Walks each contract, applies the team's checklist (reentrancy, oracle dependence, integer math, access control, etc).
- Each suspicious pattern is delegated to the triage subagent: "is this real?"
- Subagent reads the relevant contract, checks invariants, returns CONFIRMED / NOT_AN_ISSUE.
- Confirmed findings get drafted into the team's format via the skill.

End result: a list of structured findings, each with severity, location, reproduction sketch, and recommended fix. You then verify the high-severity ones manually — but you start from a thorough first pass instead of a blank page.


**Pass 3 — Reproduction tests (60 minutes)**.

For each high-severity finding:

Prompt: "Write a Foundry test that demonstrates this finding. Run it on a forked mainnet to confirm exploitability."

The agent:

- Drafts the test using the foundry MCP's knowledge of project conventions.
- Runs `forge test --fork-url $MAINNET_RPC` via the shell tool.
- If the test passes (exploit works), commits it to the repo as evidence.
- If it fails, refines and retries — or marks the finding as theoretical.

The mundane stuff (test scaffolding, mocking, debugging compilation errors) is automated. Your time goes to verifying the *logic* of the finding, not the boilerplate around it.

**What's different from doing it manually**: not the model finding bugs you wouldn't have. Senior auditors still find more bugs than the model on novel issues. The difference is that the systematic checklist coverage is fast, the formatting is consistent, and you spend your time on the parts that need a human — adversarial creativity, business-logic understanding, judgment calls on severity.

---

## Workflow 2: Building a Subgraph from Scratch

You need to index a new contract for a frontend. Subgraphs are conceptually simple but tedious to set up.

**Setup**: filesystem MCP, etherscan MCP, a `subgraph-development` skill, the Graph Protocol's CLI available via shell.

**Step 1 — Schema design**.

Prompt: "Read the contract at `0xABC...` on mainnet. Design a subgraph schema for it. Track all events, with relationships between entities."


The agent:

- Etherscan MCP fetches the verified source.
- Reads the events: `PoolCreated`, `Swap`, `Mint`, `Burn`.
- Identifies natural entities: `Pool`, `Token`, `Swap`, `LiquidityPosition`.
- Identifies relationships: every `Swap` belongs to a `Pool`, every `Pool` has two `Token`s.
- Produces a `schema.graphql` file with the right entities, fields, and `@derivedFrom` relationships.

**Step 2 — Mapping handlers**.

Prompt: "Generate the `subgraph.yaml` and AssemblyScript handler functions for each event."

The agent:

- Loads the `subgraph-development` skill, which contains the team's conventions for handler structure.
- Generates handlers that load entities (creating if needed), update fields, save.
- Writes the manifest pointing at the contract address with the right ABI.

**Step 3 — Test locally**.

Prompt: "Run `graph build` and fix any errors."

The agent:

- Runs the build via shell.
- If errors: reads them, identifies the issue (typo in field name, missing entity, incorrect AssemblyScript syntax), fixes, retries.
- Loops until clean build, or asks for human input if stuck.

**Step 4 — Deploy and verify**.

Prompt: "Deploy to the hosted service and verify it indexes the last 100 swaps correctly."

The agent:

- Runs `graph deploy` via shell.
- Polls the subgraph's GraphQL endpoint via fetch MCP for the indexing progress.
- Once synced, queries the most recent swaps and compares to Etherscan to confirm correctness.

What used to be a half-day of yak-shaving (boilerplate, type errors, deploy auth) becomes an hour with you reviewing the agent's outputs. The interesting parts — schema modeling, handler logic correctness — still need your judgment, but the operational tax drops a lot.


---

## Workflow 3: Debugging a Reverted Mainnet Transaction

A user reports their tx failed. Hash: `0x123...`. They lost gas, no obvious reason.

**Setup**: alchemy/tenderly MCP, etherscan MCP, foundry MCP.

Prompt: "Tx `0x123...` on mainnet reverted. Find out why."

The agent:

1. Fetches the tx via alchemy MCP. Gets the trace, including all internal calls and the revert frame.
2. Identifies which contract reverted (often deeper in the call stack than the user-facing one).
3. Fetches that contract's verified source via etherscan MCP.
4. Reads the source. Locates the revert. Identifies the failing condition (e.g. `require(amount <= maxBorrow, "exceeds limit")`).
5. Looks at the contract state at the time of the tx — the agent calls `eth_call` against an archive node at the relevant block to read the storage that the require was checking.
6. Returns: "Tx reverted because `amount` was 100 USDC but the user's `maxBorrow` at block X was 80 USDC. The user's collateral had dropped due to a price oracle update 2 blocks earlier. Suggested fix: re-check `maxBorrow` before signing."

This is a 5-minute task that previously was 30 minutes of manual Etherscan tab-juggling. And critically: the answer is structured well enough that you can paste it directly into a support reply.

**Variation: simulate a fix**.

Prompt: "If the user adds 20 USDC of collateral, will the tx succeed?"

The agent:

- Spins up an Anvil fork at the same block via foundry MCP.
- Simulates the collateral deposit.
- Re-runs the original tx.
- Returns: "Yes, with 20 USDC additional collateral the tx would succeed. New `maxBorrow` would be 105 USDC."

You ship this answer to the user. They follow the suggestion. Their tx works. Total elapsed time: under 10 minutes.


---

## Common Mistakes and Gotchas

**1. Over-trusting the agent's first answer on security work**
The model is great at applying checklists. It's worse at adversarial creativity — the kind of "what if I do this weird thing nobody expected" thinking that finds the deepest bugs. Use the agent for coverage, not for novel attack ideation. Human review on high-severity findings is non-negotiable.

**2. Letting the agent write irreversible operations on mainnet**
The agent has a foundry shell. If it runs `cast send` against mainnet with your funded private key, real money moves. Always require human approval for any tool call that touches a non-fork RPC. Most platforms gate this behind permission prompts — keep them on.

**3. Skipping the "explain to me why" step**
The model can produce a finding, a subgraph, a debug answer. It can also produce confident nonsense. Asking "why" — "explain why this `require` would fail at this block" — surfaces fabrication faster than reviewing output silently.

**4. Letting the agent burn through API quotas**
Audit prep on a 30-contract codebase can mean hundreds of Etherscan and Alchemy calls. If your AI tooling shares the same key as production, you'll exhaust the quota. Use a separate key, with a budget alarm.

**5. Not capturing the agent's findings as artifacts**
"It told me there were 5 high-severity findings" is not the same as having 5 written-up findings in the audit repo. Make the agent commit its outputs (skills with `render-finding.py` style helpers do this). What's in chat history is ephemeral.

**6. Forgetting to update tooling when the codebase changes**
A subagent prompt that references "our v1 contracts" becomes stale when you ship v2. Treat agent prompts and skill bodies as code — review them when the underlying system changes.

**7. Trying to chain too many subagents in one shot**
A workflow with 6 subagents in series is fragile — one of them misinterpreting will cascade. Two or three layers usually work. Beyond that, check intermediate outputs and route around failures.


---

## How This Connects to Production

The senior Web3 devs who are noticeably more productive in 2026 aren't using fundamentally different models from anyone else. They've invested in their tooling: 4-6 custom MCP servers, 8-10 skills, 5-8 subagents. Each one captures a workflow that used to be a manual time-sink. The compounding effect across a year of work is enormous — easily a 2-3x productivity gain on the parts of the job that lend themselves to automation.

Counter-intuitively, this *increases* the value of the senior parts of the job, not decreases. Code-writing throughput is higher, so the bottleneck shifts to architecture, judgment, novel problem-solving, and security review — exactly the things AI is worst at and senior engineers are best at. The path forward is not "use AI to replace the boring work and fight to keep the interesting work" — it's "use AI to do the boring work so you can spend more time on the interesting work."

That investment is what this whole track has been about. MCPs add capabilities. Skills capture procedures. Subagents handle specialized tasks. Workflows compose them. None of the individual pieces are exotic; the compounding is.

---

## What to Learn Next

You've now covered the AI tooling track end to end. Other tracks worth checking:

- **Web3 Frontend Engineering** — viem, wagmi, and the frontend stack senior devs ship with.
- **Account Abstraction & Smart Wallets** — ERC-4337, paymasters, session keys.
- **Subgraph Development with The Graph** — when the workflows here meet the actual indexing layer.
- **Solidity Security 101** — base material to make your audit-prep workflow more useful.
