---
id: F-055
feature: download-mirrors
kind: perf
severity: medium
confidence: verified
---

# Mirror batch mode `setIds` has no maximum length

## What

`POST /api/mirrors/batch/start` types `setIds` as an optional array of numbers with no `maxItems`. `POST /ownership/diff` caps at 20,000. The batch runner dedupes the whole array and can reload the entire owned-set list to diff it.

## Why

One request body can force a large allocation and a long SQLite diff. The other mirror route already picked 20,000 as a limit.

## How to improve

Use the same `maxItems` as ownership diff. Reject oversize bodies before starting the job.

## Potential gain

A batch download has a predictable upper cost.

## Evidence

- `apps/server/src/routes/mirrors.ts` (about lines 217–235): `setIds: t.Optional(t.Array(t.Number()))`.
- `apps/server/src/mirrors/batchJob.ts` (about lines 697–703): dedupes `request.setIds` with no cap.
