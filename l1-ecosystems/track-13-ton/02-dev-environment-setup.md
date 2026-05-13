# TON Development Environment Setup

**Track:** TON Development
**Level:** Beginner
**Read time:** 10 min

---

## The Problem

You want to start building on TON but don't know which tools to install, how to configure testnet access, or how to get test tokens. TON has its own development stack — Blueprint for project scaffolding, the TON CLI for network interaction, and FunC/Tact as smart contract languages. This lesson gets your local environment ready so you can compile, test, and deploy contracts.

---

## Core Concepts

### Installing Node.js and Blueprint

Blueprint is TON's official project scaffolding and development framework (similar to Hardhat for Ethereum):

```shell
# Requires Node.js >= 18.0.0
node --version
```

```
Expected output:
v20.11.0
```

```shell
# Create a new TON project with Blueprint
npm create ton@0.20.0 -- my-ton-project --type func-empty --contractName Counter
```

```
Expected output:
Creating a new TON project in ./my-ton-project
✔ Project created successfully!

Next steps:
  cd my-ton-project
  npx blueprint build
  npx blueprint test
```

This creates the standard TON project structure:

```
my-ton-project/
├── contracts/           # FunC source files (.fc)
│   └── counter.fc
├── scripts/             # Deployment and interaction scripts
│   └── deployCounter.ts
├── tests/               # Jest test files
│   └── Counter.spec.ts
├── wrappers/            # TypeScript contract wrappers
│   └── Counter.ts
├── blueprint.config.ts  # Blueprint configuration
├── package.json
└── tsconfig.json
```

```shell
cd my-ton-project
npm install
```

### Installing TON CLI Tools

The `tonos-cli` and `ton` command-line tools interact with the network:

```shell
# Install TON development dependencies (included via Blueprint)
npm install --save-dev @ton/ton@14.0.0 @ton/core@0.57.0 @ton/crypto@3.3.0

# Install Blueprint globally for CLI access
npm install -g @ton/blueprint@0.20.0
```

```shell
# Verify Blueprint installation
npx blueprint --version
```

```
Expected output:
0.20.0
```

For direct network interaction, install the TON CLI:

```shell
# Install ton-cli via pip (Python 3.9+)
pip install ton-cli==0.5.0
```

```
Expected output:
Successfully installed ton-cli-0.5.0
```

```shell
# Verify installation
ton --version
```

```
Expected output:
ton-cli 0.5.0
```

### Setting Up a Testnet Wallet

TON wallets are smart contracts. The most common wallet version is v4r2:

```typescript
// scripts/createWallet.ts
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto@3.3.0";
import { WalletContractV4 } from "@ton/ton@14.0.0";
import { TonClient } from "@ton/ton@14.0.0";

async function createWallet() {
  // Generate a new 24-word mnemonic
  const mnemonic = await mnemonicNew(24);
  console.log("Mnemonic:", mnemonic.join(" "));

  // Derive keypair from mnemonic
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  // Create wallet contract instance (v4r2)
  const wallet = WalletContractV4.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });

  console.log("Address (raw):", wallet.address.toRawString());
  console.log("Address (friendly):", wallet.address.toString({
    bounceable: false,
    testOnly: true,
  }));

  // Save mnemonic securely — this is your private key!
  return { mnemonic, wallet };
}

createWallet().catch(console.error);
```

```shell
npx ts-node scripts/createWallet.ts
```

```
Expected output:
Mnemonic: word1 word2 word3 ... word24
Address (raw): 0:abc123...def456
Address (friendly): 0QBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG
```

### Funding Your Testnet Wallet

Use the official TON testnet faucet bot on Telegram:

1. Open Telegram and search for `@testgiver_ton_bot`
2. Send your testnet address (non-bounceable format starting with `0Q...`)
3. The bot sends 5 TON to your address

Alternative faucet URL: https://faucet.toncenter.com/

Last verified: 2025-01-15. For current faucet information, see https://docs.ton.org/develop/smart-contracts/environment/testnet

```typescript
// Verify balance after funding
import { TonClient } from "@ton/ton@14.0.0";
import { Address } from "@ton/core@0.57.0";

async function checkBalance() {
  const client = new TonClient({
    endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
    apiKey: "your-api-key", // Get free key at https://toncenter.com/
  });

  const balance = await client.getBalance(
    Address.parse("0QBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG")
  );

  console.log("Balance:", balance.toString(), "nanoTON");
  console.log("Balance:", Number(balance) / 1e9, "TON");
}

checkBalance().catch(console.error);
```

```
Expected output:
Balance: 5000000000 nanoTON
Balance: 5 TON
```

### Network Configuration

| Network | Endpoint | Explorer | Chain ID |
|---------|----------|----------|----------|
| Mainnet | https://toncenter.com/api/v2/jsonRPC | https://tonscan.org | -239 |
| Testnet | https://testnet.toncenter.com/api/v2/jsonRPC | https://testnet.tonscan.org | -3 |

Last verified: 2025-01-15. For current endpoints, see https://docs.ton.org/develop/dapps/apis/toncenter

### Compiling and Testing with Blueprint

```shell
# Compile FunC contracts
npx blueprint build
```

```
Expected output:
✔ Compiled successfully
Build artifacts written to build/Counter.compiled.json
```

```shell
# Run tests (uses sandbox — local TON emulator)
npx blueprint test
```

```
Expected output:
 PASS  tests/Counter.spec.ts
  Counter
    ✓ should deploy (245 ms)
    ✓ should increment counter (128 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

### Configuring Blueprint for Testnet Deployment

Update `blueprint.config.ts` for testnet:

```typescript
// blueprint.config.ts
import { Config } from "@ton/blueprint@0.20.0";

export const config: Config = {
  network: {
    endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
    type: "testnet",
    version: "v2",
    apiKey: process.env.TONCENTER_API_KEY,
  },
};
```

```shell
# Deploy to testnet
npx blueprint run deployCounter --testnet --tonconnect
```

---

## Common Pitfalls

1. **Not getting a TON Center API key** — The public endpoint has strict rate limits (1 request/second). Get a free API key at https://toncenter.com/ for development (10 requests/second). Without it, your deployment scripts will fail with 429 errors during rapid interactions.

2. **Confusing nanoTON and TON** — All SDK functions use nanoTON (1 TON = 10^9 nanoTON). Passing `1` to a transfer means 1 nanoTON (essentially nothing). Always use `toNano('1')` from `@ton/core` to convert human-readable amounts.

3. **Forgetting to deploy the wallet contract first** — Unlike Ethereum where EOAs exist by default, TON wallets are contracts that must be deployed. A freshly funded address has a balance but no deployed wallet code. The first outgoing transaction automatically deploys the wallet contract, but you must have sufficient balance (~0.05 TON for deployment gas).

4. **Using bounceable addresses for initial funding** — When funding a new wallet that hasn't been deployed yet, always use the non-bounceable address format (starts with `0Q` on testnet). Sending to a bounceable address of an undeployed contract will bounce the funds back.

---

## What to Learn Next

- [FunC Language Fundamentals](./03-func-language-fundamentals.md) — Learn FunC syntax, data types, and the cell-based storage model
- [Blueprint Documentation](https://github.com/ton-org/blueprint) — Official Blueprint framework docs
- [TON Center API](https://toncenter.com/) — API documentation and key registration
