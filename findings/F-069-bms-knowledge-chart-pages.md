---
id: F-069
feature: bms
kind: logic-gap
severity: low
confidence: verified
---

# BMS knowledge still says chart pages are out of this release

## What

`knowledge/features/bms/index.md` business rule 8 says chart pages, leaderboards, player comparison, the score feed, and global statistics are out of this release, and marks that rule verified. Hub already serves `GET /api/bms/charts/:chartId` and `GET /api/bms/charts/:chartId/leaderboard`.

## Why

A later change that trusts the knowledge base will skip or delete those routes as unfinished. The rule and the code disagree.

## How to improve

Rewrite rule 8 to name which of those surfaces exist and which are still absent. Re-verify the security section against the chart routes.

## Potential gain

The next BMS change follows the routes that are actually shipped.

## Evidence

- `knowledge/features/bms/index.md` business rule 8.
- `apps/hub/src/routes/bms.ts` (about lines 242–277): chart read and `chartLeaderboard`.
