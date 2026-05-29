# Setting Up MCP Servers: Filesystem, Git, Databases, and the Standard Library

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Knowing what MCP is doesn't help you ship. You need to actually wire up servers, get them to launch when your editor starts, scope their permissions appropriately, and debug when they don't show up. The official "reference servers" repo and the dozens of community servers all have slightly different conventions for setup, configuration, and permissions.

This lesson is the practical guide: which servers everyone runs, the actual config snippets that work, and the gotchas that bite when you copy-paste from a README.


---

## Core Concepts

### The standard library

These are the servers you'll see in nearly every dev's config. All published as `@modelcontextprotocol/server-*` packages, runnable via `npx` or `uvx` without a global install:

- **filesystem** — read/write files in a sandboxed directory tree. The most-used MCP, full stop.
- **git** — git operations: status, log, diff, blame, show, search-commits.
- **github** — interact with the GitHub API: list issues, fetch PRs, create PRs, post comments. Needs a PAT.
- **postgres** / **sqlite** — schema introspection and read-only queries.
- **fetch** — pull a URL and return text/markdown. Stripped of HTML noise so the model isn't drowned in nav bars.
- **brave-search** / **tavily** — web search, returns titles/snippets/URLs.
- **puppeteer** / **playwright** — browser automation. The model can navigate, screenshot, evaluate JS in pages.
- **memory** — a key-value store for the agent's own scratchpad across sessions.
- **time** — timezone-aware `now()` and conversions. Sounds dumb, fixes a real LLM weakness.
- **sequential-thinking** — a "scratch space" tool that lets the model write multi-step plans visibly.

A senior Web3 dev's typical lineup: filesystem, git, github, fetch, sqlite, plus 2-3 Web3-specific servers (covered in the next lesson).


### Configuration files: where they live

Every client reads MCP servers from its own config file. The shape is the same; the path varies:

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
- **Cursor**: `.cursor/mcp.json` in the project (project-scoped) or `~/.cursor/mcp.json` (user-scoped).
- **Cline / Continue / Zed**: editor-specific paths under `~/.config/`.
- **Claude Code (CLI)**: `~/.claude.json` or via `claude mcp add` commands.
- **Kiro**: `.kiro/settings/mcp.json` (workspace) or `~/.kiro/settings/mcp.json` (user-global).

The format everyone settled on:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_…" }
    }
  }
}
```

Each entry: a `command` to run, optional `args`, optional `env` for secrets. The client launches the subprocess, talks JSON-RPC over its stdio.

### Scoping the filesystem

The single most important thing to get right: the **filesystem server's allowed root**. The third arg in the example above is the only directory tree the server can read or write. Set it to `/` and you've given the model your home directory. Set it to `/Users/me/code/myproject` and it's scoped to one project.

For dev work, scope per-project. For experimentation across many projects, scope to a `~/code` parent — but don't include `~/.ssh`, `~/Documents`, anything with secrets in the path. The server walks the entire allowed root for `list_directory` requests, which is harmless but slow on huge trees.

You can also pass multiple roots:

```json
"args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code", "/Users/me/notes"]
```

Both directories are accessible. Anything else is blocked at the server level.


### Secrets, tokens, and the env trick

Tokens go in the `env` block, not in `args`. Two reasons:

1. `args` may show up in process listings (`ps`). Env is somewhat less visible.
2. Some MCP clients log the args verbatim for debugging. They'd happily log your token.

For tokens you don't want to put in JSON at all, most clients support env-var interpolation:

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
  }
}
```

`${GITHUB_TOKEN}` is read from the shell env when the client launches the subprocess. Keep tokens in your shell rc file, gpg, or a password manager — out of any committed config.

### Permission gating

Different clients handle "should this tool actually run?" differently:

- **Claude Desktop**: prompts on every tool invocation by default. You can mark some "always allow."
- **Cursor / Cline / Continue**: configurable — some default to auto-approve read-only tools, prompt on writes.
- **Claude Code**: explicit allow/deny lists per session, or `--dangerously-skip-permissions` for fully autonomous runs (use carefully).

Read-only tools (filesystem read, git status, postgres SELECT) can usually be auto-approved. Mutating tools (filesystem write, git commit, postgres INSERT, shell exec) should always prompt — at least until you've watched the model use them enough to trust it.


---

## Code Walkthrough

A complete, real-world Web3 dev config. This is roughly what I (and most senior devs I work with) have:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/me/code"
      ]
    },
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/Users/me/code/main-project"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "sqlite-local": {
      "command": "uvx",
      "args": [
        "mcp-server-sqlite",
        "--db-path",
        "/Users/me/code/indexer/state.db"
      ]
    },
    "postgres-staging": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://readonly@staging-db:5432/app?sslmode=require"
      ]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

A few things worth pointing out:

- `npx -y` and `uvx` both auto-install on first run. No global installs to manage.
- The `git` server is scoped to one repo. If you switch repos, change the arg or run multiple `git` instances under different names.
- The Postgres URL points at a **read-only** role on staging. Production database with read-write is not something you want behind a tool the model calls autonomously.
- `memory` gives the model a persistent scratchpad across sessions — useful for long-running projects.


### Verifying it works

After saving the config, restart your client. Then ask the model "what tools do you have?" and you should see entries from each server. If a server failed to launch, most clients show it greyed out with the error. Common causes:

- `npx` not on PATH (use absolute path to `node`/`npx` if needed).
- Missing env vars (token rejected, server exits immediately).
- Permission denied on the filesystem root (e.g. you scoped to a path that doesn't exist).

To debug a specific server, run the command yourself:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_… npx -y @modelcontextprotocol/server-github
```

If the server is healthy, it prints nothing (it's waiting for JSON-RPC on stdin). Press Ctrl-D to exit. If it errored, you'll see the error.

For deeper debugging, the MCP Inspector is invaluable:

```bash
npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-github
```

Opens a local web UI where you can manually call tools, inspect responses, and check schemas. Use it for any server you're building or troubleshooting.

---

## Common Mistakes and Gotchas

**1. Forgetting to restart the client after config changes**
Most clients only read MCP config at startup. Edit the JSON, restart. Some clients (Cursor) have a reload button now.

**2. Using PAT tokens with too-broad scopes**
A GitHub PAT for the MCP server should have the *minimum* scopes you need. For most read-heavy work: `repo:read`, `read:org`. For PR creation: add `repo`. Avoid `admin:*`, `delete_repo`, etc. Compromising your editor shouldn't compromise your GitHub.

**3. Pointing the filesystem server at `~/`**
You'll regret this. SSH keys, browser profiles, downloads, secrets in dotfiles — the model sees everything in its tree. Scope tight.

**4. Running multiple instances of the same server unnecessarily**
Each instance is a separate Node/Python process and chunk of memory. If you have three projects, you don't need three filesystem servers — one server with three roots is fine.

**5. Mixing user-scoped and project-scoped configs without checking precedence**
Cursor's `.cursor/mcp.json` (project) overlays on top of `~/.cursor/mcp.json` (user). If the same server name is in both, project wins. Surprises happen when you add a server in the user config and a project config silently replaces it.

**6. Forgetting that `npx -y` downloads on first run**
The first time a config launches, `npx -y @modelcontextprotocol/server-foo` downloads the package. On a slow connection or behind a corp proxy, this can take 30+ seconds and look like the server hung. Patience or pre-install (`npm i -g`).

**7. Using `latest` tag and getting surprise breaking changes**
`@modelcontextprotocol/server-*` packages occasionally ship breaking changes. For a stable setup, pin versions: `@modelcontextprotocol/server-filesystem@2025.10.1`. For latest features, accept that something might break with an update.

**8. Network-dependent servers in offline contexts**
If you're on a plane and your config has the GitHub server, it'll just fail those calls. Most clients keep working — just the affected tools error. But the model sometimes gets confused. If you frequently work offline, have a "lite" config without network-dependent servers.

---

## How This Connects to Production

The MCP server config is shareable team infrastructure. Some teams check in a `.cursor/mcp.json` in their repo so every contributor's editor picks up the same set of tools. Some have a "team-MCP" repo with custom servers and a setup script that wires them into everyone's client. Some use hosted MCPs (via Streamable HTTP transport) so a single managed deployment serves the whole team — useful when the server needs production credentials no individual should hold.

For Web3 teams specifically, the production play is usually: filesystem + git + github locally, plus a hosted MCP for the team's internal block explorer / indexer / contract registry. Onboarding goes from "here are five wikis you should read" to "the AI knows what's in your repo and can answer questions against the indexer." That's the actual productivity gain.

---

## What to Learn Next

- **Web3-Specific MCP Servers: Etherscan, Alchemy, RPC** — the crypto-flavored MCPs that fill in the rest of a senior Web3 dev's setup.
- **Building Your Own MCP Server** — when no existing server does what you need, building one is shockingly approachable.
- **Claude Skills and Agent Skills** — the layer above MCP for packaging reusable, model-discovered capabilities.
