---
cand: B3
reopens: F-027
feature: hub
kind: correctness
severity: low
confidence: verified
status: proposed
---

# Edge TTL is not clamped to remaining freshness

## Problem

A `hit-fresh` page that is not already refreshing gets the full `edgeCacheTtlSecondsForRow` value. That helper uses the refresh interval or `hubCacheTtlMs()`, capped by `hubSearchEdgeCacheMaxAgeSec()` (default 3600). It does not subtract the row's age.

A row one minute from stale can be edge-cached for an hour. The browser is already `private, no-store`. Only `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control` are public. Nothing in the repo purges that edge entry when a refresh commits.

## Potential solution

Clamp. Do not add a Cloudflare purge client. There is no purge call, no cache-tag, and no API token in this app. Purge would be a new integration. Clamping is the fix that matches the code.

`searchPageEdgeTtlSec` needs the row's `cachedAt` (or an age in seconds) and the Hub freshness window:

```ts
const ageSec = Math.floor((now - cachedAtMs) / 1000);
const remaining = Math.floor(hubCacheTtlMs() / 1000) - ageSec;
const ttl = Math.min(rowTtlSec, remaining);
if (ttl < 5) return null;
return ttl;
```

`null` already becomes `setNoStore`. A page cached in the last few seconds of freshness must not be pinned.

Call site in `search.ts` already has `row.cachedAt` and passes `edgeCacheTtlSecondsForRow(row)`. Pass `cachedAt` through. Keep refusing `hit-stale`, `miss`, cache disabled, and an in-flight refresh.

`/search/all` already calls `setNoStore`. Leave it.

## Do not

- Do not set `s-maxage` on `Cache-Control`. The split (browser no-store, CDN max-age) is intentional.
- Do not treat "no purge" as a reason to skip the clamp. The clamp is what stops a fresh page outliving the row.

## Touch

- `apps/hub/src/routes/search.ts` — `searchPageEdgeTtlSec` and the call near line 228
- `apps/hub/src/routes/search.edgeCache.test.ts`

## Tests

The current test expects `searchPageEdgeTtlSec("hit-fresh", 1, true, 900)` to be 900. That case stays 900 when the row was just cached. Add:

- age leaves 30 s of freshness, row TTL 900 → 30
- age leaves 2 s → `null`
- age already past `hubCacheTtlMs` → `null` (should not be called for `hit-fresh`, but the helper must not return a positive TTL)
