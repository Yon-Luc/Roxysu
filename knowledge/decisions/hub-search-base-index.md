---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/services/cache.ts
  - apps/hub/src/routes/search.ts
  - apps/hub/src/services/hubEnv.ts
  - apps/hub/docker-compose.yml
  - knowledge/features/hub/index.md
---

# Hub search base index

## Decision

Prime the Hub search index on **base identity** only (`mode`, `status`, `key`, `sort`) with enriched beatmapset stubs. Apply secondary filters (stars, bpm, length, free-text query, creator) at `GET /search` request time. Do not reintroduce exact multi-filter primes as the primary model.

Optional Cloudflare reverse-proxy edge caching of `/search` responses is controlled by origin headers and must be killable without a code deploy.

## Reason

Exact-hash primes for every stars/bpm/query combo do not scale and force empty stubs that cannot be re-filtered correctly. One Ranked 7K (etc.) base prime covers many Download Maps queries when stubs carry metadata.

## Consequences

- Admin create UI / `POST /admin/cache` accept base fields only.
- `hashQueryParams` ignores secondary filters; boot may strip them from stored `query_params`.
- After deploy, re-prime (or refresh) existing rows so stub JSON replaces bare id lists.
- Edge cache: JSON needs a CF Cache Rule (Eligible for cache on `/search*`); headers alone are insufficient.
- Kill switches: `HUB_SEARCH_INDEX=0`, `HUB_SEARCH_HTTP_CACHE=0`, and CF Bypass — see Hub feature doc incident order.
- Safe rollout: ship with `HUB_SEARCH_HTTP_CACHE=0` (compose default) until validated, then enable HTTP cache + CF rule.

## Relevant implementation

- `apps/hub/src/services/cache.ts`
- `apps/hub/src/routes/search.ts`
- `apps/hub/src/services/hubEnv.ts`
- `apps/server/src/mirrors/hubSearch.ts`
- `knowledge/features/hub/index.md`
