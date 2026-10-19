---
id: F-068
feature: bms
kind: logic-gap
severity: low
confidence: verified
status: fixed
---

# BMS sessions are rebuilt from the latest 400 scores

## What

Local and Hub session lists load at most 400 recent scores, then `groupBmsSessions` clusters them on 30-minute gaps.

## Why

A session that started before the window is clipped. `scoreCount` and `startedAt` describe the visible tail, not the sitting. A gap that falls on the cut looks like two sessions or a short one.

## How to improve

Walk older pages until a gap larger than 30 minutes closes the oldest open session, or label the list as the last 400 scores.

## Potential gain

Long sessions keep a true start time and play count.

## Evidence

- `apps/server/src/bms/localProfile.ts` `listLocalSessions` (about lines 150–172): `.limit(400)` then `groupBmsSessions`.
- `apps/hub/src/services/bms.ts` (about lines 412–424): the same limit.

## Status

Fixed. New `loadRecentBmsSessions()` in `packages/db/src/bmsInterpret.ts` reads scores newest first in pages of 400 (with a one-row peek past each page) and keeps paging until the oldest loaded session is closed by a gap longer than `SESSION_GAP_MS`, more than 20 sessions are loaded, history ends, or a hard cap of 10,000 scores is hit. `listLocalSessions` (`apps/server/src/bms/localProfile.ts`) and `profileSessions` (`apps/hub/src/services/bms.ts`) use it and still return the 20 most recent sessions; both queries gained a `desc(id)` tie-break so offset paging is stable. Tests: `packages/db/src/bmsSessions.test.ts`, `apps/server/src/bms/localSessions.test.ts`, `apps/hub/src/services/bms.sessions.test.ts` (950-play sitting, exact 30 minute gap on a page boundary, 20-session limit). Knowledge: `knowledge/features/bms/index.md` rule 12.
