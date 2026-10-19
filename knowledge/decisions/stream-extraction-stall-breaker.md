---
last_verified: 2026-10
confidence: verified
touches:
  - apps/realm-reader/src/sync.ts
  - apps/realm-reader/src/upsert.ts
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/reconcileCore.ts
  - apps/realm-reader/src/deltaCore.ts
  - packages/db/src/settings-keys.ts
---

# Streamed extraction + reconcile-only catch-up

## Decision

1. Realm extraction **streams**: objects are mapped one at a time and upserted in
   bounded batches (`streamMappedUpsert` in `upsert.ts`; the incremental delta and
   flag healing batch the same way in `deltaCore.ts`, hydrating dependencies per
   batch). No cycle materializes all mapped rows at once; only per-class ID sets (for orphan
   deletion) and running watermarks span passes.
2. Missed-row healing happens **only on the periodic reconcile** cadence. The
   incremental cycle imports its watermark delta and never re-runs full-ID
   catch-up scans.
3. Reconcile catch-up is gated by a **stall breaker**
   (`sync.catchup_stalled` setting): if a round cannot shrink the Realm/SQLite
   row-count gap (rows that can never mirror, e.g. a Beatmap whose BeatmapSet
   link is gone), the counter rises; at ≥ 3 fruitless rounds automatic catch-up
   stops until any successful incremental moves rows again (which resets it) or
   the gap closes. Only the catch-up is skipped: reconcile still collects the Realm
   id sets and deletes orphans, because unmirrorable Realm rows and real orphans
   can coexist. A round is fruitless only when the catch-up moved zero rows;
   deletes never re-arm or advance the counter (`startCountGapRound` /
   `finishCountGapRound` in `reconcileCore.ts`).
4. Failed cycles back off exponentially (`REALM_RETRY_MS` → ×2, capped by
   `REALM_RETRY_MAX_MS`, default 120 s), reset on success — a persistently
   failing heavy cycle must not hot-loop every 10 s.

## Reason

Whole-library materialization plus an inline per-incremental catch-up produced
multi-GB RSS spikes and, whenever the count gate could not converge (unmirrorable
Realm rows), repeated near-full scans every cycle. See
[features/live-sync](../features/live-sync/index.md) and
`docs/analysis/realm-reader-and-db.md` (M2).

## Consequences

- Peak reader heap is flat regardless of library size; RSS after large boots is
  dominated by memory-mapped `client.realm` page cache, not heap.
- A permanently unmirrorable gap costs at most 3 catch-up attempts, then one log
  line and one Realm id scan (no catch-up upserts) per reconcile until new rows
  import or the gap closes. Real missed rows still heal within
  one reconcile interval (~10 min).
- `REALM_DEBUG_MEM=1` logs `process.memoryUsage()` per cycle;
  `REALM_MAX_OLD_SPACE_MB` (desktop spawn env) optionally caps the reader's V8
  old space — opt-in because the desktop shell does not auto-respawn the reader.

## Relevant implementation

- `apps/realm-reader/src/upsert.ts` — batch upserts + streaming helper
- `apps/realm-reader/src/reconcileCore.ts` — stall breaker, count-gap round, orphan deletes
- `apps/realm-reader/src/deltaCore.ts` — streamed incremental delta, flag healing
- `apps/realm-reader/src/sync.ts` — runFullSync / runReconcileSync / runIncrementalSync
- `apps/realm-reader/src/index.ts` — failure backoff, memory logging
- `packages/db/src/settings-keys.ts` — `SYNC_CATCHUP_STALLED_KEY`
