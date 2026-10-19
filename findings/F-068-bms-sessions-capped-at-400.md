---
id: F-068
feature: bms
kind: logic-gap
severity: low
confidence: verified
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
