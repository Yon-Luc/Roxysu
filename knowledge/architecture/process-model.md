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

Describe how osu!lazer beatmaps and scores become searchable analytics in the browser.

## Implementation

```
osu!lazer
    │
client.realm (usually read-only)
    │
apps/realm-reader (Node + Realm JS)
    │  persists raw import rows via @roxysu/db/client.node
    ▼
local mirror (SQLite WAL)
    ▲  reads/writes derived rows via @roxysu/db/client.bun
    │
apps/server (Bun + Elysia)
    │
Analytics → HTTP /api + SSE → React UI
```

- **No IPC** between realm-reader and server; both use the same local mirror file.
- The client app detects new imports by **polling** the `imports` table, then runs analytics and emits SSE.
- Optional **tosu** WebSocket feeds live in-progress map state (not the score source of truth).
- Desktop Electron shell spawns server + realm-reader; same model as `bun run dev`.

## Important symbols

- `apps/realm-reader/src/index.ts` — extraction loop
- `apps/server/src/sse.ts` — import poll + SSE
- `apps/server/src/analytics/pipeline.ts` — analytics pipeline

## Related knowledge

- [local-mirror.md](local-mirror.md)
- [data-ownership.md](data-ownership.md)
- [flows/realm-extraction-to-ui.md](../flows/realm-extraction-to-ui.md)
- [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md)
