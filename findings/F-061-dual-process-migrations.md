---
id: F-061
feature: live-sync
kind: correctness
severity: medium
confidence: likely
---

# Server and realm-reader both migrate the same SQLite file on startup

## What

`ensureDb` in the Node client and the Bun client runs Drizzle `migrate()` on every open. Desktop starts the server and realm-reader together. Both call `ensureDb` on the mirror path.

## Why

The local mirror is the bus between the two processes. Two migrators on one file at first boot after an upgrade can fail the second process or leave the schema half-applied, depending on how the migrator locks. Day-to-day starts with no pending migrations are cheap and usually fine.

## How to improve

One process owns migration (realm-reader, or a `roxysu migrate` step). The server waits until the schema version matches before it serves.

## Potential gain

Upgrades that start both processes at once do not race the migrator.

## Evidence

- `packages/db/src/client.bun.ts` `ensureDb` (about lines 27–31): `migrate(...)`.
- `packages/db/src/client.node.ts` has the same `ensureDb` pattern.
- `apps/realm-reader/src/index.ts` (about line 191): `ensureDb(dbPath)` at reader start.
- `knowledge/architecture/process-model.md`: desktop starts both processes.
