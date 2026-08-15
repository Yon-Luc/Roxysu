---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/services/cache.ts
  - apps/hub/src/services/searchIndex.ts
  - apps/hub/src/routes/search.ts
  - apps/hub/src/services/hubEnv.ts
  - packages/db/src/hub/schema.ts
  - apps/hub/docker-compose.yml
  - knowledge/features/hub/index.md
---

# Hub search base index

## Decision

Prime the Hub search index on **base identity** only (`mode`, `status`, `key`, `sort`) with enriched beatmapset stubs stored as Hub store rows (`search_index_sets` / `search_index_diffs`). Apply secondary filters (stars, bpm, length, free-text query, creator) at `GET /search` / `GET /search/all` request time via SQL. Do not reintroduce exact multi-filter primes as the primary model. Do not serve a page by `JSON.parse` of the whole catalogue.

Optional Cloudflare reverse-proxy edge caching of `/search` responses is controlled by origin headers and must be killable without a code deploy.

## Reason

Exact-hash primes for every stars/bpm/query combo do not scale and force empty stubs that cannot be re-filtered correctly. One Ranked 7K (etc.) base prime covers many Download Maps queries when stubs carry metadata.

## Consequences

- Admin create UI / `POST /admin/cache` accept base fields only.
- `hashQueryParams` ignores secondary filters; boot may strip them from stored `query_params`.
- After deploy, boot migrates leftover `beatmapset_ids` JSON into index rows. Legacy id-only blobs get empty diffs until re-prime (star filters stay empty).
- Star filter is any-difficulty-in-range (`EXISTS` on diffs), not set-level min/max overlap.
- Count / download-all use `GET /search/all`, not N paged `GET /search` calls.
- Edge cache: JSON needs a CF Cache Rule (Eligible for cache on `/search*`); headers alone are insufficient.
- Kill switches: `HUB_SEARCH_INDEX=0`, `HUB_SEARCH_HTTP_CACHE=0`, and CF Bypass — see Hub feature doc incident order.
- Safe rollout: ship with `HUB_SEARCH_HTTP_CACHE=0` (compose default) until validated, then enable HTTP cache + CF rule.

## Relevant implementation

- `apps/hub/src/services/cache.ts`
- `apps/hub/src/services/searchIndex.ts`
- `apps/hub/src/routes/search.ts`
- `apps/hub/src/services/hubEnv.ts`
- `apps/server/src/mirrors/hubSearch.ts`
- `knowledge/features/hub/index.md`
