---
last_verified: 2026-10
confidence: verified
touches:
  - apps/hub/src/routes/osuScores.ts
  - apps/hub/src/services/osuScores.ts
  - apps/hub/src/services/singleFlight.ts
  - apps/hub/src/services/osuBudget.ts
  - apps/server/src/online-scores/pull.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/backupBeforeWrite.ts
  - apps/realm-reader/src/writeOnlineScores.ts
  - apps/server/public/features/settings/sections/OnlineScorePullSection.tsx
---

# Online score pull

## Purpose

Bring ranked personal bests that exist on osu! but not in this Realm into lazer, so they show as local scores and then enter practice analytics.

## Business meaning

A manual, ruleset-scoped fetch. Loved and pending maps are out. The player previews counts before anything is written.

## Business rules

1. The osu! id is the lazer player behind the score-username filter. The Hub login must be that same id. A mismatch does not write.
2. Source is `GET /users/{id}/scores/best` for one ruleset, paged at 100, not a top-100 cap.
3. The Hub holds the osu! client secret. The client app does not call osu.ppy.sh.
4. Outbound osu! calls stay at or under 50 per rolling minute, with at most 4 in flight. A 429 parks the token until `Retry-After`.
5. Ranked bests are stored on the Hub by score id. A scan younger than 24 hours refetches only page 0 unless the top score id changed or the user forces a refresh.
6. A score can be added when its beatmap online id is in the Realm. A checksum mismatch still attaches to the current file and is counted separately.
7. The write is manual. Lazer must be closed. `client.realm` is copied first, before the write connection opens (last 5 backups kept). Extraction is paused for the write.
8. Written scores use the website score ids, standardised `total_score`, and `TotalScoreVersion` 30000019. There is no replay.
9. The write process upserts those rows into the local mirror and records an import whose watermark is copied from the previous successful extraction.
10. The commit holds the shared Realm write lock (see `features/smart-collections/` rule 7). A second Realm write gets HTTP 409 `in_flight`. Preview is also rejected with HTTP 409 `in_flight` while a commit is in flight, and a commit is rejected while preview is replacing the candidate rows.
11. A commit writes the candidate rows it read at its start and, on success, deletes only those rows by score id. It never empties the candidate table, so rows from a newer preview survive.

12. Ranked-best pulls are single-flight per osu! id and ruleset (key `osuUserId:ruleset`). A second caller, including a forced refresh arriving mid-pull, awaits the in-flight pull and receives its result, so one crawl and one delete-then-insert of the stored bests run and the osu! budget is spent once. The entry is cleared when the pull settles; an error reaches every waiter. The map is in Hub process memory (one Hub process).

## Security rules

1. Hub score routes require a valid osu! OAuth JWT and return only that user's bests.
   **Enforced by:** `apps/hub/src/routes/osuScores.ts` + `requireAuth` — status: verified
   **Unauthorized result:** 401 before any osu! call
2. The usage ledger admin route requires admin role.
   **Enforced by:** `apps/hub/src/routes/osuScores.ts` `osuBudgetAdminRoutes` — status: verified
   **Unauthorized result:** 403
3. No user-role route exposes the usage ledger (`todayCalls`, `yesterdayCalls`, `todayLimited`). Signed-in users do see the live per-minute snapshot (`callsThisMinute`, `limitPerMinute`, `inFlight`, `parkedUntil`) in `scores/best` and `scores/progress`. It is process-wide, not per user, and the Settings panel shows it on purpose.
   **Enforced by:** `apps/hub/src/routes/osuScores.ts` (no `/osu/budget` route) + `apps/hub/src/routes/osuScores.routes.test.ts` — status: verified
   **Unauthorized result:** 404 for the removed route; the ledger stays behind `/admin/osu-budget`

## Important symbols

- `apps/hub/src/services/osuScores.ts:pullRankedBests()` — coalesces per `pullKey()`; crawl body is `runPullRankedBests()`
- `apps/hub/src/services/singleFlight.ts:createKeyedFlights()`
- `apps/hub/src/services/osuBudget.ts:acquireOsuSlot()`
- `apps/server/src/online-scores/pull.ts:previewOnlineScores()`
- `apps/server/src/online-scores/pull.ts:commitOnlineScores()`
- `apps/server/src/shared/realmWriteLock.ts` — `tryAcquireRealmWriteLock()`
- `apps/realm-reader/src/writeOnlineScores.ts:runOnlineScoreWrite()`

## Dependencies

- `features/live-sync/` — extraction must be paused; the following import picks up written scores
- `features/smart-collections/` — owns the shared Realm write lock rule (rule 7) and the backup-before-open order
- `features/hub/` — OAuth identity and osu! client credentials

## Depended on by

- Settings Setup — online score pull panel

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Online score pull
- [business/realm-read-only.md](../../business/realm-read-only.md)
- [flows/online-score-pull.md](../../flows/online-score-pull.md)
