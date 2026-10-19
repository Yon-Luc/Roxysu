---
id: F-067
feature: bms
kind: logic-gap
severity: low
confidence: verified
status: fixed
---

# Public BMS play count ignores the selected variant

## What

Local overview counts plays with the selected variant filter. Hub `readBmsProfile` counts every score for the user. The public page passes that total into the header while variant chips filter the score list.

## Why

Switching variant updates the list and not the big number. Local and public profiles answer “how many plays?” differently.

## How to improve

Count plays for the selected variant on the Hub profile, or label the header as all variants.

## Potential gain

The public header matches the variant the page is showing, and matches the local profile.

## Evidence

- `apps/server/src/bms/localProfile.ts` (about lines 54–63): `baseFilters(usernames, selected)` includes the variant.
- `apps/hub/src/services/bms.ts` (about lines 300–306): count where `userId` only.
- `apps/server/public/features/bms/BmsPlayerPage.tsx` (about lines 93–97): `plays={profile.data?.plays ?? 0}` beside `variantId={selected}`.

## Status

Fixed. Verified against the code on 2026-10-19: `BmsProfileView.tsx` shows the selected variant's play count, falling back to the total.
