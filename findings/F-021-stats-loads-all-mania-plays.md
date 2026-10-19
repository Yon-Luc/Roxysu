---
id: F-021
feature: stats
kind: perf
severity: medium
confidence: verified
status: partial
---

# Stats loads every mania play for a keymode on a cache miss

## What

A stats cache miss runs `loadManiaAnalyticsRows`, a join of all scoped mania scores for that key count, then several in-memory passes for skill history, trends, rank mix, and mappers.

## Why

The page is correct in loading the plays once per keymode, and the working set is unbounded. A large mirror pays that cost per keymode tab until the cache fills.

## How to improve

Aggregate rank and trend counts in SQL. Keep the row scan for skill history, and invalidate by import delta so a cache miss is rare.

## Potential gain

Opening Stats on a large library uses less memory and returns sooner.

## Evidence

- `apps/server/src/analytics/playerStats.ts` `loadManiaAnalyticsRows` (about lines 167–198) and `getPlayerStats` (about lines 488–544), which fans the full array into progression, rank, and skillset helpers.

## Status

Partial. Measured on a synthetic 200k-score mirror (about 64k plays in one keymode, username + gamemode scope): the per-keymode row load is about 105 ms of a roughly 540 ms miss; skill history (`estimateSevenKSkillWithHistoryFromPlays`, in `recommend/sevenKSkill.ts`) is about 250-290 ms and is not touched here. Pushing rank mix, play-time buckets, and summary counts into SQL aggregates was tried and rejected: each aggregate re-scans the join (about +90 ms for one grouped query, +550 ms for separate ones) while the in-memory passes they replace cost under 10 ms, and the row set is still needed for progression, mapper ranks, skill history, and skillset mix (per-play PP resolution depends on mods and per-beatmap curves).

What changed in `apps/server/src/analytics/playerStats.ts`: `loadManiaAnalyticsRows` plus five in-memory passes became one streamed pass (`streamManiaPass`, `better-sqlite3`/`bun:sqlite` `iterate`) that folds each play into the summary, rank mix, play-time buckets, daily/weekly progression buckets, and mapper aggregates, and keeps only a compact `PlayCandidate` (beatmap id, mods, accuracy, played-at, base Sunny rating) for non-hidden plays. Per-play PP is resolved once instead of twice; the score scope is resolved once instead of per query; the dan variant lookup only queries beatmaps that have modded plays. Output is identical: a before/after comparison of the full `getPlayerStats` payload (3 scopes x 2 keymodes x day/week, session fields excluded because F-016 changes them) produced no differences. Result: no full row array is retained (heap after three runs 66 MB to 43 MB), CPU time unchanged within noise.

Remaining: every scoped play is still scanned and one compact object per non-hidden play is held for skill history, so memory is still linear in plays and a cache miss still costs about half a second per 64k plays. Reducing that further needs changes in the skill history estimator or an incremental per-import-delta structure, which are out of scope here.
