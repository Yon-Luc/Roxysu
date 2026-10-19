---
last_verified: 2026-10
confidence: verified
touches:
  - docs/architecture.md
  - packages/db
  - packages/db/src/schemaVersion.ts
  - packages/db/src/foreignKeys.ts
  - apps/realm-reader/src/index.ts
  - apps/server/src/db.ts
  - apps/server/src/shutdownJobs.ts
---

# Dual runtime + SQLite bus

## Decision

Run realm-reader on Node and the client app API on Bun; share one Drizzle schema and one local mirror file with dual clients.

## Reason

Realm JS and `better-sqlite3` are not Bun-compatible; Bun has `bun:sqlite`.

## Consequences

- Never assume a single runtime can own both Realm and Bun-native SQLite.
- Schema changes must be compatible with both clients.
- Use WAL + busy_timeout + table ownership for concurrency.
- **Single migrator:** `apps/server` (`ensureDb`, default `migrate: true`) is the only process that runs Drizzle `migrate()`. Desktop and `bun run dev` start the server first or concurrently, and desktop defers the realm-reader until the server is serving, so the reader cannot be the migrator. The realm-reader calls `ensureDb(path, { migrate: false })` then `waitForSchema()`: it polls `__drizzle_migrations` until the newest applied migration matches the bundled journal, and fails with `SchemaNotCurrentError` after 60 s instead of writing on an old schema. `ROXYSU_SKIP_MIGRATE=1` makes any `ensureDb` caller skip migration by default; `ROXYSU_READER_MIGRATE=1` makes the reader migrate itself (standalone use without the server). One-shot reader scripts (`sync-once`, `write-*-once`) and tests keep the default migrate-on-open.
- Do not add a second `migrate()` call site to a long-running process.
- Both clients enable `PRAGMA foreign_keys = ON` on every connection except a migrating `ensureDb`, which keeps it OFF through `migrate()` and enables it afterwards (see [architecture/local-mirror.md](../architecture/local-mirror.md)). Keep the two clients identical in this respect; a table-rebuild migration relies on it.
- The realm-reader holds the shared SQLite write lock only briefly: extraction batches autocommit and the import is finished in one short immediate transaction (see [extraction-commit-phase.md](extraction-commit-phase.md)). Do not wrap a streaming extraction in one transaction; the Bun server shares the same file and `busy_timeout`.
- The Bun/Node server must not `closeDb` under its own background writers: `shutdownBackgroundWork()` (analytics pipeline, backfill jobs, mirror batch) runs first in both `index.ts` and `index.node.ts`. A new long-running writer needs a stop hook added there.

## Relevant implementation

- `packages/db/src/schema.ts`
- `packages/db` `client.bun` / `client.node` — `ensureDb({ migrate })`, `waitForSchema`
- `packages/db/src/schemaVersion.ts` — `waitForSchemaCurrent`, `SchemaNotCurrentError`
