---
id: F3-006
feature: analytics
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# `/stats/skill-plays` lists ungraded plays the rest of Stats excludes

## What

The Patterns plays panel and its "in next dan" tier are built by `loadEnrichedSevenKPlays`,
which has no `rank != -1` predicate. `getPlayerStats` builds its candidates from graded
plays only.

So a failed play can be listed as a qualifying band play, and can displace the graded clear
on the same map via `bestPlayPerMap`, which picks highest stars then highest accuracy. The
panel's `currentLevel`/`nextDanLabel` therefore come from a different candidate set than the
page's Current skill. Seven fails on rated 7K maps currently fall inside the default Push
band (accuracy >= 0.90).

## Why

Two universes for the same "best play per map": `streamManiaPass` filters graded before
pushing candidates; `loadEnrichedSevenKPlays` selects straight from `scores` with only
scope, hidden and set filters.

## How to improve

Add `AND s.rank != -1` to the `loadEnrichedSevenKPlays` query so `skillBandPlays` matches
`streamManiaPass`. Longer term, extract the candidate builder so both callers share one
predicate - this is the same class as F3-008 and F3-011.

## Evidence

- `apps/server/src/analytics/skillBandPlays.ts:183-217`, `:353-370` - no `rank` predicate
- `apps/server/src/analytics/playerStats.ts:434` - graded filter in the main pass
- `apps/server/src/analytics/recommend/sevenKSkill.ts:206-225` - `bestPlayPerMap`
- `apps/server/public/features/stats/components/SkillBandPlaysPanel.tsx:184` - consumer

## Status

Fixed 2026-11-23. `loadEnrichedSevenKPlays` adds `AND s.rank != -1`, matching `streamManiaPass`.
