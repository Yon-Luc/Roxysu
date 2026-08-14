---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/tosu
  - apps/server/src/routes/tosu.ts
  - apps/server/public/features/sessions/SessionTosuLivePanel.tsx
  - apps/server/public/features/now-selected
---

# tosu live

## Purpose

Optional WebSocket integration with **tosu** for live in-progress map state (overlay / live UI hints).

## Business rules

1. tosu is **not** the score source of truth — Realm extraction → local mirror remains authoritative for plays.
2. The lean snapshot (`GET /api/tosu/live`) stays small — it is published on play ticks. Full mania pattern detail is cached on checksum change and served separately (`GET /api/tosu/live/analysis`).

## Important symbols

- `apps/server/src/tosu/*`
- `apps/server/src/routes/tosu.ts` — `/live`, `/live/analysis`, `/start`

## Dependencies

- external tosu process (root `dev` script)

## Depended on by

- `features/sessions/` — Current session **Now selected** panel
- `features/now-selected/` — second-monitor Now selected page
- overlay / live UI surfaces (when enabled)
