---
id: F-058
feature: score-transfer
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Score export loads the whole library into one JSON response

## What

`GET /api/score-transfer/export` selects every non-deleted score, joins beatmaps, and `JSON.stringify`s the file in one response. There is no cursor or stream.

## Why

The export is supposed to be the full transferable set. On a 100k-score mirror that is one large allocation on the request path before the download starts. Local-no-auth makes this a performance issue on the operator’s machine, not an extra auth hole.

## How to improve

Stream NDJSON or chunk the attachment. Keep a single download, but do not hold the encoded document and the row objects at the same time.

## Potential gain

Exporting a large library does not pause the UI for a full-table stringify.

## Evidence

- `apps/server/src/routes/scoreTransfer.ts` (lines 11–18): `JSON.stringify(file)` as the response body.
- `apps/server/src/score-transfer/transfer.ts` (about lines 163–191): unbounded select of scores.

## Status

Fixed. `exportScoreTransferChunks()` / `exportScoreTransferStream()` (`apps/server/src/score-transfer/transfer.ts`) read the local mirror in keyset pages (ordered by `scores.id`, 1000 rows per page) and emit the same `roxysu-scores` JSON document piece by piece; `GET /api/score-transfer/export` (`apps/server/src/routes/scoreTransfer.ts`) returns a `Response` over that stream. The output is byte-identical to the old `JSON.stringify(file)`, so the import path and the Settings download link are unchanged. Tests: `apps/server/src/score-transfer/transfer.export.test.ts`.
