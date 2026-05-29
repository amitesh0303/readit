# MCP Explained: The Protocol Connecting AI to Your Tools

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

In 2023, every AI coding assistant was a sealed box. ChatGPT had no idea what was in your repo. Copilot saw the file you had open and nothing else. If you wanted the model to read a Postgres schema, query an Etherscan API, or check the live state of a smart contract, you copy-pasted output into the chat.

Then came tools and function calling. But every assistant had its own tool format, every tool had to be re-implemented per-vendor, and "give Claude access to my filesystem" required a different integration than "give Cursor access to my filesystem." The plumbing was reinvented per pair.

In November 2024 Anthropic open-sourced **Model Context Protocol** (MCP), and by mid-2026 it's the de facto standard for connecting LLMs to data sources, tools, and runtime environments. If you're a senior Web3 dev shipping in 2026, you're using it — directly or indirectly — every working day.


---

## Core Concepts

### What MCP is, in one paragraph

MCP is a JSON-RPC 2.0 based protocol that defines how an LLM client (Claude Desktop, Cursor, Cline, Zed, Continue, Kiro, etc.) talks to a server that exposes tools and data. The server says "here are the tools I have, here's their JSON Schema, here's how to call them." The client gives that to the model, the model calls them, and results flow back. Anyone can write a server. Anyone can use one.

The crucial design choice is that the protocol is **vendor-neutral**. Claude is not in the spec. OpenAI is not in the spec. The spec defines messages between *any* AI client and *any* tool-providing server. This is why adoption was fast — building one Postgres MCP server gives you Postgres in every MCP-aware client.

### The three primitives

Every MCP server can expose three kinds of things:

- **Tools** — functions the model can call. JSON-Schema-typed inputs and outputs. The most-used primitive. Examples: `filesystem.read_file`, `github.create_pull_request`, `etherscan.get_contract_abi`.
- **Resources** — addressable data the model can read. URIs like `file:///path/to/file.sol` or `postgres://schema/users`. The model can list them and request their contents.
- **Prompts** — pre-defined prompt templates the user can invoke (e.g. `/summarize-pr`, `/review-contract`). Less commonly used than tools.

In practice, 90% of what people build is tools. Resources are useful for "let the model browse" patterns. Prompts are syntactic sugar for canned workflows.


### Transports: stdio, SSE, and Streamable HTTP

How does the client actually *talk* to the server? Three transports:

- **stdio** — server runs as a child process, JSON-RPC over stdin/stdout. Simplest. Most local servers (filesystem, git) use this. The client launches the server with a command + args.
- **SSE (Server-Sent Events)** — older HTTP-based transport with a long-lived GET for server→client messages and POSTs for client→server. Was the standard for hosted MCPs.
- **Streamable HTTP** — the newer (mid-2025) HTTP transport that consolidated SSE into a single endpoint with optional streaming. Now the recommended remote transport.

You pick based on where the server runs: stdio for "on my laptop next to the editor," HTTP for "hosted on a server I authenticate to."

### How a request actually flows

```
┌─────────────┐       initialize        ┌──────────────┐
│  AI Client  │ ─────────────────────▶  │  MCP Server  │
│ (Cursor,    │ ◀─── tools list ──────  │  (filesystem)│
│  Claude,    │                         │              │
│  Kiro, …)   │       tools/call:       │              │
│             │  read_file({path})      │              │
│             │ ─────────────────────▶  │              │
│             │ ◀── tool result ─────── │              │
└──────┬──────┘                         └──────────────┘
       │
       │ tool result becomes context
       ▼
   ┌────────┐
   │  LLM   │ — sees the tools, decides which to call,
   │ (Claude│   chains calls until task is done.
   │ Sonnet,│
   │ GPT-4o,│
   │  …)    │
   └────────┘
```

The LLM never talks to the MCP server directly. The client mediates: it asks the server what tools exist, presents them to the LLM as available functions, and proxies the LLM's tool calls. This means MCP works with any LLM — the protocol is between *client and server*, not *model and server*.


### Why this beat the alternatives

There were earlier attempts at standardizing tool use — OpenAI's plugins (which they discontinued), LangChain's tool ecosystem (framework-coupled), and a handful of vendor SDKs. MCP won because:

1. **No framework lock-in.** It's a wire protocol. You don't import a Python library and inherit its abstractions. You speak JSON-RPC.
2. **Local-first.** Servers can run as local subprocesses with full filesystem and process access. Critical for dev tools.
3. **Trivial to implement.** A working MCP server in TypeScript is ~30 lines using the SDK. You can write one over lunch.
4. **Permissive licensing and an actual reference implementation.** The spec, SDK, and reference servers were all open-source from day one.
5. **Multiple major clients integrated quickly.** Once Claude Desktop, then Cursor, then Continue, then Zed all spoke MCP, building a server unlocked all of them.

By the time competing protocols (OpenAI's GPT Actions, Google's something) showed up, the ecosystem was already there.

---

## Code Walkthrough

What an MCP server actually looks like, minimum viable:

```typescript
// my-mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "weather-mcp",
  version: "0.1.0",
});

server.tool(
  "get_weather",
  "Returns current weather for a city",
  { city: z.string().describe("City name, e.g. 'Tokyo'") },
  async ({ city }) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    const text = await res.text();
    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```


That's the whole server. Run it with `node my-mcp-server.js`. Then in any MCP-aware client, register the server with a config like:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/abs/path/to/my-mcp-server.js"]
    }
  }
}
```

Restart the client. The model now has a `weather.get_weather(city)` tool. That's the entire onboarding for a new tool — and it'll work in Claude Desktop, Cursor, Cline, and any other compliant client without changes.

The actual JSON-RPC traffic on the wire (slightly simplified):

```jsonc
// Client → Server: discover tools
→ {"jsonrpc":"2.0","id":1,"method":"tools/list"}

// Server → Client: here are mine
← {"jsonrpc":"2.0","id":1,"result":{"tools":[
    {"name":"get_weather","description":"Returns current weather…",
     "inputSchema":{"type":"object","properties":{"city":{"type":"string"}}}}
   ]}}

// Client → Server: model called the tool
→ {"jsonrpc":"2.0","id":2,"method":"tools/call",
   "params":{"name":"get_weather","arguments":{"city":"Tokyo"}}}

// Server → Client: tool result
← {"jsonrpc":"2.0","id":2,"result":{
    "content":[{"type":"text","text":"Tokyo: 🌦 +14°C"}]
   }}
```

If you've worked with JSON-RPC before — Ethereum's `eth_*` methods are the same protocol family — this looks familiar. That's deliberate.


---

## Common Mistakes and Gotchas

**1. Confusing "MCP server" with a typical web server**
An MCP server in stdio mode is a subprocess of the AI client. It has no HTTP listener. Don't try to `curl` it. Don't deploy it behind nginx. For HTTP-transport servers, *those* are real web servers — but most MCP servers you'll touch are stdio.

**2. Returning huge tool results**
Every tool result becomes context tokens for the model. A `read_file` that returns a 50,000-line log eats a third of your context window. Build pagination, truncation, and summarization into your tools — don't dump.

**3. Trusting tool inputs without sanitization**
A model can be tricked (via prompt injection from a fetched webpage, a malicious file, etc.) into calling `run_shell({cmd: "rm -rf ~"})`. If your tool takes free-form arguments, validate them. Especially for filesystem and shell tools, restrict to working directories and a tool-specific allowlist.

**4. Overlapping tools across servers**
If two MCP servers both expose a `read_file` tool, the client may name-conflict. Some clients namespace by server name, others don't. Pick clear, server-specific names (`fs__read_file`, `pg__query`) when in doubt.

**5. Missing the "tools" vs "resources" distinction**
If you have static, addressable data (e.g. all docs in a folder), expose them as resources, not tools. The model can browse resources and pull what it needs. Wrapping everything as tools wastes the resource primitive.

**6. Forgetting that `console.log` breaks stdio servers**
In stdio transport, stdout is the message channel. Every `console.log` you forget in production code corrupts the JSON-RPC stream. Log to stderr (`console.error`) or a file. This bites everyone exactly once.


---

## How This Connects to Production

By 2026, MCP is plumbing. Almost no one starts a "should we use MCP?" discussion — the question is which servers, hosted or local, with what permissions. Engineering teams have internal MCP servers for: their datadog/loki/grafana, their staging databases, their AWS/GCP consoles, their Linear/Jira, their internal Etherscan-equivalent block explorer for testnets, their CI logs.

For Web3 specifically: every senior dev I know has at least three MCP servers connected to their editor by default — filesystem, git/github, and some flavor of on-chain data (Etherscan, Alchemy, Foundry). Adding one more for "the contract suite I'm working on right now" is a 30-minute task. The compounding effect is real: the more your AI assistant can see and do, the more genuinely useful its suggestions get.

This track covers the rest: the specific servers worth knowing, how to build your own, and how Skills + subagents extend the same pattern beyond raw tools.

---

## What to Learn Next

- **Setting Up MCP Servers: Filesystem, Git, Databases** — practical setup of the standard library of MCP servers for development.
- **Web3-Specific MCP Servers: Etherscan, Alchemy, RPC** — the crypto-flavored servers that matter for blockchain devs.
- **Building Your Own MCP Server** — going beyond the toy example into a real, useful server you'd actually ship.
