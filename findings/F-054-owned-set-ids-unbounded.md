---
id: F-054
feature: download-mirrors
kind: perf
severity: medium
confidence: verified
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
