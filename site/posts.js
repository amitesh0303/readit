// All blog posts — ordered newest first
const BLOG_POSTS = [
  {
    slug: "2026-03-12-how-mcps-actually-changed-my-week",
    title: "How MCPs Actually Changed My Week (Not the Marketing Version)",
    date: "2026-03-12",
    dateDisplay: "Mar 12, 2026",
    tags: ["mcp", "ai", "claude", "cursor", "productivity", "web3-tooling"],
    excerpt: "Six MCP servers, four skills, two subagents. A real Tuesday walked through, including the parts where the tooling doesn't work and what the genuine productivity multiplier looks like for a senior Web3 dev.",
    file: "/blogs/2026-03-12-how-mcps-actually-changed-my-week.md"
  },
  {
    slug: "2025-09-22-i-rewrote-my-dapp-frontend-from-ethers-to-viem",
    title: "I Rewrote My dApp Frontend from Ethers to Viem. Here's What I Actually Learned.",
    date: "2025-09-22",
    dateDisplay: "Sep 22, 2025",
    tags: ["viem", "ethers", "wagmi", "frontend", "typescript", "refactor"],
    excerpt: "Three weekends, -800 lines, -70 kB gzipped, two latent bugs found. The ethers-to-viem migration that everyone has been telling me to do — what was annoying, what wasn't, and what actually changed.",
    file: "/blogs/2025-09-22-i-rewrote-my-dapp-frontend-from-ethers-to-viem.md"
  },
  {
    slug: "2025-04-01-what-account-abstraction-actually-changes-for-developers",
    title: "What Account Abstraction Actually Changes for Developers (Not the Hype Version)",
    date: "2025-04-01",
    dateDisplay: "Apr 1, 2025",
    tags: ["erc-4337", "account-abstraction", "ux", "ethereum", "wallets"],
    excerpt: "ERC-4337 shipped two years ago. Here's what's actually deployed and used today — gasless transactions, session keys, smart wallets — and the honest problems nobody talks about.",
    file: "/blogs/2025-04-01-what-account-abstraction-actually-changes-for-developers.md"
  },
  {
    slug: "2025-02-04-building-a-perps-protocol-the-math-that-keeps-me-up-at-night",
    title: "Building a Perps Protocol: The Math That Keeps Me Up at Night",
    date: "2025-02-04",
    dateDisplay: "Feb 4, 2025",
    tags: ["solana", "perpetuals", "vamm", "funding-rate", "defi", "math"],
    excerpt: "Four months into building a perpetual futures protocol on Solana. The vAMM pricing, funding rate calibration, bad debt handling, and the precision bugs that keep appearing.",
    file: "/blogs/2025-02-04-building-a-perps-protocol-the-math-that-keeps-me-up-at-night.md"
  },
  {
    slug: "2024-11-18-two-years-in-what-the-space-looks-like-from-here",
    title: "Two Years In: What the Space Looks Like From Here",
    date: "2024-11-18",
    dateDisplay: "Nov 18, 2024",
    tags: ["web3", "career", "ethereum", "solana", "reflection"],
    excerpt: "An honest retrospective after two years building on Ethereum and Solana. What surprised me, what disappointed me, and where I think this is actually going.",
    file: "/blogs/2024-11-18-two-years-in-what-the-space-looks-like-from-here.md"
  },
  {
    slug: "2024-09-03-zk-proofs-from-confusion-to-shipping",
    title: "ZK Proofs: From Complete Confusion to Actually Shipping Something",
    date: "2024-09-03",
    dateDisplay: "Sep 3, 2024",
    tags: ["zk", "circom", "snarkjs", "privacy", "ethereum"],
    excerpt: "Eight months of trying to understand ZK proofs. The thing that finally made circuits click, the trusted setup confusion, and the first circuit I actually shipped.",
    file: "/blogs/2024-09-03-zk-proofs-from-confusion-to-shipping.md"
  },
  {
    slug: "2024-07-11-i-got-my-first-audit-here-is-what-i-learned",
    title: "I Got My First Audit. Here's What I Actually Learned.",
    date: "2024-07-11",
    dateDisplay: "Jul 11, 2024",
    tags: ["security", "audit", "solidity", "defi", "production"],
    excerpt: "$18,000, two weeks, two medium findings. The donation attack I thought I'd protected against, the slippage vulnerability I hadn't considered, and what the process was actually like.",
    file: "/blogs/2024-07-11-i-got-my-first-audit-here-is-what-i-learned.md"
  },
  {
    slug: "2024-05-20-building-a-liquidation-bot-the-parts-nobody-writes-about",
    title: "Building a Liquidation Bot: The Parts Nobody Writes About",
    date: "2024-05-20",
    dateDisplay: "May 20, 2024",
    tags: ["solana", "keeper-bot", "liquidation", "infrastructure", "production"],
    excerpt: "The happy path took a week. The operational parts — race conditions, simulation, wallet management, 24/7 uptime — took seven more weeks.",
    file: "/blogs/2024-05-20-building-a-liquidation-bot-the-parts-nobody-writes-about.md"
  },
  {
    slug: "2024-03-15-eip-4844-blobs-changed-everything-and-nobody-noticed",
    title: "EIP-4844 Dropped and L2 Fees Fell Off a Cliff. Here's What Actually Happened.",
    date: "2024-03-15",
    dateDisplay: "Mar 15, 2024",
    tags: ["ethereum", "eip-4844", "blobs", "l2", "arbitrum", "optimism"],
    excerpt: "The Dencun upgrade went live and L2 fees dropped 10-20x overnight. What blobs actually are, why they're cheaper than calldata, and what changed in my code.",
    file: "/blogs/2024-03-15-eip-4844-blobs-changed-everything-and-nobody-noticed.md"
  },
  {
    slug: "2024-01-22-the-arbitrum-migration-what-nobody-tells-you",
    title: "The Arbitrum Migration: What Nobody Tells You",
    date: "2024-01-22",
    dateDisplay: "Jan 22, 2024",
    tags: ["arbitrum", "l2", "ethereum", "deployment", "gas"],
    excerpt: "Migrating from Ethereum mainnet to Arbitrum. block.number isn't what you think, gas estimation is different, and the 7-day withdrawal delay is real and users hate it.",
    file: "/blogs/2024-01-22-the-arbitrum-migration-what-nobody-tells-you.md"
  },
  {
    slug: "2023-11-07-why-i-started-learning-solana-after-a-year-on-ethereum",
    title: "Why I Started Learning Solana After a Year on Ethereum",
    date: "2023-11-07",
    dateDisplay: "Nov 7, 2023",
    tags: ["solana", "ethereum", "rust", "anchor", "learning"],
    excerpt: "The account model broke my brain in a good way. PDAs are the thing that finally made it click. And Rust is actually fine.",
    file: "/blogs/2023-11-07-why-i-started-learning-solana-after-a-year-on-ethereum.md"
  },
  {
    slug: "2023-08-29-i-deployed-to-mainnet-and-immediately-found-a-bug",
    title: "I Deployed to Mainnet and Immediately Found a Bug (Here's What I Did)",
    date: "2023-08-29",
    dateDisplay: "Aug 29, 2023",
    tags: ["solidity", "mainnet", "debugging", "gas", "production"],
    excerpt: "Deployed on August 15th. Found a gas bug on August 16th. The contract was immutable. Here's what the bug was, how I found it, and what I did about it.",
    file: "/blogs/2023-08-29-i-deployed-to-mainnet-and-immediately-found-a-bug.md"
  },
  {
    slug: "2023-06-18-six-months-in-what-i-wish-someone-had-told-me",
    title: "Six Months In: What I Wish Someone Had Told Me About Web3 Development",
    date: "2023-06-18",
    dateDisplay: "Jun 18, 2023",
    tags: ["web3", "ethereum", "solana", "learning", "career"],
    excerpt: "The tooling is better than expected, the debugging is worse. Gas optimization is a real skill. Reading audit reports is the best free education in this space.",
    file: "/blogs/2023-06-18-six-months-in-what-i-wish-someone-had-told-me.md"
  },
  {
    slug: "2023-04-03-my-first-smart-contract-bug-cost-me-nothing-but-taught-me-everything",
    title: "My First Smart Contract Bug Cost Me Nothing (But Taught Me Everything)",
    date: "2023-04-03",
    dateDisplay: "Apr 3, 2023",
    tags: ["solidity", "security", "reentrancy", "learning"],
    excerpt: "I shipped my first contract. A friend looked at it for 90 seconds and said 'your withdraw function is reentrant.' I didn't know what that meant. I do now.",
    file: "/blogs/2023-04-03-my-first-smart-contract-bug-cost-me-nothing-but-taught-me-everything.md"
  },
  {
    slug: "2023-02-14-why-i-finally-went-all-in-on-web3",
    title: "Why I Finally Went All-In on Web3 (After Years of Skepticism)",
    date: "2023-02-14",
    dateDisplay: "Feb 14, 2023",
    tags: ["web3", "career", "ethereum", "personal"],
    excerpt: "I spent years being the skeptic in the room. Then I watched a friend send money to Nigeria in 3 minutes for $0.02. That landed differently than reading about it.",
    file: "/blogs/2023-02-14-why-i-finally-went-all-in-on-web3.md"
  }
];

// All learning tracks
const TRACKS = [
  {
    id: "track-1",
    number: "Track 01",
    title: "Blockchain Fundamentals",
    level: "Beginner",
    desc: "Blocks, nodes, consensus, wallets, gas, and the EVM — the foundation everything else builds on.",
    posts: [
      { title: "What is a Blockchain? Blocks, Nodes, Consensus Explained Simply", file: "/foundations/track-01-blockchain-fundamentals/01-what-is-a-blockchain.md" },
      { title: "Public/Private Keys, Wallets, and How Transactions Actually Work", file: "/foundations/track-01-blockchain-fundamentals/02-public-private-keys-wallets-transactions.md" },
      { title: "Gas Fees Explained: Why Does Ethereum Cost So Much?", file: "/foundations/track-01-blockchain-fundamentals/03-gas-fees-explained.md" },
      { title: "EVM vs Non-EVM Chains: What's the Difference and Why It Matters", file: "/foundations/track-01-blockchain-fundamentals/04-evm-vs-non-evm-chains.md" },
      { title: "What is a Smart Contract? A Plain English Guide", file: "/foundations/track-01-blockchain-fundamentals/05-what-is-a-smart-contract.md" },
      { title: "Testnets vs Mainnets: Where Developers Practice Before Going Live", file: "/foundations/track-01-blockchain-fundamentals/06-testnets-vs-mainnets.md" },
      { title: "RPC Nodes Explained: How Your dApp Talks to the Blockchain", file: "/foundations/track-01-blockchain-fundamentals/07-rpc-nodes-explained.md" }
    ]
  },
  {
    id: "track-2",
    number: "Track 02",
    title: "Solidity & EVM Smart Contracts",
    level: "Beginner → Intermediate",
    desc: "From your first contract to production-grade Solidity — tokens, NFTs, security, gas optimization, and testing.",
    posts: [
      { title: "Your First Solidity Smart Contract: Hello World to Token in 30 Minutes", file: "/defi/track-01-solidity-evm/01-first-solidity-contract.md" },
      { title: "Solidity Data Types, Storage vs Memory vs Calldata — Deep Dive", file: "/defi/track-01-solidity-evm/02-solidity-data-types-storage-memory-calldata.md" },
      { title: "ERC-20 Standard: Building a Token from Scratch", file: "/defi/track-01-solidity-evm/03-erc20-token-from-scratch.md" },
      { title: "ERC-721 Standard: Building an NFT from Scratch", file: "/defi/track-01-solidity-evm/04-erc721-nft-from-scratch.md" },
      { title: "ERC-1155: Multi-Token Standard and When to Use It", file: "/defi/track-01-solidity-evm/05-erc1155-multi-token-standard.md" },
      { title: "Access Control in Solidity: Ownable, Roles, and Multi-Sig", file: "/defi/track-01-solidity-evm/06-access-control-ownable-roles-multisig.md" },
      { title: "Events and Logs: How Frontends Listen to Smart Contracts", file: "/defi/track-01-solidity-evm/07-events-and-logs.md" },
      { title: "Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running", file: "/defi/track-01-solidity-evm/08-solidity-security-101.md" },
      { title: "Gas Optimization Patterns Every Solidity Dev Should Know", file: "/defi/track-01-solidity-evm/09-gas-optimization-patterns.md" },
      { title: "Hardhat vs Foundry: Which Testing Framework Should You Use?", file: "/defi/track-01-solidity-evm/10-hardhat-vs-foundry.md" }
    ]
  },
  {
    id: "track-3",
    number: "Track 03",
    title: "DeFi Protocols",
    level: "Intermediate",
    desc: "AMMs, lending, oracles, flash loans, and staking — how DeFi actually works under the hood.",
    posts: [
      { title: "What is DeFi? Lending, Borrowing, and Yield Explained", file: "/defi/track-02-defi-protocols/01-what-is-defi.md" },
      { title: "How AMMs Work: The Math Behind Uniswap's x*y=k", file: "/defi/track-02-defi-protocols/02-how-amms-work-uniswap-xy-k.md" },
      { title: "Constant Product vs Constant Sum Market Makers: Tradeoffs", file: "/defi/track-02-defi-protocols/03-constant-product-vs-constant-sum.md" },
      { title: "Liquidity Pools, Impermanent Loss, and LP Token Mechanics", file: "/defi/track-02-defi-protocols/04-liquidity-pools-impermanent-loss.md" },
      { title: "How DeFi Lending Works: Collateral, Health Factor, and Liquidations", file: "/defi/track-02-defi-protocols/05-defi-lending-collateral-health-factor-liquidations.md" },
      { title: "Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)", file: "/defi/track-02-defi-protocols/06-chainlink-oracles.md" },
      { title: "Flash Loans: How They Work and How They're Exploited", file: "/defi/track-02-defi-protocols/07-flash-loans.md" },
      { title: "Token Vesting and Staking Contracts: Architecture and Patterns", file: "/defi/track-02-defi-protocols/08-token-vesting-and-staking.md" }
    ]
  },
  {
    id: "track-4",
    number: "Track 04",
    title: "Solana Development",
    level: "Beginner → Intermediate",
    desc: "The account model, PDAs, Anchor, CPIs, and SPL tokens — everything you need to build on Solana.",
    posts: [
      { title: "Solana vs Ethereum: A Developer's Comparison", file: "/l1-ecosystems/track-01-solana-development/01-solana-vs-ethereum.md" },
      { title: "Solana's Account Model Explained (vs EVM Storage Model)", file: "/l1-ecosystems/track-01-solana-development/02-solana-account-model.md" },
      { title: "What are PDAs (Program Derived Addresses)? Solana's Most Important Concept", file: "/l1-ecosystems/track-01-solana-development/03-pdas-program-derived-addresses.md" },
      { title: "Getting Started with Anchor: Your First Solana Program", file: "/l1-ecosystems/track-01-solana-development/04-getting-started-with-anchor.md" },
      { title: "Cross-Program Invocations (CPIs): How Solana Programs Call Each Other", file: "/l1-ecosystems/track-01-solana-development/05-cross-program-invocations.md" },
      { title: "Solana Transaction Anatomy: Instructions, Signers, and Compute Units", file: "/l1-ecosystems/track-01-solana-development/06-solana-transaction-anatomy.md" },
      { title: "Phantom Wallet Integration: Connecting Solana dApps to Users", file: "/l1-ecosystems/track-01-solana-development/07-phantom-wallet-integration.md" },
      { title: "Solana Token Program and SPL Tokens: The Equivalent of ERC-20", file: "/l1-ecosystems/track-01-solana-development/08-solana-token-program-spl-tokens.md" }
    ]
  },
  {
    id: "track-5",
    number: "Track 05",
    title: "Advanced Solana",
    level: "Expert",
    desc: "Geyser streaming, custom indexers, vAMMs, funding rates, keeper bots, and Pyth oracles.",
    posts: [
      { title: "Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data", file: "/l1-ecosystems/track-02-advanced-solana/01-geyser-plugin-deep-dive.md" },
      { title: "Building a Solana Indexer from Scratch with Node.js and PostgreSQL", file: "/l1-ecosystems/track-02-advanced-solana/02-solana-indexer-nodejs-postgresql.md" },
      { title: "vAMM Architecture: How Perpetual DEXes Price Without an Orderbook", file: "/l1-ecosystems/track-02-advanced-solana/03-vamm-architecture-perpetual-dexes.md" },
      { title: "Funding Rate Mechanics in Perpetual Futures: The Math and Implementation", file: "/l1-ecosystems/track-02-advanced-solana/04-funding-rate-mechanics.md" },
      { title: "Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic", file: "/l1-ecosystems/track-02-advanced-solana/05-keeper-bots-solana.md" },
      { title: "Pyth Network Oracle Integration: Real-Time Price Feeds on Solana", file: "/l1-ecosystems/track-02-advanced-solana/06-pyth-network-oracle-integration.md" },
      { title: "Cross-Margin vs Isolated Margin in On-Chain Perpetuals", file: "/l1-ecosystems/track-02-advanced-solana/07-cross-margin-vs-isolated-margin.md" }
    ]
  },
  {
    id: "track-6",
    number: "Track 06",
    title: "Zero-Knowledge Proofs",
    level: "Intermediate → Expert",
    desc: "SNARKs, STARKs, Circom circuits, trusted setups, on-chain verification, and building a privacy mixer.",
    posts: [
      { title: "ZK Proofs Explained Without the Math: What They Are and Why They Matter", file: "/foundations/track-02-zero-knowledge-proofs/01-zk-proofs-explained.md" },
      { title: "SNARKs vs STARKs: Key Differences for Developers", file: "/foundations/track-02-zero-knowledge-proofs/02-snarks-vs-starks.md" },
      { title: "Getting Started with Circom: Writing Your First ZK Circuit", file: "/foundations/track-02-zero-knowledge-proofs/03-getting-started-with-circom.md" },
      { title: "SnarkJS and Trusted Setup Ceremonies: How They Work and Why They Matter", file: "/foundations/track-02-zero-knowledge-proofs/04-snarkjs-trusted-setup.md" },
      { title: "On-Chain Proof Verification in Solidity: Gas Costs and Optimization", file: "/foundations/track-02-zero-knowledge-proofs/05-on-chain-proof-verification-solidity.md" },
      { title: "Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions", file: "/foundations/track-02-zero-knowledge-proofs/06-poseidon-hash-vs-keccak256.md" },
      { title: "Incremental Merkle Trees: The Data Structure Powering Privacy Protocols", file: "/foundations/track-02-zero-knowledge-proofs/07-incremental-merkle-trees.md" },
      { title: "Building a Privacy Mixer: Deposit, Withdraw, and Note Management", file: "/foundations/track-02-zero-knowledge-proofs/08-building-a-privacy-mixer.md" }
    ]
  },
  {
    id: "track-7",
    number: "Track 07",
    title: "Wallet Integration & UX",
    level: "Intermediate",
    desc: "MetaMask, WalletConnect, Phantom, multi-chain UX, meta-transactions, and onboarding non-crypto users.",
    posts: [
      { title: "MetaMask Integration with ethers.js and wagmi: A Complete Guide", file: "/frontend-ux/track-01-wallet-integration-ux/01-metamask-ethers-wagmi.md" },
      { title: "WalletConnect v2: Multi-Chain Wallet Support for dApps", file: "/frontend-ux/track-01-wallet-integration-ux/02-walletconnect-v2.md" },
      { title: "Phantom Wallet Integration on Solana: Sign Transactions and Send SOL", file: "/frontend-ux/track-01-wallet-integration-ux/03-phantom-wallet-solana-integration.md" },
      { title: "Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases", file: "/frontend-ux/track-01-wallet-integration-ux/04-multi-chain-wallet-ux.md" },
      { title: "EIP-2771 Meta-Transactions: Gasless UX for Your dApp", file: "/frontend-ux/track-01-wallet-integration-ux/05-eip2771-meta-transactions.md" },
      { title: "Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp", file: "/frontend-ux/track-01-wallet-integration-ux/06-web3-onboarding-ux.md" }
    ]
  },
  {
    id: "track-8",
    number: "Track 08",
    title: "L2s, Rollups & Cross-Chain",
    level: "Intermediate → Expert",
    desc: "Optimistic vs ZK rollups, Arbitrum, Polygon, deploying to L2s, bridges, and modular blockchain stacks.",
    posts: [
      { title: "Ethereum L2s Explained: Optimistic vs ZK Rollups", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/01-ethereum-l2s-explained.md" },
      { title: "Arbitrum Deep Dive: Architecture and What Developers Need to Know", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/02-arbitrum-deep-dive.md" },
      { title: "Polygon Architecture: From PoS Chain to zkEVM", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/03-polygon-architecture.md" },
      { title: "Deploying to Arbitrum: What's Different from Ethereum Mainnet", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/04-deploying-to-arbitrum.md" },
      { title: "Cross-Chain Bridges: How They Work and Where They Break", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/05-cross-chain-bridges.md" },
      { title: "What is Caldera? Customizable Rollups and the Modular Blockchain Stack", file: "/ethereum-l2s/track-01-l2s-rollups-crosschain/06-what-is-caldera.md" }
    ]
  },
  {
    id: "track-9",
    number: "Track 09",
    title: "Security & Auditing",
    level: "Intermediate → Expert",
    desc: "Audit process, Slither, Echidna, working with auditors, and the top 10 vulnerability classes.",
    posts: [
      { title: "Smart Contract Audit Process: What Auditors Actually Look For", file: "/security/track-01-security-auditing/01-smart-contract-audit-process.md" },
      { title: "Slither: Automated Static Analysis for Solidity Contracts", file: "/security/track-01-security-auditing/02-slither-static-analysis.md" },
      { title: "Echidna: Property-Based Fuzzing for Smart Contracts", file: "/security/track-01-security-auditing/03-echidna-fuzzing.md" },
      { title: "Working with Auditors: Lessons from a Trail of Bits Collaboration", file: "/security/track-01-security-auditing/04-working-with-auditors.md" },
      { title: "Top 10 Smart Contract Vulnerabilities and How to Prevent Them", file: "/security/track-01-security-auditing/05-top-10-smart-contract-vulnerabilities.md" }
    ]
  },
  {
    id: "track-10",
    number: "Track 10",
    title: "Infrastructure & DevOps for Web3",
    level: "Intermediate",
    desc: "RPC providers, Tenderly, GraphQL APIs, The Graph, and deploying Node.js indexers on AWS.",
    posts: [
      { title: "Alchemy vs Infura vs Self-Hosted Nodes: Which RPC Provider Should You Use?", file: "/tooling-infra/track-01-infrastructure-devops/01-alchemy-vs-infura-vs-self-hosted.md" },
      { title: "Tenderly: Debugging and Simulating Transactions Like a Pro", file: "/tooling-infra/track-01-infrastructure-devops/02-tenderly-debugging-simulating.md" },
      { title: "GraphQL for Blockchain Data: Building Flexible Query APIs", file: "/tooling-infra/track-01-infrastructure-devops/03-graphql-for-blockchain-data.md" },
      { title: "The Graph Protocol vs Custom Indexers: When to Use Each", file: "/tooling-infra/track-01-infrastructure-devops/04-the-graph-vs-custom-indexers.md" },
      { title: "Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale", file: "/tooling-infra/track-01-infrastructure-devops/05-docker-aws-web3-backend.md" }
    ]
  },
  {
    id: "l1-bnb-chain",
    number: "Track 11",
    title: "BNB Chain Development",
    level: "Beginner → Intermediate",
    desc: "Build on BNB Chain — BEP-20 tokens, smart contracts, and BSC deployment.",
    posts: [
      { title: "BNB Chain Overview and Architecture", file: "/l1-ecosystems/track-03-bnb-chain/01-bnb-chain-overview.md" },
      { title: "Development Environment Setup for BNB Chain", file: "/l1-ecosystems/track-03-bnb-chain/02-dev-environment-setup.md" },
      { title: "Deploy Your First BEP-20 Token to BSC Testnet", file: "/l1-ecosystems/track-03-bnb-chain/03-first-smart-contract.md" },
      { title: "BEP-20, BEP-721, and BEP-1155 Token Standards", file: "/l1-ecosystems/track-03-bnb-chain/04-token-standards.md" },
      { title: "Frontend Integration: Connect MetaMask to BSC", file: "/l1-ecosystems/track-03-bnb-chain/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-avalanche",
    number: "Track 12",
    title: "Avalanche Development",
    level: "Beginner → Intermediate",
    desc: "Build on Avalanche — C-Chain smart contracts, Subnet architecture, Fuji testnet deployment, and cross-chain dApps.",
    posts: [
      { title: "Avalanche Architecture: C-Chain, X-Chain, P-Chain, and Subnets", file: "/l1-ecosystems/track-04-avalanche/01-avalanche-overview.md" },
      { title: "Avalanche Development Environment: CLI, Core Wallet, and Fuji Testnet", file: "/l1-ecosystems/track-04-avalanche/02-dev-environment-setup.md" },
      { title: "Deploy Your First Smart Contract to Avalanche Fuji C-Chain", file: "/l1-ecosystems/track-04-avalanche/03-first-smart-contract.md" },
      { title: "Token Standards on Avalanche: ERC-20, Wrapped AVAX, and Cross-Chain Tokens", file: "/l1-ecosystems/track-04-avalanche/04-token-standards.md" },
      { title: "Frontend Integration: Core Wallet, MetaMask, and Reading C-Chain Data", file: "/l1-ecosystems/track-04-avalanche/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-cardano",
    number: "Track 13",
    title: "Cardano Development",
    level: "Intermediate",
    desc: "Build on Cardano — UTXO model, Plutus smart contracts, native tokens, and Preview testnet deployment with Haskell-based validators.",
    posts: [
      { title: "Cardano Overview: UTXO Model, Ouroboros Consensus, and Eras", file: "/l1-ecosystems/track-05-cardano/01-cardano-overview.md" },
      { title: "Cardano Development Environment Setup", file: "/l1-ecosystems/track-05-cardano/02-dev-environment-setup.md" },
      { title: "Plutus Language Fundamentals", file: "/l1-ecosystems/track-05-cardano/03-plutus-language-fundamentals.md" },
      { title: "Writing Your First Plutus Contract", file: "/l1-ecosystems/track-05-cardano/04-first-plutus-contract.md" },
      { title: "Native Tokens on Cardano", file: "/l1-ecosystems/track-05-cardano/05-native-tokens.md" },
      { title: "Cardano dApp Patterns", file: "/l1-ecosystems/track-05-cardano/06-dapp-patterns.md" },
      { title: "Preview Testnet Deployment", file: "/l1-ecosystems/track-05-cardano/07-testnet-deployment.md" }
    ]
  },
  {
    id: "l1-near-protocol",
    number: "Track 14",
    title: "NEAR Protocol Development",
    level: "Beginner → Intermediate",
    desc: "Build on NEAR — sharded architecture, Rust smart contracts, NEP token standards, and frontend integration with near-api-js.",
    posts: [
      { title: "NEAR Protocol: Architecture and Core Concepts", file: "/l1-ecosystems/track-06-near-protocol/01-near-overview.md" },
      { title: "NEAR Development Environment Setup", file: "/l1-ecosystems/track-06-near-protocol/02-dev-environment-setup.md" },
      { title: "Your First NEAR Smart Contract in Rust", file: "/l1-ecosystems/track-06-near-protocol/03-first-smart-contract.md" },
      { title: "NEAR Token Standards: NEP-141 and NEP-171", file: "/l1-ecosystems/track-06-near-protocol/04-token-standards.md" },
      { title: "Frontend Integration with near-api-js and Wallet Selector", file: "/l1-ecosystems/track-06-near-protocol/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-tron",
    number: "Track 15",
    title: "Tron Development",
    level: "Beginner → Intermediate",
    desc: "Build on Tron — DPoS consensus, TronBox smart contracts, TRC-20 tokens, energy/bandwidth resource model, and TronWeb frontend integration.",
    posts: [
      { title: "Tron: Architecture and Core Concepts", file: "/l1-ecosystems/track-07-tron/01-tron-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-07-tron/02-dev-environment-setup.md" },
      { title: "Your First Smart Contract: TRC-20 Token on Shasta", file: "/l1-ecosystems/track-07-tron/03-first-smart-contract.md" },
      { title: "Token Standards: TRC-20, TRC-721, and TRC-1155", file: "/l1-ecosystems/track-07-tron/04-token-standards.md" },
      { title: "Frontend Integration: TronLink and TronWeb", file: "/l1-ecosystems/track-07-tron/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-aptos",
    number: "Track 16",
    title: "Aptos Development",
    level: "Beginner → Intermediate",
    desc: "Build on Aptos — Block-STM parallel execution, Move smart contracts, resource model, and frontend integration with the Aptos TypeScript SDK.",
    posts: [
      { title: "Aptos: Block-STM Parallel Execution and Architecture", file: "/l1-ecosystems/track-08-aptos/01-aptos-overview.md" },
      { title: "Aptos Development Environment Setup", file: "/l1-ecosystems/track-08-aptos/02-dev-environment-setup.md" },
      { title: "Move Language Fundamentals", file: "/l1-ecosystems/track-08-aptos/03-move-language-fundamentals.md" },
      { title: "Write and Deploy Your First Move Module", file: "/l1-ecosystems/track-08-aptos/04-first-move-module.md" },
      { title: "Aptos Token Standards: Legacy Tokens and Digital Assets", file: "/l1-ecosystems/track-08-aptos/05-token-standards.md" },
      { title: "Move Advanced Patterns: Resource Accounts, Generics, and Events", file: "/l1-ecosystems/track-08-aptos/06-move-advanced-patterns.md" },
      { title: "Frontend Integration: Aptos TypeScript SDK and Petra Wallet", file: "/l1-ecosystems/track-08-aptos/07-frontend-integration.md" }
    ]
  },
  {
    id: "l1-sui",
    number: "Track 17",
    title: "Sui Development",
    level: "Beginner → Intermediate",
    desc: "Build on Sui — object-centric model, Sui Move smart contracts, and testnet deployment with parallel execution.",
    posts: [
      { title: "Sui Overview and Architecture", file: "/l1-ecosystems/track-09-sui/01-sui-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-09-sui/02-dev-environment-setup.md" },
      { title: "Sui Move Fundamentals", file: "/l1-ecosystems/track-09-sui/03-sui-move-fundamentals.md" },
      { title: "Write and Publish Your First Sui Module", file: "/l1-ecosystems/track-09-sui/04-first-sui-module.md" },
      { title: "Token Standards on Sui", file: "/l1-ecosystems/track-09-sui/05-token-standards.md" },
      { title: "Sui Move Advanced Patterns", file: "/l1-ecosystems/track-09-sui/06-sui-move-advanced.md" },
      { title: "Frontend Integration with Sui", file: "/l1-ecosystems/track-09-sui/07-frontend-integration.md" }
    ]
  },
  {
    id: "l1-xrp-ledger",
    number: "Track 18",
    title: "XRP Ledger Development",
    level: "Beginner → Intermediate",
    desc: "Build on XRP Ledger — federated consensus, payment channels, DEX, trust lines, and token issuance with xrpl.js.",
    posts: [
      { title: "XRP Ledger Overview and Architecture", file: "/l1-ecosystems/track-10-xrp-ledger/01-xrpl-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-10-xrp-ledger/02-dev-environment-setup.md" },
      { title: "Hooks and Custom Transactions", file: "/l1-ecosystems/track-10-xrp-ledger/03-hooks-custom-transactions.md" },
      { title: "Token Issuance on XRP Ledger", file: "/l1-ecosystems/track-10-xrp-ledger/04-token-issuance.md" },
      { title: "Frontend Integration with xrpl.js and Xaman Wallet", file: "/l1-ecosystems/track-10-xrp-ledger/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-hedera",
    number: "Track 19",
    title: "Hedera Development",
    level: "Beginner → Intermediate",
    desc: "Build on Hedera — Hashgraph consensus, Hedera Token Service, smart contracts, and SDK integration.",
    posts: [
      { title: "Hedera Overview and Hashgraph Consensus", file: "/l1-ecosystems/track-11-hedera/01-hedera-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-11-hedera/02-dev-environment-setup.md" },
      { title: "Smart Contracts on Hedera", file: "/l1-ecosystems/track-11-hedera/03-smart-contracts.md" },
      { title: "Hedera Token Service (HTS)", file: "/l1-ecosystems/track-11-hedera/04-token-service.md" },
      { title: "Frontend Integration with HashConnect", file: "/l1-ecosystems/track-11-hedera/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-stellar",
    number: "Track 20",
    title: "Stellar Development",
    level: "Beginner → Intermediate",
    desc: "Build on Stellar — Soroban smart contracts, asset issuance, and Horizon API integration.",
    posts: [
      { title: "Stellar Overview and Architecture", file: "/l1-ecosystems/track-12-stellar/01-stellar-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-12-stellar/02-dev-environment-setup.md" },
      { title: "Soroban Smart Contracts", file: "/l1-ecosystems/track-12-stellar/03-soroban-contracts.md" },
      { title: "Asset Issuance on Stellar", file: "/l1-ecosystems/track-12-stellar/04-asset-issuance.md" },
      { title: "Frontend Integration with Stellar SDK and Freighter Wallet", file: "/l1-ecosystems/track-12-stellar/05-frontend-integration.md" }
    ]
  },
  {
    id: "l1-ton",
    number: "Track 21",
    title: "TON Development",
    level: "Beginner → Intermediate",
    desc: "Build on TON — actor-model smart contracts, FunC programming, Jetton token standards, and frontend integration with TON Connect.",
    posts: [
      { title: "TON: Actor-Model Architecture and Infinite Sharding", file: "/l1-ecosystems/track-13-ton/01-ton-overview.md" },
      { title: "TON Development Environment Setup", file: "/l1-ecosystems/track-13-ton/02-dev-environment-setup.md" },
      { title: "FunC Language Fundamentals", file: "/l1-ecosystems/track-13-ton/03-func-language-fundamentals.md" },
      { title: "First FunC Contract: Counter with Testnet Deployment", file: "/l1-ecosystems/track-13-ton/04-first-func-contract.md" },
      { title: "Token Standards and Jettons on TON", file: "/l1-ecosystems/track-13-ton/05-token-standards.md" },
      { title: "FunC Advanced Patterns: Upgrades, Gas, and Multi-Message Workflows", file: "/l1-ecosystems/track-13-ton/06-func-advanced-patterns.md" },
      { title: "Frontend Integration with TON Connect", file: "/l1-ecosystems/track-13-ton/07-frontend-integration.md" }
    ]
  },
  {
    id: "l1-sei",
    number: "Track 22",
    title: "Sei Development",
    level: "Beginner → Intermediate",
    desc: "Build on Sei — parallelized EVM and CosmWasm dual execution, optimistic parallelization, token standards, and frontend integration with Sei's high-throughput architecture.",
    posts: [
      { title: "Sei: Architecture and Parallel Execution", file: "/l1-ecosystems/track-14-sei/01-sei-overview.md" },
      { title: "Development Environment Setup", file: "/l1-ecosystems/track-14-sei/02-dev-environment-setup.md" },
      { title: "CosmWasm and EVM Smart Contracts on Sei", file: "/l1-ecosystems/track-14-sei/03-cosmwasm-evm-contracts.md" },
      { title: "Token Standards and Asset Management on Sei", file: "/l1-ecosystems/track-14-sei/04-token-standards.md" },
      { title: "Frontend Integration: Wallets and dApp UI on Sei", file: "/l1-ecosystems/track-14-sei/05-frontend-integration.md" }
    ]
  },
  {
    id: "l2-arbitrum",
    number: "Track 23",
    title: "Arbitrum Development",
    level: "Intermediate",
    desc: "Build on Arbitrum — optimistic rollup architecture, bridging, Arbitrum SDK, and deployment with gas savings.",
    posts: [
      { title: "Arbitrum Architecture: How the Optimistic Rollup Works", file: "/ethereum-l2s/track-02-arbitrum/01-arbitrum-architecture.md" },
      { title: "Arbitrum vs Ethereum Mainnet: What's Different for Developers", file: "/ethereum-l2s/track-02-arbitrum/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Arbitrum: Deposits and Withdrawals", file: "/ethereum-l2s/track-02-arbitrum/03-bridging-assets.md" },
      { title: "Arbitrum Ecosystem Tooling: SDK, Explorers, and Developer Tools", file: "/ethereum-l2s/track-02-arbitrum/04-ecosystem-tooling.md" },
      { title: "Deploying to Arbitrum: Step-by-Step Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-02-arbitrum/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-optimism",
    number: "Track 24",
    title: "Optimism & OP Stack Development",
    level: "Intermediate",
    desc: "Build on Optimism — OP Stack architecture, bridging, ecosystem tooling, and deployment with gas comparison.",
    posts: [
      { title: "OP Stack Architecture: How Optimism Works Under the Hood", file: "/ethereum-l2s/track-03-optimism/01-op-stack-architecture.md" },
      { title: "Optimism vs Ethereum Mainnet: What's Different for Developers", file: "/ethereum-l2s/track-03-optimism/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Optimism: Deposits and Withdrawals", file: "/ethereum-l2s/track-03-optimism/03-bridging-assets.md" },
      { title: "Optimism Ecosystem Tooling: SDKs, Explorers, and Dev Tools", file: "/ethereum-l2s/track-03-optimism/04-ecosystem-tooling.md" },
      { title: "Deploying to Optimism: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-03-optimism/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-base",
    number: "Track 25",
    title: "Base Development",
    level: "Beginner → Intermediate",
    desc: "Build on Base — Coinbase's OP Stack L2 with low fees, high throughput, and seamless onchain tooling.",
    posts: [
      { title: "Base Architecture: Coinbase's OP Stack L2", file: "/ethereum-l2s/track-04-base/01-base-architecture.md" },
      { title: "Base vs Ethereum Mainnet: What's Different for Developers", file: "/ethereum-l2s/track-04-base/02-differences-from-mainnet.md" },
      { title: "Bridging Assets to and from Base", file: "/ethereum-l2s/track-04-base/03-bridging-assets.md" },
      { title: "Base Ecosystem Tooling", file: "/ethereum-l2s/track-04-base/04-ecosystem-tooling.md" },
      { title: "Deploying to Base: Complete Walkthrough", file: "/ethereum-l2s/track-04-base/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-zksync",
    number: "Track 26",
    title: "zkSync Era Development",
    level: "Intermediate → Advanced",
    desc: "Build on zkSync Era — zk-rollup architecture, Solidity deployment differences, bridging, and tooling with gas comparisons.",
    posts: [
      { title: "zkSync Era Architecture: How a ZK-Rollup Works", file: "/ethereum-l2s/track-05-zksync/01-zksync-era-architecture.md" },
      { title: "zkSync Era vs Ethereum Mainnet: What's Different", file: "/ethereum-l2s/track-05-zksync/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on zkSync Era", file: "/ethereum-l2s/track-05-zksync/03-bridging-assets.md" },
      { title: "zkSync Era Tooling and Development Environment", file: "/ethereum-l2s/track-05-zksync/04-ecosystem-tooling.md" },
      { title: "Deploying to zkSync Era: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-05-zksync/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-starknet",
    number: "Track 27",
    title: "Starknet Development",
    level: "Intermediate → Advanced",
    desc: "Build on Starknet — validity rollup architecture, Cairo smart contracts, bridging, and ecosystem tooling with gas comparisons.",
    posts: [
      { title: "Starknet Architecture: How a Validity Rollup Works", file: "/ethereum-l2s/track-06-starknet/01-starknet-architecture.md" },
      { title: "Starknet vs Ethereum: What Works Differently", file: "/ethereum-l2s/track-06-starknet/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Starknet: L1↔L2 Messaging", file: "/ethereum-l2s/track-06-starknet/03-bridging-assets.md" },
      { title: "Starknet Ecosystem Tooling: SDKs, CLI, and Dev Environment", file: "/ethereum-l2s/track-06-starknet/04-ecosystem-tooling.md" },
      { title: "Deploying to Starknet: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-06-starknet/05-deployment-walkthrough.md" },
      { title: "Cairo Language Fundamentals: Syntax, Types, and Ownership", file: "/ethereum-l2s/track-06-starknet/06-cairo-language-fundamentals.md" },
      { title: "Cairo Advanced Patterns: Components, Testing, and Production Contracts", file: "/ethereum-l2s/track-06-starknet/07-cairo-advanced-patterns.md" }
    ]
  },
  {
    id: "l2-linea",
    number: "Track 28",
    title: "Linea Development",
    level: "Intermediate → Advanced",
    desc: "Build on Linea — zk-rollup architecture, EVM equivalence, bridging, and deployment with gas comparisons.",
    posts: [
      { title: "Linea Architecture: A Type 2 zkEVM Rollup", file: "/ethereum-l2s/track-07-linea/01-linea-architecture.md" },
      { title: "Differences from Ethereum Mainnet on Linea", file: "/ethereum-l2s/track-07-linea/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Linea: L1↔L2 Deposits and Withdrawals", file: "/ethereum-l2s/track-07-linea/03-bridging-assets.md" },
      { title: "Linea Ecosystem Tooling: SDKs, Explorers, and Developer Tools", file: "/ethereum-l2s/track-07-linea/04-ecosystem-tooling.md" },
      { title: "Deploying to Linea: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-07-linea/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-polygon-zkevm",
    number: "Track 29",
    title: "Polygon zkEVM Development",
    level: "Intermediate",
    desc: "Build on Polygon zkEVM — Type 2 zk-rollup architecture, EVM equivalence, bridging, and deployment with gas comparisons.",
    posts: [
      { title: "Polygon zkEVM Architecture: How the Type 2 zkEVM Works", file: "/ethereum-l2s/track-08-polygon-zkevm/01-polygon-zkevm-architecture.md" },
      { title: "Polygon zkEVM vs Ethereum Mainnet: What's Different", file: "/ethereum-l2s/track-08-polygon-zkevm/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Polygon zkEVM", file: "/ethereum-l2s/track-08-polygon-zkevm/03-bridging-assets.md" },
      { title: "Polygon zkEVM Ecosystem Tooling", file: "/ethereum-l2s/track-08-polygon-zkevm/04-ecosystem-tooling.md" },
      { title: "Deploying to Polygon zkEVM: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-08-polygon-zkevm/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-mantle",
    number: "Track 30",
    title: "Mantle Network Development",
    level: "Intermediate",
    desc: "Build on Mantle — optimistic rollup with modular data availability, bridging, Mantle SDK, and deployment with gas savings.",
    posts: [
      { title: "Mantle Architecture: Optimistic Rollup with Modular Data Availability", file: "/ethereum-l2s/track-09-mantle/01-mantle-architecture.md" },
      { title: "Mantle vs Ethereum Mainnet: What's Different for Developers", file: "/ethereum-l2s/track-09-mantle/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Mantle: Deposits and Withdrawals", file: "/ethereum-l2s/track-09-mantle/03-bridging-assets.md" },
      { title: "Mantle Ecosystem Tooling: SDK, Explorers, and Developer Tools", file: "/ethereum-l2s/track-09-mantle/04-ecosystem-tooling.md" },
      { title: "Deploying to Mantle: Step-by-Step Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-09-mantle/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-immutable",
    number: "Track 31",
    title: "Immutable zkEVM Development",
    level: "Intermediate",
    desc: "Build on Immutable zkEVM — gaming-focused zk-rollup architecture, Immutable SDK, NFT minting, and deployment for web3 games.",
    posts: [
      { title: "Immutable zkEVM Architecture: A Gaming-Focused ZK-Rollup", file: "/ethereum-l2s/track-10-immutable/01-immutable-zkevm-architecture.md" },
      { title: "Differences from Ethereum Mainnet on Immutable zkEVM", file: "/ethereum-l2s/track-10-immutable/02-differences-from-mainnet.md" },
      { title: "Bridging Assets to and from Immutable zkEVM", file: "/ethereum-l2s/track-10-immutable/03-bridging-assets.md" },
      { title: "Immutable Gaming SDK and Tooling", file: "/ethereum-l2s/track-10-immutable/04-gaming-sdk-tooling.md" },
      { title: "Deploying to Immutable zkEVM: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-10-immutable/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-scroll",
    number: "Track 32",
    title: "Scroll Development",
    level: "Intermediate → Advanced",
    desc: "Build on Scroll — zkEVM architecture, bytecode-level EVM equivalence, bridging, and deployment with gas comparisons.",
    posts: [
      { title: "Scroll Architecture: A Type 1 zkEVM Rollup", file: "/ethereum-l2s/track-11-scroll/01-scroll-architecture.md" },
      { title: "Scroll vs Ethereum Mainnet: What's Different", file: "/ethereum-l2s/track-11-scroll/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Scroll: L1↔L2 Deposits and Withdrawals", file: "/ethereum-l2s/track-11-scroll/03-bridging-assets.md" },
      { title: "Scroll Ecosystem Tooling: SDKs, Explorers, and Dev Tools", file: "/ethereum-l2s/track-11-scroll/04-ecosystem-tooling.md" },
      { title: "Deploying to Scroll: Complete Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-11-scroll/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-blast",
    number: "Track 33",
    title: "Blast Development",
    level: "Intermediate",
    desc: "Build on Blast — optimistic rollup with native yield, auto-rebasing ETH/USDB, gas revenue sharing, and deployment.",
    posts: [
      { title: "Blast Architecture: The Optimistic Rollup with Native Yield", file: "/ethereum-l2s/track-12-blast/01-blast-architecture.md" },
      { title: "Blast vs Ethereum Mainnet: Key Differences for Developers", file: "/ethereum-l2s/track-12-blast/02-differences-from-mainnet.md" },
      { title: "Bridging Assets on Blast: Deposits and Withdrawals", file: "/ethereum-l2s/track-12-blast/03-bridging-assets.md" },
      { title: "Blast Ecosystem Tooling: SDKs, Explorers, and Developer Tools", file: "/ethereum-l2s/track-12-blast/04-ecosystem-tooling.md" },
      { title: "Deploying to Blast: Step-by-Step Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-12-blast/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "l2-mode",
    number: "Track 34",
    title: "Mode Network Development",
    level: "Intermediate",
    desc: "Build on Mode — OP Stack optimistic rollup with DeFi-native sequencer fee sharing, bridging, and deployment.",
    posts: [
      { title: "Mode Architecture: OP Stack L2 with Sequencer Fee Sharing", file: "/ethereum-l2s/track-13-mode/01-mode-architecture.md" },
      { title: "Mode vs Ethereum Mainnet: Key Differences for Developers", file: "/ethereum-l2s/track-13-mode/02-differences-from-mainnet.md" },
      { title: "Bridging Assets to and from Mode", file: "/ethereum-l2s/track-13-mode/03-bridging-assets.md" },
      { title: "Mode Ecosystem Tooling: SDKs, Explorers, and Developer Tools", file: "/ethereum-l2s/track-13-mode/04-ecosystem-tooling.md" },
      { title: "Deploying to Mode: Step-by-Step Walkthrough with Gas Comparison", file: "/ethereum-l2s/track-13-mode/05-deployment-walkthrough.md" }
    ]
  },
  {
    id: "cosmos-ibc",
    number: "Track 35",
    title: "Cosmos SDK & IBC Development",
    level: "Intermediate → Advanced",
    desc: "Build sovereign appchains with Cosmos SDK and connect them via IBC — modules, token transfers, custom packets, and interchain security.",
    posts: [
      { title: "Cosmos SDK Architecture: Building Sovereign Application Chains", file: "/cosmos-ibc/track-01-cosmos-ibc/01-cosmos-sdk-architecture.md" },
      { title: "IBC Protocol Mechanics: Cross-Chain Communication", file: "/cosmos-ibc/track-01-cosmos-ibc/02-ibc-protocol-mechanics.md" },
      { title: "Building a Custom Cosmos SDK Module", file: "/cosmos-ibc/track-01-cosmos-ibc/03-building-custom-module.md" },
      { title: "Osmosis, Neutron, and dYdX: Production Cosmos Patterns", file: "/cosmos-ibc/track-01-cosmos-ibc/04-osmosis-neutron-dydx.md" },
      { title: "Interchain Security: Shared Validator Sets", file: "/cosmos-ibc/track-01-cosmos-ibc/05-interchain-security.md" },
      { title: "Celestia DA Integration: Modular Data Availability for Cosmos Chains", file: "/cosmos-ibc/track-01-cosmos-ibc/06-celestia-da-integration.md" },
      { title: "Multi-Hop IBC Routing: Packet Forward Middleware", file: "/cosmos-ibc/track-01-cosmos-ibc/07-multi-hop-ibc-routing.md" }
    ]
  },
  {
    id: "polkadot-substrate",
    number: "Track 36",
    title: "Polkadot & Substrate Development",
    level: "Intermediate → Advanced",
    desc: "Build parachains with Substrate — pallets, FRAME macros, runtime configuration, XCM messaging, and Polkadot 2.0 coretime.",
    posts: [
      { title: "Polkadot Relay Chain Architecture: Shared Security for a Multi-Chain World", file: "/polkadot/track-01-polkadot-substrate/01-relay-chain-architecture.md" },
      { title: "Substrate Pallets and FRAME: Building Modular Blockchain Logic", file: "/polkadot/track-01-polkadot-substrate/02-substrate-pallets-frame.md" },
      { title: "Runtime Configuration: Composing Pallets into a Blockchain", file: "/polkadot/track-01-polkadot-substrate/03-runtime-configuration.md" },
      { title: "Building a Parachain: From Substrate Runtime to Polkadot-Connected Chain", file: "/polkadot/track-01-polkadot-substrate/04-building-a-parachain.md" },
      { title: "XCM Cross-Chain Messaging: Tokens and Remote Calls Between Parachains", file: "/polkadot/track-01-polkadot-substrate/05-xcm-cross-chain-messaging.md" },
      { title: "Polkadot 2.0 and Coretime: The New Economic Model", file: "/polkadot/track-01-polkadot-substrate/06-polkadot-2-coretime.md" }
    ]
  },
  {
    id: "bitcoin-l2s",
    number: "Track 37",
    title: "Bitcoin L2s and Sidechains",
    level: "Intermediate → Advanced",
    desc: "Build on Bitcoin L2s — Lightning Network, Stacks/Clarity smart contracts, Liquid Network, Rootstock EVM, and Merlin Chain.",
    posts: [
      { title: "Bitcoin Programmability: Beyond Simple Transfers", file: "/bitcoin-l2s/track-01-bitcoin-l2s/01-bitcoin-programmability-overview.md" },
      { title: "Lightning Network: Payment Channels from Scratch", file: "/bitcoin-l2s/track-01-bitcoin-l2s/02-lightning-network-channels.md" },
      { title: "Lightning Invoicing and Payment Routing", file: "/bitcoin-l2s/track-01-bitcoin-l2s/03-lightning-invoicing-routing.md" },
      { title: "Stacks and Clarity: Smart Contracts Anchored to Bitcoin", file: "/bitcoin-l2s/track-01-bitcoin-l2s/04-stacks-clarity-contracts.md" },
      { title: "Stacks Advanced: Maps, Traits, and Multi-Contract Architecture", file: "/bitcoin-l2s/track-01-bitcoin-l2s/05-stacks-advanced-patterns.md" },
      { title: "Liquid Network: Confidential Transactions and Issued Assets", file: "/bitcoin-l2s/track-01-bitcoin-l2s/06-liquid-network.md" },
      { title: "Rootstock: EVM Smart Contracts Secured by Bitcoin", file: "/bitcoin-l2s/track-01-bitcoin-l2s/07-rootstock-evm-deployment.md" },
      { title: "Merlin Chain: ZK-Rollup on Bitcoin", file: "/bitcoin-l2s/track-01-bitcoin-l2s/08-merlin-chain.md" }
    ]
  },
  {
    id: "modular-da-layers",
    number: "Track 38",
    title: "Modular Blockchain & Data Availability Layers",
    level: "Intermediate → Advanced",
    desc: "Understand modular blockchain architecture and integrate Celestia, EigenDA, and Avail for data availability.",
    posts: [
      { title: "Modular vs Monolithic Blockchains: The Architecture Shift", file: "/modular-da/track-01-modular-da-layers/01-modular-vs-monolithic.md" },
      { title: "Celestia DA Integration: Posting and Retrieving Data Blobs", file: "/modular-da/track-01-modular-da-layers/02-celestia-da-integration.md" },
      { title: "EigenDA and Restaking: Ethereum-Secured Data Availability", file: "/modular-da/track-01-modular-da-layers/03-eigenda-restaking.md" },
      { title: "Avail DA Layer: Validity-Proof Data Availability", file: "/modular-da/track-01-modular-da-layers/04-avail-da-layer.md" },
      { title: "DA Layer Comparison: Choosing the Right Data Availability Solution", file: "/modular-da/track-01-modular-da-layers/05-da-layer-comparison.md" }
    ]
  },
  {
    id: "appchain-frameworks",
    number: "Track 39",
    title: "Appchain Frameworks",
    level: "Intermediate → Advanced",
    desc: "Compare and deploy appchains — Cosmos SDK, OP Stack, Polygon CDK, Starknet, Saga, and Avalanche subnets from setup to running devnet.",
    posts: [
      { title: "Cosmos SDK Chain Creation: From Scaffold to Running Devnet", file: "/appchain-frameworks/track-01-appchain-frameworks/01-cosmos-sdk-chain-creation.md" },
      { title: "OP Stack Rollup Deployment: Launch Your Own L2 Chain", file: "/appchain-frameworks/track-01-appchain-frameworks/02-op-stack-rollup-deployment.md" },
      { title: "Polygon CDK: Deploy a ZK-Proven Rollup", file: "/appchain-frameworks/track-01-appchain-frameworks/03-polygon-cdk.md" },
      { title: "Starknet Appchains: Deploy a STARK-Proven Chain with Cairo", file: "/appchain-frameworks/track-01-appchain-frameworks/04-starknet-appchains.md" },
      { title: "Saga Chainlets: Launch a Dedicated Chain in Minutes", file: "/appchain-frameworks/track-01-appchain-frameworks/05-saga-chainlets.md" },
      { title: "Avalanche Subnets: Sub-Second Finality with Custom VMs", file: "/appchain-frameworks/track-01-appchain-frameworks/06-avalanche-subnets.md" }
    ]
  },
  {
    id: "frontend-engineering",
    number: "Track 40",
    title: "Web3 Frontend Engineering",
    level: "Intermediate",
    desc: "viem, wagmi, Next.js App Router, multicall, transaction UX, IPFS, and real-time data — building dApp frontends that don't fall over.",
    posts: [
      { title: "Ethers vs Viem vs Web3.js: Picking a Library in 2026", file: "/frontend-ux/track-02-web3-frontend-engineering/01-ethers-vs-viem-vs-web3js.md" },
      { title: "wagmi v2 + Viem: Hooks, Connectors, and Type Safety", file: "/frontend-ux/track-02-web3-frontend-engineering/02-wagmi-v2-viem-hooks.md" },
      { title: "Next.js App Router for dApps: SSR, RSC, and Wallet State Hydration", file: "/frontend-ux/track-02-web3-frontend-engineering/03-nextjs-app-router-dapps.md" },
      { title: "Reading Contract State: Multicall, Caching, and Subscriptions", file: "/frontend-ux/track-02-web3-frontend-engineering/04-multicall-caching-subscriptions.md" },
      { title: "Sending Transactions: UX Patterns for Pending, Mined, and Reverted States", file: "/frontend-ux/track-02-web3-frontend-engineering/05-transaction-ux-patterns.md" },
      { title: "IPFS for dApps: Pinning, Gateways, and Reliable NFT Metadata", file: "/frontend-ux/track-02-web3-frontend-engineering/06-ipfs-for-dapps.md" },
      { title: "Real-Time Data: WebSocket Subscriptions and Optimistic UI", file: "/frontend-ux/track-02-web3-frontend-engineering/07-realtime-websockets-optimistic-ui.md" }
    ]
  },
  {
    id: "account-abstraction",
    number: "Track 41",
    title: "Account Abstraction & Smart Wallets",
    level: "Intermediate → Advanced",
    desc: "ERC-4337 internals, paymasters, session keys, SIWE, passkeys, and EIP-7702 — the auth and tx layer that's quietly replacing EOAs.",
    posts: [
      { title: "ERC-4337 Architecture: UserOps, Bundlers, EntryPoint, Paymasters", file: "/frontend-ux/track-03-account-abstraction/01-erc4337-architecture.md" },
      { title: "Building a Smart Account from Scratch with Solidity", file: "/frontend-ux/track-03-account-abstraction/02-building-smart-account-solidity.md" },
      { title: "Paymaster Design: Sponsored Gas, ERC-20 Gas, and Rate Limiting", file: "/frontend-ux/track-03-account-abstraction/03-paymaster-design.md" },
      { title: "Session Keys and Permission Systems for dApps and Games", file: "/frontend-ux/track-03-account-abstraction/04-session-keys-permissions.md" },
      { title: "Sign-In With Ethereum (SIWE): Sessions, Nonces, and JWT Bridging", file: "/frontend-ux/track-03-account-abstraction/05-sign-in-with-ethereum.md" },
      { title: "Passkeys + WebAuthn for Smart Wallets", file: "/frontend-ux/track-03-account-abstraction/06-passkeys-webauthn-smart-wallets.md" },
      { title: "EIP-7702: Setting Code on EOAs", file: "/frontend-ux/track-03-account-abstraction/07-eip-7702-setting-code-on-eoas.md" }
    ]
  },
  {
    id: "ai-developer-tooling",
    number: "Track 42",
    title: "AI Developer Tooling: MCP, Skills & Subagents",
    level: "Intermediate",
    desc: "MCP servers, Claude Skills, custom subagents, and the agent toolchain — practical AI tooling for Web3 engineers in 2026.",
    posts: [
      { title: "MCP Explained: The Protocol Connecting AI to Your Tools", file: "/tooling-infra/track-03-ai-developer-tooling/01-mcp-protocol-explained.md" },
      { title: "Setting Up MCP Servers: Filesystem, Git, Databases, and the Standard Library", file: "/tooling-infra/track-03-ai-developer-tooling/02-setting-up-mcp-servers.md" },
      { title: "Web3-Specific MCP Servers: Etherscan, Alchemy, Foundry, and On-Chain Data", file: "/tooling-infra/track-03-ai-developer-tooling/03-web3-mcp-servers.md" },
      { title: "Building Your Own MCP Server", file: "/tooling-infra/track-03-ai-developer-tooling/04-building-your-own-mcp-server.md" },
      { title: "Claude Skills and Agent Skills: Packaging Reusable Capabilities", file: "/tooling-infra/track-03-ai-developer-tooling/05-claude-skills-and-agent-skills.md" },
      { title: "Subagents and Custom Agents: Delegating Specialized Work", file: "/tooling-infra/track-03-ai-developer-tooling/06-subagents-custom-agents.md" },
      { title: "AI-Augmented Web3 Workflows: Audits, Indexing, and Debugging", file: "/tooling-infra/track-03-ai-developer-tooling/07-ai-augmented-web3-workflows.md" }
    ]
  },
  {
    id: "nft-engineering",
    number: "Track 43",
    title: "NFT Engineering Beyond ERC-721",
    level: "Intermediate",
    desc: "Metadata standards, marketplaces, royalty enforcement, lazy minting, rentable NFTs, soulbound tokens, and on-chain art — the full stack of NFT primitives.",
    posts: [
      { title: "NFT Metadata Standards: Schema, IPFS, and Frozen URIs", file: "/defi/track-03-nft-engineering/01-nft-metadata-standards.md" },
      { title: "Building an NFT Marketplace: Listings, Bids, and Settlement", file: "/defi/track-03-nft-engineering/02-building-nft-marketplace.md" },
      { title: "EIP-2981 vs Royalty Registries: Enforcing Creator Royalties", file: "/defi/track-03-nft-engineering/03-eip-2981-royalty-enforcement.md" },
      { title: "Lazy Minting: Off-Chain Signatures, On-Chain Settlement", file: "/defi/track-03-nft-engineering/04-lazy-minting.md" },
      { title: "ERC-4907 Rentable NFTs and Other Useful Extensions", file: "/defi/track-03-nft-engineering/05-erc4907-rentable-nfts.md" },
      { title: "Soulbound Tokens and ERC-5192 Non-Transferable NFTs", file: "/defi/track-03-nft-engineering/06-soulbound-tokens.md" },
      { title: "Generative NFT Art: On-Chain SVGs and Reveal Mechanics", file: "/defi/track-03-nft-engineering/07-generative-onchain-svg.md" }
    ]
  },
  {
    id: "subgraph-development",
    number: "Track 44",
    title: "The Graph & Subgraph Development",
    level: "Intermediate",
    desc: "Manifest, schema, mappings, dynamic data sources, performance, decentralized network — building production indexers with The Graph.",
    posts: [
      { title: "Subgraph Anatomy: Manifest, Schema, and Mappings", file: "/tooling-infra/track-02-subgraph-development/01-subgraph-anatomy.md" },
      { title: "Writing Mappings in AssemblyScript: Event Handlers and Entities", file: "/tooling-infra/track-02-subgraph-development/02-writing-mappings-assemblyscript.md" },
      { title: "Modeling Time-Series and Cumulative Data in Subgraphs", file: "/tooling-infra/track-02-subgraph-development/03-time-series-cumulative-data.md" },
      { title: "Indexing Factory Patterns: Dynamic Data Sources", file: "/tooling-infra/track-02-subgraph-development/04-factory-patterns-dynamic-data-sources.md" },
      { title: "Subgraph Performance: Query Cost, Pagination, and Indexing Speed", file: "/tooling-infra/track-02-subgraph-development/05-subgraph-performance.md" },
      { title: "Hosted Service vs Decentralized Network: Cost and Tradeoffs", file: "/tooling-infra/track-02-subgraph-development/06-hosted-service-vs-decentralized-network.md" },
      { title: "Migrating from a Subgraph to a Custom Indexer", file: "/tooling-infra/track-02-subgraph-development/07-migrating-to-custom-indexer.md" }
    ]
  }
];
