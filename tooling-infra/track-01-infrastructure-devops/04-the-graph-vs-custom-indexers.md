# The Graph Protocol vs Custom Indexers: When to Use Each

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

You need to index your smart contract events. You've heard of The Graph Protocol — it's what Uniswap and Aave use. But you've also heard that building a custom indexer gives you more control. Which should you use?

The answer depends on your requirements. This blog gives you a concrete framework for making the decision, with real tradeoffs.

---

## Core Concepts

### What The Graph Does

The Graph is a decentralized indexing protocol. You write a "subgraph" — a schema and event handlers — and The Graph's network of indexers processes your contract events and makes them queryable via GraphQL.

```
Your contract emits events
    ↓
The Graph indexers process events
    ↓
Data stored in The Graph's database
    ↓
Your frontend queries via GraphQL
```

**Hosted Service** (graph.network): centralized, free, easy to use. Being deprecated.
**Decentralized Network**: pay GRT tokens to indexers, fully decentralized.
**Subgraph Studio**: deploy to hosted service or decentralized network.

### What a Custom Indexer Does

A custom indexer is a service you build and run yourself. It listens to blockchain events (via RPC polling or Geyser), processes them, stores them in your database, and exposes them via your own API.

```
Your contract emits events
    ↓
Your indexer (Node.js) processes events
    ↓
Your PostgreSQL database
    ↓
Your GraphQL/REST API
    ↓
Your frontend
```

### The Tradeoff Table

| Property | The Graph | Custom Indexer |
|----------|-----------|----------------|
| Setup time | Hours | Days-weeks |
| Infrastructure | None (managed) | Significant |
| Latency | ~1-5 minutes | Seconds (with Geyser) |
| Customization | Limited (AssemblyScript) | Full (any language) |
| Cost | GRT tokens | Infrastructure costs |
| Reliability | Depends on indexers | Depends on your ops |
| Complex queries | Limited | Full SQL |
| Historical data | Yes | Yes (if you index from genesis) |
| Real-time | No (polling) | Yes (with WebSocket/Geyser) |

### When to Use The Graph

**Use The Graph when:**
- You need to get something working quickly
- Your indexing needs are standard (events → queryable data)
- You don't have DevOps capacity
- You're okay with 1-5 minute latency
- Your query patterns fit GraphQL well
- You want decentralized infrastructure

**Use a custom indexer when:**
- You need real-time data (< 1 second latency)
- You need complex queries (joins, aggregations, custom logic)
- You need to index data from multiple chains simultaneously
- You need to combine on-chain and off-chain data
- You need full control over the data model
- You're building infrastructure that others will depend on

---

## Code Walkthrough

**The Graph subgraph:**

```yaml
# subgraph.yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: LendingPool
    network: mainnet
    source:
      address: "0xYourContractAddress"
      abi: LendingPool
      startBlock: 18000000
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Position
        - User
        - Transaction
      abis:
        - name: LendingPool
          file: ./abis/LendingPool.json
      eventHandlers:
        - event: Deposited(indexed address,indexed address,uint256)
          handler: handleDeposited
        - event: Borrowed(indexed address,indexed address,uint256)
          handler: handleBorrowed
        - event: Liquidated(indexed address,indexed address,indexed address,uint256,uint256)
          handler: handleLiquidated
      file: ./src/mapping.ts
```

```graphql
# schema.graphql
type User @entity {
  id: ID!  # address
  totalDeposited: BigDecimal!
  totalBorrowed: BigDecimal!
  positions: [Position!]! @derivedFrom(field: "owner")
  transactions: [Transaction!]! @derivedFrom(field: "user")
}

type Position @entity {
  id: ID!  # address-asset
  owner: User!
  asset: String!
  collateralAmount: BigDecimal!
  debtAmount: BigDecimal!
  healthFactor: BigDecimal!
  updatedAt: BigInt!
}

type Transaction @entity {
  id: ID!  # txHash-logIndex
  user: User!
  type: String!
  asset: String!
  amount: BigDecimal!
  timestamp: BigInt!
  blockNumber: BigInt!
}
```

```typescript
// src/mapping.ts (AssemblyScript)
import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { Deposited, Borrowed, Liquidated } from "../generated/LendingPool/LendingPool";
import { User, Position, Transaction } from "../generated/schema";

export function handleDeposited(event: Deposited): void {
  // Load or create user
  let user = User.load(event.params.user.toHexString());
  if (!user) {
    user = new User(event.params.user.toHexString());
    user.totalDeposited = BigDecimal.zero();
    user.totalBorrowed = BigDecimal.zero();
  }

  // Update user totals
  const amount = event.params.amount.toBigDecimal().div(BigDecimal.fromString("1e18"));
  user.totalDeposited = user.totalDeposited.plus(amount);
  user.save();

  // Load or create position
  const positionId = event.params.user.toHexString() + "-" + event.params.asset.toHexString();
  let position = Position.load(positionId);
  if (!position) {
    position = new Position(positionId);
    position.owner = user.id;
    position.asset = event.params.asset.toHexString();
    position.collateralAmount = BigDecimal.zero();
    position.debtAmount = BigDecimal.zero();
    position.healthFactor = BigDecimal.fromString("999");
  }

  position.collateralAmount = position.collateralAmount.plus(amount);
  position.updatedAt = event.block.timestamp;
  position.save();

  // Create transaction record
  const txId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const tx = new Transaction(txId);
  tx.user = user.id;
  tx.type = "DEPOSIT";
  tx.asset = event.params.asset.toHexString();
  tx.amount = amount;
  tx.timestamp = event.block.timestamp;
  tx.blockNumber = event.block.number;
  tx.save();
}

export function handleBorrowed(event: Borrowed): void {
  // Similar pattern...
}

export function handleLiquidated(event: Liquidated): void {
  // Handle liquidation event...
}
```

```bash
# Deploy subgraph
graph auth --studio YOUR_DEPLOY_KEY
graph codegen && graph build
graph deploy --studio my-lending-protocol
```

**Querying The Graph:**

```typescript
import { gql, useQuery } from "@apollo/client";
import { ApolloClient, InMemoryCache } from "@apollo/client";

// The Graph endpoint
const client = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/your-account/my-lending-protocol",
  cache: new InMemoryCache(),
});

const GET_LIQUIDATABLE_POSITIONS = gql`
  query GetLiquidatablePositions {
    positions(
      where: { healthFactor_lt: "1.0" }
      orderBy: healthFactor
      orderDirection: asc
      first: 100
    ) {
      id
      owner { id }
      asset
      collateralAmount
      debtAmount
      healthFactor
    }
  }
`;

// Use in a liquidation bot
async function findLiquidatablePositions() {
  const { data } = await client.query({ query: GET_LIQUIDATABLE_POSITIONS });
  return data.positions;
}
```

---

## Common Mistakes and Gotchas

**1. Using The Graph for real-time liquidation bots**  
The Graph has 1-5 minute indexing latency. A liquidation bot that relies on The Graph will miss liquidation opportunities. Use Geyser (Solana) or WebSocket subscriptions (EVM) for real-time data.

**2. Not handling subgraph reorgs**  
The Graph handles reorgs automatically, but your subgraph handlers must be idempotent (safe to run multiple times). Don't assume an event will only be processed once.

**3. AssemblyScript limitations**  
The Graph's mapping language is AssemblyScript (a TypeScript subset that compiles to WASM). It has significant limitations: no closures, limited standard library, no async/await. Complex logic is hard to write.

**4. Not indexing from the right start block**  
If you set `startBlock` too early, your subgraph takes forever to sync. If too late, you miss historical data. Set it to the block your contract was deployed.

**5. Not monitoring subgraph health**  
Subgraphs can fall behind or fail. Monitor your subgraph's sync status and set up alerts. The Graph's hosted service has had reliability issues — consider running your own Graph node for critical applications.

---

## How This Connects to Production

Uniswap's analytics uses a Uniswap subgraph on The Graph. Aave's dashboard uses an Aave subgraph. OpenSea uses a custom indexer for their NFT data (too complex for The Graph). Dune Analytics is a custom indexer that indexes all of Ethereum into a queryable SQL database. The pattern: use The Graph for standard event indexing, build custom indexers for complex queries, real-time requirements, or multi-chain data.

---

## What to Learn Next

- **Building a Solana Indexer from Scratch with Node.js and PostgreSQL** — build a custom indexer.
- **GraphQL for Blockchain Data: Building Flexible Query APIs** — build the API layer on top of your indexer.
- **Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale** — deploy your indexer to production.
