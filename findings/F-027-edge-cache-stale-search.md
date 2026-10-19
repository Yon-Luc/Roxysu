---
id: F-027
feature: hub
kind: correctness
severity: medium
confidence: verified
---

# Edge cache can keep search pages after the index changes

## What

On an index hit, Hub sets `CDN-Cache-Control: public, max-age=…` when HTTP caching is enabled. The cached JSON includes the beatmapset list. A later origin refresh does not change that object until the edge TTL expires.

## Why

The response may say `stale: true` while still listing the old ids. Download Maps and community browse then count and download from the cached page. Purging the edge is an operational step, not something refresh does.

## How to improve

Put the index generation in the cache key, or send `no-store` when the row is stale. Purge the edge when a refresh commits.

## Potential gain

Search pages follow the index that was just primed, without a manual CDN purge.

## Evidence

- `apps/hub/src/routes/search.ts` (about lines 214–230): `setEdgeCache` on a hit, body includes `cached`, `stale`, and the beatmapset ids.
- `knowledge/decisions/hub-search-base-index.md` treats the edge cache as killable; the refresh path does not kill it.
