---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - package.json
  - apps/server/package.json
  - apps/realm-reader/package.json
---

# Tech stack

## Purpose

Record the intentional dual-runtime stack and UI/API choices.

## Implementation

| Layer | Choice |
|---|---|
| Local API | Bun + Elysia (`apps/server`, port 4321) |
| UI | React 19, TanStack Router/Query, Recharts, Tailwind 4 |
| Realm import | Node + Realm JS + `better-sqlite3` (`apps/realm-reader`) |
| Shared DB | Drizzle schema in `packages/db`; `client.bun` vs `client.node` |
| Hub | Separate Elysia app (`apps/hub`, port 4322) |
| Desktop | Electron (`apps/desktop`) |
| Dev env | Nix flake / direnv for native modules on NixOS |

## Why two runtimes

Realm JS does not run on Bun; `better-sqlite3` also does not. Each process uses the SQLite driver its runtime supports while sharing one schema.

## Related knowledge

- [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md)
