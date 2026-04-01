// All blog posts — ordered newest first
const BLOG_POSTS = [
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
      { title: "What is a Blockchain? Blocks, Nodes, Consensus Explained Simply", file: "/track-1-blockchain-fundamentals/01-what-is-a-blockchain.md" },
      { title: "Public/Private Keys, Wallets, and How Transactions Actually Work", file: "/track-1-blockchain-fundamentals/02-public-private-keys-wallets-transactions.md" },
      { title: "Gas Fees Explained: Why Does Ethereum Cost So Much?", file: "/track-1-blockchain-fundamentals/03-gas-fees-explained.md" },
      { title: "EVM vs Non-EVM Chains: What's the Difference and Why It Matters", file: "/track-1-blockchain-fundamentals/04-evm-vs-non-evm-chains.md" },
      { title: "What is a Smart Contract? A Plain English Guide", file: "/track-1-blockchain-fundamentals/05-what-is-a-smart-contract.md" },
      { title: "Testnets vs Mainnets: Where Developers Practice Before Going Live", file: "/track-1-blockchain-fundamentals/06-testnets-vs-mainnets.md" },
      { title: "RPC Nodes Explained: How Your dApp Talks to the Blockchain", file: "/track-1-blockchain-fundamentals/07-rpc-nodes-explained.md" }
    ]
  },
  {
    id: "track-2",
    number: "Track 02",
    title: "Solidity & EVM Smart Contracts",
    level: "Beginner → Intermediate",
    desc: "From your first contract to production-grade Solidity — tokens, NFTs, security, gas optimization, and testing.",
    posts: [
      { title: "Your First Solidity Smart Contract: Hello World to Token in 30 Minutes", file: "/track-2-solidity-evm/01-first-solidity-contract.md" },
      { title: "Solidity Data Types, Storage vs Memory vs Calldata — Deep Dive", file: "/track-2-solidity-evm/02-solidity-data-types-storage-memory-calldata.md" },
      { title: "ERC-20 Standard: Building a Token from Scratch", file: "/track-2-solidity-evm/03-erc20-token-from-scratch.md" },
      { title: "ERC-721 Standard: Building an NFT from Scratch", file: "/track-2-solidity-evm/04-erc721-nft-from-scratch.md" },
      { title: "ERC-1155: Multi-Token Standard and When to Use It", file: "/track-2-solidity-evm/05-erc1155-multi-token-standard.md" },
      { title: "Access Control in Solidity: Ownable, Roles, and Multi-Sig", file: "/track-2-solidity-evm/06-access-control-ownable-roles-multisig.md" },
      { title: "Events and Logs: How Frontends Listen to Smart Contracts", file: "/track-2-solidity-evm/07-events-and-logs.md" },
      { title: "Solidity Security 101: Re-entrancy, Integer Overflow, and Front-Running", file: "/track-2-solidity-evm/08-solidity-security-101.md" },
      { title: "Gas Optimization Patterns Every Solidity Dev Should Know", file: "/track-2-solidity-evm/09-gas-optimization-patterns.md" },
      { title: "Hardhat vs Foundry: Which Testing Framework Should You Use?", file: "/track-2-solidity-evm/10-hardhat-vs-foundry.md" }
    ]
  },
  {
    id: "track-3",
    number: "Track 03",
    title: "DeFi Protocols",
    level: "Intermediate",
    desc: "AMMs, lending, oracles, flash loans, and staking — how DeFi actually works under the hood.",
    posts: [
      { title: "What is DeFi? Lending, Borrowing, and Yield Explained", file: "/track-3-defi-protocols/01-what-is-defi.md" },
      { title: "How AMMs Work: The Math Behind Uniswap's x*y=k", file: "/track-3-defi-protocols/02-how-amms-work-uniswap-xy-k.md" },
      { title: "Constant Product vs Constant Sum Market Makers: Tradeoffs", file: "/track-3-defi-protocols/03-constant-product-vs-constant-sum.md" },
      { title: "Liquidity Pools, Impermanent Loss, and LP Token Mechanics", file: "/track-3-defi-protocols/04-liquidity-pools-impermanent-loss.md" },
      { title: "How DeFi Lending Works: Collateral, Health Factor, and Liquidations", file: "/track-3-defi-protocols/05-defi-lending-collateral-health-factor-liquidations.md" },
      { title: "Chainlink Oracles: Why Price Feeds Are Critical (and Can Be Attacked)", file: "/track-3-defi-protocols/06-chainlink-oracles.md" },
      { title: "Flash Loans: How They Work and How They're Exploited", file: "/track-3-defi-protocols/07-flash-loans.md" },
      { title: "Token Vesting and Staking Contracts: Architecture and Patterns", file: "/track-3-defi-protocols/08-token-vesting-and-staking.md" }
    ]
  },
  {
    id: "track-4",
    number: "Track 04",
    title: "Solana Development",
    level: "Beginner → Intermediate",
    desc: "The account model, PDAs, Anchor, CPIs, and SPL tokens — everything you need to build on Solana.",
    posts: [
      { title: "Solana vs Ethereum: A Developer's Comparison", file: "/track-4-solana-development/01-solana-vs-ethereum.md" },
      { title: "Solana's Account Model Explained (vs EVM Storage Model)", file: "/track-4-solana-development/02-solana-account-model.md" },
      { title: "What are PDAs (Program Derived Addresses)? Solana's Most Important Concept", file: "/track-4-solana-development/03-pdas-program-derived-addresses.md" },
      { title: "Getting Started with Anchor: Your First Solana Program", file: "/track-4-solana-development/04-getting-started-with-anchor.md" },
      { title: "Cross-Program Invocations (CPIs): How Solana Programs Call Each Other", file: "/track-4-solana-development/05-cross-program-invocations.md" },
      { title: "Solana Transaction Anatomy: Instructions, Signers, and Compute Units", file: "/track-4-solana-development/06-solana-transaction-anatomy.md" },
      { title: "Phantom Wallet Integration: Connecting Solana dApps to Users", file: "/track-4-solana-development/07-phantom-wallet-integration.md" },
      { title: "Solana Token Program and SPL Tokens: The Equivalent of ERC-20", file: "/track-4-solana-development/08-solana-token-program-spl-tokens.md" }
    ]
  },
  {
    id: "track-5",
    number: "Track 05",
    title: "Advanced Solana",
    level: "Expert",
    desc: "Geyser streaming, custom indexers, vAMMs, funding rates, keeper bots, and Pyth oracles.",
    posts: [
      { title: "Geyser Plugin Deep Dive: How to Stream Real-Time Solana Data", file: "/track-5-advanced-solana/01-geyser-plugin-deep-dive.md" },
      { title: "Building a Solana Indexer from Scratch with Node.js and PostgreSQL", file: "/track-5-advanced-solana/02-solana-indexer-nodejs-postgresql.md" },
      { title: "vAMM Architecture: How Perpetual DEXes Price Without an Orderbook", file: "/track-5-advanced-solana/03-vamm-architecture-perpetual-dexes.md" },
      { title: "Funding Rate Mechanics in Perpetual Futures: The Math and Implementation", file: "/track-5-advanced-solana/04-funding-rate-mechanics.md" },
      { title: "Keeper Bots on Solana: Architecture, Uptime, and Liquidation Logic", file: "/track-5-advanced-solana/05-keeper-bots-solana.md" },
      { title: "Pyth Network Oracle Integration: Real-Time Price Feeds on Solana", file: "/track-5-advanced-solana/06-pyth-network-oracle-integration.md" },
      { title: "Cross-Margin vs Isolated Margin in On-Chain Perpetuals", file: "/track-5-advanced-solana/07-cross-margin-vs-isolated-margin.md" }
    ]
  },
  {
    id: "track-6",
    number: "Track 06",
    title: "Zero-Knowledge Proofs",
    level: "Intermediate → Expert",
    desc: "SNARKs, STARKs, Circom circuits, trusted setups, on-chain verification, and building a privacy mixer.",
    posts: [
      { title: "ZK Proofs Explained Without the Math: What They Are and Why They Matter", file: "/track-6-zero-knowledge-proofs/01-zk-proofs-explained.md" },
      { title: "SNARKs vs STARKs: Key Differences for Developers", file: "/track-6-zero-knowledge-proofs/02-snarks-vs-starks.md" },
      { title: "Getting Started with Circom: Writing Your First ZK Circuit", file: "/track-6-zero-knowledge-proofs/03-getting-started-with-circom.md" },
      { title: "SnarkJS and Trusted Setup Ceremonies: How They Work and Why They Matter", file: "/track-6-zero-knowledge-proofs/04-snarkjs-trusted-setup.md" },
      { title: "On-Chain Proof Verification in Solidity: Gas Costs and Optimization", file: "/track-6-zero-knowledge-proofs/05-on-chain-proof-verification-solidity.md" },
      { title: "Poseidon Hash vs Keccak256: Why ZK Circuits Need Different Hash Functions", file: "/track-6-zero-knowledge-proofs/06-poseidon-hash-vs-keccak256.md" },
      { title: "Incremental Merkle Trees: The Data Structure Powering Privacy Protocols", file: "/track-6-zero-knowledge-proofs/07-incremental-merkle-trees.md" },
      { title: "Building a Privacy Mixer: Deposit, Withdraw, and Note Management", file: "/track-6-zero-knowledge-proofs/08-building-a-privacy-mixer.md" }
    ]
  },
  {
    id: "track-7",
    number: "Track 07",
    title: "Wallet Integration & UX",
    level: "Intermediate",
    desc: "MetaMask, WalletConnect, Phantom, multi-chain UX, meta-transactions, and onboarding non-crypto users.",
    posts: [
      { title: "MetaMask Integration with ethers.js and wagmi: A Complete Guide", file: "/track-7-wallet-integration-ux/01-metamask-ethers-wagmi.md" },
      { title: "WalletConnect v2: Multi-Chain Wallet Support for dApps", file: "/track-7-wallet-integration-ux/02-walletconnect-v2.md" },
      { title: "Phantom Wallet Integration on Solana: Sign Transactions and Send SOL", file: "/track-7-wallet-integration-ux/03-phantom-wallet-solana-integration.md" },
      { title: "Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases", file: "/track-7-wallet-integration-ux/04-multi-chain-wallet-ux.md" },
      { title: "EIP-2771 Meta-Transactions: Gasless UX for Your dApp", file: "/track-7-wallet-integration-ux/05-eip2771-meta-transactions.md" },
      { title: "Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp", file: "/track-7-wallet-integration-ux/06-web3-onboarding-ux.md" }
    ]
  },
  {
    id: "track-8",
    number: "Track 08",
    title: "L2s, Rollups & Cross-Chain",
    level: "Intermediate → Expert",
    desc: "Optimistic vs ZK rollups, Arbitrum, Polygon, deploying to L2s, bridges, and modular blockchain stacks.",
    posts: [
      { title: "Ethereum L2s Explained: Optimistic vs ZK Rollups", file: "/track-8-l2s-rollups-crosschain/01-ethereum-l2s-explained.md" },
      { title: "Arbitrum Deep Dive: Architecture and What Developers Need to Know", file: "/track-8-l2s-rollups-crosschain/02-arbitrum-deep-dive.md" },
      { title: "Polygon Architecture: From PoS Chain to zkEVM", file: "/track-8-l2s-rollups-crosschain/03-polygon-architecture.md" },
      { title: "Deploying to Arbitrum: What's Different from Ethereum Mainnet", file: "/track-8-l2s-rollups-crosschain/04-deploying-to-arbitrum.md" },
      { title: "Cross-Chain Bridges: How They Work and Where They Break", file: "/track-8-l2s-rollups-crosschain/05-cross-chain-bridges.md" },
      { title: "What is Caldera? Customizable Rollups and the Modular Blockchain Stack", file: "/track-8-l2s-rollups-crosschain/06-what-is-caldera.md" }
    ]
  },
  {
    id: "track-9",
    number: "Track 09",
    title: "Security & Auditing",
    level: "Intermediate → Expert",
    desc: "Audit process, Slither, Echidna, working with auditors, and the top 10 vulnerability classes.",
    posts: [
      { title: "Smart Contract Audit Process: What Auditors Actually Look For", file: "/track-9-security-auditing/01-smart-contract-audit-process.md" },
      { title: "Slither: Automated Static Analysis for Solidity Contracts", file: "/track-9-security-auditing/02-slither-static-analysis.md" },
      { title: "Echidna: Property-Based Fuzzing for Smart Contracts", file: "/track-9-security-auditing/03-echidna-fuzzing.md" },
      { title: "Working with Auditors: Lessons from a Trail of Bits Collaboration", file: "/track-9-security-auditing/04-working-with-auditors.md" },
      { title: "Top 10 Smart Contract Vulnerabilities and How to Prevent Them", file: "/track-9-security-auditing/05-top-10-smart-contract-vulnerabilities.md" }
    ]
  },
  {
    id: "track-10",
    number: "Track 10",
    title: "Infrastructure & DevOps for Web3",
    level: "Intermediate",
    desc: "RPC providers, Tenderly, GraphQL APIs, The Graph, and deploying Node.js indexers on AWS.",
    posts: [
      { title: "Alchemy vs Infura vs Self-Hosted Nodes: Which RPC Provider Should You Use?", file: "/track-10-infrastructure-devops/01-alchemy-vs-infura-vs-self-hosted.md" },
      { title: "Tenderly: Debugging and Simulating Transactions Like a Pro", file: "/track-10-infrastructure-devops/02-tenderly-debugging-simulating.md" },
      { title: "GraphQL for Blockchain Data: Building Flexible Query APIs", file: "/track-10-infrastructure-devops/03-graphql-for-blockchain-data.md" },
      { title: "The Graph Protocol vs Custom Indexers: When to Use Each", file: "/track-10-infrastructure-devops/04-the-graph-vs-custom-indexers.md" },
      { title: "Docker + AWS for Web3 Backend: Deploying Node.js Indexers at Scale", file: "/track-10-infrastructure-devops/05-docker-aws-web3-backend.md" }
    ]
  }
];
