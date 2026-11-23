---
last_verified: 2026-11
confidence: verified
touches:
  - docs/architecture.md
  - README.md
  - apps/server/src/sse.ts
  - apps/realm-reader/src/index.ts
  - apps/overlay-rs/
  - apps/desktop/main.js
  - packages/db/src/schemaVersion.ts
  - apps/server/src/db.ts
  - apps/server/src/shutdownJobs.ts
  - apps/server/src/listen.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
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
- Optional **in-game overlay** host (`apps/overlay-rs`) renders `#/overlay` above lazer on wlr-layer-shell Wayland; client-app HTTP only, no direct store access. On NixOS packages the Electron shell spawns it as a third child (`resources/overlay/roxysu-overlay`), stops or spawns it per the `overlay.host_enabled` toggle, restarts it when `overlay.host_url` or `overlay.host_output` changes, and respawns it if it exits (watchdog exit **75** — see in-game-overlay rule 15). Desktop passes a long age backstop (default 21600 s; `ROXYSU_OVERLAY_MAX_AGE_SEC` overrides, `0` disables) instead of the old disabled cap; the host does not map until the HUD frame is transparent and, while following osu!, until an output hint resolves to a monitor.
- **Listen:** both entry points use `resolveListen()` (`ROXYSU_PORT`, else `PORT`, else 4321; `ROXYSU_HOST`, else `127.0.0.1`). Background work starts after the socket is bound. On Node that is the `listening` event; if that server object cannot be reached, work starts anyway and a warning is logged. `EADDRINUSE` prints `port N is already in use (ROXYSU_PORT)` and exits 1 before that work starts.
- **Server shutdown order:** on SIGINT/SIGTERM the client app stops its subscriptions and HTTP listener, awaits background writers via `shutdownBackgroundWork()` (analytics run, backfill jobs, mirror batch; 3 s bound), discards uncommitted score-transfer uploads, and only then closes the local mirror and exits. See [features/live-sync/](../features/live-sync/index.md) rule 19.
- Desktop Electron shell spawns server + realm-reader (+ bundled overlay host on Linux/Wayland); same model as `bun run dev`.
- **Realm-reader respawn:** the Electron shell respawns an unexpectedly exited realm-reader with exponential backoff and gives up after repeated short-lived runs (see [features/desktop/](../features/desktop/index.md)); the server exiting still ends the whole app.
- **Migration order:** the server is the single migrator of the local mirror. Desktop spawns it first and spawns the realm-reader only after the server is serving; the reader opens the file without migrating and waits for the schema to be current (60 s bound, then exit with an error). In `bun run dev` both start together and the reader simply waits. See [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md).

## Important symbols

- `apps/realm-reader/src/index.ts` — extraction loop
- `apps/server/src/sse.ts` — import poll + SSE
- `apps/server/src/analytics/pipeline.ts` — analytics pipeline
- `apps/server/src/listen.ts:resolveListen()` — loopback listen target shared by both entry points
- `apps/server/src/shutdownJobs.ts` — background writers stopped before `closeDb`

## Related knowledge

- [local-mirror.md](local-mirror.md)
- [data-ownership.md](data-ownership.md)
- [flows/realm-extraction-to-ui.md](../flows/realm-extraction-to-ui.md)
- [decisions/dual-runtime-sqlite-bus.md](../decisions/dual-runtime-sqlite-bus.md)
