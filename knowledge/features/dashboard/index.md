---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/dashboard/DashboardPage.tsx
  - apps/server/src/routes/dashboard.ts
---

# Dashboard

## Purpose

At-a-glance practice library overview: indexed score/beatmap counts, Realm extraction status, current session, weekly activity, PP/accuracy trends, recent scores.

## Business meaning

Landing surface for “is my practice library healthy and what have I been playing?”

## Main flows

- Open app → dashboard loads summary APIs + SSE extraction status.

## Important symbols

- `apps/server/public/features/dashboard/DashboardPage.tsx`
- `apps/server/src/routes/dashboard.ts`

## Dependencies

- `features/live-sync/` — extraction status
- `features/sessions/` — current session summary

## Depended on by

- (entry surface; no feature depends on dashboard specifically)

## Related knowledge

- [flows/realm-extraction-to-ui.md](../../flows/realm-extraction-to-ui.md)

**In UI:** extraction status labels use "Live sync".
