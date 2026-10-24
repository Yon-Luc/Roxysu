---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/map-analysis/reworkDanJob.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/map-analysis/computeReworkDan.ts
  - apps/server/src/tosu/analyze.ts
  - apps/server/src/analytics/recommend
  - packages/mania-difficulty
  - packages/mania-pattern-analysis
---

# Flow: Rework backfill to recommend

## User intent

Populate mania difficulty estimates so 4K/7K recommendations and `dan:`/`rework:` filters work well.

## Flow

```
(optional) Hub calc bundle pull gap-fills matching hashes
    ↓
Settings POST /api/settings/rework-dan/start
  (or Jobs onboarding /jobs/start-recommended)
    ↓
job reads .osu from lazer files  (one batch = one SQLite transaction)
    ↓
analyzeManiaOnceFromText  — parses once, runs the calculator once
    (withPattern, windowMs unset → no skill-timeline allocation;
     every 128 notes, a heap-ceiling trip releases the graph, stores a failed
     rework row and a failed pattern row, and pauses the job)
    ↓
reworkDanLabel(star, lnRatio, keys) → tier from dans.json
    ↓
persist Dan ratings store (beatmap_dan_ratings, algorithm = 'mania-difficulty')
   + beatmap_pattern_analysis (dominant skill) — same pass
    ↓
dan: / rework: / reworkstars: / pattern: query fields + `rework` display mode
    ↓
GET /api/practice/recommend + Session Suggest UI
```

Also see [hub-calc-bundle-pull.md](hub-calc-bundle-pull.md).

Editing `dans.json` only needs `POST /api/settings/rework-dan/relabel`, which
rewrites labels from stored stars without re-reading charts.

The pattern job is still available for maps the dan job has not rated, but a
full dan backfill also fills the pattern store, so running both is not required.

## Flow: dominant skill pattern analysis

```
Settings POST /api/settings/pattern-analysis/start
    ↓
@roxysu/mania-pattern-analysis  analyzeManiaBackfillFromOsuText
    (windowMs null — chart-level skills only, no timeline;
     every 128 notes, a heap-ceiling trip releases the graph, stores a failed
     pattern row, and pauses the job — that chart is skipped until a recompute)
    ↓
skillProfile() → dominant / secondary / confidence
    ↓
persist beatmap_pattern_analysis (algorithm = 'mania-skill-v1')
    ↓
pattern: / dominant: / style: filters + practice browser skill chart
```

On-request detail still bins the skill timeline. The backfill does not. A chart
that would exhaust the heap is a failed row, not a dead server.

## Flow: modded plays → dan difficulty variants

```
server boot / sync.finished (debounced)
    ↓
dan variant job scans mania scores (full scan at boot; changed_score_ids per import;
null delta -> full scan only if the mania score fingerprint changed)
    ↓
resolveDanVariant() → distinct combos (beatmap × rate × Invert)
    ↓
backfill (memory-guarded, yields per combo) reads .osu, estimates with { speedRate, cvtFlag: "IN" }
    ↓
persist beatmap_dan_rating_variants (algorithm = 'mania-difficulty')
    ↓
run finished with rows written -> invalidatePlayerStatsCache()
    ↓
skill axes / band plays / dashboard read variant stars per play
```

## Flow: mod-aware dan reads (preview / live analysis)

```
tosu snapshot mods (MR/IN/HO + rate) or detail/profile read
    ↓
analyze.ts reworkFromText(cvtFlag)     |   getReworkDan(db, id) on beatmap detail
    ↓                                  |
ephemeral analysis.rework              |   Dan ratings store (persisted NM row)
(never persisted; rate via clockRate)
```

Variant rows are for skill/stats aggregation of modded plays, not a separate
list/recommend request-path compute. `GET /api/practice`, `GET /api/search`,
and `GET /api/practice/recommend` never start rework/pattern jobs.

## Business guarantee

Recommendations and `dan:` / `rework:` / `pattern:` filters use persisted estimates only. Without the Settings jobs, 4K/7K suggest quality is limited and those filters miss unrated maps. `GET /api/practice`, `GET /api/search`, and `GET /api/practice/recommend` do not start or run rework/pattern compute. Dan difficulty variants are likewise computed only by the background job — modded plays without a computed variant are excluded from skill aggregation until rated.

## Implementation references

- `apps/server/src/map-analysis/reworkDanJob.ts`
- `apps/server/src/map-analysis/danVariantJob.ts`
- `apps/server/src/map-analysis/patternAnalysisJob.ts`
- `packages/mania-difficulty`
- `packages/mania-difficulty/dans.json`
- `apps/server/src/analytics/recommend/*`
