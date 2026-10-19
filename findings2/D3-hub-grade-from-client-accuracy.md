---
cand: D3
reopens: F-041
feature: bms
kind: security
severity: medium
confidence: verified
status: proposed
---

# Hub grade derives from client accuracy

## Problem

`presentedScore` passes the client `accuracy` into `bmsScorePresentation`. `djGrade` is `djGradeFromAccuracy` of that number. `validateInbound` only checks `accuracy` is in `0..1` and each judgement count on its own. Nothing compares `exScore`, `maxExScore`, `accuracy`, and the counts.

`accuracy: 1` with `miss: 500` is stored as grade `max`. Table completion uses `gradeMeets(row.djGrade)`. A non-Roxysu client can satisfy a grade gate that way.

Combo lamp is not that hole. `comboLampFromCounts` returns null when bad, poor, or miss is non-zero. The client `gameplay.djGrade` string is already ignored.

Rank is a second hole the grade fix does not close. Leaderboards order by `ex_score`, then `accuracy`. Both are stored from the client and only range-checked. A forged `exScore` ranks without a forged grade.

Rows ingested before the presentation fix keep the client `djGrade` and `comboLampId` that were written then. Nothing recomputes them. Recomputing grade from the stored `accuracy` column does not help: that column is the same client number.

The formula is already documented in `packages/db/src/bmsInterpret.ts`: EX = pgreat*2 + great, max EX = maximum perfect*2, accuracy = EX / max EX.

## Potential solution

Compute the public numbers. Do not trust the client copies when the counts are present.

In `validateInbound`, when `pgreat` and `great` are present:

- `expectedEx = pgreat * 2 + great`. If `exScore` is present and not equal, reject.
- If `maxExScore` is present and `> 0`, `expectedAcc = expectedEx / maxExScore`. If `accuracy` is present and differs by more than `1e-6`, reject.
- If `maxExScore` is present and `expectedEx > maxExScore`, reject.

Then `presentedScore` grades from `expectedAcc`, not from `score.score.accuracy`. Store the computed EX and accuracy, not the client fields.

If `pgreat` and `great` are missing, reject the score. A public row with no counts cannot be checked, and both grade and rank would fall back to client numbers. Local upload already sends counts. A client that omits them should not land on a leaderboard.

`exScore` above the count-derived value is the rank forge. The equality check is what stops it. A range check is not.

Backfill, on the Hub database, not a client-app migration. For each `bms_scores` row with `pgreat` and `great` non-null, recompute EX, accuracy, `djGrade`, and `comboLampId` with `bmsScorePresentation` fed the computed accuracy and the stored counts. Write those columns. Rows with null `pgreat` and `great` cannot be checked: set `djGrade` to null and `exScore` to null so they drop out of grade gates and rank. `gradeMeets` already treats null as not meeting.

Do this once, in a Hub script or a Hub migration. Do not recompute on every read.

## Do not

- Do not only re-run `djGradeFromAccuracy` on the stored `accuracy`. That keeps the lie.
- Do not accept a mismatch and overwrite quietly without a test that a lying body is rejected. Rejecting is the ingest rule. The backfill is the only overwrite.
- Do not treat combo lamp as the bug. It is already count-derived on the current path.

## Touch

- `apps/hub/src/services/bms.ts` — `validateInbound`, `presentedScore`, the insert column values
- `packages/db/src/bmsInterpret.ts` — a shared `exScoreFromCounts` if the formula should not be copied
- Hub backfill, next to the Hub schema, not `packages/db/drizzle` (that journal is the local mirror)

## Tests

Extend `bms.ingest.test.ts`: `accuracy: 1`, `miss: 500`, `pgreat: 0`, `great: 0` is rejected and stores no row. A consistent body still stores `djGrade` from the computed accuracy, including the existing case where the client `djGrade` string is a lie. A body with `exScore` above `pgreat * 2 + great` is rejected.
