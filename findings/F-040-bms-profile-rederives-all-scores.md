---
id: F-040
feature: bms
kind: perf
severity: medium
confidence: verified
---

# Opening the BMS profile re-derives every BMS score

## What

`GET /api/bms/profile` always calls `deriveBmsScores(db, null)` before reading the overview. With a null id list, derive pages through every score whose ruleset is `bms` and upserts `bms_score_details`.

## Why

The analytics pipeline already derives on import. The profile route repeats that work on every visit and every variant refetch, because the query key includes the variant and the handler ignores it for derive.

## How to improve

Derive from the pipeline and from an explicit rescan. The profile read should query `bms_score_details` only.

## Potential gain

The BMS page opens in a read, not a full rewrite of every BMS score.

## Evidence

- `apps/server/src/routes/bms.ts` (lines 117–121): `await deriveBmsScores(db, null)` then `localBmsOverview`.
- `apps/server/src/bms/derive.ts` (lines 31–47): pages all BMS scores when `scoreIds` is null.
