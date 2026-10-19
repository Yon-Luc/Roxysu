---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/pipeline.ts
  - apps/server/src/analytics/retry.ts
  - apps/server/src/analytics/session.ts
  - apps/server/src/analytics/mastery/engine.ts
  - apps/server/src/analytics/statistics.ts
  - apps/realm-reader/src
---

# Flow: Score indexing & analytics

## User intent

After new plays (or deletes), keep sessions/mastery/stats consistent.

## Flow

```
import success (changedScoreIds or full)
    ↓
analytics pipeline incremental or full rebuild
    ↓
retry (scoped writes when beatmapIds known) / sessions (delta repair of the sessions the new scores touch, full rebuild when `score_count` does not add up) / mastery / statistics
    ↓
SSE consumers refresh
```

## Business guarantee

Soft deletes and orphan cleanup feed session/mastery refresh; large/full imports may force full rebuild. A `running`/`failed` import while scores have moved past the last successful watermark forces a full rebuild. `running` older than 10 minutes is treated as idle. Delta retries still read the global score timeline for correct `retry_index`, but only rewrite `score_metrics` for affected beatmaps. The session engine repairs only the sessions the new `scoreIds` touch (windowed re-bucketing, same reconcile routine as the full rebuild) before falling back to a full rebuild. `is_pb` ranks by resolved PP (`resolveScorePp`), the same value mastery `best_pp` uses. Mastery rows carry Practice/QL play aggregates (`best_score`, `best_misses`, …).

## Implementation references

- `apps/server/src/analytics/pipeline.ts`
- `apps/server/src/analytics/session.ts`
- `apps/server/src/analytics/retry.ts`
- `apps/server/src/analytics/mastery/*`
- `apps/server/src/analytics/statistics.ts`
