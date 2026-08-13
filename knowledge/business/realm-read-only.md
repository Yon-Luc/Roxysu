---
last_verified: 2026-08
confidence: verified
touches:
  - README.md
  - docs/architecture.md
---

# Realm read-only

## Purpose

Protect osu!lazer user data.

## Business rules

1. `client.realm` is the immutable source of truth for scores and beatmaps; SQLite is a mirror plus derived/user data.
2. The only intentional Realm write is manual smart-collection sync to `!Roxysu `-prefixed collections.

**Status:** verified (README + architecture + collection sync code)
