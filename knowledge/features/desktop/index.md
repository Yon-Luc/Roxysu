---
last_verified: 2026-08
confidence: verified
touches:
  - apps/desktop/main.js
  - docs/electron-plan.md
---

# Desktop

## Purpose

Electron packaging shell that spawns server + realm-reader; same architecture as browser `bun run dev`.

## Business meaning

Distribute Roxysu as a desktop app without changing the local-mirror-centric architecture.

## Important symbols

- `apps/desktop/main.js`

## Dependencies

- `apps/server`, `apps/realm-reader`

## Depended on by

- (packaging surface)

## Related knowledge

- [architecture/process-model.md](../../architecture/process-model.md)
