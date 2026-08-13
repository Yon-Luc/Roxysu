---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/analytics/session.ts
  - apps/server/src/routes/sessions.ts
  - apps/server/public/features/sessions
---

# Sessions

## Purpose

Group scores into practice sessions by inactivity gaps; browse past sessions and the live current session (SSE). Suggest maps via Up Next (QL) or 7K Sunny recommendations.

## Business rules

1. A new session starts when the gap between scores exceeds **30 minutes** (`SESSION_GAP_MS`).
2. Current session hub updates as new plays land via SSE.

## Important symbols

- `apps/server/src/analytics/session.ts` — `SESSION_GAP_MS`
- `apps/server/src/routes/sessions.ts`
- `apps/server/public/features/sessions/*`

## Dependencies

- `features/live-sync/` — new scores
- `features/practice-library/` — Up Next QL
- `features/sunny-dan-recommendations/` — 7K recommend

## Depended on by

- `features/dashboard/` — current session summary

## Related knowledge

- [business/sessions-gap.md](../../business/sessions-gap.md)
- [flows/score-indexing-analytics.md](../../flows/score-indexing-analytics.md)
