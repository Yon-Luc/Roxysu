---
id: F-021
feature: stats
kind: perf
severity: medium
confidence: verified
---

# Stats loads every mania play for a keymode on a cache miss

## What

A stats cache miss runs `loadManiaAnalyticsRows`, a join of all scoped mania scores for that key count, then several in-memory passes for skill history, trends, rank mix, and mappers.

## Why

The page is correct in loading the plays once per keymode, and the working set is unbounded. A large mirror pays that cost per keymode tab until the cache fills.

## How to improve

Aggregate rank and trend counts in SQL. Keep the row scan for skill history, and invalidate by import delta so a cache miss is rare.

## Potential gain

Opening Stats on a large library uses less memory and returns sooner.

## Evidence

- `apps/server/src/analytics/playerStats.ts` `loadManiaAnalyticsRows` (about lines 167–198) and `getPlayerStats` (about lines 488–544), which fans the full array into progression, rank, and skillset helpers.
