---
id: F3-039
feature: preview-replay
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# A mania hold released late, or still held, is scored a tail miss

## What

`missExpiredNotes` fails a hold's tail whenever the timeline passes `endMs + missWindow`,
without checking `note.holding`.

A player who holds an LN through its tail - the normal way to play when the next note in that
column is far away - gets a tail `miss` instead of the `great` lazer awards at `EndTime`. The
end-of-timeline flush does the same to any tail still held when the replay stops, so a chart
ending on a held LN always shows one extra miss.

Releasing between `endMs` and `endMs + missWindow` is also judged from the raw late error, so a
130 ms late release at OD8 reads `miss` instead of being clamped.

## Why

`missExpiredNotes` ignores `note.holding`. The release handlers judge `frame.tMs - note.endMs`
symmetrically. The flush marks every unjudged hold tail a miss. Lazer completes a hold at its
end time while the body is still held, so hold length past the tail is never penalised.

## How to improve

In `missExpiredNotes`, skip notes with `note.holding`, and once `tMs >= note.endMs` for a held
note push `{ result: "great", tMs: note.endMs }` as an auto-complete.

In the release path, if `frame.tMs >= note.endMs` use the held-to-end result rather than the
offset. In the flush, treat `holding` as a completed tail.

Add tests for "held 200 ms past tail", "released 100 ms late" and "replay ends while held".
There is no `simulate` test file today.

## Evidence

- `packages/mania-judge/src/simulate.ts:147-168` - expiry ignores `holding`
- `packages/mania-judge/src/simulate.ts:205-223` - symmetric release judgement
- `packages/mania-judge/src/simulate.ts:230-255` - flush marks held tails as misses
- `packages/mania-judge/src/decode.test.ts:145-173` - only rice notes are covered
