---
last_verified: 2026-10
confidence: verified
touches:
  - packages/db/src/bmsInterpret.ts
  - packages/db/src/schema.ts
  - packages/db/drizzle/0028_bms.sql
  - apps/server/src/bms/derive.ts
  - apps/server/src/bms/sync.ts
  - apps/server/src/bms/localProfile.ts
  - apps/server/src/routes/bms.ts
  - apps/server/src/analytics/pipeline.ts
  - apps/server/src/analytics/scoreGamemode.ts
  - apps/hub/src/services/bms.ts
  - apps/hub/src/services/bmsCommunity.ts
  - apps/hub/src/routes/bms.ts
  - apps/server/public/features/bms
  - apps/server/src/bms/stageImage.ts
  - packages/db/src/bmsTables.ts
  - packages/db/bms-tables/insane.json
  - packages/db/bms-tables/satellite.json
  - packages/db/bms-tables/stella.json
---

# BMS

## Purpose

Show a local BMS profile from scores Realm extraction already stored, publish those scores to a public Hub profile, and read public charts, leaderboards, comparisons, the score feed, and global statistics from the Hub.

## Business meaning

BMS is a ruleset already present in the local mirror. This feature interprets those scores. It does not add a second extraction path and it does not copy the ruleset implementation.

## Business rules

1. EX score is `perfect * 2 + great`. Max EX is `maximum_statistics.perfect * 2`. Normalized score is the stored total score.
   **Status:** verified
2. A BMS variant is the sorted partitioning mods. Gauge mods stay a separate field. No gauge mod stays null. Stored `AG` means Normal.
   **Status:** verified
3. Combo lamps come only from judgement counts. Clear lamps stay null. Rank is the DJ grade, not a clear.
   **Status:** verified
4. Autoplay scores (`AT`) are derived but not uploaded.
   **Status:** verified
5. A rescan rebuilds `bms_score_details` and does not reset a `synced` or `rejected` queue row.
   **Status:** verified
6. Disabling upload stops new sends. It does not delete local or Hub scores.
   **Status:** verified
7. Table completion counts DJ grades and combo lamps. Clear-type lamps are not counted as clears. Insane, Satellite, and Stella ship with the app. Each level lists that table's charts, and a chart counts when the player has a matching score.
   **Status:** verified
   **Enforced by:** `packages/db/src/bmsTables.ts:loadBundledBmsTables()` and `apps/server/src/bms/localProfile.ts:seedBundledLocalTables()`
8. A public chart leaderboard is one best score per player for one variant. Achievement, gauge, and country are filters on that board. Scratch and other variants do not share a board.
   **Status:** verified
   **Enforced by:** `apps/hub/src/services/bmsCommunity.ts:chartLeaderboard()`
9. Global plays count stored public scores. A retry of a score already stored does not add a play or a submission row. Recorded submissions count accepted and rejected source scores, not HTTP retries.
   **Status:** verified
   **Enforced by:** `apps/hub/src/services/bmsCommunity.ts:bmsGlobalStats()` and `BMS_STAT_DEFINITIONS`
10. The score feed is ordered by stored time and score id. A cursor page does not repeat or skip rows already passed. New scores appear at the head.
   **Status:** verified
   **Enforced by:** `apps/hub/src/services/bmsCommunity.ts:bmsFeed()`
11. A chart image is the stage file, then the banner, then the back bitmap, then the first still bitmap. Video BGA is not an image. The file is read from the chart's source folder, which Realm extraction already stores. The response stays inside that folder.
   **Status:** verified
   **Enforced by:** `apps/server/src/bms/stageImage.ts:resolveBmsStageImage()` and `GET /api/bms/covers/:beatmapId`

## Security rules

1. Local `/api/bms` follows the client app: no user auth. The Hub JWT used for background upload is stored in local settings and is not returned by the status route.
   **Enforced by:** `apps/server/src/bms/sync.ts:bmsSyncStatus()` — status: verified
   **Unauthorized result:** N/A on the client app
2. Hub score ownership is the authenticated principal. A body user id is ignored. Trust is `community_submitted`.
   **Enforced by:** `apps/hub/src/routes/bms.ts` — status: verified
   **Unauthorized result:** 401
3. Private profiles and missing profiles both 404 for non-owners.
   **Enforced by:** `apps/hub/src/services/bms.ts:readBmsProfile()` — status: verified
   **Unauthorized result:** 404
4. Table import is admin-only. Fetch allows only HTTPS hosts on the allowlist and does not follow redirects.
   **Enforced by:** `apps/hub/src/routes/bms.ts` `POST /api/bms/tables/import` — status: verified
   **Unauthorized result:** 403 or 400
5. Chart leaderboards, the score feed, chart play counts, and global statistics include only public profiles. A private score detail or a comparison that includes a hidden profile is 404 for everyone except that profile's owner, and the owner still does not appear on the public leaderboard or feed.
   **Enforced by:** `apps/hub/src/services/bmsCommunity.ts` — status: verified
   **Unauthorized result:** 404

## Main flows

```
Realm extraction stores a raw BMS score
 ↓
analytics pipeline derives bms_score_details
 ↓
auto-upload enqueues non-autoplay scores
 ↓
worker posts a batch to Hub /api/bms/scores/batch
 ↓
accepted and duplicate become synced; rejected stops; retryable waits
```

Local `/bms` reads the local mirror and still renders when the Hub is unreachable. Insane, Satellite, and Stella are read from `packages/db/bms-tables` and written into `bms_table_cache` on the first tables read, so their song lists do not depend on a Hub fetch. The Hub stores the same three catalogues when it starts. The table screen shows one catalogue and one level at a time. Public `/bms/players/:username` reads the Hub. `/bms/charts/:chartId`, `/bms/compare/:playerA/:playerB`, `/bms/feed`, and `/bms/statistics` also read the Hub. The feed polls the first page. Leaderboard filters stay in the URL.

## Important symbols

- `packages/db/src/bmsInterpret.ts:interpretBmsScore()`
- `apps/server/src/bms/derive.ts:deriveBmsScores()`
- `apps/server/src/bms/sync.ts:drainBmsQueue()`
- `apps/hub/src/services/bms.ts:ingestBmsBatch()`
- `apps/hub/src/services/bmsCommunity.ts:chartLeaderboard()`
- `packages/db/src/bmsTables.ts:loadBundledBmsTables()`

## Dependencies

- `features/live-sync/` — raw BMS scores already extracted
- `features/hub/` — public profile, batch ingest, table import
- `features/sessions/` — local session rows grouped by ruleset short name

## Depended on by

- Score list gamemode filter — `bms` is its own mode in `SCORE_GAMEMODE_IDS`

## Failure behavior

1. A 401 from the Hub pauses uploads, keeps queue rows, and asks for login again.
2. A missing chart MD5 is a permanent rejection for that score.
3. One rejected batch item does not change the result of the other items.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — BMS, BMS variant
- [architecture/data-ownership.md](../../architecture/data-ownership.md)
- [features/hub/index.md](../hub/index.md)
