---
last_verified: 2026-08
confidence: verified
touches:
  - packages/db/src/schema.ts
  - docs/architecture.md
---

# Table ownership

## Purpose

Prevent dual-writer corruption by assigning table ownership per process.

## Business rules

1. **realm-reader** writes only **raw import** tables: `beatmaps`, `scores`, `imports`, mirrored realm collections, and related raw rows.
2. **server** writes only **derived / user** tables: sessions, mastery, stats, score_metrics, collections, settings, notes/tags, etc.
3. Soft-deleted Realm objects are upserted with `delete_pending = true`; product queries filter them out.
4. Server (Drizzle) owns schema/migrations for the whole local mirror.

## Security rules

N/A for client app table ownership — see Hub permissions for networked auth.

## Important symbols

- `packages/db/src/schema.ts` — section comments mark raw vs derived ownership

## Related knowledge

- [vocabulary.md](../vocabulary.md) — Local mirror, raw import tables, derived tables
- [business/table-ownership.md](../business/table-ownership.md)
- [business/realm-read-only.md](../business/realm-read-only.md)
