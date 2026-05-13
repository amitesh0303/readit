# Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp

**Track:** Intermediate  
**Read time:** 10 min

---

## The Problem

You've built a great dApp. Your crypto-native friends love it. But when you show it to a non-crypto friend, they hit a wall: "Install MetaMask? What's a seed phrase? I need ETH for gas? Why is this so complicated?"

The gap between Web2 and Web3 UX is real and it's costing protocols users. This blog covers the patterns that reduce friction: embedded wallets, social login, fiat on-ramps, and progressive disclosure. These aren't compromises on decentralization — they're bridges that bring users in.

---

## Core Concepts

### The Onboarding Friction Stack

```
Level 1: Install a wallet extension (MetaMask)
Level 2: Create a wallet (seed phrase, backup)
Level 3: Get ETH for gas (buy on exchange, transfer)
Level 4: Understand what they're signing
Level 5: Actually use your dApp
```

Most users drop off at Level 1 or 2. Your job is to reduce or eliminate as many levels as possible.

### Embedded Wallets: The Modern Solution

Embedded wallets (Privy, Dynamic, Magic) create a wallet for users using familiar auth methods (email, Google, Twitter) and store the private key in a secure enclave or MPC system. Users never see a seed phrase.

```
Traditional flow:
User → Install MetaMask → Create wallet → Buy ETH → Use dApp

Embedded wallet flow:
User → Sign in with Google → Wallet created automatically → Use dApp
```

The tradeoff: users trust the embedded wallet provider with key custody (or partial custody in MPC systems). This is a real centralization tradeoff — be transparent about it.

### Progressive Disclosure

Don't show everything at once. Start with the minimum needed to get value, reveal complexity as users need it.

```
Level 1 (no wallet): Browse, read, explore
Level 2 (embedded wallet): Sign in with email, basic interactions
Level 3 (self-custody): Connect MetaMask for full control
```

---

## Code Walkthrough

**Privy embedded wallet integration:**

```typescript
// src/config/privy.ts
import { PrivyProvider } from "@privy-io/react-auth";

export function PrivyConfig({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        // Login methods
        loginMethods: ["email", "google", "twitter", "wallet"],

        // Appearance
        appearance: {
          theme: "dark",
          accentColor: "#676FFF",
          logo: "https://yourapp.com/logo.png",
        },

        // Embedded wallet config
        embeddedWallets: {
          createOnLogin: "users-without-wallets", // auto-create for email/social users
          requireUserPasswordOnCreate: false,
          noPromptOnSignature: false, // always prompt for signatures
        },

        // Default chain
        defaultChain: {
          id: 42161, // Arbitrum
          name: "Arbitrum One",
          network: "arbitrum",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://arb1.arbitrum.io/rpc"] } },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

```tsx
// src/components/SmartLogin.tsx — progressive auth flow
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useState } from "react";

export function SmartLogin() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!ready) return <div>Loading...</div>;

  if (!authenticated) {
    return (
      <div className="login-container">
        <h2>Get Started</h2>

        {/* Primary: email/social (low friction) */}
        <button onClick={login} className="primary-login">
          Continue with Email or Google
        </button>

        {/* Secondary: wallet (for crypto-native users) */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="secondary-login"
        >
          {showAdvanced ? "Hide" : "Already have a wallet?"}
        </button>

        {showAdvanced && (
          <div className="wallet-options">
            <p>Connect MetaMask, Coinbase Wallet, or any WalletConnect wallet</p>
            <button onClick={login}>Connect Wallet</button>
          </div>
        )}
      </div>
    );
  }

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const externalWallet = wallets.find((w) => w.walletClientType !== "privy");

  return (
    <div className="user-info">
      <p>Welcome, {user?.email?.address ?? user?.twitter?.username ?? "User"}</p>

      {embeddedWallet && (
        <div className="wallet-info">
          <p>Your wallet: {embeddedWallet.address.slice(0, 6)}...{embeddedWallet.address.slice(-4)}</p>
          <p className="hint">
            This wallet was created for you. You can export it anytime.
          </p>
        </div>
      )}

      {/* Prompt to upgrade to self-custody */}
      {embeddedWallet && !externalWallet && (
        <div className="upgrade-prompt">
          <p>Want full control? Connect your own wallet.</p>
          <button onClick={login}>Connect MetaMask</button>
        </div>
      )}

      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

**Fiat on-ramp integration:**

```tsx
// src/components/FundWallet.tsx
import { usePrivy } from "@privy-io/react-auth";

export function FundWallet({ address }: { address: string }) {
  function openOnRamp(provider: "moonpay" | "transak" | "coinbase") {
    const urls = {
      moonpay: `https://buy.moonpay.com?walletAddress=${address}&currencyCode=eth`,
      transak: `https://global.transak.com?walletAddress=${address}&cryptoCurrencyCode=ETH`,
      coinbase: `https://pay.coinbase.com/buy/select-asset?destinationWallets=[{"address":"${address}","assets":["ETH"]}]`,
    };
    window.open(urls[provider], "_blank", "width=500,height=700");
  }

  return (
    <div className="fund-wallet">
      <h3>Add Funds</h3>
      <p>You need ETH to pay for transactions. Buy with a credit card:</p>

      <div className="onramp-options">
        <button onClick={() => openOnRamp("moonpay")}>
          Buy with MoonPay
        </button>
        <button onClick={() => openOnRamp("transak")}>
          Buy with Transak
        </button>
        <button onClick={() => openOnRamp("coinbase")}>
          Buy with Coinbase Pay
        </button>
      </div>

      <p className="hint">
        Or transfer ETH from an exchange like Coinbase or Binance.
      </p>
    </div>
  );
}
```

**Transaction explanation component:**

```tsx
// src/components/TransactionExplainer.tsx — explain what users are signing
interface TransactionExplainerProps {
  action: string;
  details: { label: string; value: string }[];
  risks?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function TransactionExplainer({
  action,
  details,
  risks,
  onConfirm,
  onCancel,
}: TransactionExplainerProps) {
  return (
    <div className="tx-explainer">
      <h3>You're about to: {action}</h3>

      <div className="tx-details">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-row">
            <span className="label">{label}</span>
            <span className="value">{value}</span>
          </div>
        ))}
      </div>

      {risks && risks.length > 0 && (
        <div className="risks">
          <h4>⚠️ Important</h4>
          <ul>
            {risks.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button onClick={onConfirm} className="confirm">
          Confirm in Wallet
        </button>
        <button onClick={onCancel} className="cancel">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Usage example
function SwapPage() {
  const [showExplainer, setShowExplainer] = useState(false);

  return showExplainer ? (
    <TransactionExplainer
      action="Swap 100 USDC for ETH"
      details={[
        { label: "You pay", value: "100 USDC" },
        { label: "You receive", value: "~0.048 ETH" },
        { label: "Price impact", value: "0.12%" },
        { label: "Network fee", value: "~$0.50" },
      ]}
      risks={[
        "The actual amount received may vary by up to 0.5% due to price changes",
        "This transaction cannot be reversed once confirmed",
      ]}
      onConfirm={() => { setShowExplainer(false); executeSwap(); }}
      onCancel={() => setShowExplainer(false)}
    />
  ) : (
    <button onClick={() => setShowExplainer(true)}>Swap</button>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Showing wallet addresses to non-crypto users**  
`0x742d35Cc6634C0532925a3b844Bc454e4438f44e` means nothing to a new user. Show ENS names when available, use avatars, and let users set display names. Treat the address as an internal identifier, not a user-facing one.

**2. Using crypto jargon without explanation**  
"Gas," "nonce," "slippage," "liquidity" — these are meaningless to new users. Either explain them inline or replace them with plain language. "Network fee" instead of "gas," "price tolerance" instead of "slippage."

**3. Not providing a "what is this?" explanation for every signature request**  
Users are trained to be suspicious of signature requests (and rightly so). Always explain what they're signing before they sign it. The `TransactionExplainer` component above is a good pattern.

**4. Requiring a wallet before showing any value**  
Let users explore your dApp without connecting a wallet. Show them what they can do, then ask them to connect when they want to take action. "Connect to see your balance" is better than a blank screen.

**5. Not handling the "no ETH for gas" case gracefully**  
When a user tries to submit a transaction but has no ETH, show a helpful message with options: buy ETH, use a fiat on-ramp, or use gasless transactions if available. Don't just show "insufficient funds."

---

## How This Connects to Production

Coinbase Wallet uses embedded wallet technology to let users create wallets with just an email. Privy powers the wallet infrastructure for many consumer dApps. Magic.link provides similar functionality. OpenSea integrates MoonPay for fiat on-ramps directly in their interface. The trend is clear: the best-performing consumer dApps are those that minimize crypto-specific friction while maintaining the core value proposition of decentralization. The protocols that figure out onboarding will win the next wave of users.

---

## What to Learn Next

- **EIP-2771 Meta-Transactions: Gasless UX for Your dApp** — remove gas friction entirely.
- **Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases** — handle the full wallet UX stack.
- **MetaMask Integration with ethers.js and wagmi** — the foundation for all wallet integrations.
