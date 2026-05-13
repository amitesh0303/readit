# Stacks Advanced: Maps, Traits, and Multi-Contract Architecture

**Track:** Bitcoin L2s and Sidechains
**Lesson:** 5 of 8
**Level:** Advanced
**Read time:** 13 min

---

## The Problem

You've written basic Clarity contracts, but real applications need persistent key-value storage, composable interfaces between contracts, and integration with Bitcoin state via Proof of Transfer. You need to understand maps for complex data storage, traits for contract interfaces, and how Stacks' unique PoX consensus lets contracts read Bitcoin state.

## Core Concepts

### Maps: Key-Value Storage

Maps are Clarity's primary data structure for storing records indexed by keys. Unlike Solidity mappings, Clarity maps have explicit key and value types:

```clarity
;; nft-marketplace.clar
;; A simple NFT marketplace demonstrating maps and traits
;; clarinet@2.4.0

;; Define map for listings
(define-map listings
  { token-id: uint }
  { seller: principal, price: uint, listed-at: uint }
)

;; Define map for offers
(define-map offers
  { token-id: uint, buyer: principal }
  { amount: uint, expires-at: uint }
)

;; Track total sales volume
(define-data-var total-volume uint u0)

;; List an NFT for sale
(define-public (list-nft (token-id uint) (price uint))
  (begin
    (asserts! (> price u0) (err u200))
    ;; Verify caller owns the NFT (would check NFT contract in production)
    (map-set listings
      { token-id: token-id }
      { seller: tx-sender, price: price, listed-at: block-height }
    )
    (ok true)
  )
)

;; Buy a listed NFT
(define-public (buy-nft (token-id uint))
  (let (
    (listing (unwrap! (map-get? listings { token-id: token-id }) (err u201)))
    (price (get price listing))
    (seller (get seller listing))
  )
    ;; Transfer STX from buyer to seller
    (try! (stx-transfer? price tx-sender seller))
    ;; Remove listing
    (map-delete listings { token-id: token-id })
    ;; Update volume
    (var-set total-volume (+ (var-get total-volume) price))
    (ok price)
  )
)

;; Make an offer on any NFT (listed or not)
(define-public (make-offer (token-id uint) (amount uint) (expires-in uint))
  (begin
    (asserts! (> amount u0) (err u202))
    (asserts! (<= expires-in u1008) (err u203)) ;; Max 1 week (~1008 blocks)
    (map-set offers
      { token-id: token-id, buyer: tx-sender }
      { amount: amount, expires-at: (+ block-height expires-in) }
    )
    (ok true)
  )
)

;; Read-only: get listing details
(define-read-only (get-listing (token-id uint))
  (map-get? listings { token-id: token-id })
)

;; Read-only: get offer details
(define-read-only (get-offer (token-id uint) (buyer principal))
  (map-get? offers { token-id: token-id, buyer: buyer })
)

;; Read-only: get total marketplace volume
(define-read-only (get-volume)
  (ok (var-get total-volume))
)
```

### Traits: Contract Interfaces

Traits define interfaces that contracts must implement. They enable composability — your marketplace can work with any NFT contract that implements the standard trait:

```clarity
;; nft-trait.clar
;; Define a trait (interface) for NFT contracts
;; Based on SIP-009: https://github.com/stacksgov/sips/blob/main/sips/sip-009

(define-trait nft-trait
  (
    ;; Transfer token to a new owner
    (transfer (uint principal principal) (response bool uint))

    ;; Get the owner of a token
    (get-owner (uint) (response (optional principal) uint))

    ;; Get the last minted token ID
    (get-last-token-id () (response uint uint))

    ;; Get token URI for metadata
    (get-token-uri (uint) (response (optional (string-utf8 256)) uint))
  )
)
```

```clarity
;; simple-nft.clar
;; Implement the NFT trait
;; clarinet@2.4.0

(impl-trait .nft-trait.nft-trait)

(define-non-fungible-token simple-nft uint)

(define-data-var last-id uint u0)
(define-constant contract-owner tx-sender)

;; Mint a new NFT
(define-public (mint (recipient principal))
  (let ((new-id (+ (var-get last-id) u1)))
    (asserts! (is-eq tx-sender contract-owner) (err u100))
    (try! (nft-mint? simple-nft new-id recipient))
    (var-set last-id new-id)
    (ok new-id)
  )
)

;; SIP-009 required: transfer
(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err u101))
    (nft-transfer? simple-nft id sender recipient)
  )
)

;; SIP-009 required: get-owner
(define-read-only (get-owner (id uint))
  (ok (nft-get-owner? simple-nft id))
)

;; SIP-009 required: get-last-token-id
(define-read-only (get-last-token-id)
  (ok (var-get last-id))
)

;; SIP-009 required: get-token-uri
(define-read-only (get-token-uri (id uint))
  (ok (some u"https://example.com/nft/{id}.json"))
)
```

### Reading Bitcoin State via PoX

Stacks' Proof of Transfer consensus means every Stacks block is anchored to a Bitcoin block. Contracts can access Bitcoin block data:

```clarity
;; bitcoin-aware.clar
;; Contract that reads Bitcoin block state
;; This demonstrates Stacks' unique Bitcoin integration

;; Get the current Bitcoin block height as seen by Stacks
(define-read-only (get-bitcoin-height)
  (ok burn-block-height)
)

;; Time-lock that uses Bitcoin block height
(define-map timelocks
  { id: uint }
  { owner: principal, amount: uint, unlock-height: uint }
)

(define-data-var lock-nonce uint u0)

;; Lock STX until a specific Bitcoin block height
(define-public (create-timelock (amount uint) (unlock-at-btc-height uint))
  (let ((id (var-get lock-nonce)))
    (asserts! (> amount u0) (err u300))
    (asserts! (> unlock-at-btc-height burn-block-height) (err u301))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set timelocks
      { id: id }
      { owner: tx-sender, amount: amount, unlock-height: unlock-at-btc-height }
    )
    (var-set lock-nonce (+ id u1))
    (ok id)
  )
)

;; Claim locked STX after Bitcoin block height passes
(define-public (claim-timelock (id uint))
  (let (
    (lock (unwrap! (map-get? timelocks { id: id }) (err u302)))
    (owner (get owner lock))
    (amount (get amount lock))
    (unlock-height (get unlock-height lock))
  )
    (asserts! (is-eq tx-sender owner) (err u303))
    (asserts! (>= burn-block-height unlock-height) (err u304))
    (try! (as-contract (stx-transfer? amount tx-sender owner)))
    (map-delete timelocks { id: id })
    (ok amount)
  )
)
```

### Multi-Contract Architecture

Large applications split logic across multiple contracts that call each other:

```shell
# Project structure for a multi-contract DeFi app
clarinet new defi-app
cd defi-app
clarinet contract new token
clarinet contract new vault
clarinet contract new governance

# Run the full test suite
clarinet test
```

```
Expected output:
Running tests for contracts/token.clar
Running tests for contracts/vault.clar
Running tests for contracts/governance.clar
12 tests passed, 0 failed
```

## Common Pitfalls

1. **Not using `unwrap!` and `unwrap-panic` correctly** — `unwrap!` returns an error response if the optional is `none`. `unwrap-panic` aborts the entire transaction. Use `unwrap!` in public functions (returns error to caller) and `unwrap-panic` only in read-only functions or when failure is truly unexpected.

2. **Forgetting maps return `(optional ...)` values** — `map-get?` returns `(some value)` or `none`. You must always handle the `none` case. Use `default-to` for fallback values or `unwrap!` to return an error.

3. **Not understanding `as-contract` for escrow patterns** — When a contract needs to hold and release funds, use `as-contract` to make the contract itself the sender. Without it, `tx-sender` is always the original caller, and the contract can't transfer its own holdings.

4. **Exceeding the read count or write count limits** — Stacks blocks have limits on how many reads/writes a single transaction can perform. Complex operations that touch many map entries may hit these limits. Design contracts to minimize per-transaction state access.

## What to Learn Next

- [Liquid Network](./06-liquid-network.md) — Explore Bitcoin's federated sidechain for confidential transactions
- [Stacks Documentation](https://docs.stacks.co/) — Official Stacks developer documentation
- [Clarity Book](https://book.clarity-lang.org/) — Comprehensive Clarity language guide
- [Hiro Platform GitHub](https://github.com/hirosystems/clarinet) — Clarinet source code and examples
