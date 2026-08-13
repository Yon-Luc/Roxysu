---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/tosu
---

# tosu live

## Purpose

Optional WebSocket integration with **tosu** for live in-progress map state (overlay / live UI hints).

## Business rules

1. tosu is **not** the score source of truth — Realm → SQLite remains authoritative for plays.

## Important symbols

- `apps/server/src/tosu/*`

## Dependencies

- external tosu process (root `dev` script)

## Depended on by

- overlay / live UI surfaces (when enabled)
