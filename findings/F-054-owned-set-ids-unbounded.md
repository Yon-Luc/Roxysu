---
id: F-054
feature: download-mirrors
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Owned beatmapset ids are returned as one unbounded array

## What

`GET /api/mirrors/owned-set-ids` selects every non-deleted set with `onlineId > 0` and returns the full array. There is no page size.

## Why

A large mirror becomes a multi-megabyte JSON response built on the request path. Repeat calls repeat the scan. The client app is localhost-only by default; the cost is still memory and latency on the machine running Roxysu.

## How to improve

Paginate or return a compact bitmap with an ETag. Let the client diff incrementally.

## Potential gain

Download Maps stays responsive for players with very large libraries.

## Evidence

- `apps/server/src/mirrors/ownership.ts` `loadOwnedSetOnlineIds` (lines 15–22): `selectDistinct` with no limit.
- `apps/server/src/routes/mirrors.ts` (lines 112–114): returns `{ setIds: [...owned] }`.

## Status

Fixed. `GET /api/mirrors/owned-set-ids` is now keyset-paginated (`?after=<id>&limit=<n>`, default 20,000, max 50,000) and returns `{ setIds, nextAfter, version }`. It sends a weak `ETag` derived from an SQLite aggregate (count, id sum, max id) and answers `If-None-Match` with 304. A request without parameters still works and returns the first page (all ids for libraries under the default). The only in-repo client, `fetchOwnedSetIds` in `apps/server/public/lib/api.ts`, walks `nextAfter`. Files: `apps/server/src/mirrors/ownership.ts`, `apps/server/src/routes/mirrors.ts`; tests `ownership.pagination.test.ts`, `routes/mirrors.routes.test.ts`.
