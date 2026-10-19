---
last_verified: 2026-10
confidence: verified
touches:
  - docs/architecture.md
  - README.md
  - apps/server/src/sse.ts
  - apps/realm-reader/src/index.ts
  - apps/overlay/main.c
  - apps/desktop/main.js
  - packages/db/src/schemaVersion.ts
  - apps/server/src/db.ts
  - apps/server/src/shutdownJobs.ts
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
- Optional **in-game overlay** host (`apps/overlay`) renders `#/overlay` above lazer on wlr-layer-shell Wayland; client-app HTTP only, no direct store access. On NixOS packages the Electron shell spawns it as a third child (`resources/overlay/roxysu-overlay`), stops or spawns it per the `overlay.host_enabled` toggle, restarts it when the `overlay.host_url` setting changes, and respawns it if it exits (the host self-exits when its resource watchdog trips — see in-game-overlay rule 15).
- **Server shutdown order:** on SIGINT/SIGTERM the client app stops its subscriptions and HTTP listener, awaits background writers via `shutdownBackgroundWork()` (analytics run, backfill jobs, mirror batch; 3 s bound), and only then closes the local mirror and exits. See [features/live-sync/](../features/live-sync/index.md) rule 19.
- Desktop Electron shell spawns server + realm-reader (+ bundled overlay host on Linux/Wayland); same model as `bun run dev`.
- **Realm-reader respawn:** the Electron shell respawns an unexpectedly exited realm-reader with exponential backoff and gives up after repeated short-lived runs (see [features/desktop/](../features/desktop/index.md)); the server exiting still ends the whole app.
- **Migration order:** the server is the single migrator of the local mirror. Desktop spawns it first and spawns the realm-reader only after the server is serving; the reader opens the file without migrating and waits for the schema to be current (60 s bound, then exit with an error). In `bun run dev` both start together and the reader simply waits. See [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md).

## Important symbols

- `apps/realm-reader/src/index.ts` — extraction loop
- `apps/server/src/sse.ts` — import poll + SSE
- `apps/server/src/analytics/pipeline.ts` — analytics pipeline
- `apps/server/src/shutdownJobs.ts` — background writers stopped before `closeDb`

## Related knowledge

- [local-mirror.md](local-mirror.md)
- [data-ownership.md](data-ownership.md)
- [flows/realm-extraction-to-ui.md](../flows/realm-extraction-to-ui.md)
- [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md)
