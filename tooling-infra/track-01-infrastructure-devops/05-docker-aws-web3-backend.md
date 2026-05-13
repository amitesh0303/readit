# Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You've built a Solana indexer or an Ethereum event processor. It works on your laptop. Now you need to deploy it to production — 24/7 uptime, automatic restarts on failure, scaling under load, and monitoring. You've heard of Docker and AWS but you're not sure how to put it all together for a Web3 backend.

This blog covers the full production deployment stack for a Web3 indexer: Docker containerization, AWS ECS deployment, RDS for PostgreSQL, and CloudWatch monitoring.

---

## Core Concepts

### The Production Stack

```
GitHub (source code)
    ↓ CI/CD (GitHub Actions)
ECR (Docker image registry)
    ↓
ECS Fargate (container orchestration)
    ├── Indexer service (Node.js)
    ├── API service (GraphQL)
    └── Worker service (keeper bot)
    ↓
RDS PostgreSQL (database)
    ↓
CloudWatch (logs + metrics + alerts)
```

### Why Docker for Web3 Backends

Web3 backends have specific dependencies: Node.js version, native modules (secp256k1, keccak), and sometimes Rust toolchains. Docker ensures your production environment exactly matches your development environment.

```dockerfile
# Without Docker: "works on my machine"
# With Docker: same environment everywhere
```

### ECS Fargate vs EC2

**ECS Fargate**: serverless containers. You define CPU/memory, AWS manages the underlying EC2 instances. No server management, automatic scaling, pay per use.

**ECS EC2**: you manage the EC2 instances. More control, potentially cheaper at high scale, but more operational overhead.

For most Web3 backends: start with Fargate. Move to EC2 if costs become significant.

---

## Code Walkthrough

**Dockerfile for a Node.js indexer:**

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# ── Production image ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml — local development
version: "3.8"

services:
  indexer:
    build: .
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/indexer
      - RPC_ENDPOINT=${RPC_ENDPOINT}
      - GEYSER_ENDPOINT=${GEYSER_ENDPOINT}
      - NODE_ENV=development
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    ports:
      - "3000:3000"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/indexer
      - PORT=4000
    depends_on:
      - db
    ports:
      - "4000:4000"

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: indexer
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    ports:
      - "5432:5432"

volumes:
  postgres-data:
```

**GitHub Actions CI/CD pipeline:**

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS ECS

on:
  push:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: web3-indexer
  ECS_CLUSTER: web3-production
  ECS_SERVICE: indexer-service
  CONTAINER_NAME: indexer

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build, tag, and push image to ECR
        id: build-image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Download task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition indexer \
            --query taskDefinition > task-definition.json

      - name: Update ECS task definition with new image
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: ${{ env.CONTAINER_NAME }}
          image: ${{ steps.build-image.outputs.image }}

      - name: Deploy to ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
```

**ECS Task Definition (Terraform):**

```hcl
# infrastructure/ecs.tf
resource "aws_ecs_task_definition" "indexer" {
  family                   = "indexer"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"  # 1 vCPU
  memory                   = "2048"  # 2 GB
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "indexer"
      image = "${aws_ecr_repository.indexer.repository_url}:latest"

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.database_url.arn
        },
        {
          name      = "RPC_ENDPOINT"
          valueFrom = aws_secretsmanager_secret.rpc_endpoint.arn
        },
      ]

      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/indexer"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "indexer" {
  name            = "indexer-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.indexer.arn
  desired_count   = 2  # run 2 instances for redundancy
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.indexer.id]
    assign_public_ip = false
  }

  # Auto-scaling
  lifecycle {
    ignore_changes = [desired_count]
  }
}

# Auto-scaling based on CPU
resource "aws_appautoscaling_target" "indexer" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.indexer.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "indexer_cpu" {
  name               = "indexer-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.indexer.resource_id
  scalable_dimension = aws_appautoscaling_target.indexer.scalable_dimension
  service_namespace  = aws_appautoscaling_target.indexer.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0  # scale up when CPU > 70%
  }
}
```

**Health check endpoint in your indexer:**

```typescript
// src/health.ts
import express from "express";
import { Pool } from "pg";

export function setupHealthCheck(app: express.Application, db: Pool) {
  app.get("/health", async (req, res) => {
    const checks = {
      status: "ok",
      timestamp: new Date().toISOString(),
      checks: {} as Record<string, { status: string; latency?: number; error?: string }>,
    };

    // Check database connectivity
    const dbStart = Date.now();
    try {
      await db.query("SELECT 1");
      checks.checks.database = {
        status: "ok",
        latency: Date.now() - dbStart,
      };
    } catch (err) {
      checks.status = "degraded";
      checks.checks.database = {
        status: "error",
        error: (err as Error).message,
      };
    }

    // Check indexer lag
    try {
      const result = await db.query(
        "SELECT MAX(slot) as latest_slot FROM transactions"
      );
      const latestIndexedSlot = result.rows[0]?.latest_slot ?? 0;
      // In production: compare with current chain slot
      checks.checks.indexer = {
        status: "ok",
        latency: latestIndexedSlot,
      };
    } catch (err) {
      checks.checks.indexer = {
        status: "error",
        error: (err as Error).message,
      };
    }

    const statusCode = checks.status === "ok" ? 200 : 503;
    res.status(statusCode).json(checks);
  });
}
```

---

## Common Mistakes and Gotchas

**1. Storing secrets in environment variables in the task definition**  
Never put API keys or database passwords directly in ECS task definitions — they're visible in the AWS console and logs. Use AWS Secrets Manager or Parameter Store and reference them as `secrets` in the task definition.

**2. Not setting up proper IAM roles**  
ECS tasks need IAM roles to access AWS services (Secrets Manager, CloudWatch, S3). Create a task execution role (for ECS to pull images and secrets) and a task role (for your application to access AWS services). Don't use overly permissive roles.

**3. Not handling graceful shutdown**  
When ECS stops a container (for deployment or scaling), it sends SIGTERM. Your application must handle this gracefully: stop accepting new requests, finish processing current requests, close database connections. Without graceful shutdown, you'll lose in-flight data.

**4. Not monitoring indexer lag**  
Your indexer can fall behind if it can't keep up with the chain. Monitor the gap between the latest indexed slot/block and the current chain head. Alert when lag exceeds a threshold (e.g., 100 blocks).

**5. Single-region deployment**  
AWS regions can have outages. For critical infrastructure, deploy to multiple regions with Route 53 failover. At minimum, use multiple availability zones within a region.

---

## How This Connects to Production

Helius (Solana RPC provider) runs their indexing infrastructure on AWS ECS. Most DeFi protocol backends use similar stacks: Docker containers on ECS or EKS, RDS for PostgreSQL, ElastiCache for Redis, CloudWatch for monitoring. The patterns here — containerization, CI/CD, auto-scaling, health checks — are standard DevOps practices applied to Web3 backends. The main Web3-specific consideration is handling blockchain-specific failure modes: RPC outages, chain reorgs, and indexer lag.

---

## What to Learn Next

- **Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data** — the data source for your production indexer.
- **Building a Solana Indexer from Scratch with Node.js and PostgreSQL** — the indexer you're deploying.
- **Alchemy vs Infura vs Self-Hosted Nodes: Which RPC Provider Should You Use?** — the RPC layer your indexer depends on.
