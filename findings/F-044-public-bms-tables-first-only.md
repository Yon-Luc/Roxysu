---
id: F-044
feature: bms
kind: logic-gap
severity: medium
confidence: verified
---

# Public BMS tables tab loads only the first catalogue table

## What

Local `GET /api/bms/tables` returns completion for every cached table version. The public player page loads the catalogue, picks the first table that has a `latestVersionId`, and fetches completion for that id only.

## Why

A player with several imported tables sees all of them on the local BMS page and one of them on `/bms/players/:user/tables`.

## How to improve

Fetch completion for each catalogue entry, or add a Hub endpoint that returns every table the way the local route does.

## Potential gain

The public tables tab matches the local profile.

## Evidence

- `apps/server/src/routes/bms.ts` (lines 150–164): `localTableCompletion` for the whole cache.
- `apps/server/public/features/bms/BmsPlayerPage.tsx` (lines 54–64): `firstTable` and a single `fetchPublicBmsTables` call.
