---
id: F3-009
feature: analytics
kind: correctness
severity: low
confidence: verified
status: proposed
---

# Active-day streak stops counting at 61

## What

`computeActiveDayStreak` walks back only while `streak <= SNAPSHOT_DAYS` (60), so any real
streak of 61 or more days displays as 61 - permanently, not just at the 60-day edge.

## Why

The 60-day window exists to bound `getCalendarActivity`. The cap leaked into the displayed
value instead of only limiting the lookback.

## How to improve

Separate the window from the reported streak. Keep the bounded calendar query, and either
report the streak as "60+" or keep walking day by day until the first gap, since the walk
stops immediately on a miss.

## Evidence

- `apps/server/src/analytics/practiceSnapshot.ts:9` - `SNAPSHOT_DAYS = 60`
- `apps/server/src/analytics/practiceSnapshot.ts:22-34` - loop bound doubles as the value
- `apps/server/src/analytics/practiceSnapshot.ts:61-77` - the bounded calendar query
