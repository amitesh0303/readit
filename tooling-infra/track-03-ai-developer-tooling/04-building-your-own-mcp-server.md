# Building Your Own MCP Server

**Track:** Intermediate
**Read time:** 10 min

---

## The Problem

Off-the-shelf MCP servers cover the obvious cases. They don't cover *your* case: the internal indexer with its bespoke schema, the contract registry your team maintains, the scripts you've written that codify "the right way" to deploy on your testnet. Wrapping these as MCPs means the AI in your editor can use them — saving every team member the same context-loading effort each time.

Building an MCP server is genuinely simple. The hard part is designing tools that the model uses correctly without hand-holding. This lesson walks through both: the mechanics, and the design discipline that separates a useful server from a confusing one.


---

## Core Concepts

### TypeScript or Python — pick one

Official SDKs exist in both:

- **TypeScript** — `@modelcontextprotocol/sdk`. Best ergonomics if you're already in a Node ecosystem. Zod schemas integrate cleanly.
- **Python** — `mcp` (PyPI). Type-hinted, async. Best if your existing logic (data pipelines, ML) is Python.

Other community SDKs exist (Go, Rust, Kotlin) and they all speak the same wire protocol. Servers in different languages all interop with the same clients. Pick whatever language your existing internal logic is in — don't rewrite to match.

### Tool design: the rules that matter

The single biggest factor in whether your MCP is useful is whether the model can figure out *which tool to call when*. That comes down to:

- **Tool names that describe the action** — `get_user_balance`, not `query`. The model picks based on names; vague names cause wrong picks.
- **Descriptions that explain when to use the tool** — not what the tool does internally. "Use this when the user asks about token balances" beats "Calls /api/v2/balance."
- **JSON-Schema input that constrains hard** — enums for finite choices, regex for addresses, numeric ranges. Loose schemas → wrong arguments.
- **Structured outputs** — return JSON or text the model can parse and reason over. Don't return "Success!" or "Error." Return the data and structured error info.
- **Idempotency where possible** — if the model retries (it sometimes does), the second call shouldn't break things. Especially for write tools.

### Tool granularity

A common beginner mistake: one giant `do_everything` tool with a `mode` parameter. The model has trouble using these because the schema is huge and the description has to cover every mode. Splitting into 5 small tools (`get_balance`, `get_supply`, `get_holders`, `get_transfers`, `get_price`) is almost always better — even though it's more code. Each has a tight schema and an obvious use case.

The other mistake: too many tools. If you expose 80 tools and the names don't help the model differentiate, picking gets noisy. 10-20 well-named tools per server is the sweet spot. Beyond that, consider splitting into multiple servers.


### Resources for browsable data

When you have static or addressable data — docs, contract registries, ABI files — expose it as **resources**, not tools. The client surfaces resources to the model as a list it can browse. The model picks what it needs.

```typescript
server.resource(
  "registry",
  "registry://contracts/{chain}/{name}",
  {
    list: async () => ({
      resources: [
        { uri: "registry://contracts/mainnet/usdc", name: "USDC", mimeType: "application/json" },
        { uri: "registry://contracts/mainnet/dai", name: "DAI", mimeType: "application/json" },
        // ...
      ],
    }),
    read: async ({ uri }) => {
      const [, , chain, name] = uri.split("/");
      const contract = await registry.lookup(chain, name);
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(contract, null, 2),
        }],
      };
    },
  },
);
```

For 50 contracts: a tool called `get_contract(name)` works. For 5,000 contracts: resources lets the model browse without you sending 5,000 entries on every prompt.

### Authentication and secrets

Stdio MCPs run as subprocesses of the client; they inherit the env passed in the config. That's where your secrets go: `ETHERSCAN_API_KEY`, `INTERNAL_DB_URL`, etc. Never hardcode them in the server source.

For HTTP-transport MCPs (when the server runs remotely), you handle auth at the HTTP layer: bearer tokens, OAuth, mTLS. The Streamable HTTP transport supports OAuth 2.1 explicitly — the client redirects the user through a flow, gets a token, sends it on every call. Use this for any server that needs per-user credentials.


---

## Code Walkthrough

A real-ish internal server: a contract registry MCP with three tools and a resource.

```typescript
// contract-registry-mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Pool } from "pg";

const pg = new Pool({ connectionString: process.env.REGISTRY_DB! });

const server = new McpServer({
  name: "team-contract-registry",
  version: "1.0.0",
});

const ChainSchema = z.enum(["mainnet", "base", "arbitrum", "optimism", "sepolia"]);

server.tool(
  "lookup_contract",
  "Look up a contract address by team-internal name (e.g. 'core-vault') on a specific chain. Returns address, ABI URL, and deployment metadata.",
  {
    name: z.string().describe("Internal contract name (lowercase, hyphenated)"),
    chain: ChainSchema,
  },
  async ({ name, chain }) => {
    const r = await pg.query(
      "SELECT address, abi_url, deployed_at, deployer, version FROM contracts WHERE name=$1 AND chain=$2",
      [name, chain],
    );
    if (r.rows.length === 0) {
      return {
        content: [{ type: "text", text: `No contract '${name}' on ${chain}.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(r.rows[0], null, 2) }],
    };
  },
);


server.tool(
  "list_contracts",
  "List all contracts deployed on a specific chain. Returns names, addresses, and versions.",
  { chain: ChainSchema },
  async ({ chain }) => {
    const r = await pg.query(
      "SELECT name, address, version FROM contracts WHERE chain=$1 ORDER BY name",
      [chain],
    );
    return {
      content: [{ type: "text", text: JSON.stringify(r.rows, null, 2) }],
    };
  },
);

server.tool(
  "search_by_address",
  "Reverse-lookup: given an address, find the team-internal name. Useful for explaining what an address is.",
  {
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  },
  async ({ address }) => {
    const r = await pg.query(
      "SELECT name, chain, version FROM contracts WHERE address ILIKE $1",
      [address],
    );
    return {
      content: [{ type: "text", text: JSON.stringify(r.rows, null, 2) }],
    };
  },
);

// Browsable resource: every contract by URI
server.resource(
  "registry",
  "registry://{chain}/{name}",
  {
    list: async () => {
      const r = await pg.query("SELECT name, chain FROM contracts");
      return {
        resources: r.rows.map((row) => ({
          uri: `registry://${row.chain}/${row.name}`,
          name: `${row.name} on ${row.chain}`,
          mimeType: "application/json",
        })),
      };
    },
    read: async ({ uri }) => {
      const m = uri.match(/^registry:\/\/([^/]+)\/(.+)$/);
      if (!m) throw new Error("bad uri");
      const [, chain, name] = m;
      const r = await pg.query(
        "SELECT * FROM contracts WHERE chain=$1 AND name=$2",
        [chain, name],
      );
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(r.rows[0] ?? null, null, 2),
        }],
      };
    },
  },
);

await server.connect(new StdioServerTransport());
```


That's a complete, useful server in ~70 lines. Wire it into the team's MCP config:

```json
{
  "team-registry": {
    "command": "node",
    "args": ["/usr/local/bin/contract-registry-mcp.js"],
    "env": {
      "REGISTRY_DB": "${TEAM_REGISTRY_DB}"
    }
  }
}
```

Now anyone on the team can ask "what's the address of `core-vault` on Base?" or "is `0x1234...` one of ours?" and the model has the right answer.

### Testing your server

Use the MCP Inspector during development:

```bash
npx @modelcontextprotocol/inspector node ./contract-registry-mcp.js
```

Browser opens. You can:

- See all the tools your server exposes with their schemas
- Manually call tools with arbitrary arguments and see the response
- Inspect resources
- Check the JSON-RPC traffic

This is faster than testing through an AI client because there's no model-induced ambiguity. Get the tool calls right in the inspector first, then plug into your actual client.

### Distribution

Three options:

1. **Personal use only**: keep the script local, point your client at the absolute path.
2. **Team use**: publish as an internal npm package or check into a shared repo with a setup script. Each dev's MCP config references the entry point.
3. **Public release**: publish to npm/PyPI. The community has hundreds of public MCP servers — yours can be one.

For Web3 teams, option 2 is most common. You don't want to npm-publish a server with knowledge of your private contract registry.


---

## Common Mistakes and Gotchas

**1. Logging to stdout in stdio servers**
The protocol uses stdout. Anything you `console.log` corrupts the message stream. Use `console.error` (stderr) for logs. This bites everyone exactly once.

**2. Schema descriptions that don't tell the model when to call**
Bad: "Returns user balance." Good: "Use this when the user asks about their token holdings on a specific chain. Returns balance in raw token units." The description is your prompt to the model.

**3. Returning data the model can't reason over**
A binary blob, a 50MB JSON, a non-UTF-8 string. The model's input is text. Anything you return must be representable as a string the model can read.

**4. Forgetting to handle empty results**
If the lookup returns no rows, your tool should return a clear "no results found" message — not throw, not return empty array silently. The model needs to know "I asked the right thing but the answer is nothing."

**5. Tools that have side effects without obvious names**
A tool called `lookup_contract` that *also* logs to your team's audit DB is surprising. Side effects belong in tools whose names imply them (`record_lookup`, `mark_audited`).

**6. Embedding API keys in the server source**
Even for "private" servers. Eventually someone copies it, the source ends up in a screenshot, and the key leaks. Always env vars.

**7. Not versioning the server**
The `version` field in the server constructor matters when you upgrade. If a tool's behavior changes (e.g. response shape), bump the version. Some clients log the server version on startup, which helps debugging.

**8. Adding a tool that the model never calls correctly**
If you find the model consistently calling a tool with bad args, the issue is your schema or description, not the model. Tighten the schema. Rewrite the description to be more directive.


---

## How This Connects to Production

The teams getting the most value out of AI tooling in 2026 aren't using more sophisticated models — they're using the same models with better-curated context. A custom MCP for your team's contract registry, deployment scripts, internal docs, and indexer is what turns a generic AI assistant into one that actually understands your codebase.

The investment is small. A 100-line MCP server saves every team member the effort of explaining the same internal context every conversation. That investment compounds across hires, projects, and time.

The pattern that works: start by building tiny servers that wrap one painful workflow (looking up addresses, fetching internal API data, running a recurring command). Use them for a week. Add the next painful workflow. After a month, you have a custom MCP layer that's genuinely yours, and the team's AI workflows are noticeably better than what the off-the-shelf tooling provides.

---

## What to Learn Next

- **Claude Skills and Agent Skills** — how to package multi-step *workflows* (not just tools) that the model can pick up automatically.
- **Subagents and Custom Agents** — delegating to specialized agents that have their own tool sets and prompts.
- **AI-Augmented Web3 Workflows** — what all of this looks like end-to-end on a real Web3 project.
