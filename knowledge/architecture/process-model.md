---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - README.md
  - apps/server/src/sse.ts
  - apps/realm-reader/src/index.ts
---

# Process model

## Purpose

Describe how osu!lazer data becomes searchable analytics in the browser.

## Implementation

```
osu!lazer
    │
client.realm (usually read-only)
    │
apps/realm-reader (Node + Realm JS)
    │  writes via @roxysu/db/client.node
    ▼
SQLite WAL (shared file)
    ▲  reads/writes via @roxysu/db/client.bun
    │
apps/server (Bun + Elysia)
    │
Analytics → HTTP /api + SSE → React UI
```

- **No IPC** between realm-reader and server; both use the same SQLite file.
- Server detects new data by **polling** the `imports` table, then runs analytics and emits SSE.
- Optional **tosu** WebSocket feeds live in-progress map state (not the score SoT).
- Desktop Electron shell spawns server + realm-reader; same data model.

## Important symbols

- `apps/realm-reader/src/index.ts` — import loop
- `apps/server/src/sse.ts` — import poll + SSE
- `apps/server/src/analytics/pipeline.ts` — analytics pipeline

## Related knowledge

- [data-ownership.md](data-ownership.md)
- [flows/realm-sync-to-ui.md](../flows/realm-sync-to-ui.md)
- [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md)
