---
last_verified: 2026-10
confidence: verified
touches:
  - packages/db/src/schema.ts
  - packages/db/src/schemaVersion.ts
  - packages/db/src/foreignKeys.ts
  - packages/db/src/client.bun.ts
  - packages/db/src/client.node.ts
  - docs/architecture.md
---

# Local mirror

## Purpose

Roxysu's owned persistent store on the client machine.

## Business meaning

The local mirror is the SQLite file both processes share. realm-reader **extracts** Realm beatmaps, scores, collections, and skins into raw import tables; the client app **persists** derived analytics and user-authored rows (collections, mastery, sessions, settings).

It is not a temporary cache — it is Roxysu's schema-controlled store alongside read-only Realm.

## Business rules

1. Raw import tables are realm-reader-owned; derived tables are server-owned.
2. Soft-deleted Realm **Score** and **BeatmapSet** objects land in raw rows with `delete_pending = true`; product queries exclude them. Realm Beatmap has no `DeletePending` (difficulty hide is `hidden`).
3. Schema migrations are owned by the client app (Drizzle): `apps/server` is the only process that runs `migrate()`. realm-reader opens the file with `ensureDb(path, { migrate: false })` and waits (bounded, 60 s) for the schema to be current. See [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md).

4. **Foreign keys are enforced.** Every connection (`createDb`, `ensureDb`, both clients) runs `PRAGMA foreign_keys = ON`, so an insert with a missing parent fails and a parent delete with remaining children fails. Writers must insert parents first (sets, then beatmaps, then scores) and delete children first (score metrics before scores; mastery, notes, tags, dan/mania/pattern rows and Roxysu Play results before beatmaps; sessions only after their score metrics are detached). `bms_score_details` and `bms_sync_queue` cascade with their score; `realm_collection_hashes` and `realm_skin_files` cascade with their parent. A new table with a foreign key needs its delete order added to `reconcileDeletes` (`apps/realm-reader/src/reconcileCore.ts`).
5. **Migrations run with foreign keys off.** A migrating `ensureDb` opens the connection with foreign keys OFF, runs `migrate()` (one transaction, where the pragma is a no-op, so a table-rebuild migration could otherwise drop or cascade rows), then turns them ON. `PRAGMA foreign_key_check` runs once per open as a warning only: **existing orphan rows** from before enforcement are logged with counts per relationship, never deleted, and never block boot (SQLite checks a child row only when its reference columns are written, so they do not block unrelated writes).

## Important symbols

- `packages/db/src/foreignKeys.ts` — `enableForeignKeys()`, `foreignKeysEnabled()`, `findForeignKeyOrphans()`, `warnForeignKeyOrphans()`

- `packages/db/src/schema.ts` — `scores` also has `scores_user_pending_ruleset_beatmap_idx` and `scores_beatmap_pending_idx` (practice query predicates)
- `@roxysu/db/client.bun`, `@roxysu/db/client.node`

## Related knowledge

- [vocabulary.md](../vocabulary.md) — canonical term definition
- [data-ownership.md](data-ownership.md)
- [realm-access.md](realm-access.md)
