# Hosted Service vs Decentralized Network: Cost and Tradeoffs

**Track:** Intermediate
**Read time:** 7 min

---

## The Problem

You've built a subgraph. Where do you actually deploy it? The Graph started as a hosted service (free, run by Edge & Node), then transitioned to the decentralized network (paid, run by independent indexers). The hosted service was sunsetted for new chains in 2023, fully migrated by 2024. By 2026, "deploy a subgraph" almost always means the decentralized network — but the economics are different from the free era and the migration story still matters.

---

## Core Concepts

### The decentralized network in 60 seconds

Independent operators ("indexers") run subgraph nodes. They stake GRT (The Graph token) on subgraphs they choose to support. Subgraph developers signal which subgraphs are valuable by curating (also with GRT). Queries are paid in GRT. A "gateway" abstracts all of this — you send GraphQL queries to the gateway, it routes to indexers, it bills you.

You don't need to deal with indexers directly. You need an API key from the gateway. From your perspective: deploy → get a query URL → use API key in your queries.

### The pricing in 2026

Roughly:

- **Free tier**: 100k queries/month, generous enough for hobby and dev work
- **Paid tier**: pay-per-query, on the order of $0.0001–$0.001 per query depending on cost
- **Subgraph deployment**: small one-time GRT signal to incentivize indexers to support your subgraph

For a typical dApp doing 1M queries/month, expect $50-200/month in query fees. For a high-traffic protocol doing 100M+/month, you're at $5-20k/month. At that point, running your own indexer becomes economically interesting.

### The hosted service: what's left

The hosted service still exists for some chains and for legacy subgraphs that weren't migrated. It's free but slow, lower SLAs, and explicitly not the place for production. If you find yourself using it in 2026, that's a flag — migration to the decentralized network or a self-hosted alternative is a near-term need.


### Self-hosting Graph Node

You can run `graph-node` (the indexer software) yourself. Postgres for state, IPFS for subgraph metadata, an Ethereum archive node for source data. Operationally it's a real piece of infrastructure: you're running a Postgres at hundreds of GB scale, an archive node at multiple TB, plus the graph-node itself. For a single popular subgraph: $300-1000/month in infra, plus your time.

When self-hosting makes sense:

- **You need data not exposed by the standard subgraph API.** Custom queries, joins, aggregations.
- **Your query volume is in the tens of millions per month.** At that point, paying gateway fees is more expensive than running your own.
- **Latency matters more than money.** Self-hosted in your own region is faster than going through the gateway.
- **You need privacy.** Subgraph data on the decentralized network is public; on your own infra you can keep it private.

When it doesn't make sense:

- **Hobby projects, side projects, MVPs.** Use the gateway, free or cheap.
- **You're already overstretched.** Operating a Graph Node, archive node, and Postgres is real work.

### Hybrid approach

Many teams run their own subgraph for their core data (high traffic, business-critical) and use public subgraphs (Uniswap, Aave) for ancillary data. You're not forced to pick one strategy.

---

## Code Walkthrough

Deploying to the decentralized network with `graph-cli`:

```bash
# 1) Authenticate
graph auth --product subgraph-studio <DEPLOY_KEY>

# 2) Build
yarn codegen
yarn build

# 3) Deploy to the studio (testnet-like environment)
graph deploy --node https://api.studio.thegraph.com/deploy/ <SUBGRAPH_NAME>

# 4) Test queries against the studio URL — same API, different endpoint
curl -X POST -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}' \
  https://api.studio.thegraph.com/query/<ID>/<NAME>/<VERSION>

# 5) Once happy, publish to the decentralized network
# (signal GRT, get a queryable mainnet URL)
```

The studio is where you test before publishing — same API, no gateway fees, but lower SLA. Publishing makes your subgraph available to everyone via the gateway and starts earning indexers' attention.


A self-hosted Graph Node setup with docker-compose:

```yaml
version: "3"
services:
  graph-node:
    image: graphprotocol/graph-node:latest
    ports: ["8000:8000", "8020:8020", "8030:8030"]
    depends_on: [ipfs, postgres]
    environment:
      postgres_host: postgres
      postgres_user: graph
      postgres_pass: graph
      postgres_db: graph-node
      ipfs: "ipfs:5001"
      ethereum: "mainnet:https://eth-mainnet.g.alchemy.com/v2/KEY"
      GRAPH_LOG: info
  ipfs:
    image: ipfs/kubo:latest
    ports: ["5001:5001"]
  postgres:
    image: postgres:14
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: graph
      POSTGRES_PASSWORD: graph
      POSTGRES_DB: graph-node
    command: ["postgres", "-cshared_preload_libraries=pg_stat_statements"]
```

That's the local-dev setup. For production, swap the alchemy URL for your own archive node, add backups for Postgres, and put a load balancer in front.

---

## Common Mistakes and Gotchas

**1. Using the studio URL in production**
Studio endpoints have lower availability and aren't billable — they're for testing. Production must point at the gateway URL or your self-hosted endpoint.

**2. Not tracking query costs**
Your dApp does X queries/page-load × Y page-loads/day × $Z/query = monthly bill. Estimate before launch. If your bill is going to be $5000/month, that's worth knowing.

**3. Self-hosting without an archive node**
Graph Node needs an archive node for historical data — full nodes don't have it. Running your own archive node is the most expensive part of self-hosting (TBs of storage). Free public archive endpoints exist but rate-limit aggressively.

**4. Forgetting to migrate when the hosted service is sunsetted for your chain**
Periodically check The Graph's status pages. Don't wake up to a deprecated subgraph and a broken dApp.

**5. Picking the wrong indexer for your subgraph**
On the decentralized network, indexers choose what to support based on signal. A niche subgraph with no curation might have one indexer with poor latency. Adding signal (GRT curation) attracts more indexers.

---

## How This Connects to Production

For most teams, the decentralized network gateway is the right answer. Cheap, no infra to run, scales with you. Self-hosting is the answer for protocol teams running their own subgraphs at high volume — it's not a marginal optimization, it's the move for the top 5% of subgraphs by traffic.

The trend in 2026: more teams running self-hosted Graph Nodes for their core data, plus optional decentralized-network deployments for redundancy and public access. The tooling has matured enough that operating your own indexer is a few-day project, not a few-month one.

---

## What to Learn Next

- **Migrating from a Subgraph to a Custom Indexer** — when even a self-hosted Graph Node isn't enough.
- **Subgraph Performance** (previous lesson) — squeezing more out of what you have before going self-hosted.
- **Web3 Backend Engineering** (separate track) — the alternative architecture entirely.
