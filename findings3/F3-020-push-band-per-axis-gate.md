---
id: F3-020
feature: rework-dan
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Push needs 30 band maps per axis while the summary reports the overall peak

## What

`recommendPush` runs one pool per axis, and `pickCandidatesInRange` returns empty when that
axis's peak is 0. Peak is 0 unless at least `topPlays` (30) distinct maps sit inside the
90-95% band for that axis.

`summaryFor` for Push reads the overall peak, so a player with 15 RC and 15 LN band plays is
told "Found 0 maps for pushing above your 90%+ clear level (~8.5 stars)" - a level it claims
to have but returns nothing for.

The shortfall copy ("in your top 30 rated maps") also misdescribes the rule, which is 30 maps
in the band chosen from all plays, and the band is a closed 5-point window while the model
behind Push is `topN` of the hardest band maps.

## Why

The gate in `applyBandLevels` is per-band-per-axis, but the summary and the empty-result
decision use `skill.overall`/`peakOverall`. The two layers disagree about what "available"
means.

## How to improve

In `summaryFor`, report per-axis availability, or the max over axes, and use the real band
semantics in the copy. Alternatively let `recommendPush` fall back to the overall peak when a
per-axis peak is 0 instead of returning an empty pool.

This is also the seam `todo.txt` wants configurable thresholds through, so fix it together
with that change rather than twice.

## Evidence

- `apps/server/src/analytics/recommend/sevenKSkill.ts:569-570`, `:34-58` - per-axis peak
- `apps/server/src/analytics/recommend/pick.ts:34-39` - empty pool on zero peak
- `apps/server/src/analytics/recommend/strategies.ts:94-111` - the gate
- `apps/server/src/analytics/recommend/summary.ts:46-51` - overall peak in the copy
- `apps/server/src/analytics/recommend/recommend.ts:137` - empty-result branch
