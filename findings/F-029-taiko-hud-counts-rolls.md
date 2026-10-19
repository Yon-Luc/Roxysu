---
id: F-029
feature: preview-replay
kind: correctness
severity: medium
confidence: verified
---

# Taiko rewatch HUD counts drumroll and swell rows

## What

`simulateTaikoJudgments` adds to accuracy counts only when `kind === "hit"`. Drumroll ticks and swell rows are still pushed as judgments with `great` or `miss`. The rewatch HUD and the video-export HUD walk every judgment and add it to accuracy, combo, and the judgment counters.

## Why

The footer “Sim” number uses the hit counts. The live HUD uses the raw judgment list. Drum-heavy maps make the on-screen accuracy diverge from the sim and from osu! taiko, which scores hits rather than every roll tick.

## How to improve

In the rewatch HUD and `computeHud`, skip judgments whose `kind` is not `hit`, matching `taikoAccuracyFromCounts`.

## Potential gain

Combo and accuracy on taiko rewatch and exported video match the simulated result.

## Evidence

- `apps/server/src/replay/taikoJudge.ts` (lines 137–149): counts update only for `kind === "hit"`.
- `apps/server/public/components/ScoreReplayModal.tsx` (lines 1036–1045): every judgment updates `accWeight`, `judged`, and `counts`.
- `apps/server/public/lib/replayVideoExport.ts` `computeHud` (about lines 699–706): same loop.
