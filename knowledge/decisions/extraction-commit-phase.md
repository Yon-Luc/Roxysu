---
last_verified: 2026-10
confidence: verified
touches:
  - apps/realm-reader/src/importJournal.ts
  - apps/realm-reader/src/sync.ts
  - apps/realm-reader/src/reconcileCore.ts
  - apps/realm-reader/src/deltaCore.ts
  - apps/realm-reader/src/importJournal.test.ts
---

# Streamed batches + one short commit phase

## Decision

1. Full extraction, reconcile and incremental extraction write their rows in bounded batches with autocommit. No transaction spans the streaming phase.
2. Every cycle claims an `imports` row as `running` first. Only the **commit phase** (`commitImport` in `importJournal.ts`) flips it to `success`, inside one immediate transaction that also holds everything that must land with it: orphan deletes (`reconcileDeletes`), the catch-up stall counter, the one-shot replay-hash backfill flag, the incremental watermark, `changed*Ids`, and journal pruning.
3. The mirror is trusted only through the latest `success` import. `hasSuccessfulImport` gates bootstrap; `getWatermarks` returns no cursor when no `success` import exists (it never derives a cursor from `MAX()` over data tables then), so `runIncrementalSync` falls back to a full extraction; the analytics pipeline waits while the latest import is `running` and does not run on a `failed` one.
4. An interrupted cycle (crash, kill, thrown error) leaves the import `running` (marked `failed` on the next reader start, or by the server's stale sweep) or `failed`. Partially written batches stay in the mirror, which is safe because upserts are idempotent and the next cycle re-reads from the last successful cursor.

## Reason

A transaction around a streaming full extraction would hold the SQLite write lock (shared with the Bun server, `busy_timeout` 30 s) for the whole library import, blocking server writes and risking `SQLITE_BUSY` for them. Per-batch autocommit keeps each lock to one batch. Evaluated alternatives: one giant transaction (rejected: long WAL write lock, large WAL growth); a generation or "partial extraction" flag (rejected: it would duplicate what the `imports` status already says, and every reader already trusts that status); one transaction per phase (rejected: phases are still tens of thousands of rows and finalising the import row last already gives the same guarantee).

## Consequences

- Never write `success` (or the incremental watermark) outside `commitImport`, and never move work that must be atomic with it (deletes whose ids feed `changed*Ids`, one-shot flags that imply a null analytics delta) out of the commit transaction.
- Keep the commit phase short: no Realm reads, no per-row mapping; only SQLite statements over already collected ids.
- New logic that needs tests under Bun belongs in the Realm-free modules (`importJournal.ts`, `reconcileCore.ts`, `deltaCore.ts`); `sync.ts` stays a thin Realm adapter because importing `realm` crashes Bun.
- Incremental extraction is no longer one transaction: a crash mid-delta leaves some delta rows written without a new cursor; the next cycle re-imports the same delta.

## Relevant implementation

- `apps/realm-reader/src/importJournal.ts` — `commitImport()`, `getWatermarks()`, `failImport()`
- `apps/realm-reader/src/sync.ts` — `runFullSync()`, `runReconcileSync()`, `runIncrementalSync()`
- `apps/realm-reader/src/importJournal.test.ts` — mid-run failure and commit rollback tests
