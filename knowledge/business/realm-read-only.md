---
last_verified: 2026-10
confidence: verified
touches:
  - README.md
  - docs/architecture.md
---

# Realm read-only

## Purpose

Protect osu!lazer user beatmaps and scores.

## Business rules

1. Realm is the immutable source of truth for scores and beatmaps; the local mirror holds extracted copies plus derived/user rows.
2. Intentional Realm writes are manual only: **collection write-back** to `!Roxysu `-prefixed collections, **online score pull** of ranked bests into `Score` rows, and **score transfer** of scores from a file into `Score` rows. Each requires lazer closed, a backup taken before the write connection opens, and a schema check. They are mutually exclusive: one shared Realm write lock (`apps/server/src/shared/realmWriteLock.ts`) rejects a second concurrent write with HTTP 409 `in_flight`.

**Status:** verified (README + architecture + collection write-back code)
