---
last_verified: 2026-08
confidence: verified
touches:
  - packages/db/src/schema.ts
  - docs/architecture.md
---

# Local mirror

## Purpose

Roxysu's owned persistent store on the client machine.

## Business meaning

The local mirror is the SQLite file both processes share. realm-reader **extracts** Realm beatmaps and scores into raw import tables; the client app **persists** derived analytics and user-authored rows (collections, mastery, sessions, settings).

It is not a temporary cache — it is Roxysu's schema-controlled store alongside read-only Realm.

## Business rules

1. Raw import tables are realm-reader-owned; derived tables are server-owned.
2. Soft-deleted Realm objects land in raw rows with `delete_pending = true`; product queries exclude them.
3. Schema migrations are owned by the client app (Drizzle).

## Important symbols

- `packages/db/src/schema.ts`
- `@roxysu/db/client.bun`, `@roxysu/db/client.node`

## Related knowledge

- [vocabulary.md](../vocabulary.md) — canonical term definition
- [data-ownership.md](data-ownership.md)
- [realm-access.md](realm-access.md)
