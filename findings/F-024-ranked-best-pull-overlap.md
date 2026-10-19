---
id: F-024
feature: online-score-pull
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Ranked-best pulls for the same player can overlap

## What

`pullRankedBests` has no per-user lock. `replaceStored` deletes every cached best for that osu! user and ruleset, then inserts the new pages in chunks. Two overlapping crawls interleave those writes.

## Why

A force refresh and a normal pull, or two clients, both pass the cache check and both call `walkPages`. The shared osu! budget is about 50 requests per minute, so the overlap also spends quota twice.

## How to improve

Coalesce in-flight work on `(osuUserId, ruleset)` and share one promise with every waiter.

## Potential gain

The cached bests stay a single complete set, and two clicks do not double the osu! crawl.

## Evidence

- `apps/hub/src/services/osuScores.ts` `pullRankedBests` (about lines 357–401): sets progress to `running` and walks pages with no mutex.
- `replaceStored` (about lines 273–297): delete-all, then chunked insert.

## Status

Fixed. `pullRankedBests` in `apps/hub/src/services/osuScores.ts` now shares one in-flight promise per `osuUserId:ruleset` (`createKeyedFlights` in `services/singleFlight.ts`); a force refresh arriving mid-pull joins the running pull. The entry is cleared when it settles. Tests: `services/singleFlight.test.ts` (keyed coalescing); the real crawl is not driven in a test because Hub `db` is a process singleton that may point at the dev `data/hub.sqlite`.
