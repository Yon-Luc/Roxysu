---
id: F3-016
feature: rework-dan
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# Dan difficulty variants keep the previous formula's stars after a pin change

## What

`beatmap_dan_rating_variants` rows are never invalidated when the mania difficulty port pin
changes. "Recalculate all" deletes only the Dan ratings store and pattern rows. The variant
job then skips any combo whose `beatmap_hash` still equals the beatmap hash.

Modded plays - the ones a rate-mod player actually has - keep old-formula stars in skill axes
and recommendations. The relabel pass then rewrites their label from the stale star, which
makes the wrong number look authoritative.

## Why

`clearStoredReworkSync` omits the variants table, and `planDanVariantBackfill` treats hash
equality as freshness. Hash equality says nothing about the algorithm or formula version.
`decisions/hub-calc-bundle-version.md` deliberately excludes variants from the calc bundle,
but no other path clears them either.

## How to improve

Delete `beatmap_dan_rating_variants` rows for `REWORK_ALGORITHM` inside
`clearStoredReworkSync`; they re-enter the import and boot combo scan. Or store the port
revision on the variant row and compare it in `planDanVariantBackfill`.

## Evidence

- `apps/server/src/map-analysis/computeReworkDan.ts:698-705` - the clear omits variants
- `apps/server/src/map-analysis/computeDanVariants.ts:285-292` - hash equality as the freshness test
- `apps/server/src/analytics/recommend/sevenKSkill.ts:794-800` - variants feed skill axes
- `knowledge/vocabulary.md` "Dan difficulty variants" - describes variants as formula-versioned rows

## Notes

F-017 and F-018 covered memory and stats-cache invalidation for this job, not staleness.
