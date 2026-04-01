# Alchemy vs Infura vs Self-Hosted Nodes: Which RPC Provider Should You Use?

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

Your dApp needs an RPC endpoint. You've heard of Alchemy and Infura. You've also heard that "real" protocols run their own nodes. Which should you use? The answer depends on your scale, budget, and requirements — and it changes as your protocol grows.

This blog gives you a concrete framework for making this decision, with real numbers on cost, reliability, and when to switch.

---

## Core Concepts

### What You're Actually Choosing

When you pick an RPC provider, you're choosing:
- **Reliability**: what's the uptime SLA?
- **Rate limits**: how many requests per second?
- **Latency**: how fast are responses?
- **Features**: do you need archive data, enhanced APIs, webhooks?
- **Privacy**: do you want your queries going through a third party?
- **Cost**: what's the price per request at your scale?

### The Major Providers

**Alchemy**:
- Free tier: 300M compute units/month (~300K requests)
- Paid: $49/month (Growth), $199/month (Scale), custom enterprise
- Strengths: enhanced APIs (NFT API, Transfers API), webhooks, Notify, Simulator
- Weaknesses: can be expensive at high volume
- Used by: Uniswap, OpenSea, many major protocols

**Infura**:
- Free tier: 100K requests/day
- Paid: $50/month (Developer), $225/month (Team), custom enterprise
- Strengths: most established, widest chain support, IPFS gateway
- Weaknesses: had a major outage in 2020 that took down MetaMask
- Used by: MetaMask (historically), many dApps

**QuickNode**:
- Free tier: limited
- Paid: $9/month (Discover), $49/month (Build), custom enterprise
- Strengths: fastest response times, widest chain support, add-ons marketplace
- Weaknesses: less brand recognition than Alchemy/Infura

**Ankr**:
- Free tier: generous public endpoints
- Paid: $0.10/million requests
- Strengths: cheapest at scale, decentralized node network
- Weaknesses: less reliable than premium providers

**Self-hosted (geth/erigon/nethermind)**:
- Cost: $500-2000/month for a full node, $2000-5000/month for archive
- Strengths: no rate limits, full privacy, guaranteed uptime (if you manage it well)
- Weaknesses: significant DevOps overhead, sync time (days to weeks)

### When to Use Each

**Use managed provider (Alchemy/Infura/QuickNode) when:**
- You're in development or early production
- Your request volume is < 10M/month
- You don't have DevOps capacity
- You need enhanced APIs (NFT data, token transfers, etc.)

**Use self-hosted when:**
- You're hitting rate limits on managed providers
- You need guaranteed uptime (no dependency on third party)
- You need privacy (don't want queries going through a third party)
- You're running a high-frequency bot (latency matters)
- Your request volume makes self-hosting cheaper than managed

**Use both (hybrid) when:**
- Self-hosted as primary, managed as fallback
- Self-hosted for write operations, managed for read operations
- Different providers for different chains

---

## Code Walkthrough

Production RPC setup with fallback and monitoring:

```typescript
// src/rpc/provider-manager.ts
import { ethers } from "ethers";

interface ProviderConfig {
  url: string;
  name: string;
  weight: number; // higher = preferred
  maxRequestsPerSecond: number;
}

class RateLimiter {
  private requests: number[] = [];
  private maxRPS: number;

  constructor(maxRPS: number) {
    this.maxRPS = maxRPS;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < 1000);

    if (this.requests.length >= this.maxRPS) {
      const oldest = this.requests[0];
      const waitTime = 1000 - (now - oldest);
      await new Promise((r) => setTimeout(r, waitTime));
    }

    this.requests.push(Date.now());
  }
}

class ManagedProvider {
  private provider: ethers.JsonRpcProvider;
  private rateLimiter: RateLimiter;
  private errorCount = 0;
  private lastError = 0;
  public readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.url);
    this.rateLimiter = new RateLimiter(config.maxRequestsPerSecond);
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    await this.rateLimiter.throttle();

    try {
      const result = await this.provider.send(method, params);
      this.errorCount = 0; // reset on success
      return result;
    } catch (error) {
      this.errorCount++;
      this.lastError = Date.now();
      throw error;
    }
  }

  isHealthy(): boolean {
    // Consider unhealthy if >5 errors in last 60 seconds
    if (this.errorCount > 5 && Date.now() - this.lastError < 60_000) {
      return false;
    }
    return true;
  }
}

export class ProviderManager {
  private providers: ManagedProvider[];
  private metrics = {
    requests: 0,
    errors: 0,
    fallbacks: 0,
  };

  constructor(configs: ProviderConfig[]) {
    // Sort by weight (highest first)
    this.providers = configs
      .sort((a, b) => b.weight - a.weight)
      .map((c) => new ManagedProvider(c));
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    this.metrics.requests++;

    // Try providers in order of weight
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];

      if (!provider.isHealthy()) {
        if (i > 0) this.metrics.fallbacks++;
        continue;
      }

      try {
        return await provider.request(method, params);
      } catch (error) {
        this.metrics.errors++;
        console.warn(`Provider ${provider.config.name} failed:`, (error as Error).message);

        if (i === this.providers.length - 1) {
          throw new Error(`All providers failed for ${method}`);
        }

        this.metrics.fallbacks++;
        console.log(`Falling back to ${this.providers[i + 1].config.name}`);
      }
    }

    throw new Error("No healthy providers available");
  }

  getMetrics() {
    return {
      ...this.metrics,
      providerHealth: this.providers.map((p) => ({
        name: p.config.name,
        healthy: p.isHealthy(),
      })),
    };
  }
}

// Usage
const manager = new ProviderManager([
  {
    url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
    name: "Alchemy",
    weight: 100,
    maxRequestsPerSecond: 330, // Alchemy Growth tier
  },
  {
    url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
    name: "Infura",
    weight: 80,
    maxRequestsPerSecond: 100,
  },
  {
    url: "https://rpc.ankr.com/eth",
    name: "Ankr Public",
    weight: 10,
    maxRequestsPerSecond: 30,
  },
]);

// Wrap with ethers.js
const provider = new ethers.JsonRpcProvider({
  url: "http://localhost:8545", // proxy to manager
  send: (method, params) => manager.send(method, params),
} as any);
```

Self-hosted node setup with Docker:

```yaml
# docker-compose.yml — Ethereum full node with Geth
version: "3.8"

services:
  geth:
    image: ethereum/client-go:latest
    container_name: geth
    restart: unless-stopped
    ports:
      - "8545:8545"   # HTTP RPC
      - "8546:8546"   # WebSocket RPC
      - "30303:30303" # P2P
    volumes:
      - geth-data:/root/.ethereum
    command:
      - --mainnet
      - --http
      - --http.addr=0.0.0.0
      - --http.port=8545
      - --http.api=eth,net,web3,txpool
      - --http.corsdomain=*
      - --ws
      - --ws.addr=0.0.0.0
      - --ws.port=8546
      - --ws.api=eth,net,web3
      - --syncmode=snap  # faster initial sync
      - --cache=4096     # 4GB cache
      - --maxpeers=50
    deploy:
      resources:
        limits:
          memory: 16G

  # Nginx reverse proxy with rate limiting
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - geth

volumes:
  geth-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/ethereum  # fast SSD required
```

```nginx
# nginx.conf — rate limiting for self-hosted node
http {
    limit_req_zone $binary_remote_addr zone=rpc:10m rate=100r/s;

    server {
        listen 80;

        location / {
            limit_req zone=rpc burst=200 nodelay;
            proxy_pass http://geth:8545;
            proxy_set_header Host $host;
        }
    }
}
```

---

## Common Mistakes and Gotchas

**1. Using a single RPC provider with no fallback**  
Infura's 2020 outage took down MetaMask and most dApps simultaneously. Always have at least two providers configured with automatic fallback. The `FallbackProvider` in ethers.js handles this elegantly.

**2. Exposing your API key in frontend code**  
Your Alchemy or Infura key in client-side JavaScript is visible to anyone. They can use your key, exhaust your rate limits, and run up your bill. Use a backend proxy or use provider-level domain restrictions.

**3. Not monitoring your node's sync status**  
Self-hosted nodes can fall behind if they lose peers or have hardware issues. Always monitor sync status and alert when the node is more than a few blocks behind.

**4. Underestimating storage requirements**  
A Geth full node requires ~1TB SSD. An archive node requires ~2TB+. Use fast NVMe SSDs — spinning disks are too slow for Ethereum node operation. Budget for storage growth (~100GB/month for full node).

**5. Not setting up proper authentication for self-hosted nodes**  
A self-hosted node without authentication is accessible to anyone who can reach it. Use JWT authentication (Geth supports this) or put it behind a VPN/firewall.

---

## How This Connects to Production

Uniswap Labs uses Alchemy for their frontend. Aave uses Infura. Chainlink runs its own nodes for oracle operations. Flashbots runs its own nodes for MEV infrastructure. The pattern: consumer-facing dApps use managed providers for convenience; infrastructure-level protocols (oracles, MEV, liquidation bots) run their own nodes for reliability and latency. As your protocol grows, you'll likely move from managed → hybrid → self-hosted for critical operations.

---

## What to Learn Next

- **Tenderly: Debugging and Simulating Transactions Like a Pro** — use Tenderly's simulation on top of your RPC setup.
- **The Graph Protocol vs Custom Indexers: When to Use Each** — build queryable APIs on top of your node.
- **Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale** — deploy your infrastructure.
