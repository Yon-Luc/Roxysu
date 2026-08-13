---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/routes/auth.ts
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubSearchQuery.ts
  - apps/server/public/features/hub
  - apps/server/public/lib/hub.ts
  - packages/db/src/hub/schema.ts
  - packages/hub-client
---

# Hub

## Purpose

Optional online process for sharing collections and maintaining the hub search index. Separate Hub store from the client app's local mirror.

## Business meaning

Networked collaboration / discovery — not required for offline practice analytics.

## Security rules

1. Authenticated Hub API routes require a valid osu! OAuth JWT.
   **Enforced by:** `apps/hub/src/middleware/auth.ts` — status: verified
   **Unauthorized result:** request rejected before mutation

2. Edit collection: owner only.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

3. Delete collection: owner or admin.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

4. Hub search index admin operations require admin role.
   **Enforced by:** hub admin checks — status: verified
   **Unauthorized result:** forbidden

## Important symbols

- `apps/hub/src/*`
- `apps/server/src/routes/system.ts` — client app OAuth handoff helpers
- `packages/hub-client`

## Tag taxonomy

Hub collections carry canonical lowercase tags (`VALID_TAGS` in
`packages/db/src/hub/schema.ts`, mirrored in `apps/server/public/lib/hub.ts`).
Tags are **gamemode-scoped**: each secondary tag belongs to exactly one primary
mode (`mania` / `std` / `ctb` / `taiko`) and is grouped under a category label
(Keys / Pattern / Style / Difficulty) for the picker UI.

- Mania pattern tags reuse Roxysu's own pattern vocabulary from
  `packages/mania-pattern-analysis` (`jack`, `minijack`, `longjack`, `chordjack`,
  `jumpstream`, `handstream`, `chordstream`, `stream`, `delay`, `bracket`).
- Mania key tags: `4k` `5k` `6k` `7k` `8k`.
- Tags are stored as free text in `collection_tags`; the whitelist is app-level
  validation (`VALID_TAGS`), not a DB constraint, so adding tags needs no migration.
- The picker shows grouped chips for a selected mode (`hubTagGroupsForMode`) and
  a flat union for "all".

**Enforced by:** `apps/hub/src/routes/collections.ts` `parseTagFilters` / create /
update tag validation — status: verified

## Dependencies

- [architecture/hub-vs-local.md](../../architecture/hub-vs-local.md)
- `features/smart-collections/` — hub collections can write back to Realm

## Depended on by

- Hub UI pages under `apps/server/public/features/hub`

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Hub, Hub store, Hub search index
- [business/hub-permissions.md](../../business/hub-permissions.md)
- [decisions/hub-separate-process.md](../../decisions/hub-separate-process.md)
