---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/session.ts
  - apps/server/src/analytics/progression.ts
  - apps/server/src/routes/sessions.ts
  - apps/server/src/routes/overlay.ts
  - apps/server/src/scores/pbCompare.ts
  - apps/server/src/analytics/retry.ts
  - apps/server/src/mania-rating/estimateScorePp.ts
  - apps/server/public/components/PageTitle.tsx
  - apps/server/src/scores/parseStatistics.ts
  - apps/server/public/features/sessions
  - apps/server/public/features/sessions/SessionShareCard.tsx
  - apps/server/public/features/sessions/sessionShareHighlights.ts
  - apps/server/public/lib/sessionShareImage.ts
  - apps/server/public/components/ScoreCard.tsx
  - apps/server/public/components/ShareScoreLinkButton.tsx
  - apps/server/public/lib/osuUrls.ts
  - apps/server/public/features/overlay
  - apps/desktop/preload.js
  - apps/desktop/main.js
  - packages/session-names/src/generate.ts
  - packages/session-names/src/terms.json
  - packages/db/src/schema.ts
---

# Sessions

## Purpose

Group scores into practice sessions by inactivity gaps; browse past sessions and the live current session (SSE). Suggest maps via Up Next (query language) or 4K/7K Rework recommendations.

Each session has a **display name** — a stable, generated label (Mushoku Tensei–themed) used in the UI instead of numeric ids.

## Business meaning

A session is a contiguous block of plays separated by inactivity. The display name is assigned once when the session row is created (or backfilled) and persists for the life of that row — including while the session is still open ("current session").

Live sessions keep the **Current session** label in headings; the generated name appears as secondary text.

## Business rules

1. A new session starts when the gap between scores exceeds **30 minutes** (`SESSION_GAP_MS`).
2. Current session hub refreshes as new plays land via SSE.
3. Every session row has a **display name** generated from its `id` via `@roxysu/session-names`. New names skip any display name already used in the local mirror (case-insensitive).
4. Display names are persisted in `sessions.name` at creation; existing rows without a name are backfilled on the next session-engine run. Already-named rows are not regenerated.
5. The UI shows the display name for closed sessions; open sessions use **Current session** as the primary label and show the name as secondary text. Numeric `#id` is not shown.
6. A session display name always starts with a capital letter (`capitalizeSessionName()`).
7. Session detail windows the newest scores (`GET /api/sessions/:id?limit=`, default 50, max 500) with Load more. PB count is for the whole session, not the window.
8. OBS overlay uses `GET /api/overlay?limit=` (header + last N scores, no PP curves for the rest of the session) and must not poll `["dashboard"]` or full current-session detail.
9. Up Next samples debounce the query string. Suggest/recommend over-fetch and **client-filter** session-played beatmap IDs so each new play does not change the React Query key. Shuffle bumps a key instead of double-fetching.
10. Session score rows whose beatmap was removed from the game (`beatmapId` null after Realm orphan cleanup) display as “Beatmap deleted” / “Removed from the game”, not Untitled/Unknown.
11. The Current session **Now selected** panel shows ephemeral tosu `analysis.rework` (Rework dan).
12. Sessions list page keeps the current-session CTA at the top, then recent sessions (default **7**), then a GitHub-style activity calendar from `daily_stats` (~53 weeks UTC). The CTA uses the same panel as Home. The calendar says that a day click filters the list above.
13. `GET /api/sessions` returns `{ current, items, activity }` where `activity` is `{ day, playCount }[]` from `getDailyActivity` (missing days = 0 plays in the UI).
14. Clicking a calendar day filters the list to sessions whose `startedAt` falls on that UTC day (`YYYY-MM-DD`). Clicking the day again or **Show all** clears the filter. With no day selected, **Show all** expands beyond the default 7 (API still caps `items` at 100).
15. Session detail score lists use shared `ScoreCard` (`variant="beatmap"`) with map cover, judgments, and PB comparison. A submitted score (`online_id` > 0) shows **Share link**, which copies `https://osu.ppy.sh/scores/{onlineId}`. Unsubmitted scores (`-1` or `0`) do not.
16. Each session score may include `judgments` (from `scores.statistics`) and `pbCompare`:
    - when `isPb` — previous best on that beatmap (`kind: "previous"`), if one exists
    - when not PB — current PB on that beatmap (`kind: "current"`)
    Ranking is the single `comparePbRank` shared with `runRetryEngine` (`is_pb`): resolved PP, then accuracy, then the earlier play. Resolved PP is `resolveScorePp` (stored Realm PP, else the lazer-master curve estimate for no-mod / mirror-only mania scores), the same value mastery `best_pp` ranks by. A null-PP no-mod mania score can therefore be the PB over a score with a tiny stored PP. Lookup is batched per distinct beatmap in the score window.
17. Current session layout: stats → Now selected → recommendations → score cards at the bottom. 4K/7K recommend does not offer Send to marathon.
18. Recommendation focus bands (Push / Accuracy / Consistency / Deficit) and topPlays are configured in Settings → Customize (`recommend.focus_settings`); session recommend reads those settings.
19. Active session detail (live or closed, not idle) offers **Copy as image**: one dark branded PNG. Clipboard write is armed in the click turn via a deferred `ClipboardItem` promise (required by Chromium user activation), then the card is captured. Fallback: Electron `writeClipboardImage`, then download. Card header uses absolute dates (same calendar day → one date + time window; different days → full start/end datetimes). Plays / PBs / Duration are centered in the two-column layout. Up to **20** highlight scores with judgments and PB compare — no session display name, no ruleset, no relative “ago” times. With **9+** highlights the card goes **wider** (two even columns) instead of taller; “+N more plays” only when the session has more than 20 plays. Highlights prefer PBs by PP, then fill with non-PBs by PP (`pickSessionShareHighlights`). Share may refetch with `limit=500` when the UI score window is incomplete.
20. Session rebuild after new scores is a **delta repair** first (`tryRepairSessionDelta`), full rebuild second. Sessions are blocks of the global timeline split by gaps over 30 minutes, so new scores can only reshape the sessions within one gap of them (plus the open session, which is always re-evaluated so it closes once stale). The repair re-buckets those sessions' scores together with the new scores and reconciles them with the same routine as the full rebuild, so gaps inside the batch, scores older than the open session, closing the open session, and merging or extending closed sessions all produce the same partition as a full rebuild. It returns null (full rebuild) only when `sessions.score_count` outside the repaired sessions plus the repaired scores does not equal the number of in-scope scores, i.e. the stored sessions are not a trustworthy partition. Deletes and watermark resets do not use the delta path (the pipeline forces a full rebuild).
21. The full rebuild does not load `score_metrics` into memory: prior session ids are read in id chunks, metrics are written with insert-or-ignore plus `UPDATE ... WHERE session_id IS NOT ?`, and sessions that no bucket claims are deleted only after their metrics rows are nulled (foreign key).
22. Long session names truncate: list rows clip the title and the open-session subtitle to one line (`truncate`, full name in `title`), and the detail header clamps the title to two lines (`line-clamp-2 min-w-0 break-words`, full name in `title`) so it wraps beside the Copy as image button instead of widening the page.
    **Status:** verified

## Important symbols

- `apps/server/src/analytics/session.ts` — `SESSION_GAP_MS`, `runSessionEngine()` (global gap algorithm; session/metrics writes in one sync transaction callback via `reconcileBuckets()` — required by better-sqlite3 on desktop; name backfill skipped when every name is already capitalized), `tryRepairSessionDelta()` (windowed delta repair)
- `apps/server/src/analytics/retry.ts` — `runRetryEngine()` assigns `is_pb` via `comparePbRank` on resolved PP
- `apps/server/src/analytics/progression.ts:getDailyActivity()` — per-day play counts for the list calendar
- `apps/server/src/routes/sessions.ts` — `serializeSession()` includes `name`; score window via `limit`; list includes `activity`; detail attaches `judgments` + `pbCompare`
- `apps/server/src/scores/pbCompare.ts` — `comparePbRank()` (shared PB ranking) and batched top-2 lookup for session compare; PP resolved with `resolveScorePp`
- `apps/server/src/routes/overlay.ts` — slim OBS payload
- `packages/session-names/src/generate.ts` — `generateSessionName(sessionId, taken)`, `capitalizeSessionName()`
- `packages/session-names/src/terms.json` — character, region, activity, modifier, style word lists
- `apps/server/public/features/sessions/*`
- `apps/server/public/features/sessions/SessionsPage.tsx` — list + day filter
- `apps/server/public/features/sessions/SessionDetailPage.tsx` — score cards via `ScoreCard`; share image control
- `apps/server/public/features/sessions/SessionShareCard.tsx` — off-screen share card layout
- `apps/server/public/features/sessions/sessionShareHighlights.ts` — highlight picker + `formatSessionDuration`
- `apps/server/public/lib/sessionShareImage.ts` — PNG capture + clipboard / download
- `apps/server/public/components/ScoreCard.tsx` — compact (Map Page) and beatmap (session) variants
- `apps/server/public/components/ShareScoreLinkButton.tsx` — copies the osu! score page URL when `onlineId` > 0
- `apps/server/public/features/sessions/SessionActivityCalendar.tsx` — contribution grid
- `apps/server/public/features/sessions/SessionSuggest.tsx` — Up Next / 4K / 7K tabs
- `apps/server/public/features/sessions/SessionSevenKRecommend.tsx` — Rework recommend panel (`keyCount` 4 or 7)

## Implementation

Name generation uses a seeded PRNG mixed from `session.id` + retry attempt, and three-slot templates from `terms.json`:

- `{character}'s {modifier} {activity}`
- `{modifier} {activity} in {region}`
- `{modifier} {region} · {character}`
- `{character}'s {activity} in {region}`
- `{character} at {region} · {activity}`
- `{character}'s {style} {activity}`
- `{modifier} {style} in {region}`
- `{character} · {modifier} {style}`
- `{region} {modifier} {activity}`

If the first pick is already taken, the generator retries with a different seed (up to 64 times), then extra distinguisher suffixes (`encore`, `returns`, …). Existing persisted names are left as-is.

On new session insert, `runSessionEngine()` sets `name` immediately after allocating the id, passing every current display name as `taken`. `sessionDisplayName()` falls back to `generateSessionName(id)` if `name` is still null, and always capitalizes the first letter.

## Dependencies

- `features/live-sync/` — new scores from Realm extraction
- `features/practice-library/` — Up Next query language
- `features/rework-dan-recommendations/` — 4K/7K recommend
- `@roxysu/session-names` — display name vocabulary and generator
- `features/practice-profiles/` — shared `ScoreCard` (`variant="beatmap"` on session detail)
- `features/stats/` — documents `resolveScorePp` (stored Realm PP, else NM/MR curve estimate); `is_pb` and `pbCompare` rank by it, like mastery `best_pp`
- `features/mastery-settings/` — mastery `best_pp` ranks by the same resolved PP

## Depended on by

- `features/dashboard/` — current session summary and last closed session in practice snapshot
- `features/now-selected/` — shares tosu live snapshot with Current session panel
- `features/bms/` — reads stored sessions whose ruleset short name is `bms`

## Related knowledge

- [business/sessions-gap.md](../../business/sessions-gap.md)
- [flows/score-indexing-analytics.md](../../flows/score-indexing-analytics.md)
- [flows/session-share-image.md](../../flows/session-share-image.md)
