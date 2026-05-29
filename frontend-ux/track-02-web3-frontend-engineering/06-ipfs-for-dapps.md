# IPFS for dApps: Pinning, Gateways, and Reliable NFT Metadata

**Track:** Intermediate
**Read time:** 8 min

---

## The Problem

You mint an NFT. The image is "on IPFS." Six months later, the image 404s. The contract is fine, the chain is fine, but the artwork your collection sold for ETH is unreachable. This happens *constantly*. The IPFS-on-public-gateways failure mode is one of the most embarrassing operational issues in NFT history, and the fix is straightforward — most teams just skip it.

This lesson is about how IPFS actually works for dApps, what "pinning" really means, why your image disappeared, and how to set up content storage that survives.

---

## Core Concepts

### IPFS in 30 seconds

IPFS is a content-addressed storage network. You upload a file; the network returns a CID (Content Identifier), which is a hash of the file contents. Anyone with the CID can request the file from any node that has it. Two important properties:

- **Content addressing**: the CID *is* the hash of the content. Change the file, get a different CID. This is great for verifiability — the CID baked into your NFT contract is a guarantee about what the metadata says.
- **No persistence by default**: an IPFS node will fetch a file when asked, hold it for a while, then garbage-collect it. If no one is "pinning" the file (asking their node to keep it), it disappears.

This is the whole story behind disappearing NFTs. The team uploaded to a public gateway like nft.storage or Pinata's free tier. That service ran for a year and stopped pinning. No one else pinned the content. The file is technically still in the protocol — the CID is valid — but no node has the bytes.

### CIDs, gateways, and how dApps actually fetch

A CID looks like `bafybeif7v5...` (CIDv1, base32) or `QmXoY...` (CIDv0, base58). To fetch the file, you need either an IPFS node yourself or an HTTP gateway that proxies requests:

- `https://ipfs.io/ipfs/CID`
- `https://gateway.pinata.cloud/ipfs/CID`
- `https://CID.ipfs.dweb.link`

Browsers can't speak the IPFS protocol natively (yet — Brave has it, others don't). So in practice, dApps fetch IPFS content through HTTPS gateways. This means:

- Gateway availability matters. If `ipfs.io` is down, your dApp is broken if it only uses that gateway.
- Gateway speed varies wildly. A first-fetch on a cold gateway can take 30+ seconds.
- Gateways can rate-limit you. Free tiers get throttled hard at scale.

### Pinning services: where you should actually upload

For production, you don't run your own IPFS node (well, you can, but you don't have to). You use a pinning service that handles uploads and persistence:

- **Pinata** — most popular for NFT teams. Paid plans, generous free tier, good APIs.
- **Web3.Storage** / **NFT.Storage** — backed by Filecoin, free tier, but has had reliability issues and support questions.
- **Infura IPFS** — discontinued for new users in 2024 but still mentioned in old docs.
- **Quicknode IPFS**, **Crust**, **4EVERLAND** — newer competitors, often bundled with other Web3 infra.

Pick one. Then *pin to a second one* if your data is high-value. Redundant pinning is the only protection against a service shutting down.

### Filecoin: the "permanent" claim

Filecoin is a separate network where you pay storage providers to host data over time and get cryptographic proofs that the data is still there. Services like web3.storage offer "Filecoin-backed" storage — meaning the data is replicated to Filecoin storage providers and there's an economic incentive for them to keep it.

For most NFTs, this is overkill in 2026. You can get the same practical persistence by pinning at two pinning services. Filecoin is more compelling for very large datasets (gigabytes per project) where renting space directly is cheaper than per-pin pricing.

### NFT metadata: the standard shape

ERC-721 doesn't dictate what `tokenURI(tokenId)` returns, but the convention is:

```
ipfs://bafy.../1.json
```

Which resolves to:

```json
{
  "name": "My NFT #1",
  "description": "...",
  "image": "ipfs://bafy.../1.png",
  "attributes": [
    { "trait_type": "Background", "value": "Blue" }
  ]
}
```

Both the metadata JSON and the image are on IPFS. Many marketplaces (OpenSea, Blur, etc.) cache this, but they fetch it through gateways and they don't pin it — so the fetched cache exists but if the original disappears, new viewers won't see it.

---

## Code Walkthrough

Uploading a file and metadata to Pinata, then minting an NFT pointing to the result:

```typescript
// scripts/upload-nft.ts
import { PinataSDK } from "pinata";
import { readFile } from "fs/promises";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY!,
});

async function uploadNFT(imagePath: string, name: string, description: string) {
  // 1) Upload the image
  const imageBytes = await readFile(imagePath);
  const imageUpload = await pinata.upload.file(
    new File([imageBytes], "image.png", { type: "image/png" }),
  );
  const imageCid = imageUpload.IpfsHash;
  console.log(`Image: ipfs://${imageCid}`);

  // 2) Construct metadata JSON pointing to the image
  const metadata = {
    name,
    description,
    image: `ipfs://${imageCid}`,
    attributes: [],
  };

  // 3) Upload metadata
  const metaUpload = await pinata.upload.json(metadata);
  const metaCid = metaUpload.IpfsHash;
  console.log(`Metadata: ipfs://${metaCid}`);

  return `ipfs://${metaCid}`;
}

const tokenURI = await uploadNFT("./art/1.png", "My NFT #1", "First mint");
// Now mint: contract.safeMint(user, tokenURI)
```

For batches (a 10k collection), upload everything in a single directory and use the CID of the directory + path:

```typescript
// Upload a folder of images, get one CID for the whole folder
const dir = await pinata.upload.fileArray([file1, file2, ...]);
// Image #1 lives at ipfs://${dir.IpfsHash}/1.png
```

Then your metadata `image` fields are all `ipfs://CID/N.png` — one CID covers the whole collection.

For redundancy, also upload to a second service:

```typescript
import { Web3Storage } from "web3.storage";

const w3s = new Web3Storage({ token: process.env.WEB3_STORAGE_TOKEN! });
await w3s.put([new File([imageBytes], "image.png")]);
```

Now two services are pinning your content. If one goes down, the other still serves.

### Resolving IPFS URLs in the frontend

Don't ship `ipfs://` URLs to users — most browsers can't fetch them. Resolve to your preferred gateway:

```typescript
function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length);
    // Use your dedicated gateway, not a public one — better latency, no rate limits
    return `https://your-gateway.mypinata.cloud/ipfs/${path}`;
  }
  return uri;
}

// In a React component:
<img src={ipfsToHttp(metadata.image)} alt={metadata.name} />
```

For high-availability, attempt multiple gateways with timeout:

```typescript
async function fetchFromIPFS(cid: string): Promise<Response> {
  const gateways = [
    `https://your-gateway.mypinata.cloud/ipfs/${cid}`,
    `https://${cid}.ipfs.dweb.link`,
    `https://ipfs.io/ipfs/${cid}`,
  ];

  return Promise.any(
    gateways.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) =>
        r.ok ? r : Promise.reject(),
      ),
    ),
  );
}
```

`Promise.any` returns the first one that succeeds, races the rest into the void.

---

## Common Mistakes and Gotchas

**1. Using a free public gateway in production**
`https://ipfs.io/ipfs/CID` is fine for dev. In production it gets rate-limited to 80 requests per minute or so. Your popular NFT page will hit that immediately. Pay for a dedicated gateway from your pinning service, or run your own.

**2. Putting the image bytes inside the metadata JSON**
Some "make it work" tutorials show base64-encoding the image into the metadata `image` field as a `data:` URL. Don't. Metadata CIDs become tied to the image bytes, so if you fix a typo in the description you also have to re-upload the image and the CID changes. Keep image as a separate IPFS reference.

**3. Mutable metadata via centralized URLs**
If your `tokenURI` is `https://api.mysite.com/nft/1.json`, you can change the metadata at any time. Some teams do this intentionally for upgradeable NFTs. But it removes the verifiability that's the whole point of using IPFS in the first place. Pick a side.

**4. Forgetting to pin metadata, only pinning images**
If your contract returns `ipfs://CID/1.json` and you pinned the images directory but never pinned the metadata directory, the metadata can disappear and marketplaces will show "untitled" with broken images. Pin everything.

**5. CIDv0 vs CIDv1 confusion**
CIDv0 (`Qm...`) is the old base58 format. CIDv1 (`bafy...`) is the new base32 format. They're equivalent but they look different. Some tools default to v1 now (Pinata), some still spit out v0. They both work — just be aware that the same content can have two CID strings depending on the encoding.

**6. Not tracking your CIDs**
Six months in, a customer asks "what's the metadata for token 4231?" — and you no longer have the upload logs. Always store CIDs in your own database keyed by tokenId. Don't rely on being able to reconstruct them.

**7. Trusting "decentralized" pinning services without redundancy**
Even pinning services run by web3-native teams have shut down. NFT.Storage's free tier was paused in 2024. Trustless pinning networks like Crust exist but have had spotty performance. Treat any single service as a single point of failure and pin to two.

---

## How This Connects to Production

Every major NFT marketplace rebuilds metadata caches because the underlying IPFS data is unreliable. OpenSea has a refresh button on every NFT for this reason. Behind the scenes, they hit the metadata CID, cache the JSON and image to their own infra, and serve from S3. Your project benefits from this caching — until it doesn't, because they purge stale entries or rate-limit specific CIDs.

The lesson: don't outsource your project's persistence to a marketplace. Pin your own data, double-pin to a second service, document your CIDs, and consider running a small IPFS node or paying for Filecoin replication if your project is high-value enough that 5 years of guaranteed availability matters. The cost is a few dollars a month per gigabyte. The cost of an entire collection going dark is your reputation.

---

## What to Learn Next

- **NFT Engineering Beyond ERC-721** (separate track) — once your storage is solid, the contract patterns: marketplaces, royalties, lazy minting.
- **Real-Time Data: WebSocket Subscriptions and Optimistic UI** — how to plug live data into your dApp now that static content is solved.
- **Web3 Backend Engineering** (separate track) — the server-side counterpart, including running indexers and caching.
