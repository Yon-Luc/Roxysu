---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - apps/realm-reader/src
---

# Poll, not Realm listeners

## Decision

Prefer watermark/reconcile polling over Realm `addListener` change notifications for import sync.

## Reason

Lazer may exclusive-lock the Realm file; listener-based sync is a poor fit for that model and latency needs.

## Consequences

- Live updates are seconds-scale, not sub-second push from Realm.
- Full remap is reserved for first import / `REALM_FULL_SYNC`.

## Relevant implementation

- `apps/realm-reader/src/index.ts` / `sync.ts`
