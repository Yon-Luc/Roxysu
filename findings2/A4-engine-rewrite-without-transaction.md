---
cand: A4
feature: sessions
kind: correctness
severity: low
confidence: inferred
status: proposed
---

# Retry and mastery engines wipe then rewrite outside a transaction

## Problem

`runRetryEngine` deletes `score_metrics`, then inserts in batches of 500. `runMasteryEngine` does the same for `mastery`. Each statement autocommits. `runSessionEngine` already wraps its write in `db.transaction`. Foreign keys are on (`ON DELETE no action`).

The engines run in the server. Deletes of parent rows run in the realm-reader, inside `commitImport`'s immediate transaction. WAL serializes writers, so the server waits out the reader's transaction. It does not cover the gap between the engine's own autocommit statements.

This is a timing race, not a certain failure. It is more plausible once A1 lets the pipeline run beside a long import that later commits.

Wrong details from the first writeup, kept out of the fix:

- Mastery's foreign key is `beatmaps.id`, not `scores.id`. A score delete does not fail a mastery insert. An orphan beatmap delete in the same commit can.
- Retry's foreign key is `score_metrics.score_id` → `scores.id`. The score delete is `reconcileCore` deleting orphan scores, not the function signature at the cited lines.
- "Table wiped" is strict only if the first insert batch fails. A later failure leaves earlier batches committed. Either way the pre-wipe rows are gone.
- Scoped runs delete by id, not the whole table. They have the same gap.

## Potential solution

Wrap only the wipe and the inserts. Leave the read and the PP/mastery compute outside the transaction so the write lock stays short (`knowledge/decisions/dual-runtime-sqlite-bus.md`).

Use an immediate transaction, same idea as `commitImport`. Drizzle already accepts `{ behavior: "immediate" }` (see `withTransaction` in `importJournal.ts`). A deferred transaction can still interleave with the reader's commit between the delete and the first insert.

```ts
db.transaction((tx) => {
  tx.delete(scoreMetrics).run();
  for (const batch of batches) tx.insert(scoreMetrics).values(batch).run();
}, { behavior: "immediate" });
```

Same shape for `mastery`. On a foreign-key failure the transaction rolls back and the previous rows remain. The pipeline catch already logs and retries next run.

Do not pre-filter against `scores` / `beatmaps` instead. The check and the insert have to be the same transaction or the gap is still there.

## Do not

- Do not wrap the curve load or the full score scan in the transaction.
- Do not turn foreign keys off for the engine write.

## Touch

- `apps/server/src/analytics/retry.ts` — delete + insert loop
- `apps/server/src/analytics/mastery/engine.ts` — delete + insert loop

## Tests

No existing test fails today; this is a race. A unit test can open a transaction, delete a parent the engine is about to reference, and assert the engine's thrown insert rolls back to the pre-wipe row count. That needs a test double or a second connection. If that harness is awkward, ship the transaction without a new test and say so in the note. Do not add a sleep-based race test.
