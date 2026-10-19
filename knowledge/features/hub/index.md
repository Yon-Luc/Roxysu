---
last_verified: 2026-10
confidence: verified
touches:
  - apps/hub/src/routes/auth.ts
  - apps/hub/src/middleware/auth.ts
  - apps/hub/src/services/hubRole.ts
  - apps/hub/src/services/clientIp.ts
  - apps/hub/src/services/hubEnv.ts
  - apps/hub/src/services/oauthState.ts
  - apps/server/src/hubOAuthPending.ts
  - apps/server/src/routes/system.ts
  - apps/hub/src/services/collectionWrite.ts
  - apps/hub/src/routes/collections.ts
  - apps/hub/src/routes/search.ts
  - apps/hub/src/routes/calcBundles.ts
  - apps/hub/src/services/cache.ts
  - apps/hub/src/services/singleFlight.ts
  - apps/hub/src/services/cacheRefreshCron.ts
  - apps/hub/src/routes/admin.ts
  - apps/hub/src/services/calcBundles.ts
  - apps/hub/src/services/searchIndex.ts
  - apps/hub/src/services/hinamizawa.ts
  - apps/hub/src/services/hubSearchQuery.ts
  - apps/server/public/features/hub
  - apps/server/public/lib/hub.ts
  - apps/server/src/hubUrl.ts
  - apps/server/src/mirrors/hubSearch.ts
  - apps/server/src/map-analysis/calcBundle.ts
  - apps/hub/src/db.ts
  - apps/hub/drizzle/0003_collection_indexes.sql
  - apps/hub/drizzle/0006_calc_bundles.sql
  - packages/hub-client
  - packages/db/src/hub/schema.ts
  - apps/hub/src/routes/bms.ts
  - apps/hub/src/services/bms.ts
  - apps/hub/src/services/bmsCommunity.ts
  - apps/hub/drizzle/0008_bms.sql
  - packages/db/src/bmsTables.ts
  - packages/db/bms-tables/insane.json
  - packages/db/bms-tables/satellite.json
  - packages/db/bms-tables/stella.json
  - apps/hub/Dockerfile
  - apps/hub/docker-compose.yml
  - knowledge/decisions/hub-search-base-index.md
  - knowledge/decisions/hub-calc-bundle-version.md
---

# Hub

## Purpose

Optional online process for sharing collections and maintaining the hub search index. Separate Hub store from the client app's local mirror.

**In UI:** Share collection is the primary header action on browse. Login, logout, and admin links sit on a second row. Browse, Favorites, and Added are exclusive tabs. On a collection, Save / Update is the primary action; favorite, edit, and delete sit under it. Share page publish stays with the readiness line, not duplicated in the header.

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

4b. Hub calc bundle admin upload/list/delete require admin role. Public `GET /calc-bundles/:version` is unauthenticated but killable.
   **Enforced by:** `apps/hub/src/routes/admin.ts` + `requireAdmin`; `apps/hub/src/services/hubEnv.ts:isHubCalcBundlesEnabled()` — status: verified
   **Unauthorized result:** 403 on admin routes; 503 when kill switch off

5. Login may promote `ADMIN_OSU_ID` to admin but never demotes a stored admin.
   **Enforced by:** `apps/hub/src/services/hubRole.ts:resolveHubLoginRole()` — status: verified
   **Unauthorized result:** N/A (role is not taken from the JWT claim)

6. Rate-limit identity ignores `X-Forwarded-For` / `X-Real-Ip` unless `HUB_TRUST_PROXY=1`.
   **Enforced by:** `apps/hub/src/services/clientIp.ts` — status: verified

7. CORS must be an explicit origin list (`CORS_ORIGIN`) in production and when `HUB_LISTEN` names a non-loopback host (a published port); `*` and unset refuse to listen. Otherwise an unset `CORS_ORIGIN` defaults to the Roxysu client loopback origins (`http://127.0.0.1:4321`, `http://localhost:4321`); an explicit `*` is honoured only on a non-published Hub and logs a warning.
   **Enforced by:** `apps/hub/src/services/hubEnv.ts:resolveCorsOrigin()` / `isHubPublished()` — status: verified
   **Unauthorized result:** process does not bind

8. Collection star/mode/key stats are computed from maps on the Hub; client-supplied stats are not accepted. When the collection lists beatmap online ids, only those difficulties are sampled; otherwise every difficulty of each beatmapset is sampled.
   **Enforced by:** `apps/hub/src/routes/collections.ts` POST/PUT — status: verified

9. Public `GET /search` returns the hub search index only. Cache miss is empty (`cached: false`); it does not live-proxy Hinamizawa.
   **Enforced by:** `apps/hub/src/routes/search.ts` — status: verified

10. Hub search index primes are keyed by **base identity** only (`mode`, `status`, `key`, `sort`). Secondary filters (`min_stars`/`max_stars`, bpm/length, `query`, `creator`) are applied in SQL against `search_index_sets` / `search_index_diffs` at request time. Star match is any difficulty in range.
    **Enforced by:** `apps/hub/src/services/cache.ts:hashQueryParams()` / `apps/hub/src/services/searchIndex.ts` — status: verified

11. Kill switches (env, read per request): `HUB_SEARCH_INDEX=0` forces miss; `HUB_SEARCH_HTTP_CACHE=0` forces `Cache-Control`/`CDN-Cache-Control: no-store` (stops new Cloudflare edge entries; does not flush existing HITs — bypass the CF Cache Rule for that).
    **Enforced by:** `apps/hub/src/services/hubEnv.ts` + `apps/hub/src/routes/search.ts` — status: verified

12. Hub calc bundles are keyed by Roxysu product version. Clients gap-fill the local mirror by beatmap hash and never overwrite successful local computes.
    **Enforced by:** `apps/server/src/map-analysis/calcBundle.ts:applyCalcBundle()` — status: verified
    **See:** [decisions/hub-calc-bundle-version.md](../../decisions/hub-calc-bundle-version.md)

13. BMS score batches belong to the authenticated Hub user. A `userId` in the body is ignored. Trust is always `community_submitted`. The stored DJ grade and combo lamp are computed from the submitted accuracy and judgement counts. A score whose mods include autoplay is rejected.
    **Enforced by:** `apps/hub/src/routes/bms.ts` `POST /api/bms/scores/batch` and `apps/hub/src/services/bms.ts:ingestBmsScore()` — status: verified
    **Unauthorized result:** 401 before insert

14. A private BMS profile (`hub_users.bms_profile_public = 0`) is hidden from everyone except that user. Missing and private profiles both return 404.
    **Enforced by:** `apps/hub/src/services/bms.ts:readBmsProfile()` and the other public BMS reads — status: verified
    **Unauthorized result:** 404, including for anonymous viewers

15. BMS table import accepts only HTTPS URLs on the allowlist, rejects redirects, and is admin-only.
    **Enforced by:** `apps/hub/src/routes/bms.ts` `POST /api/bms/tables/import` plus `isAllowedBmsTableUrl()` — status: verified
    **Unauthorized result:** 403 for non-admins; 400 for a disallowed URL

16. Public BMS chart leaderboards, the score feed, and global statistics count public profiles only. Comparison and score detail hide a private profile from everyone except its owner.
    **Enforced by:** `apps/hub/src/services/bmsCommunity.ts` — status: verified
    **Unauthorized result:** 404

17. Insane, Satellite, and Stella are stored when the Hub starts, from the catalogues shipped in `packages/db/bms-tables`. Their identity is the bundled source name, so a later start does not add a second version of the same catalogue.
    **Enforced by:** `apps/hub/src/services/bms.ts:seedBundledBmsTables()` — status: verified

18. Hub OAuth handoff redeem needs a handoff verifier, and the Hub always generates the handoff id. A `handoff` query param on `GET /auth/login` is ignored. Desktop login sends a local nonce (`nonce`), which is echoed on the localhost redirect (`h` + `n`) so only that pending login learns the Hub id. The client that starts login keeps a high-entropy verifier (never in a URL or redirect) and sends only its SHA-256 challenge (required). The Hub stores the challenge with the one-time JWT and redeems it only via `POST /auth/handoff/:id` with the matching verifier (constant-time compare). A wrong or missing verifier returns the same 404 as an unknown id, does not consume the handoff, and still counts toward the per-IP rate limit (30 per minute). Knowing an id the caller chose is not enough, because that id is not the one stored. The `GET` redeem no longer exists.
   **Enforced by:** `apps/hub/src/services/oauthState.ts:consumeHandoff()` and `apps/hub/src/routes/auth.ts` `/login`, `POST /handoff/:id` — status: verified
   **Unauthorized result:** 404 (login without a valid challenge: 400)

19. The client app's Hub calc bundle upload sends the admin bearer only to `resolveHubBaseUrl()`. A request body `hubUrl` does not exist and is ignored.
   **Enforced by:** `apps/server/src/map-analysis/calcBundle.ts:uploadCalcBundleToHub()` — status: verified
   **Unauthorized result:** N/A (no caller-selected target)

20. Hub search index refresh is single-flight per `search_cache` row. Public stale refresh (`GET /search`, `GET /search/all`), admin prime and `POST /admin/cache/:id/refresh`, and the cron tick all call `refreshCacheSingleFlight(cacheId)`, so overlapping refreshes of one row share one crawl and one delete-then-insert of `search_index_sets`. A failure rejects every waiter and clears the entry. The map is in Hub process memory (one Hub process). Public stale refresh does not start a crawl while `refreshBackoffUntil` is in the future, and that skip happens before the per-IP limit. Cron, admin refresh, and the public path write failures with `recordRefreshFailure` (`REFRESH_FAILURE_BACKOFF_MS`, 15 minutes). Backoff does not turn a stale row into `hit-fresh`.
   **Enforced by:** `apps/hub/src/services/cache.ts:refreshCacheSingleFlight` (built on `apps/hub/src/services/singleFlight.ts`) — status: verified
   **Unauthorized result:** N/A (integrity rule: readers never see a half-replaced index from two overlapping refreshes)

## Important symbols

- `apps/hub/src/*`
- `apps/hub/src/services/cache.ts:hashQueryParams()` — SHA-256 (32 hex) of **base** params only; boot rehashes/strips secondary fields from stored `query_params`. Download Maps still forwards secondary filters + `sort` via `mirrorParamsToHubQuery`; Hub looks up by base then SQL-filters index rows.
- `apps/hub/src/services/searchIndex.ts` — persist stubs as rows; `GET /search` pages in SQL; `GET /search/all` dumps ids/compact/full. Boot `migrateBlobsToRows()` lifts leftover JSON blobs.
- `apps/hub/src/services/cache.ts:parseStoredStubs()` — dual-read leftover blob JSON for one-shot migration only
- `apps/hub/src/services/hinamizawa.ts:fetchAllBeatmapsetStubs()` — cache refresh crawls Hinamizawa search pages into enriched stubs; optional `keymode` keeps sets using embedded `beatmaps[].cs`. Do not N+1 `/s/{id}` for key filter
- `apps/hub/src/services/cache.ts:refreshCacheSingleFlight()` — the only entry point for index refresh (never call `refreshCache` directly from a route or the cron)
- `apps/hub/src/services/hubEnv.ts:isHubSearchIndexEnabled()` / `isHubSearchHttpCacheEnabled()` — prod kill switches
- `apps/server/public/features/hub/HubAdminCachePage.tsx` — admin prime UI: base fields only (mode, status, keys, sort, frequency); secondary filters are runtime on Download Maps
- `apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx` — admin Hub calc bundle upload/list/delete
- `apps/hub/src/services/calcBundles.ts` / `routes/calcBundles.ts` — version-keyed calc bundle store + public GET
- `apps/server/src/map-analysis/calcBundle.ts` — export, pull, gap-fill apply
- `apps/server/src/hubUrl.ts:resolveHubBaseUrl()` — shared Hub URL for Community, OAuth redeem, and Download Maps (`HUB_URL`; localhost in `bun run dev`, `https://roxysu-api.yonx.app` when `ROXYSU_DESKTOP=1`)
- `apps/server/public/lib/hub.ts` — runtime Community client (clears JWT on Hub 401; delete + export). `packages/hub-client` is the Node Eden client and is not used in the browser
- `apps/server/public/features/hub/HubSessionChip.tsx` — app-wide osu! OAuth state on the right of the sidebar scores/maps lines. On small screens it floats bottom-right above the tab bar, and sits in the More sheet while that sheet is open. Logged out shows Log in; logged in shows avatar and username. Same JWT as Community. Not client app auth.
- `apps/server/src/mirrors/hubSearch.ts:mirrorParamsToHubQuery()` / `tryFetchAllHubCachedIds()` — maps Download params to Hub GET `/search` (page) or `/search/all` (count/download-all). Circuit breaker skips Hub for 30s after timeout/5xx.
- `apps/server/src/routes/system.ts` — client app OAuth handoff helpers: `POST /hub-oauth/begin` returns `{ handoff, verifier, challenge }`; `POST /hub-oauth/pending` checks the verifier locally (`apps/server/src/hubOAuthPending.ts:verifyHubOAuthHandoffVerifier()`) and presents it to Hub
- `apps/server/public/lib/hub.ts:prepareWebHubLoginChallenge()` — web login keeps the verifier in `sessionStorage` (same tab) and redeems it in `redeemHubHandoff()`
- Community detail: owner or admin can edit/delete; Save calls `GET /collections/:id/export` so `downloadCount` increments
- Browse mode chip (`q=mode=m`) matches `dominantMode` **or** the corresponding Hub tag (`mania` / `std` / `ctb` / `taiko`)
- Community Favorites tab uses `GET /collections/me/favorites`
- List and favorites DTOs omit full `beatmapsetIds` (preview IDs + `mapCount` only). Detail uses `maps[]` plus `beatmapIds` (osu beatmap online ids). Export returns both the set id list and `beatmapIds`.
- A shared collection stores one `collection_maps` row per beatmapset (download / ownership) and one `collection_beatmaps` row per difficulty that was in the source collection. An empty difficulty list is legacy whole-set membership.
- Publishing a smart or Realm collection sends those beatmap online ids. Saving it locally stores them on the hub-added row and collection write-back includes only those beatmaps.
- Community Added tab renders from local hub-added rows; ownership uses `POST /api/mirrors/ownership/diff` rather than shipping every owned set ID.
- OAuth callback accepts only `h=` (handoff id), never a JWT or verifier in the URL. `HubCallbackPage` does not redeem until the `system-status` query has resolved, and redeems once (the once-ref is set before the await) so it never POSTs the verifier to the `useHubUrl` localhost default
- `apps/hub/src/db.ts` — `bun run db:migrate` and Hub boot both apply Hub store migrations
- `apps/hub/Dockerfile` — build context is repo root. Copy every `apps/*/package.json` so `bun.lock`'s workspace graph stays valid under `--frozen-lockfile`.
- `apps/hub/docker-compose.yml` — Coolify run config: pull prebuilt image, named volume at `/app/data`, `expose` 4322 (no host `ports`), `HUB_TRUST_PROXY=1`, production CORS allowlist for local Community; defaults `HUB_SEARCH_HTTP_CACHE=0` for safe rollout.

### Hub search edge cache (Cloudflare reverse proxy)

Hub does not publish to Cloudflare Workers. When the Hub hostname is orange-cloud proxied:

1. Origin **fresh** hits set `CDN-Cache-Control: public, max-age=…` (capped by `HUB_SEARCH_EDGE_CACHE_MAX_AGE_SEC`, default 1h, and clamped to remaining `hubCacheTtlMs` freshness; under 5 seconds left is `no-store`) when `HUB_SEARCH_HTTP_CACHE=1`; browsers get `private, no-store`. A `hit-stale` response, a miss, and a fresh hit whose row has a refresh in flight are `no-store` on every header, so the edge does not pin the pre-refresh page list. There is no purge client; bypass the CF rule to flush. `GET /search/all` stays `no-store`. `apps/hub/src/routes/search.ts:searchPageEdgeTtlSec()` decides.
2. JSON is **not** CF-cacheable by default — ops must add a named Cache Rule: `GET` + path `/search*` → Eligible for cache, respect origin TTL. Bypass that rule for instant edge kill.
3. Incident order: `HUB_SEARCH_INDEX=0` (live mirror) → CF Bypass `/search*` → `HUB_SEARCH_HTTP_CACHE=0` (+ Bypass until TTL/purge).

**See:** [decisions/hub-search-base-index.md](../../decisions/hub-search-base-index.md)

## Tag taxonomy

Hub collections carry canonical lowercase tags (`VALID_TAGS` in
`packages/db/src/hub/schema.ts`, mirrored in `apps/server/public/lib/hub.ts`).
Tags are **gamemode-scoped**: each secondary tag belongs to exactly one primary
mode (`mania` / `std` / `ctb` / `taiko`) and is grouped under a category label
(Keys / Skill / Style / Difficulty for mania) for the picker UI.

- Mania skill tags reuse the **dominant skill** vocabulary from
  `packages/mania-pattern-analysis` (`speed`, `jack`, `coordination`,
  `technical`, `release`). `speed` appears once — it is a skill, not a
  difficulty tag.
- Mania key tags: `4k` `5k` `6k` `7k` `8k`.
- Tags are stored as free text in `collection_tags`; the whitelist is app-level
  validation (`VALID_TAGS`), not a DB constraint, so adding tags needs no migration.
- Retired Interlude pattern tags (`minijack`, `longjack`, `chordjack`,
  `jumpstream`, `handstream`, `chordstream`, `stream`, `delay`, `bracket`, `tech`)
  live in `LEGACY_HUB_TAGS`. They stay in `VALID_TAGS` so collections created
  before the dominant-skill switch keep validating, but the picker no longer
  offers them. Do not drop them from `VALID_TAGS` without a data migration.
- Hub store indexes: `collections(owner_id)`, `collections(created_at)`,
  `collection_maps(collection_id)`, unique `(collection_id, beatmapset_id)`,
  `collection_beatmaps(collection_id)`, unique `(collection_id, beatmap_id)`,
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
- `features/download-mirrors/` — Save collection starts `mode=setIds` for ownership-missing set ids (multi-provider fallback; pending sets often miss on hinai alone)

## Depended on by

- Hub UI pages under `apps/server/public/features/hub`
- `features/download-mirrors/` — Download Maps search / count / download-all prefer primed Hub search index
- `features/sunny-dan-recommendations/` — Hub calc bundle pull gap-fills dan/pattern rows before local backfill
- `features/online-score-pull/` — Hub proxies ranked best fetches and holds the osu! usage ledger
- `features/bms/` — public BMS profile, score batch, table import, chart leaderboards, comparison, feed, and statistics

## Failure behavior

1. Community Log out removes the JWT from `localStorage` only. Hub does not keep a revoke list; a copied JWT stays valid until expiry (30 days). Hub 401 still clears the stored JWT.
2. OAuth pending codes and handoffs live in Hub process memory and are lost on restart. A web login must finish in the same browser tab (its verifier is in `sessionStorage`); a login opened elsewhere cannot be redeemed.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Hub, Hub store, Hub search index
- [business/hub-permissions.md](../../business/hub-permissions.md)
- [decisions/hub-separate-process.md](../../decisions/hub-separate-process.md)
