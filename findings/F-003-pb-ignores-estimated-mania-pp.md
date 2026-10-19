---
id: F-003
feature: sessions
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Personal best uses raw PP while mastery uses estimated mania PP

## What

`runRetryEngine` marks `score_metrics.is_pb` by comparing `scores.pp`, and treats a null PP as worse than any number. `runMasteryEngine` ranks the same scores with `resolveScorePp`, which fills in a lazer-master curve estimate for no-mod and mirror mania scores that have no stored PP.

Session PB counts, the PB flag, and compare chips can therefore point at a different score than mastery `best_pp` and practice-library PP ordering.

## Why

Two rankers exist. The retry engine never calls `resolveScorePp`. A mania score with accuracy 99% and null PP loses to a score with 1 stored PP, even when the curve would rank the null-PP score higher. Stats copy documents PP-curve estimation as no-mod only; the retry path does not apply that rule either, so the two surfaces disagree for the same rows.

## How to improve

Use one rank function. Extend the PB comparison so both `runRetryEngine` and mastery call `resolveScorePp` (including the no-mod / mirror gate) before choosing the best score on a beatmap.

## Potential gain

“PB”, mastery best PP, and library PP sort agree on mania scores that lazer did not persist a PP for.

## Evidence

- `apps/server/src/analytics/retry.ts` (lines 99–114): `const pp = row.pp ?? -Infinity`.
- `apps/server/src/analytics/mastery/engine.ts` (lines 124–155): `resolveScorePp(...)` then `agg.bestPp`.
- `apps/server/src/mania-rating/estimateScorePp.ts` `resolveScorePp`.

## Status

Fixed. `runRetryEngine` (`apps/server/src/analytics/retry.ts`) now loads lazer-master curves (`loadManiaPpCurves`, scoped to the scoped beatmaps on scoped runs) and ranks each score with `resolveScorePp`. It uses the shared `comparePbRank` from `apps/server/src/scores/pbCompare.ts`, whose `loadPbCompareForBeatmaps` also resolves PP before ranking, so `is_pb`, session `pbCompare`, and mastery `best_pp` agree. Tests: `analytics/retry.test.ts` (null-PP no-mod and mirror-only scores versus a tiny stored PP, rate-mod not estimated, no-curve fallback, ties, scoped run, pbCompare agreement). Knowledge: `features/sessions/` rule 16, `features/stats/`.
