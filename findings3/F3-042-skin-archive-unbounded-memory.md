---
id: F3-042
feature: skin-fusion
kind: perf
severity: low
confidence: verified
status: proposed
---

# Realm skin archive export assembles the whole skin in memory while fusion caps at 400 MB

## What

`GET /skins/:id/archive` reads every `realm_skin_files` row into one `Record<string, Uint8Array>`,
deflates it into a second buffer, then copies it again with `Buffer.from` for the response.

A skin with large assets - lazer's importer keeps every file in the skin folder - can push the
client app process to multiple GB with no error path. `planFusion` already refuses above
`DEFAULT_MAX_BYTES` (400 MB), so the two paths disagree on what is acceptable.

## Why

The route accumulates entries one `readFile` at a time and never sums sizes. The cache caps
limit only retention, not the build.

## How to improve

Sum the sizes in the loop and return 413 with the fusion limit before zipping. Or stream via
`zip`'s chunk callback into the `Response` instead of `Buffer.from(zipped)`.

Reusing the fusion constant keeps the two paths consistent.

## Evidence

- `apps/server/src/routes/skins.ts:212-259` - unbounded accumulation
- `apps/server/src/shared/skinFusion/plan.ts:64`, `:765-768` - the existing 400 MB limit
