# Next.js App Router for dApps: SSR, RSC, and Wallet State Hydration

**Track:** Intermediate
**Read time:** 9 min

---

## The Problem

Next.js 13+ shipped the App Router and React Server Components, and the entire "default Next.js dApp" pattern broke. The old pages-router examples — `_app.tsx`, `getServerSideProps`, client-only providers — are not how you build a Next.js app in 2026. But Web3 hooks like wagmi are inherently client-side: they need a wallet provider, browser APIs, and state that lives across navigations.

That tension — Server Components want to render on the server with no client state, Web3 hooks want a connected wallet in the browser — is what this lesson is about. Done wrong, you ship hydration mismatches, flashes of "not connected" state, or worse, a ServerSideRendering that calls a wallet API and crashes.

---

## Core Concepts

### Server Components vs Client Components, fast version

In the App Router:

- **Server Components** (the default) render on the server. They cannot use hooks (`useState`, `useEffect`, `useReadContract`), cannot access browser APIs, and the result is sent to the browser as serialized HTML + RSC payload.
- **Client Components** (marked with `"use client"` at the top of the file) render in the browser. They behave like regular React components.

For Web3, almost everything you write that *uses a hook* is a Client Component. wagmi cannot work in a Server Component because it needs the browser's wallet provider and a stateful React context.

### Where the providers go

The providers (`WagmiProvider`, `QueryClientProvider`, optionally `RainbowKitProvider`) must be in a Client Component. The trick is to wrap them once at the app boundary and let everything else stay as-is. The pattern:

```tsx
// app/providers.tsx
"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { config } from "@/lib/wagmi.config";

export function Providers({ children }: { children: React.ReactNode }) {
  // QueryClient must be created lazily to avoid hydration issues
  // with multiple instances during SSR
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
```

```tsx
// app/layout.tsx — this stays a Server Component
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Notice `layout.tsx` stays a Server Component. It just imports the client `Providers` component. Server Components can render Client Components — they can't *use* client features themselves.

### The hydration mismatch trap

If you `useAccount()` and render different content based on `isConnected`, you'll see this in the console on first load:

```
Hydration failed because the initial UI does not match what was rendered on the server.
```

What's happening: the server-rendered HTML knows nothing about the user's wallet, so it renders "Not connected." Then on the client, wagmi reads `localStorage` for a previously connected session and re-renders with "0xAlice connected." The two snapshots disagree. React's hydration crashes.

Three fixes:

1. **Mount-gating**: render nothing wallet-related until after hydration finishes.
2. **SSR cookies**: use wagmi's `cookieStorage` and pass the initial state into the config so server and client agree.
3. **`suppressHydrationWarning`**: only for tiny leaf cases, not as a general fix.

The mount-gate is the simplest and what most dApps use:

```tsx
"use client";
import { useEffect, useState } from "react";

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}
```

Wrap any wallet-aware component in `<ClientOnly>` and the SSR pass renders nothing for it; the browser renders it after the wallet state is known. Trade-off: a brief flicker before the connect button appears.

### Cookie-based SSR for serious dApps

If you actually want server-rendered content that reflects the wallet state (for SEO, faster first-paint, or per-user UI), wagmi v2 supports cookie storage:

```typescript
// lib/wagmi.config.ts
import { http, cookieStorage, createConfig, createStorage } from "wagmi";
import { mainnet, base } from "wagmi/chains";

export function getConfig() {
  return createConfig({
    chains: [mainnet, base],
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [mainnet.id]: http(),
      [base.id]: http(),
    },
  });
}
```

In your root layout, read the cookie and pass it down:

```tsx
// app/layout.tsx
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { getConfig } from "@/lib/wagmi.config";
import { Providers } from "./providers";

export default async function RootLayout({ children }: Props) {
  const cookie = (await headers()).get("cookie");
  const initialState = cookieToInitialState(getConfig(), cookie);
  return (
    <html>
      <body>
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
```

```tsx
// app/providers.tsx
"use client";
import { type State, WagmiProvider } from "wagmi";
import { getConfig } from "@/lib/wagmi.config";

export function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState: State | undefined;
}) {
  const [config] = useState(() => getConfig());
  return (
    <WagmiProvider config={config} initialState={initialState}>
      {/* QueryClientProvider, etc. */}
    </WagmiProvider>
  );
}
```

Now the server renders with the user's connected address (or unconnected state) reflected in the wagmi state. No hydration mismatch.

### When to use Server Components for Web3

Server Components are useful for *public* on-chain data: token prices, TVL, leaderboards, NFT collection metadata. Things you'd render the same regardless of who's viewing.

```tsx
// app/token/[address]/page.tsx — Server Component
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

export default async function TokenPage({ params }: { params: { address: string } }) {
  const client = createPublicClient({ chain: mainnet, transport: http() });
  const totalSupply = await client.readContract({
    address: params.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "totalSupply",
  });

  return <h1>Total supply: {totalSupply.toString()}</h1>;
}
```

This runs once on the server, sends the rendered HTML to the browser, and never re-runs unless you revalidate. Combined with Next.js's caching, it's a powerful way to cut down RPC calls for public data.

---

## Code Walkthrough

A realistic split: server-rendered token metadata, client-rendered user balance and approve button.

```tsx
// app/token/[address]/page.tsx (Server Component)
import { TokenHeader } from "./TokenHeader";
import { UserPanel } from "./UserPanel";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

export const revalidate = 60; // re-render server side every 60s max

export default async function TokenPage({ params }: { params: { address: string } }) {
  const client = createPublicClient({ chain: mainnet, transport: http() });
  const [name, symbol, supply] = await Promise.all([
    client.readContract({ address: params.address as any, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: params.address as any, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: params.address as any, abi: erc20Abi, functionName: "totalSupply" }),
  ]);

  return (
    <main>
      {/* Server-rendered: same for everyone, cached */}
      <TokenHeader name={name} symbol={symbol} supply={supply.toString()} />

      {/* Client-rendered: depends on connected wallet */}
      <UserPanel tokenAddress={params.address} />
    </main>
  );
}
```

```tsx
// app/token/[address]/UserPanel.tsx (Client Component)
"use client";
import { useAccount, useReadContract } from "wagmi";

export function UserPanel({ tokenAddress }: { tokenAddress: string }) {
  const { address } = useAccount();
  const { data: balance } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (!address) return <button>Connect wallet to see balance</button>;
  return <div>Your balance: {balance?.toString() ?? "…"}</div>;
}
```

This is the right shape: public data fetched on the server (cached, fast, SEO-friendly), user-specific state on the client (interactive, wallet-aware). Both compose cleanly in the same page.

---

## Common Mistakes and Gotchas

**1. Forgetting `"use client"` and getting the wrong error message**
Without `"use client"` at the top of a file that uses hooks, you get "you're importing a component that needs `useState`. It only works in a Client Component." The fix is a one-line directive at the top.

**2. Importing client code from server code by accident**
A Server Component that imports your `Providers` (or anything else with `"use client"`) is fine — Next.js handles the boundary. But importing a Server Component into a Client Component is *not* allowed and will fail at build time. The arrow only goes one way.

**3. Treating `localStorage` as available everywhere**
SSR runs in Node. There's no `localStorage`, no `window`, no `document`. If your wagmi connector or provider config touches these at module load, you get build errors. Use `typeof window !== 'undefined'` guards or move the access inside `useEffect`.

**4. Querying on-chain data in a Server Component without RPC env vars**
Server Components run on the server, which means in production they hit your `NEXT_PUBLIC_RPC` from server-side. If you've only set the public env var in the browser bundle but not on the server (e.g. you used a non-NEXT_PUBLIC variable name), the server will fail. Set RPC URLs as both server-side and `NEXT_PUBLIC_` if you need both.

**5. Not setting `revalidate` for Server Components fetching on-chain data**
Without `revalidate`, your page is statically cached *forever*. The "total supply" you fetched at build time will never update. Either set `export const revalidate = N` or use `dynamic = 'force-dynamic'` if you want every request to re-fetch.

**6. Using SSR cookies without HTTPS in production**
Cookie-based wagmi storage uses cookies. Cookies in production should be `Secure` and `SameSite`. wagmi handles defaults, but if you're behind an HTTP-only reverse proxy or running in a hybrid setup, the cookie flow can silently fail. Inspect the `Set-Cookie` headers when debugging.

---

## How This Connects to Production

Most production dApps in 2026 use a hybrid approach: Server Components for marketing pages, public dashboards, and SEO-critical content; Client Components for the actual app. This split-rendering model is the reason teams care about it — a "swap page" can have its hero section, token list, and links rendered on the server (fast, cached, indexable), while the actual swap UI is a Client Component island.

The other production reason: Server Components let you keep RPC keys server-side. If you fetch on-chain data in a Server Component, the request goes from your server to Alchemy, never from the user's browser. That means you don't have to expose your API key to the client and you can rate-limit and cache at the edge.

---

## What to Learn Next

- **Reading Contract State: Multicall, Caching, and Subscriptions** — once you've got the rendering boundary right, optimize the actual data layer.
- **Real-Time Data: WebSocket Subscriptions and Optimistic UI** — keeping client components fresh without polling RPC every five seconds.
- **Sending Transactions: UX Patterns for Pending, Mined, and Reverted States** — write flows are the area where good UX matters most.
