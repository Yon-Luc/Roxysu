---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/routes/auth.ts
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubRole.ts
  - apps/hub/src/services/clientIp.ts
  - apps/hub/src/services/hubEnv.ts
  - apps/hub/src/services/collectionWrite.ts
  - apps/hub/src/routes/collections.ts
  - apps/hub/src/routes/search.ts
  - apps/hub/src/services/cache.ts
  - apps/hub/src/services/hinamizawa.ts
  - apps/hub/src/services/hubSearchQuery.ts
  - apps/server/public/features/hub
  - apps/server/public/lib/hub.ts
  - apps/server/src/hubUrl.ts
  - apps/server/src/mirrors/hubSearch.ts
  - apps/hub/src/db.ts
  - apps/hub/drizzle/0003_collection_indexes.sql
  - packages/hub-client
  - apps/hub/Dockerfile
  - apps/hub/docker-compose.yml
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

2. Edit collection: owner or admin.
   **Enforced by:** `apps/hub/src/routes/collections.ts` PUT `/:id` — status: verified
   **Unauthorized result:** forbidden

3. Delete collection: owner or admin.
   **Enforced by:** `apps/hub/src/routes/collections.ts` DELETE `/:id` — status: verified
   **Unauthorized result:** forbidden

4. Hub search index admin operations require admin role.
   **Enforced by:** hub admin checks — status: verified
   **Unauthorized result:** forbidden

5. Login may promote `ADMIN_OSU_ID` to admin but never demotes a stored admin.
   **Enforced by:** `apps/hub/src/services/hubRole.ts:resolveHubLoginRole()` — status: verified
   **Unauthorized result:** N/A (role is not taken from the JWT claim)

6. Rate-limit identity ignores `X-Forwarded-For` / `X-Real-Ip` unless `HUB_TRUST_PROXY=1`.
   **Enforced by:** `apps/hub/src/services/clientIp.ts` — status: verified

7. Production CORS must be an explicit origin list (`CORS_ORIGIN`); `*` and unset refuse to listen.
   **Enforced by:** `apps/hub/src/services/hubEnv.ts:resolveCorsOrigin()` — status: verified
   **Unauthorized result:** process does not bind

8. Collection star/mode/key stats are computed from maps on the Hub; client-supplied stats are not accepted.
   **Enforced by:** `apps/hub/src/routes/collections.ts` POST/PUT — status: verified

9. Public `GET /search` returns the hub search index only. Cache miss is empty (`cached: false`); it does not live-proxy Hinamizawa.
   **Enforced by:** `apps/hub/src/routes/search.ts` — status: verified

## Important symbols

- `apps/hub/src/*`
- `apps/hub/src/services/cache.ts:hashQueryParams()` — SHA-256 (32 hex) hub search index identity; boot rehashes legacy keys. Identity includes admin-primed `query_params` (mode, status, sort, stars, query, creator, bpm/length, key). Download Maps lookups must send the same fields — including `sort` — via `mirrorParamsToHubQuery`.
- `apps/hub/src/services/hinamizawa.ts:fetchAllBeatmapsetIds()` — cache refresh crawls Hinamizawa search pages; optional `keymode` keeps sets using embedded `beatmaps[].cs` (same as Download Maps). Do not N+1 `/s/{id}` for key filter (429s silently truncated Ranked 7K to ~page 26)
- `apps/server/public/features/hub/HubAdminCachePage.tsx` — admin prime UI: sort (default `ranked_desc` / Recently ranked), mode, status, stars, query, creator, bpm/length, keys, frequency
- `apps/server/src/hubUrl.ts:resolveHubBaseUrl()` — shared Hub URL for Workshop, OAuth redeem, and Download Maps (`HUB_URL`; localhost in `bun run dev`, `https://roxysu-api.yonx.app` when `ROXYSU_DESKTOP=1`)
- `apps/server/public/lib/hub.ts` — runtime Workshop client (clears JWT on Hub 401; delete + export). `packages/hub-client` is the Node Eden client and is not used in the browser
- `apps/server/src/mirrors/hubSearch.ts:mirrorParamsToHubQuery()` — maps Download mirror params to Hub GET `/search` (forwards `sort`, star bounds, key, etc.)
- `apps/server/src/routes/system.ts` — client app OAuth handoff helpers
- Workshop detail: owner or admin can edit/delete; Save calls `GET /collections/:id/export` so `downloadCount` increments
- Browse mode chip (`q=mode=m`) matches `dominantMode` **or** the corresponding Hub tag (`mania` / `std` / `ctb` / `taiko`)
- Workshop Favorites tab uses `GET /collections/me/favorites`
- List and favorites DTOs omit full `beatmapsetIds` (preview IDs + `mapCount` only). Detail uses `maps[]`; export still returns the full ID list.
- Workshop Added tab renders from local hub-added rows; ownership uses `POST /api/mirrors/ownership/diff` rather than shipping every owned set ID.
- OAuth callback accepts only `h=` (handoff id), never a JWT in the URL
- `apps/hub/src/db.ts` — `bun run db:migrate` and Hub boot both apply Hub store migrations
- `apps/hub/Dockerfile` — build context is repo root. Copy every `apps/*/package.json` so `bun.lock`'s workspace graph stays valid under `--frozen-lockfile`.
- `apps/hub/docker-compose.yml` — Coolify run config: pull prebuilt image, named volume at `/app/data`, `expose` 4322 (no host `ports`), `HUB_TRUST_PROXY=1`, production CORS allowlist for local Workshop.

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
- Hub store indexes: `collections(owner_id)`, `collections(created_at)`,
  `collection_maps(collection_id)`, unique `(collection_id, beatmapset_id)`,
  `collection_tags(tag)`, `collection_favorites(collection_id)`.
- The picker shows grouped chips for a selected mode (`hubTagGroupsForMode`) and
  a flat union for "all".
- Picker copy in `apps/server/public/lib/hub.ts` must stay equal to
  `packages/db/src/hub/schema.ts` (parity test: `hubTags.test.ts`).

**Enforced by:** `apps/hub/src/routes/collections.ts` `parseTagFilters` / create /
update tag validation — status: verified

## Dependencies

- [architecture/hub-vs-local.md](../../architecture/hub-vs-local.md)
- `features/smart-collections/` — hub collections can write back to Realm

## Depended on by

- Hub UI pages under `apps/server/public/features/hub`
- `features/download-mirrors/` — Download Maps search / count / download-all prefer primed Hub search index

## Failure behavior

1. Workshop Log out removes the JWT from `localStorage` only. Hub does not keep a revoke list; a copied JWT stays valid until expiry (30 days). Hub 401 still clears the stored JWT.
2. OAuth pending codes live in Hub process memory and are lost on restart.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Hub, Hub store, Hub search index
- [business/hub-permissions.md](../../business/hub-permissions.md)
- [decisions/hub-separate-process.md](../../decisions/hub-separate-process.md)
