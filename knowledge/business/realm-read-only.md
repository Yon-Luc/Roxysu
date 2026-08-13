---
last_verified: 2026-08
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
2. The only intentional Realm write is manual **collection write-back** to `!Roxysu `-prefixed collections.

**Status:** verified (README + architecture + collection write-back code)
