---
id: F-042
feature: bms
kind: logic-gap
severity: medium
confidence: verified
status: fixed
---

# Hub accepts autoplay scores that local derive refuses to upload

## What

Local derive sets `autoplay` from the `AT` mod and the sync queue skips those rows. Hub `validateInbound` and `ingestBmsScore` never read `gameplay.mods` for `AT`.

## Why

Business rule 4 says autoplay scores are derived and not uploaded. That rule is enforced on the Roxysu client only. A direct batch to the Hub API can insert autoplay scores into public stats and leaderboards.

## How to improve

Reject a batch that contains `BMS_AUTOPLAY_ACRONYM`, or store the flag and exclude those rows from public aggregates.

## Potential gain

Public BMS stats match the local “no autoplay” rule.

## Evidence

- `packages/db/src/bmsInterpret.ts`: `BMS_AUTOPLAY_ACRONYM = "AT"`.
- `apps/server/src/bms/derive.ts` (about lines 139–141): `if (row.autoplay) continue` before queue insert.
- `apps/hub/src/services/bms.ts`: no `AT` check in `validateInbound` or ingest.
- `knowledge/features/bms/index.md` business rule 4.

## Status

Fixed. Verified against the code on 2026-10-19: `validateInbound` rejects `AT` in mods with reason `autoplay` (`apps/hub/src/services/bms.ts`, `bms.ingest.test.ts`).
