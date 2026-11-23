---
id: F3-019
feature: rework-dan
kind: design-gap
severity: medium
confidence: verified
status: proposed
---

# Nothing invalidates the practice list when ratings change, and the Hub pull skips post-apply steps

## What

`finish()` in the rework and pattern jobs publishes only `dashboard.updated`/`jobs.updated`,
which the client maps to `["dashboard"]`, `["stats"]` and settings keys.

After "Calculate missing dans" finishes, an open practice list (60 s `staleTime`) and an open
beatmap page keep showing the pre-backfill state. The same is true of
`POST /settings/rework-dan/relabel` (no event at all) and of the manual
`POST /settings/calc-bundle/pull` (publishes `dashboard.updated`, never `calc-bundle.applied`).

That pull path also skips the `nullIllegalShapeLabels` sweep the shipped-file path runs, so
dev installs keep cross-keymode shapes until a pattern job starts - contrary to how
`vocabulary.md` describes calc-bundle applies.

## Why

Only `mastery.updated` and the shipped-file apply invalidate `["practice"]`/`["beatmap"]`.
No event represents "rework or pattern rows changed".

## How to improve

Publish `calc-bundle.applied`, or a new `ratings.updated`, from the jobs' `finish()`, from the
relabel route and from `pullAndApplyCalcBundle`. Call `nullIllegalShapeLabels` after any
apply, not only the shipped-file one.

## Evidence

- `apps/server/public/lib/sse.ts:126-147`, `:188-193` - the event-to-query map
- `apps/server/src/map-analysis/reworkDanJob.ts:182-193` - `finish()` publishes dashboard only
- `apps/server/src/map-analysis/calcBundle.ts:785-796`, `:878`, `:896` - pull path
- `apps/server/src/routes/settings.ts:244-246` - relabel route publishes nothing
