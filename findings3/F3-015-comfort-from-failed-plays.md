---
id: F3-015
feature: rework-dan
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Comfort skill is computed from plays the player failed

## What

Comfort (`overall`/`rc`/`ln`/`fln`) is a weighted mean over the top-30 hardest rework-rated
plays. Plays under 80% accuracy get weight 0, and when every point in the window has weight
0, `weightedMean` returns the plain average of those points instead of 0.

A player whose rated plays are all maps above their level - all below 80% accuracy, the
normal shape for someone improving - gets comfort equal to the average star rating of maps
they cannot clear. `recommendDeficit` and `recommendSkillset` target that comfort plus or
minus 10-20%, so they recommend maps far above the player's level. `todo.txt` explicitly
asks that recommended maps not sit significantly above the player's skill.

Cohort-specific: current mirror data has 9 of 3,316 rated plays under 80%, so the top-30
window always contains weighted points and the path does not fire today.

## Why

`accuracyWeight` clamps at 0 for accuracy below 0.8, and the comfort loop multiplies by it
with no floor. `totalWeight === 0` is therefore a normal state, and the `if (totalWeight <= 0)`
branch averages zero-weight points. Cold start avoids this with `Math.max(0.05, ...)`; the
main path does not.

## How to improve

In `weightedMean`, drop zero-weight points, or return 0 when total weight is 0. Give
`accuracyWeight` a small floor in `estimateSevenKSkillFromPlays`, matching
`coldStartFromPlays`.

Add a test: six plays at 0.75 accuracy on 8-star maps must not produce a comfort level that
Deficit then targets.

## Evidence

- `apps/server/src/analytics/recommend/sevenKSkill.ts:125-138` - `accuracyWeight`, `weightedMean` fallback
- `apps/server/src/analytics/recommend/sevenKSkill.ts:696-712` - the comfort loop
- `apps/server/src/analytics/recommend/sevenKSkill.ts:439`, `:522` - cold-start floors
- `apps/server/src/analytics/recommend/strategies.ts:375-392` - Deficit targeting comfort

## Status

Fixed 2026-11-23. `weightedMean` returns 0 when total weight is 0 instead of averaging the
zero-weight points. The cold-start paths already floored their weights at 0.05, so only the
main comfort loop was affected; the fix sits in the shared helper so `clearLevelFromPlays`
gets the same guarantee.

Tests: `comfort with no weighted evidence` (2) — six sub-80% plays produce comfort 0, and a
sub-80% play does not move the comfort computed from graded plays. `bun test` on the
recommend suite: 35 pass.
