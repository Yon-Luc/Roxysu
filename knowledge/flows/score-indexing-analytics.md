---
last_verified: 2026-04
confidence: verified
touches:
  - apps/server/src/analytics/pipeline.ts
  - apps/server/src/analytics/retry.ts
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
retry (scoped writes when beatmapIds known) / sessions (append-delta when possible) / mastery / statistics
    ↓
SSE consumers refresh
```

## Business guarantee

Soft deletes and orphan cleanup feed session/mastery refresh; large/full imports may force full rebuild. A `running`/`failed` import while scores have moved past the last successful watermark forces a full rebuild. `running` older than 10 minutes is treated as idle. Delta retries still read the global score timeline for correct `retry_index`, but only rewrite `score_metrics` for affected beatmaps. Session engine tries an append-only path for new `scoreIds` before a full rebuild. Mastery rows carry Practice/QL play aggregates (`best_score`, `best_misses`, …).

## Implementation references

- `apps/server/src/analytics/pipeline.ts`
- `apps/server/src/analytics/session.ts`
- `apps/server/src/analytics/retry.ts`
- `apps/server/src/analytics/mastery/*`
- `apps/server/src/analytics/statistics.ts`
