# Claude Skills and Agent Skills: Packaging Reusable Capabilities

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

MCP servers expose *tools*. But a lot of useful capabilities aren't tools — they're *workflows*. "When the user asks for a security audit summary, follow this multi-step process: read the contract, list externally-callable functions, classify by risk, format as a checklist." That's not a tool. That's a procedure, plus knowledge, plus maybe a few helper scripts.

Skills are how you package that. Originally introduced as Claude Skills by Anthropic in 2025 and adopted in similar shapes by other agent platforms (Kiro's steering, Cursor's rules, Cline's modes), the pattern is the same: a folder of instructions and helper assets the agent can discover and load when relevant.

This lesson is about what skills actually are, when to use them instead of MCPs, and how to write ones that work.


---

## Core Concepts

### Skills vs MCPs vs prompts

Three closely-related concepts. The differences matter:

- **MCP servers** expose runtime tools and data. Think: "the agent can do this thing now." Examples: read filesystem, query Postgres, fetch URL.
- **Skills** are packages of *instructions and assets* the agent loads when a task matches. Think: "when this kind of task comes up, follow these instructions and use these scripts." Examples: "how to write a PR description," "how to format a security report," "how to convert a Word doc to PDF."
- **Prompts** are user-invokable templates ("/summarize-pr"). They're a single piece of text. Skills are richer — they include scripts, reference files, and decision rules.

The cleanest mental model: MCPs add *capabilities*; skills add *expertise* in using them.

### Anatomy of a skill

The Claude Skills format (and the broader pattern most platforms follow):

```
my-skill/
├── SKILL.md          # required: front matter + instructions
├── scripts/          # optional: helper scripts the agent can run
│   ├── format.py
│   └── lint.sh
└── references/       # optional: docs/examples the agent can read
    ├── examples.md
    └── style-guide.md
```

`SKILL.md` has YAML front matter the agent uses to decide when to load the skill:

```markdown
---
name: pdf-export
description: Use this skill when the user asks to export a document, report, or summary as a PDF. Handles formatting, fonts, and page breaks.
---

# PDF Export

When the user asks for a PDF:

1. Identify the source content (markdown? HTML? plain text?)
2. Run `scripts/format.py --input <file> --output <pdf>` to generate the PDF.
3. If the source has images, ensure they're embedded.
4. Confirm output path with the user.

## Common cases

- Converting markdown reports → use the `--style report` flag
- Converting code documentation → use the `--style code` flag
```


The agent reads only the front matter at startup — that's the discovery surface. The body is loaded only when the agent decides to invoke the skill, keeping context use efficient.

### Discovery: how the agent picks a skill

Different platforms do this slightly differently:

- **Claude Skills**: front-matter `description` is matched against the current task. The agent decides "this skill is relevant" and reads the body.
- **Kiro steering files**: similar pattern with `inclusion: auto` files that activate when matched.
- **Cursor rules**: globs match files, and matched rules become part of the system prompt.
- **Cline modes**: user explicitly switches mode; rules for that mode are loaded.

In all cases, the goal is the same: the *right* expertise loads for the *right* task, and you don't burn context on every skill at every turn.

### When to use a skill instead of an MCP

Use a skill when:

- The capability is mostly *knowledge* (a procedure, a style guide, a domain ontology).
- The "tool" is just a shell script that doesn't need a long-running server.
- You want the agent to follow specific steps when a kind of task comes up.
- The same instructions would otherwise need to be in the system prompt for every conversation.

Use an MCP when:

- You need a long-running connection (database, websocket).
- The capability is genuinely a runtime tool with structured I/O.
- You want the same capability available across many AI clients with one implementation.
- You need authentication / state across calls.

Many real workflows use both: a skill that says "when the user asks for an audit summary, do these steps using these MCP tools."


### Writing skills that the agent actually uses

The biggest authoring mistake: vague descriptions. The agent decides whether to load a skill based on the front-matter `description`. If yours says "various utilities," it'll never get picked. If it says "Use this skill when the user wants to convert markdown reports to PDF," it'll get picked exactly when relevant.

Writing rules that work:

1. **Describe the trigger, not the capability.** "Use when the user asks X" beats "Provides Y."
2. **Be specific about scope.** "For Solidity audit reports" is better than "For audits."
3. **Include keywords users actually use.** If your team says "ship it" instead of "deploy," include "ship" in the description.
4. **Keep it short.** The description is read on every task; long descriptions waste tokens.

For the body of the skill (loaded only when invoked):

1. Write step-by-step instructions, not narrative explanations.
2. Reference helper scripts by relative path (the agent's working directory will be the skill's directory when it runs them).
3. Include examples of input → expected output where useful.
4. Don't repeat what the agent already knows — focus on the team-specific or task-specific bits.

---

## Code Walkthrough

A practical skill for a Web3 team: "format a security finding."

```
solidity-audit-report/
├── SKILL.md
├── scripts/
│   └── render-finding.py
└── references/
    ├── severity-rubric.md
    └── example-finding.md
```


`SKILL.md`:

```markdown
---
name: solidity-audit-report
description: Use this skill when the user wants to write up a security finding for a Solidity contract — drafting an issue, formatting a report, or classifying severity. Produces output in the team's standard finding format.
---

# Solidity Audit Finding Format

When the user describes a vulnerability or asks for a finding:

## 1. Classify severity

Read `references/severity-rubric.md` for the team's classification rules.
Severities: Critical, High, Medium, Low, Informational.

## 2. Structure the finding

Every finding has these sections, in order:
- **Title**: Short, action-oriented (e.g. "Reentrancy in `withdraw()` allows balance manipulation").
- **Severity**: From the rubric.
- **Location**: File path and line number (`src/Vault.sol:142`).
- **Description**: What the issue is, in 2-3 sentences.
- **Impact**: What the attacker can achieve.
- **Reproduction**: Concrete steps or a Foundry test snippet.
- **Recommendation**: How to fix.
- **References**: Links to similar past findings if relevant.

## 3. Render

If the user wants the finding committed to the repo, call:

    python scripts/render-finding.py --severity <Sev> --title "<title>" --content <body.md>

It writes to `findings/<YYYY-MM-DD>-<slug>.md` in the audit repo.

## 4. Cross-check

Look at `references/example-finding.md` for tone and formatting before rendering.
```

`scripts/render-finding.py` is a regular Python script — opens the right path, writes the file, prints the resulting filename. The agent invokes it via shell.

`references/severity-rubric.md` is a one-page document with the team's actual rules ("a Critical finding requires demonstrable on-chain loss greater than X under realistic conditions").

When a user says "draft a finding for the reentrancy I just found in `withdraw()`," the agent:

1. Sees the description match → loads the skill body.
2. Reads `severity-rubric.md` to classify (Critical, given on-chain loss).
3. Walks through the section structure.
4. Calls `render-finding.py` to write the file.
5. Confirms with the user.


This used to be "I have to remember to follow our format" or "let me copy-paste an old finding." Now the format is encoded once, applied automatically, consistently across the team.

### Where to put skills

Two scopes:

- **User-level**: `~/.claude/skills/` (Claude) or `~/.kiro/skills/` (Kiro). Available across all your projects.
- **Workspace-level**: `.claude/skills/` or `.kiro/skills/` in the repo. Scoped to that project; checked in for the team.

Team-level skills go in the repo. Personal style preferences go in the user-level directory.

---

## Common Mistakes and Gotchas

**1. Description that doesn't trigger when expected**
If your skill never fires, the description isn't matching how users actually phrase the task. Try the description on a colleague: "what would you ask for to make this skill kick in?" Match their wording.

**2. Body that the agent can't follow**
"Render the finding nicely" is not actionable. "Run `scripts/render-finding.py --severity X --title Y`" is. Imperative steps with concrete commands.

**3. Skill that overlaps with another skill**
If two skills both match "writing a PR description," the agent picks one — possibly the wrong one. Make descriptions specific enough that there's no ambiguity, or merge them.

**4. Trying to put runtime logic in `SKILL.md`**
The skill body is text the agent reads. It's not executable. Helper logic goes in `scripts/`, called by the agent through its shell tool.

**5. Updating SKILL.md but forgetting the description**
Easy to update the body and leave a stale description. The description is the discovery surface — it's the thing that has to stay accurate even more than the body.

**6. Skill that depends on tools the agent doesn't have**
If your skill says "run `forge test`," the agent needs a shell tool. If it says "fetch via curl," the agent needs network access. Verify the agent's tool surface includes what your skill assumes.


**7. Putting secrets in the skill**
`SKILL.md` is text the agent reads into context. If you embed an API key, it's now in the prompt every time the skill loads. Use env vars and reference them from helper scripts instead.

---

## How This Connects to Production

The teams I see getting the most leverage out of AI tools have invested in skills heavily. They look at every "I have to explain the same thing in every conversation" moment and turn it into a skill. After a few months, their AI assistant feels less like a generic tool and more like a colleague who's been at the company for years.

For Web3 teams, the high-leverage skills tend to be: audit-finding format, deployment runbook, gas-optimization checklist, "explain this contract to a non-technical stakeholder," "draft a postmortem from this incident timeline." Each one captures expertise that previously lived in a senior engineer's head.

The pattern is mundane: identify a recurring procedure, write it down, point to the helper scripts, give it a clear trigger description. But it's the kind of mundane that compounds — every skill is a multiplier on every future conversation that touches its territory.

---

## What to Learn Next

- **Subagents and Custom Agents** — when a skill isn't enough and you need a fully separate agent with its own prompt and tool set.
- **AI-Augmented Web3 Workflows** — putting MCPs and skills together end-to-end on real audit, indexing, and debugging tasks.
- **Building Your Own MCP Server** — for the cases where you need runtime tools, not just instructions.
