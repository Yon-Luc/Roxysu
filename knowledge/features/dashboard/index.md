---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/components/CommandPalette.tsx
  - apps/server/public/lib/focusTrap.ts
  - apps/server/public/features/dashboard/DashboardPage.tsx
  - apps/server/src/routes/dashboard.ts
  - apps/server/src/analytics/practiceSnapshot.ts
  - apps/server/src/analytics/scoreAutoFilterCache.ts
  - apps/server/src/analytics/scoreUsername.ts
  - apps/server/src/analytics/scoreGamemode.ts
  - apps/server/src/routes/overlay.ts
  - apps/desktop/main.js
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

4. The command palette (Ctrl/Cmd+K) is a modal dialog: it focuses its input on open, traps Tab / Shift+Tab inside the dialog (`focusTrapTarget()`), pulls focus back in if it lands behind the scrim, locks body scroll, and restores focus to the previously focused element on close.
   **Status:** verified

## Main flows

- Open app → dashboard loads summary APIs + SSE extraction status.
- Desktop: splash shows “Opening Home” after the server is healthy, then the UI loads; Home shows a branded “Loading practice summary…” state with layout skeletons until `GET /api/dashboard` returns.

## Implementation

- `GET /api/dashboard` resolves auto username/gamemode filters first (most-common `GROUP BY` results are cached ~60s in `scoreAutoFilterCache`, cleared on score/sync/mastery events and when the filter settings change).
- After recent scores, independent work (PP curves, counts, last import, current session, weekly activity, practice snapshot) runs in parallel.
- Home does not wait on Realm extraction; sync status is shell chrome + SSE refetch.

## Important symbols

- `apps/server/public/features/dashboard/DashboardPage.tsx`
- `apps/server/public/components/CommandPalette.tsx`
- `apps/server/public/lib/focusTrap.ts:focusTrapTarget()`
- `apps/server/src/routes/dashboard.ts`
- `apps/server/src/analytics/practiceSnapshot.ts:getPracticeSnapshot()`
- `apps/server/src/analytics/scoreAutoFilterCache.ts`

## Dependencies

- `features/live-sync/` — extraction status
- `features/sessions/` — current session summary + last closed session
- `features/practice/` — See more destination

## Depended on by

- (entry surface; no feature depends on dashboard specifically)

## Related knowledge

- [flows/realm-extraction-to-ui.md](../../flows/realm-extraction-to-ui.md)
- [features/desktop/index.md](../desktop/index.md) — splash → server ready → loadURL

**In UI:** current session leads, then the practice snapshot, weekly activity, and recent scores. Indexed counts and last sync stay as a quiet line under the title. Extraction status labels use "Live sync". While the summary is loading, Home shows the Roxysu mark, title, loading copy, and skeletons (not a second full-screen splash).
