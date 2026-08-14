---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/tosu
  - apps/server/src/routes/tosu.ts
  - apps/server/public/lib/useTosuLiveQuery.ts
  - apps/server/public/lib/sse.ts
  - apps/server/public/features/sessions/SessionTosuLivePanel.tsx
  - apps/server/public/features/now-selected
---

# tosu live

## Purpose

Optional WebSocket integration with **tosu** for live in-progress map state (overlay / live UI hints).

## Business rules

1. tosu is **not** the score source of truth — Realm extraction → local mirror remains authoritative for plays.
2. The lean snapshot (`GET /api/tosu/live`) stays small — it is published on play ticks. Full mania pattern detail is cached on checksum change and served separately (`GET /api/tosu/live/analysis`).
3. `tosu.updated` SSE is `{ reason: "play" | "full", ... }`. Play ticks (rate-limited to 500ms) patch play + beatmap state in the client cache. Full invalidation is for checksum/status changes.
4. Client HTTP poll of the lean snapshot is a reconnect fallback only (`useTosuLiveQuery`); the Current session panel does not poll while hidden.

## Important symbols

- `apps/server/src/tosu/*`
- `apps/server/src/routes/tosu.ts` — `/live`, `/live/analysis`, `/start`
- `apps/server/public/lib/useTosuLiveQuery.ts`

## Dependencies

- external tosu process (root `dev` script)

## Depended on by

- `features/sessions/` — Current session **Now selected** panel
- `features/now-selected/` — second-monitor Now selected page
- overlay / live UI surfaces (when enabled)
