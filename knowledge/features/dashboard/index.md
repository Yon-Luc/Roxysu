---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/dashboard/DashboardPage.tsx
  - apps/server/src/routes/dashboard.ts
  - apps/server/src/analytics/practiceSnapshot.ts
  - apps/server/src/routes/overlay.ts
---

# Dashboard

## Purpose

At-a-glance practice library overview: indexed score/beatmap counts, Realm extraction status, current session, weekly activity, practice snapshot (plays today / last 7 days / active-day streak / last closed session), and a short recent-scores list.

## Business meaning

Landing surface for “is my practice library healthy and what have I been playing?”

The OBS overlay must not poll this dashboard payload. Overlay idle recent scores come from `GET /api/overlay`.

## Business rules

1. Recent scores whose beatmap was removed from the game (`beatmapId` null after Realm orphan cleanup) display as “Beatmap deleted” / “Removed from the game”, not Untitled/Unknown.
   **Status:** verified

2. Home shows at most **8** recent scores (`playedAt` descending). **See more** links to `/practice` (default sort `lastPlayed` desc).
   **Status:** verified

3. Practice snapshot is local-only: derived from `daily_stats` plus the newest closed session (`endedAt` set). No remote news or osu! API.
   **Status:** verified

## Main flows

- Open app → dashboard loads summary APIs + SSE extraction status.

## Important symbols

- `apps/server/public/features/dashboard/DashboardPage.tsx`
- `apps/server/src/routes/dashboard.ts`
- `apps/server/src/analytics/practiceSnapshot.ts:getPracticeSnapshot()`

## Dependencies

- `features/live-sync/` — extraction status
- `features/sessions/` — current session summary + last closed session
- `features/practice/` — See more destination

## Depended on by

- (entry surface; no feature depends on dashboard specifically)

## Related knowledge

- [flows/realm-extraction-to-ui.md](../../flows/realm-extraction-to-ui.md)

**In UI:** extraction status labels use "Live sync".
