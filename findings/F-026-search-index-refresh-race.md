---
id: F-026
feature: hub
kind: correctness
severity: medium
confidence: verified
---

# Search-index refresh is not single-flight per cache row

## What

Stale public search refreshes are deduped with an in-memory `refreshing` set. Admin `POST /cache/:id/refresh` and cron call `refreshCache` directly. `refreshCache` deletes every `search_index_sets` row for that cache inside a transaction, then inserts the new stubs.

## Why

Two refreshes of the same id can overlap. Readers can observe an empty or half-replaced index between the delete and the insert of the other transaction.

## How to improve

Share one `Map<cacheId, Promise>` across public stale refresh, admin refresh, and cron.

## Potential gain

Download Maps and community browse do not briefly see an empty index while a prime runs.

## Evidence

- `apps/hub/src/routes/search.ts` `maybeRefreshStale` (about lines 85–97): local `refreshing` set only.
- `apps/hub/src/routes/admin.ts` (about lines 186–198): `await refreshCache(params.id)` with no shared lock.
- `apps/hub/src/services/cache.ts` (about lines 618–622): delete-and-replace inside the transaction.
