---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/mirrors.ts
  - apps/server/src/mirrors/batchJob.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/public/features/download
---

# Download mirrors

## Purpose

Fetch beatmap sets via configured mirrors (hinai / nerinyan / osu.direct) from the UI.

## Business rules

1. Only one mirror batch download runs at a time (`job.running`).
2. "Count all missing" / "Download all missing" require **Hide maps I already own** to be active on the submitted search (they always exclude owned/pending server-side).
3. Toggling that checkbox commits immediately so those actions do not stay disabled until Search.
4. In-memory locks (`job.running`, `openingInProgress`) are cleared on server startup via `clearStuckMirrorBatchLocks()` (same pattern as `clearStuckRealmReaderPause`).
5. A second **Stop** while status is already `stopping` force-clears the lock so the UI cannot stay stuck if a download slot ignored cancellation.

## Important symbols

- `apps/server/src/routes/mirrors.ts`
- `apps/server/src/mirrors/batchJob.ts:clearStuckMirrorBatchLocks()`
- `apps/server/src/mirrors/batchJob.ts:stopMirrorBatchJob()`
- `apps/server/public/features/download/*`

## Dependencies

- settings / path configuration for download targets (inferred — confirm when changing)

## Depended on by

- (standalone download UX)
