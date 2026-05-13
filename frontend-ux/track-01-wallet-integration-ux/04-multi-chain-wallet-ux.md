# Multi-Chain Wallet UX: Handling Network Switching, Errors, and Edge Cases

**Track:** Intermediate  
**Read time:** 11 min

---

## The Problem

Your dApp supports Ethereum, Arbitrum, and Polygon. A user connects on Ethereum, tries to use a feature that only works on Arbitrum, and gets a cryptic error. Or they switch networks mid-session and your UI shows stale data. Or they're on a testnet and try to use mainnet contracts.

Multi-chain UX is where most dApps fall apart. The happy path is easy. The edge cases — wrong network, rejected network switch, stale state after chain change, unsupported wallet — are where users get confused and leave. This blog covers every edge case with production-ready patterns.

---

## Core Concepts

### The Network State Machine

A user's network state can be:
```
UNKNOWN → CONNECTED_WRONG_CHAIN → SWITCHING → CONNECTED_RIGHT_CHAIN
                                      ↓
                                  SWITCH_REJECTED
```

Your UI must handle every state explicitly. "Connected" is not enough — you need to know if they're connected to the right chain.

### Chain Detection Patterns

```typescript
// Pattern 1: Required chain (dApp only works on one chain)
if (chainId !== REQUIRED_CHAIN_ID) {
  return <SwitchNetworkPrompt />;
}

// Pattern 2: Supported chains (dApp works on multiple chains)
if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
  return <UnsupportedNetworkWarning />;
}

// Pattern 3: Feature-gated chains (some features only on some chains)
const isFeatureAvailable = FEATURE_CHAINS.includes(chainId);
```

### The Switch Network Flow

```
User on wrong chain
    ↓
Show "Switch to Arbitrum" button
    ↓
Call wallet_switchEthereumChain
    ↓
Three outcomes:
  1. Success → update UI
  2. Chain not added (error 4902) → call wallet_addEthereumChain → retry
  3. User rejected → show manual instructions
```

---

## Code Walkthrough

Production-grade multi-chain UX with wagmi:

```tsx
// src/hooks/useNetworkGuard.ts
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { arbitrum, mainnet, polygon } from "wagmi/chains";

export const SUPPORTED_CHAINS = [mainnet, arbitrum, polygon];
export const SUPPORTED_CHAIN_IDS = SUPPORTED_CHAINS.map((c) => c.id);

export type NetworkStatus =
  | "loading"
  | "disconnected"
  | "unsupported"
  | "supported";

export function useNetworkGuard() {
  const { isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const status: NetworkStatus = isConnecting
    ? "loading"
    : !isConnected
    ? "disconnected"
    : !SUPPORTED_CHAIN_IDS.includes(chainId)
    ? "unsupported"
    : "supported";

  const currentChain = SUPPORTED_CHAINS.find((c) => c.id === chainId);

  return {
    status,
    chainId,
    currentChain,
    isSwitching,
    switchError,
    switchToChain: (targetChainId: number) => switchChain({ chainId: targetChainId }),
    isSupported: status === "supported",
  };
}
```

```tsx
// src/components/NetworkGuard.tsx
import { useNetworkGuard, SUPPORTED_CHAINS } from "@/hooks/useNetworkGuard";
import { arbitrum } from "wagmi/chains";

interface NetworkGuardProps {
  requiredChainId?: number;
  children: React.ReactNode;
}

export function NetworkGuard({ requiredChainId, children }: NetworkGuardProps) {
  const { status, chainId, isSwitching, switchError, switchToChain } = useNetworkGuard();

  if (status === "loading") {
    return <div className="loading">Connecting...</div>;
  }

  if (status === "disconnected") {
    return <div className="connect-prompt">Please connect your wallet</div>;
  }

  if (status === "unsupported") {
    return (
      <div className="network-error">
        <h3>Unsupported Network</h3>
        <p>Please switch to one of the supported networks:</p>
        <div className="chain-list">
          {SUPPORTED_CHAINS.map((chain) => (
            <button
              key={chain.id}
              onClick={() => switchToChain(chain.id)}
              disabled={isSwitching}
            >
              {isSwitching ? "Switching..." : `Switch to ${chain.name}`}
            </button>
          ))}
        </div>
        {switchError && (
          <p className="error">
            {switchError.message.includes("rejected")
              ? "Switch rejected. Please switch manually in your wallet."
              : switchError.message}
          </p>
        )}
      </div>
    );
  }

  if (requiredChainId && chainId !== requiredChainId) {
    const requiredChain = SUPPORTED_CHAINS.find((c) => c.id === requiredChainId);
    return (
      <div className="wrong-network">
        <h3>Wrong Network</h3>
        <p>This feature requires {requiredChain?.name ?? `Chain ${requiredChainId}`}</p>
        <button
          onClick={() => switchToChain(requiredChainId)}
          disabled={isSwitching}
        >
          {isSwitching ? "Switching..." : `Switch to ${requiredChain?.name}`}
        </button>
        {switchError && (
          <p className="error">
            Switch failed. Please switch manually in your wallet.
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
```

```tsx
// src/components/TransactionButton.tsx — handles all tx states
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useState } from "react";

interface TransactionButtonProps {
  contractAddress: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  label: string;
  onSuccess?: (hash: string) => void;
}

export function TransactionButton({
  contractAddress,
  abi,
  functionName,
  args = [],
  value,
  label,
  onSuccess,
}: TransactionButtonProps) {
  const [userMessage, setUserMessage] = useState<string | null>(null);

  const {
    writeContract,
    data: txHash,
    isPending: isWalletPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    onReplaced: (replacement) => {
      // Transaction was replaced (speed up or cancel)
      console.log("Transaction replaced:", replacement);
    },
  });

  // Parse error messages for user-friendly display
  function getErrorMessage(error: Error | null): string | null {
    if (!error) return null;

    const msg = error.message.toLowerCase();

    if (msg.includes("user rejected") || msg.includes("user denied")) {
      return "Transaction rejected";
    }
    if (msg.includes("insufficient funds")) {
      return "Insufficient funds for gas";
    }
    if (msg.includes("nonce too low")) {
      return "Transaction conflict. Please try again.";
    }
    if (msg.includes("gas required exceeds allowance")) {
      return "Transaction would fail. Check your inputs.";
    }
    if (msg.includes("execution reverted")) {
      // Try to extract revert reason
      const revertMatch = error.message.match(/reason: (.+?)(?:\n|$)/);
      return revertMatch ? `Failed: ${revertMatch[1]}` : "Transaction failed";
    }

    return "Transaction failed. Please try again.";
  }

  const error = writeError || confirmError;
  const errorMessage = getErrorMessage(error as Error | null);

  function handleClick() {
    reset();
    setUserMessage(null);
    writeContract({ address: contractAddress, abi, functionName, args, value });
  }

  if (isConfirmed) {
    return (
      <div className="tx-success">
        <span>✓ {label} successful</span>
        <a
          href={`https://etherscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Etherscan
        </a>
        <button onClick={() => { reset(); onSuccess?.(txHash!); }}>Done</button>
      </div>
    );
  }

  return (
    <div className="tx-button-container">
      <button
        onClick={handleClick}
        disabled={isWalletPending || isConfirming}
        className={`tx-button ${isWalletPending || isConfirming ? "pending" : ""}`}
      >
        {isWalletPending
          ? "Confirm in wallet..."
          : isConfirming
          ? "Confirming..."
          : label}
      </button>

      {isWalletPending && (
        <p className="hint">Check your wallet for a confirmation request</p>
      )}

      {isConfirming && txHash && (
        <p className="hint">
          Transaction submitted.{" "}
          <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
            Track on Etherscan
          </a>
        </p>
      )}

      {errorMessage && (
        <p className="error">{errorMessage}</p>
      )}
    </div>
  );
}
```

```tsx
// src/components/ChainAwareBalance.tsx — handles stale data after chain switch
import { useAccount, useBalance, useChainId } from "wagmi";
import { useEffect, useState } from "react";

export function ChainAwareBalance() {
  const { address } = useAccount();
  const chainId = useChainId();
  const [prevChainId, setPrevChainId] = useState(chainId);
  const [isStale, setIsStale] = useState(false);

  const { data: balance, isLoading, refetch } = useBalance({ address });

  // Detect chain switch and mark data as stale
  useEffect(() => {
    if (chainId !== prevChainId) {
      setIsStale(true);
      setPrevChainId(chainId);
      // Refetch after a short delay (give RPC time to sync)
      setTimeout(() => {
        refetch();
        setIsStale(false);
      }, 1000);
    }
  }, [chainId, prevChainId, refetch]);

  if (isLoading || isStale) {
    return <span className="balance loading">Loading...</span>;
  }

  return (
    <span className="balance">
      {balance
        ? `${parseFloat(balance.formatted).toFixed(4)} ${balance.symbol}`
        : "—"}
    </span>
  );
}
```

---

## Common Mistakes and Gotchas

**1. Not handling the "chain not added" error (4902)**  
When you call `wallet_switchEthereumChain` for a chain the user hasn't added, you get error code 4902. You must then call `wallet_addEthereumChain`. Many dApps forget this and show a cryptic error instead.

**2. Not invalidating cached data after chain switch**  
wagmi caches contract reads. After a chain switch, the cache may contain data from the old chain. Always invalidate relevant queries after a chain switch using `queryClient.invalidateQueries()`.

**3. Showing the wrong block explorer link**  
Etherscan is for Ethereum mainnet. Arbitrum uses Arbiscan, Polygon uses Polygonscan. Always use the correct explorer for the current chain. wagmi's chain objects include `blockExplorers` for this.

**4. Not handling WalletConnect chain switching**  
WalletConnect wallets handle chain switching differently from injected wallets. Some mobile wallets don't support `wallet_switchEthereumChain` at all. Always provide a fallback: "Please switch to [chain] in your wallet manually."

**5. Assuming the user is on mainnet**  
Some users are on testnets (Sepolia, Goerli). If your contract addresses are mainnet-only, calls will fail silently or with confusing errors. Always validate the chain before making contract calls.

---

## How This Connects to Production

Uniswap's interface handles 10+ chains with seamless switching. When you switch from Ethereum to Arbitrum, it automatically updates all prices, balances, and contract addresses. Aave's interface shows a clear "Wrong Network" banner when you're on an unsupported chain. dYdX V4 is chain-specific (its own Cosmos chain) and handles the "not on our chain" case with a clear onboarding flow. The quality of multi-chain UX is increasingly a competitive differentiator — protocols that handle it well retain users, those that don't lose them to confusion.

---

## What to Learn Next

- **EIP-2771 Meta-Transactions: Gasless UX for Your dApp** — remove gas friction entirely.
- **Web3 Onboarding UX: Getting Non-Crypto Users into Your dApp** — reduce friction for new users.
- **MetaMask Integration with ethers.js and wagmi** — revisit the foundation with this deeper context.
