---
id: F3-022
feature: bms
kind: security
severity: medium
confidence: verified
status: proposed
reopens: F-041, D3
---

# BMS grade is still forgeable: trust moved from `accuracy` to client `maxExScore`

## What

`accuracy` is no longer read from the request body, but it is now computed as
`exScore / clientSuppliedMaxExScore`. Validation only requires `exScore <= maxExScore`.

A client can send 100 pgreat and 400 miss with `maxExScore` equal to its own EX score and get
accuracy 1.0, DJ grade `max`, and a perfect combo lamp. Public leaderboards and table
completion count that grade.

## Why

`validateInbound` enforces EX-versus-judgements and accuracy-versus-judgements consistency,
but never anchors `maxExScore` to the chart (note count, or a consensus value for that
`chart.md5`). `presentedScore` feeds `derivedAccuracy` into `bmsScorePresentation`, and every
public read ranks on the stored `accuracy`.

## How to improve

In `validateInbound`, require `maxExScore === 2 * chart note count` when the note count is
known. In `ingestBmsScore`, cross-check against the largest `maxExScore` already stored for
that `chart.md5` and reject a lower value as inconsistent.

Store the authoritative value on `bms_charts` and recompute `accuracy` from it in
`recomputeStoredBmsScores`. Rows ingested before the fix need a one-off repass.

## Evidence

- `apps/hub/src/services/bms.ts:126-131` - only `expectedEx > maxEx` is checked
- `apps/hub/src/services/bms.ts:137-143` - `derivedAccuracy` divides by client `maxExScore`
- `apps/hub/src/services/bms.ts:277` - `djGrade` persisted
- `apps/hub/src/services/bmsCommunity.ts:233-239` - ranking tie-break on `accuracy`

## Notes

D3's fix closed the `accuracy` field and left the divisor open. The trust question - whether a
non-Roxysu client may submit at all - is a policy decision that precedes the code change.
