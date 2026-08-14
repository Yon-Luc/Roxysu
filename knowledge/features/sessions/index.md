---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/analytics/session.ts
  - apps/server/src/routes/sessions.ts
  - apps/server/public/features/sessions
  - packages/session-names/src/generate.ts
  - packages/session-names/src/terms.json
  - packages/db/src/schema.ts
---

# Sessions

## Purpose

Group scores into practice sessions by inactivity gaps; browse past sessions and the live current session (SSE). Suggest maps via Up Next (query language) or 4K/7K Sunny recommendations.

Each session has a **display name** — a stable, generated label (Mushoku Tensei–themed) used in the UI instead of numeric ids.

## Business meaning

A session is a contiguous block of plays separated by inactivity. The display name is assigned once when the session row is created (or backfilled) and persists for the life of that row — including while the session is still open ("current session").

Live sessions keep the **Current session** label in headings; the generated name appears as secondary text and is stored for future features (e.g. saving or sharing).

## Business rules

1. A new session starts when the gap between scores exceeds **30 minutes** (`SESSION_GAP_MS`).
2. Current session hub refreshes as new plays land via SSE.
3. Every session row has a **display name** generated from its `id` via `@roxysu/session-names`. New names skip any display name already used in the local mirror (case-insensitive).
4. Display names are persisted in `sessions.name` at creation; existing rows without a name are backfilled on the next session-engine run. Already-named rows are not regenerated.
5. The UI shows the display name for closed sessions; open sessions use **Current session** as the primary label and show the name as secondary text. Numeric `#id` is not shown.
6. A session display name always starts with a capital letter (`capitalizeSessionName()`).

## Important symbols

- `apps/server/src/analytics/session.ts` — `SESSION_GAP_MS`, `runSessionEngine()`, `backfillSessionNames()`
- `apps/server/src/routes/sessions.ts` — `serializeSession()` includes `name`
- `packages/session-names/src/generate.ts` — `generateSessionName(sessionId, taken)`, `capitalizeSessionName()`
- `packages/session-names/src/terms.json` — character, region, activity, modifier, style word lists
- `apps/server/public/features/sessions/*`
- `apps/server/public/features/sessions/SessionSuggest.tsx` — Up Next / 4K / 7K tabs
- `apps/server/public/features/sessions/SessionSevenKRecommend.tsx` — Sunny recommend panel (`keyCount` 4 or 7)

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
- `features/sunny-dan-recommendations/` — 4K/7K recommend
- `@roxysu/session-names` — display name vocabulary and generator

## Depended on by

- `features/dashboard/` — current session summary (shows name)
- `features/now-selected/` — shares tosu live snapshot with Current session panel

## Related knowledge

- [business/sessions-gap.md](../../business/sessions-gap.md)
- [flows/score-indexing-analytics.md](../../flows/score-indexing-analytics.md)
