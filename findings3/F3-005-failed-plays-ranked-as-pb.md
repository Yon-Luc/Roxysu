---
id: F3-005
feature: analytics
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Failed plays are ranked as PB and given a fabricated PP

## What

`is_pb`, `mastery.best_pp` and `mastery.best_accuracy` are computed over every scoped
score, including `rank = -1` fails and quits. A failed play has no stored PP, so
`resolveScorePp` fills in the lazer-master curve estimate from accuracy alone. A fail
therefore receives a full-combo-theoretical PP.

Measured in the local mirror on 2026-11-23:

| Query | Result |
| --- | --- |
| `is_pb = 1` on `rank = -1` | 15 rows, all with `pp IS NULL` |
| mastery rows whose PB is a fail | 11 rows, 1596.61 pp total, max 480.87 pp |
| 7K fails at >= 90% accuracy inside the default Push band | 7 rows |

The practice library shows that PP, `pp:` filters and sorts rank by it, and every session
shows a PB badge on a failed play.

## Why

`resolveScorePp` has no grade input. Its signature is
`{pp, accuracy, mods, rulesetShortName, curve}`, so "PP is missing because lazer did not
persist it" and "PP is missing because the play failed" are indistinguishable.

Callers `runRetryEngine`, `runMasteryEngine`, `getPlayerStats`, `routes/dashboard.ts` and
`routes/sessions.ts` all pass fails through. The graded gate exists only in the accuracy
aggregates (`streamManiaPass`, `bumpBucket`).

## How to improve

Add `rank` to `resolveScorePp` and return `null` when `rank === -1`: curve estimates are
for completed plays only.

Then:

1. Skip ungraded rows when folding `bestPp`/`bestAccuracy`/`bestMisses` in `runMasteryEngine`.
2. Exclude them from `bestByBeatmap` in `runRetryEngine`, so `is_pb` can only land on a graded play.
3. Force one full retry-engine and mastery rebuild to repair stored rows.

## Evidence

- `apps/server/src/mania-rating/estimateScorePp.ts:18-37` - no grade parameter
- `apps/server/src/analytics/retry.ts:125-142` - `bestByBeatmap` folds every score
- `apps/server/src/analytics/mastery/engine.ts:91-123` - folds every score
- `apps/server/src/analytics/playerStats.ts:383`, `:434` - the graded gate that does exist
- `knowledge/features/stats/index.md:56` - "A quit does not become the best play on a map"
- `knowledge/features/sessions/index.md:65` - PB badge rule

## Notes

F-003 unified the PB rankers on `resolveScorePp`. The unification made this bug reach
every surface at once; it did not create it.

## Status

Fixed 2026-11-23, in four places:

1. `resolveScorePp` takes `rank` and returns `null` for `rank === -1` before the curve branch. A
   stored PP still wins, so nothing real is hidden.
2. `runRetryEngine` skips ungraded rows when building `bestByBeatmap`, so `is_pb` can only land
   on a graded play, and a map with only fails has no PB.
3. `runMasteryEngine` folds `best_accuracy`, `best_score`, `best_misses` and `best_pp` from
   graded plays only. `play_count` and `last_played_at` still count every play, because a fail
   is still practice.
4. `topTwoByBeatmap` skips ungraded rows, so session `pbCompare` can never point at a fail.

Every caller now passes the grade: `routes/{dashboard,scores,sessions,beatmaps,overlay}.ts` and
`analytics/{playerStats,statistics}.ts`.

**Repair of existing rows.** `needsFullRebuild` probes for `is_pb = 1` on a `rank = -1` score;
finding one forces one full rebuild of the retry, session, mastery and statistics engines. The
probe stops matching once repaired, so it is self-healing rather than a persisted marker.

Tests: `resolveScorePp grade gate` (3), `runRetryEngine with failed plays` (2),
`runMasteryEngine with failed plays` (2), `topTwoByBeatmap grade gate` (2),
`pipeline.rebuild.test.ts` (4). Server suite 1020 pass.
