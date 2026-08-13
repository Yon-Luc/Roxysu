---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - packages/db
---

# Dual runtime + SQLite bus

## Decision

Run realm-reader on Node and the API on Bun; share one Drizzle schema and one SQLite file with dual clients.

## Reason

Realm JS and `better-sqlite3` are not Bun-compatible; Bun has `bun:sqlite`.

## Consequences

- Never assume a single runtime can own both Realm and Bun-native SQLite.
- Schema changes must be compatible with both clients.
- Use WAL + busy_timeout + table ownership for concurrency.

## Relevant implementation

- `packages/db/src/schema.ts`
- `packages/db` `client.bun` / `client.node`
