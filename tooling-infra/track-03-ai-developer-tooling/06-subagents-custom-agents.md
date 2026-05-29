# Subagents and Custom Agents: Delegating Specialized Work

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

A single agent doing everything has limits. The system prompt grows. The tool list bloats. Every conversation has to re-establish "you're an audit agent, you're rigorous about reentrancy, here's our codebase, here are our standards." Context is finite. Quality drops as you cram more in.

Subagents (or "custom agents") solve this by giving you specialized agents that the main agent can delegate to. The auditor subagent has its own system prompt and tool set, scoped exactly to audit work. The context-gatherer subagent's whole job is "given a vague question, identify the relevant files." Each runs autonomously, returns its result, and disappears — leaving the parent agent's context clean.

This pattern shows up across platforms with slightly different names — Claude Code's subagents, Kiro's invoke_sub_agent, Cursor's modes, Cline's agents. The mechanics are the same.


---

## Core Concepts

### What a subagent actually is

A subagent is a separate agent run, with:

- Its own system prompt
- Its own tool access (often a subset of the parent's)
- Its own context window (independent of the parent's)
- Its own conversation history (just for this task)

When the parent agent invokes a subagent, it sends a prompt — a task description — and the subagent runs autonomously until it produces a final answer, which is returned as a single text block. The parent gets the answer, the subagent's intermediate context is discarded.

### Why this is different from "the agent does it itself"

Two reasons:

1. **Context isolation.** A long subagent run might burn 50,000 tokens of intermediate work — file reads, tool calls, scratch reasoning. None of that pollutes the parent's context. The parent sees only the final answer.

2. **Specialization.** The subagent has a focused system prompt and a focused tool set. It's not trying to be helpful in general; it's trying to do *this specific kind of task* well. Specialized prompts produce better outputs than generalized ones.

The cost: subagent runs are independent — the subagent can't ask the parent for clarification mid-run. You front-load the prompt with everything the subagent will need.

### Common subagent patterns

A non-exhaustive list of subagents that show up in real Web3 dev setups:

- **context-gatherer** — Given a question or task, identify which files and code regions are relevant. Returns a curated list of file paths and line ranges. The parent then reads those and continues.
- **code-reviewer** — Given a diff or set of changed files, produce a focused review. Different from the parent agent's "I'll glance at this" — has its own checklist, runs static analysis tools, doesn't get distracted.
- **test-runner** — Runs the test suite, parses output, returns a structured summary of failures. Without this, the parent often gets lost in test stack traces.
- **doc-writer** — Given a function or module, produce documentation in the team's house style. Specialized prompt = more consistent output.
- **deploy-helper** — Walks the deployment runbook, checks preconditions, executes steps. Has only the deploy-related tools available.
- **security-checker** — Looks at a contract for common vulns. Specialized for Solidity, not general code review.


### When to use a subagent

Use a subagent when:

- The task has a long exploration phase but a short answer (context-gathering is the textbook case).
- You want to delegate to specialized expertise without burning context on the system prompt.
- Multiple of these tasks could be done in parallel.
- You want the parent agent to stay focused on the user's original task.

Don't use a subagent when:

- The task is small (just do it inline — subagent overhead isn't worth it).
- You need back-and-forth with the user during the task (subagents run autonomously to completion).
- The result is so big that it'll blow up the parent's context anyway.

### Defining a subagent

Most platforms let you define subagents as files. The shape, roughly:

```yaml
# .agents/code-reviewer.yaml (illustrative)
name: code-reviewer
description: Reviews code changes (a diff or list of files) for correctness, style, and potential bugs. Returns a structured review with line-specific comments.
tools:
  - read_file
  - grep_search
  - run_shell  # for running linters
system_prompt: |
  You are a senior code reviewer. Your job is to read the provided diff or files
  and produce a thorough, critical review.

  Review checklist:
  1. Correctness: does the code do what the comments/PR description claim?
  2. Edge cases: are nil/empty/boundary cases handled?
  3. Concurrency: any shared state that could race?
  4. Style: matches the team's conventions?
  5. Tests: are there tests for the change? Do existing tests still pass?

  Output format:
  - A short summary (3 lines max)
  - A list of inline comments, each with file:line and the comment
  - A final verdict: approve / approve-with-comments / request-changes
```

Different platforms have different exact formats. The core elements are always: name, description, tool list, system prompt.


### Invoking a subagent

The parent agent invokes via a tool that takes the subagent name and a prompt:

```
invoke_sub_agent(
  name="code-reviewer",
  prompt="Review the changes in PR #1234. Focus on the new auth flow in
          src/auth/. The team is concerned about session-handling race conditions."
)
```

The subagent runs, possibly for several "turns" (read files, search, think), and produces a final response. That response — and only that response — is what the parent sees.

You can pass context files to seed the subagent's context (so it doesn't waste turns finding them):

```
invoke_sub_agent(
  name="code-reviewer",
  contextFiles=["src/auth/session.ts", "src/auth/middleware.ts"],
  prompt="Review the session handling..."
)
```

This is especially valuable when the parent has already done the file-finding work — pass results forward instead of letting the subagent redo them.

---

## Code Walkthrough

A real subagent definition for Web3 audit triage:

```markdown
---
name: web3-vulnerability-triage
description: Use when the user has a potential vulnerability in a Solidity contract and wants a structured assessment. Reads the contract, classifies the issue, suggests reproduction steps, drafts a finding.
tools: [read_file, grep_search, run_shell]
---

# Vulnerability Triage Agent

You are a Solidity security specialist. When given a contract path and a
description of a potential issue, you:


1. Read the contract and understand its purpose.
2. Re-read the function(s) named in the issue. Look at every external call,
   storage write, and access modifier.
3. Confirm whether the issue is real:
   - Is there an exploitable invariant violation?
   - Can an attacker (EOA, contract, MEV bot) reach the bad state?
   - What's the realistic loss?
4. If real: draft a finding using the team's format (see references in
   `~/.kiro/skills/solidity-audit-report/`).
5. If not real: explain why, including what *would* make it real.

You always return:
- A boolean verdict (CONFIRMED / NOT_AN_ISSUE / NEEDS_MORE_INFO)
- A severity (Critical/High/Medium/Low/Informational), or null
- A draft finding (if confirmed) or explanation (if not)

Don't go beyond the scope. If the issue is reentrancy in `withdraw()`, don't
audit the rest of the contract.
```

The parent agent invokes this whenever a security question comes up. The subagent does the focused analysis. The parent gets a clean, structured answer to surface to the user.

### Composing subagents

Subagents can themselves invoke subagents (depending on platform). A useful pattern:

- **Parent agent**: takes user request, decides what to do.
- **Context-gatherer subagent**: identifies relevant files.
- **Specialist subagent**: does the actual analysis (audit, review, doc-write).
- **Parent agent**: combines results, presents to user.

Each layer keeps its context clean. The parent agent's context is only: the user's request, the high-level decisions, and the final summarized output of each subagent.

The cost: latency. Each subagent invocation is a separate model run. A 4-step chain might take a couple minutes end-to-end. Worth it for tasks where the alternative is "context overflow halfway through and have to restart."


---

## Common Mistakes and Gotchas

**1. Using a subagent for trivial tasks**
Subagent invocation has overhead — model startup, tool list construction, prompt loading. For "what does line 42 do?" just answer inline. Subagents are for tasks worth a separate run.

**2. Vague subagent prompts**
"Review the code" produces meandering output. "Review the code, focusing on the auth flow, with attention to race conditions in session handling, output as a structured review with file:line comments" produces tight, useful output. Front-load every relevant detail.

**3. Subagent that re-does the parent's work**
If you've already read 10 files, don't make the subagent re-read them. Pass the relevant snippets in the prompt or as context files. Saves time, saves tokens.

**4. Forgetting subagents can't ask questions**
A subagent that gets ambiguous instructions will guess and proceed. If a task needs clarification, do it in the parent before invoking. Subagents are autonomous to completion.

**5. Letting the subagent loop without bounds**
A subagent that keeps reading files looking for "more context" can burn its context window without producing output. Most platforms have step limits. Keep the task scoped.

**6. Returning huge subagent results**
The subagent's final response goes into the parent's context. If the subagent dumps 5,000 lines of file contents, the parent's context fills up. Train your subagent to summarize — the parent can re-fetch raw data if needed.

**7. Mismatched tool sets**
A subagent with a system prompt that says "run the test suite" but no shell tool will fail. Match the prompt's expectations to the actual tool list.

---

## How This Connects to Production

The teams making heavy use of agentic tools in 2026 typically have 3-8 custom subagents defined per project. They're checked in alongside the code (`.claude/agents/`, `.kiro/agents/`, `.cursor/agents/` depending on the stack), so every contributor's AI assistant has the same specialized helpers available.


For Web3 teams, the high-value subagents tend to be:

- A context-gatherer that knows the codebase layout
- A vulnerability triage agent (above)
- A test-runner that interprets Foundry output
- A deploy-runbook agent that checks preconditions before mainnet actions
- A "translate-to-non-technical" agent for status updates

Each one is a few hundred lines of careful prompt engineering, and each one saves real time the next thousand times it's used.

The mental shift: stop trying to make one agent do everything. Build a small team of specialized agents and let them collaborate. The pattern is closer to how human dev teams work — engineers, reviewers, ops, doc writers — and produces better outcomes for the same reason.

---

## What to Learn Next

- **AI-Augmented Web3 Workflows** — putting MCPs, skills, and subagents together for real audit, indexing, and debugging tasks.
- **Building Your Own MCP Server** — when your subagents need new tools that don't exist yet.
- **Claude Skills and Agent Skills** — when "specialized expertise" is what you want without the full subagent overhead.
