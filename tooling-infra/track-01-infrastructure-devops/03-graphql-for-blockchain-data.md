# GraphQL for Blockchain Data: Building Flexible Query APIs

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

Your dApp needs to display a user's transaction history, their current positions, and protocol-wide analytics. You could make 10 separate RPC calls and stitch the data together on the frontend. Or you could build a GraphQL API that lets the frontend request exactly the data it needs in a single query.

GraphQL is the standard for blockchain data APIs — The Graph Protocol is built on it, and most DeFi frontends use it. This blog shows you how to build a GraphQL API on top of indexed blockchain data.

---

## Core Concepts

### Why GraphQL for Blockchain Data

REST APIs have a fixed response shape. If the frontend needs 5 fields from a 20-field response, it still gets all 20. If it needs data from 3 different endpoints, it makes 3 requests.

GraphQL lets the client specify exactly what it needs:

```graphql
# REST: GET /users/{address} → returns all user data
# GET /positions/{address} → returns all positions
# GET /transactions/{address} → returns all transactions
# 3 requests, over-fetching

# GraphQL: one request, exactly what you need
query {
  user(address: "0x...") {
    address
    totalDeposited
    positions {
      asset
      amount
      healthFactor
    }
    recentTransactions(limit: 10) {
      hash
      type
      amount
      timestamp
    }
  }
}
```

### The Stack

```
Blockchain (events, state)
    ↓
Indexer (Node.js + PostgreSQL)
    ↓
GraphQL API (Apollo Server or Hasura)
    ↓
Frontend (Apollo Client or urql)
```

### Schema Design for DeFi Data

Good GraphQL schema design for DeFi:

```graphql
type Query {
  # Single entity lookups
  user(address: String!): User
  position(id: ID!): Position
  pool(address: String!): Pool

  # List queries with filtering and pagination
  positions(
    owner: String
    asset: String
    healthFactorBelow: Float
    first: Int = 20
    skip: Int = 0
    orderBy: PositionOrderBy = HEALTH_FACTOR
    orderDirection: OrderDirection = ASC
  ): [Position!]!

  # Aggregates
  protocolStats: ProtocolStats!
}

type User {
  address: String!
  totalDeposited: BigDecimal!
  totalBorrowed: BigDecimal!
  positions: [Position!]!
  transactions(first: Int = 20, skip: Int = 0): [Transaction!]!
}

type Position {
  id: ID!
  owner: User!
  asset: Token!
  collateralAmount: BigDecimal!
  debtAmount: BigDecimal!
  healthFactor: Float!
  liquidatable: Boolean!
  createdAt: Int!
  updatedAt: Int!
}

type Token {
  address: String!
  symbol: String!
  decimals: Int!
  priceUSD: BigDecimal!
}

type Transaction {
  hash: String!
  type: TransactionType!
  user: User!
  asset: Token!
  amount: BigDecimal!
  timestamp: Int!
  blockNumber: Int!
}

enum TransactionType {
  DEPOSIT
  WITHDRAW
  BORROW
  REPAY
  LIQUIDATION
}

type ProtocolStats {
  totalValueLocked: BigDecimal!
  totalBorrowed: BigDecimal!
  utilizationRate: Float!
  activePositions: Int!
}

enum PositionOrderBy {
  HEALTH_FACTOR
  COLLATERAL_AMOUNT
  DEBT_AMOUNT
  CREATED_AT
}

enum OrderDirection {
  ASC
  DESC
}

scalar BigDecimal
```

---

## Code Walkthrough

Building a GraphQL API with Apollo Server:

```typescript
// src/graphql/server.ts
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { Pool } from "pg";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers";

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // Enable introspection in development
  introspection: process.env.NODE_ENV !== "production",
});

const { url } = await startStandaloneServer(server, {
  context: async ({ req }) => ({
    db,
    // Add auth context if needed
    userAddress: req.headers["x-user-address"] as string | undefined,
  }),
  listen: { port: 4000 },
});

console.log(`GraphQL server running at ${url}`);
```

```typescript
// src/graphql/resolvers.ts
import { Pool } from "pg";
import DataLoader from "dataloader";

interface Context {
  db: Pool;
  userAddress?: string;
}

// DataLoader for batching database queries
// Prevents N+1 query problem
function createLoaders(db: Pool) {
  return {
    userLoader: new DataLoader<string, any>(async (addresses) => {
      const result = await db.query(
        "SELECT * FROM users WHERE address = ANY($1)",
        [addresses]
      );
      const userMap = new Map(result.rows.map((u) => [u.address, u]));
      return addresses.map((addr) => userMap.get(addr) ?? null);
    }),

    tokenLoader: new DataLoader<string, any>(async (addresses) => {
      const result = await db.query(
        "SELECT * FROM tokens WHERE address = ANY($1)",
        [addresses]
      );
      const tokenMap = new Map(result.rows.map((t) => [t.address, t]));
      return addresses.map((addr) => tokenMap.get(addr) ?? null);
    }),
  };
}

export const resolvers = {
  Query: {
    user: async (_: unknown, { address }: { address: string }, { db }: Context) => {
      const result = await db.query(
        "SELECT * FROM users WHERE address = $1",
        [address.toLowerCase()]
      );
      return result.rows[0] ?? null;
    },

    positions: async (
      _: unknown,
      {
        owner,
        asset,
        healthFactorBelow,
        first = 20,
        skip = 0,
        orderBy = "HEALTH_FACTOR",
        orderDirection = "ASC",
      }: {
        owner?: string;
        asset?: string;
        healthFactorBelow?: number;
        first?: number;
        skip?: number;
        orderBy?: string;
        orderDirection?: string;
      },
      { db }: Context
    ) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramCount = 1;

      if (owner) {
        conditions.push(`owner_address = $${paramCount++}`);
        params.push(owner.toLowerCase());
      }

      if (asset) {
        conditions.push(`asset_address = $${paramCount++}`);
        params.push(asset.toLowerCase());
      }

      if (healthFactorBelow !== undefined) {
        conditions.push(`health_factor < $${paramCount++}`);
        params.push(healthFactorBelow);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const orderColumn = {
        HEALTH_FACTOR: "health_factor",
        COLLATERAL_AMOUNT: "collateral_amount",
        DEBT_AMOUNT: "debt_amount",
        CREATED_AT: "created_at",
      }[orderBy] ?? "health_factor";

      const orderDir = orderDirection === "DESC" ? "DESC" : "ASC";

      params.push(first, skip);
      const result = await db.query(
        `SELECT * FROM positions ${whereClause}
         ORDER BY ${orderColumn} ${orderDir}
         LIMIT $${paramCount++} OFFSET $${paramCount++}`,
        params
      );

      return result.rows;
    },

    protocolStats: async (_: unknown, __: unknown, { db }: Context) => {
      const result = await db.query(`
        SELECT
          SUM(collateral_amount_usd) as total_value_locked,
          SUM(debt_amount_usd) as total_borrowed,
          COUNT(*) as active_positions
        FROM positions
        WHERE debt_amount > 0
      `);

      const stats = result.rows[0];
      const utilizationRate = stats.total_value_locked > 0
        ? stats.total_borrowed / stats.total_value_locked
        : 0;

      return {
        totalValueLocked: stats.total_value_locked ?? "0",
        totalBorrowed: stats.total_borrowed ?? "0",
        utilizationRate,
        activePositions: parseInt(stats.active_positions),
      };
    },
  },

  User: {
    positions: async (user: { address: string }, _: unknown, { db }: Context) => {
      const result = await db.query(
        "SELECT * FROM positions WHERE owner_address = $1 ORDER BY health_factor ASC",
        [user.address]
      );
      return result.rows;
    },

    transactions: async (
      user: { address: string },
      { first = 20, skip = 0 }: { first?: number; skip?: number },
      { db }: Context
    ) => {
      const result = await db.query(
        `SELECT * FROM transactions
         WHERE user_address = $1
         ORDER BY timestamp DESC
         LIMIT $2 OFFSET $3`,
        [user.address, first, skip]
      );
      return result.rows;
    },
  },

  Position: {
    owner: async (position: { owner_address: string }, _: unknown, { db }: Context) => {
      const result = await db.query(
        "SELECT * FROM users WHERE address = $1",
        [position.owner_address]
      );
      return result.rows[0];
    },

    asset: async (position: { asset_address: string }, _: unknown, { db }: Context) => {
      const result = await db.query(
        "SELECT * FROM tokens WHERE address = $1",
        [position.asset_address]
      );
      return result.rows[0];
    },

    liquidatable: (position: { health_factor: number }) => {
      return position.health_factor < 1.0;
    },
  },
};
```

Frontend query with Apollo Client:

```typescript
// src/hooks/useUserPositions.ts
import { gql, useQuery } from "@apollo/client";

const GET_USER_POSITIONS = gql`
  query GetUserPositions($address: String!) {
    user(address: $address) {
      address
      totalDeposited
      totalBorrowed
      positions {
        id
        asset {
          symbol
          priceUSD
        }
        collateralAmount
        debtAmount
        healthFactor
        liquidatable
      }
    }
  }
`;

export function useUserPositions(address: string | undefined) {
  const { data, loading, error, refetch } = useQuery(GET_USER_POSITIONS, {
    variables: { address: address?.toLowerCase() },
    skip: !address,
    pollInterval: 30_000, // refresh every 30 seconds
  });

  return {
    user: data?.user,
    positions: data?.user?.positions ?? [],
    loading,
    error,
    refetch,
  };
}

// Subscription for real-time updates
const POSITION_UPDATED = gql`
  subscription OnPositionUpdated($owner: String!) {
    positionUpdated(owner: $owner) {
      id
      healthFactor
      collateralAmount
      debtAmount
    }
  }
`;
```

---

## Common Mistakes and Gotchas

**1. N+1 query problem**  
If you resolve `Position.owner` with a separate database query for each position, and you return 100 positions, you make 100 database queries. Use DataLoader to batch these into a single query. This is the most common GraphQL performance issue.

**2. Not paginating list queries**  
Returning all positions without pagination can return millions of rows. Always add `first` and `skip` (or cursor-based pagination) to list queries. Set reasonable defaults and maximums.

**3. Exposing sensitive data**  
GraphQL's flexibility means clients can query anything you expose. Be careful about what you put in your schema. Don't expose internal IDs, admin data, or anything that could be used for attacks.

**4. Not caching expensive queries**  
Protocol-wide stats (TVL, total borrowed) are expensive to compute and don't change every second. Cache them with a TTL (e.g., 60 seconds) using Redis or Apollo's built-in caching.

**5. Not handling null values**  
Blockchain data can be incomplete (e.g., a token without a price feed). Use nullable types (`Token` instead of `Token!`) for data that might not exist, and handle nulls gracefully in your resolvers.

---

## How This Connects to Production

The Graph Protocol is a decentralized GraphQL indexing service — you write a "subgraph" (schema + event handlers) and The Graph indexes your contract events into a queryable GraphQL API. Uniswap's analytics (info.uniswap.org) is powered by a Uniswap subgraph. Aave's dashboard queries an Aave subgraph. Most DeFi frontends use GraphQL for their data layer. Building your own GraphQL API (as shown here) gives you more control and lower latency than The Graph, at the cost of more infrastructure to manage.

---

## What to Learn Next

- **The Graph Protocol vs Custom Indexers: When to Use Each** — decide whether to use The Graph or build your own.
- **Building a Solana Indexer from Scratch with Node.js and PostgreSQL** — the indexer that feeds your GraphQL API.
- **Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale** — deploy your GraphQL API to production.
