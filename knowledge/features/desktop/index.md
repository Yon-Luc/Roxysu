---
last_verified: 2026-11
confidence: verified
touches:
  - apps/desktop/main.js
  - apps/desktop/preload.js
  - apps/desktop/urlPolicy.js
  - apps/desktop/stopChild.js
  - apps/desktop/waitForServer.js
  - apps/desktop/paths.js
  - apps/desktop/respawnPolicy.js
  - apps/desktop/overlayApplyPolicy.js
  - apps/desktop/overlayApplyLoop.js
  - apps/desktop/overlaySettings.js
  - apps/desktop/overlayUrlGuard.js
  - apps/server/public/lib/desktop.ts
  - apps/server/src/index.node.ts
  - apps/server/src/shared/upgradeSocketGuard.ts
  - nix/overlay-rs.nix
  - nix/prebuilt.nix
  - nix/package.nix
  - docs/electron-plan.md
  - publish.sh
  - flake.nix
---

# Desktop

## Purpose

Electron packaging shell that spawns server + realm-reader (and, on NixOS
packages, the bundled In-game overlay host); same architecture as browser
`bun run dev`.

## Business meaning

Distribute Roxysu as a desktop app without changing the local-mirror-centric architecture.

## Important symbols

- `apps/desktop/main.js` — spawns client app + realm-reader + optional overlay host; sets `ROXYSU_DESKTOP=1`, `ROXYSU_PACKAGED=1` when `paths.isPackaged` (Nix / electron-builder; unset for `bun desktop`), and `HUB_URL` (`https://roxysu-api.yonx.app` unless overridden). Any unexpected server exit or spawn `error` while not shutting down goes through the same respawn policy as the realm-reader (`respawnPolicy.js:decideRespawn`, pure, unit-tested: 2 s doubling to 60 s, a run ≥ 60 s resets the counter, give-up after 6 consecutive short-lived runs) — a "server stopped" splash status, respawn, `waitForServer` re-run, then a window reload; only an exhausted budget shows a "server stopped — see logs" splash and exits. The realm-reader and overlay host are left running across a server respawn (the overlay self-heals via its poll-failure rule and respawns once settings polls answer again). `REALM_MAX_OLD_SPACE_MB` optionally prepends `--max-old-space-size` to the realm-reader node spawn (opt-in heap guardrail; unset = no flag). `watchOverlayHostSetting` polls the client-app settings store and spawns/restarts/stops the bundled `resources/overlay/roxysu-overlay` on Linux + Wayland per the `overlay.host_enabled` toggle, `overlay.host_url`, and optional `overlay.host_output` (passed as `--output=` only when set); while disabled it stops the child and suppresses the liveness respawn, otherwise respawns the host if it exits on its own (rate-limited to one auto-respawn per 15s, except that a changed URL or monitor restarts at once); the apply decision lives in `apps/desktop/overlayApplyPolicy.js` (`decideOverlayApply`, pure, unit-tested; `childIsAlive` treats signal death as dead) and stops a live host after 5 consecutive failed settings polls regardless of the last known toggle (see in-game-overlay rule 14). Poll runs are serialized through `apps/desktop/overlayApplyLoop.js` (`createApplyGate` allows one run in flight and coalesces mid-flight ticks into a single re-run; `executeOverlayDecision` awaits the stop before a replacement spawns, so a restart never overlaps two hosts). The settings fetch (`apps/desktop/overlaySettings.js`) requires HTTP 200 with an `overlay` object and a boolean `enabled`, and caps the body at 64 KiB — a non-200 error document counts as a failed poll, not as "enabled with the default HUD URL". `guardOverlaySettings` re-validates `hostUrl`/`output` with `apps/desktop/overlayUrlGuard.js` (CommonJS mirror of the server parsers) before they reach argv: a rejected URL falls back to the default HUD URL, a rejected monitor follows the osu! window, both logged. The settings UI's "Restart overlay" action bumps a monotonic `overlay.host_restart` nonce, which restarts the host at once (bypassing the liveness gap; the shell records the nonce it spawned under, so one click restarts exactly once). `ROXYSU_OVERLAY_BIN` overrides the binary path. Quit is held in `before-quit` (`preventDefault()`) until `shutdown()` has stopped every child: SIGTERM, then SIGKILL after 5 s, then give up 2 s later if `exit` never arrives, then `app.quit()` again. This matters because the server and realm-reader only handle SIGTERM cooperatively (realm-reader checks its flag between syncs), so a bare SIGTERM could leave them holding `ROXYSU_PORT` after Electron exited. Preload bridge (`roxysuDesktop`): `openExternal`, `writeClipboardImage` (PNG bytes via `clipboard.writeImage` for session share cards, rejected above 15 MB). The window stays on the app origin (`http://ROXYSU_HOST:ROXYSU_PORT`): `will-navigate` / `will-redirect` block anything else, `setWindowOpenHandler` denies new windows, and `http:` / `https:` / `osu:` are handed to `shell.openExternal` so an osu! client link or a website link cannot blank the window or inherit the preload. Both IPC handlers reject a sender whose frame URL is not that origin. `waitForServer` (`apps/desktop/waitForServer.js`) treats the child as up only for HTTP 200 with JSON `{ ok: true }` on `/api/system/healthz`, one probe at a time, and aborts when shutdown starts. A failed `loadURL` shows the splash error and exits unless shutdown is already in progress. A server exit while not shutting down respawns with backoff (policy above).
- Quit sequence (`main.js`: `before-quit` → `shutdown()` → `stopChild()` in `apps/desktop/stopChild.js`): `before-quit` calls `preventDefault()`, SIGTERMs the overlay host, realm-reader and server in parallel, waits for each `exit` (SIGKILL after `CHILD_STOP_GRACE_MS` = 5 s). If `kill()` returns false, or the child still has not exited 2 s after SIGKILL, the wait resolves anyway so Quit cannot hang. Shutdown then closes the child log fds, and `before-quit` re-issues `app.quit()` from `finally`. A `quitAfterShutdown` flag lets the second `before-quit` through, so `autoUpdater.quitAndInstall` keeps working. The server and realm-reader install cooperative SIGTERM handlers, so a bare SIGTERM without waiting could leave them alive after Electron exited and holding `ROXYSU_PORT`. The server's SIGTERM handler awaits background writers for up to 3 s (`shutdownBackgroundWork()`) before closing the local mirror, which fits inside the 5 s `CHILD_STOP_GRACE_MS`. On Windows `SIGTERM` is an immediate terminate (no cooperative handler runs)
- Realm-reader respawn (`main.js`: `spawnRealmReader` → `scheduleRealmRespawn`): an exit while not shutting down, a spawn `error` (no `exit`), or a failed extract / missing entry reschedules the reader after an exponential backoff chosen by `apps/desktop/respawnPolicy.js:decideRespawn()` (pure, unit-tested): 2 s doubling to 60 s; a run that stayed up at least 60 s resets the consecutive-failure counter; after 6 consecutive shorter runs the shell gives up (logged; restart Roxysu to retry). `spawnRealmReader` returns a Promise of `"running" | "failed" | "spawned"`; only `"failed"` reschedules, and a still-running child (`childIsAlive`) does not. The first packaged extract (`paths.js:ensureRealmExtracted`) uses async `execFile` so `tar` does not freeze the window; the marker is written only after the entry exists, and a quit during extract does not spawn. The failure counter advances only inside `scheduleRealmRespawn`. The pending timer is cleared in `shutdown()`, so a quit never races a respawn. The reader opens the local mirror without migrating and exits on a 60 s schema wait, which the respawn also covers. No UI indicator exists for a given-up reader; the desktop log is the only surface
- `apps/desktop/preload.js` — `contextBridge.exposeInMainWorld("roxysuDesktop", …)`
- `apps/server/src/shared/upgradeSocketGuard.ts` — `guardUpgradeSocketErrors()` attaches a socket `error` listener to every HTTP **upgrade** socket on the Node server (armed from the `app.listen` callback in `index.node.ts`). Required because `@elysiajs/node` always installs a crossws upgrade handler even with no `.ws()` routes: a rejected handshake is answered by writing a normal HTTP body onto the raw upgrade socket, and crossws' `sendResponse` never listens for `error`, so a client that hangs up mid-response raises an unhandled `EPIPE`/`ECONNRESET` and kills the Node process (which the desktop shell then respawns with backoff — see the `main.js` respawn policy above). Upstream crossws is still unfixed — keep this guard, and do not patch `node_modules`. Bun (`src/index.ts`) is unaffected; it does not use the Node adapter
- The server child is spawned with `NODE_OPTIONS=--expose-gc` (merged with any inherited value). Backfill jobs need a forced collector between maps so note graphs do not accumulate; Node only exposes `global.gc` with that flag, and `NODE_OPTIONS` is the only channel that also reaches dev `tsx`, since `spawnNodeEntry` drops positional node args on the `tsx` path. Scope it to the server child — Electron itself must not inherit the flag. The same spawn path also explains why the server inherits a **~4 GB** default V8 heap on Node, which is why backfill jobs check heap ratio and not just free RAM (see [rework-dan-recommendations/](../rework-dan-recommendations/index.md) rules 11–13). When `ROXYSU_LIBRARY_PATH` is set, `spawnNodeEntry` replaces the child's `LD_LIBRARY_PATH` with that value so Node does not load Chromium libraries from the Electron wrapper
- `nix/prebuilt.nix` / `nix/package.nix` — bundle the In-game overlay host from [nix/overlay-rs.nix](../../nix/overlay-rs.nix), set `--set-default HUB_URL https://roxysu-api.yonx.app`, and set `ROXYSU_NODE_BIN` plus `ROXYSU_LIBRARY_PATH` (libstdc++, zlib, openssl, icu). The prebuilt package launches nixpkgs Node 22 (`NODE_MODULE_VERSION` 127, matching the CI tarball's natives). `resources/node/node` is the nodejs.org binary and is not executed: `autoPatchelf` would move its embedded V8 snapshot and the process SIGSEGVs at startup. The install asserts `resources/node/VERSION` is `22.*`. The from-source package still launches nixpkgs Node 24 and rebuilds natives against it
- `publish.sh` — bumps versions, tags to trigger CI, builds and uploads
  `RoxysuPreview.zip` (standalone Tosu counter) to the GitHub release, pins
  `linux-resources` to the versioned GitHub tarball, then force-moves the tag
  to that lock commit

## Business rules

1. The desktop shell uses the newest Electron major nixpkgs still allows (`meta.knownVulnerabilities` empty). Electron 42 is end-of-life and Nix refuses to evaluate it. Windows installers bundle the same major from `apps/desktop` `electron` via electron-builder. Child processes use a Node runtime, not Electron's Node: Windows uses `resources/node`, Nix prebuilt uses nixpkgs Node 22 via `ROXYSU_NODE_BIN`, Nix from-source uses nixpkgs Node 24 via `ROXYSU_NODE_BIN`.
   **Status:** verified

## Dependencies

- `apps/server`, `apps/realm-reader`
- Packaging file lists that must include every desktop module: `apps/desktop/package.json` `build.files`, `apps/desktop/scripts/pack-linux-resources.mjs`, `apps/desktop/scripts/assert-linux-resources.mjs`, `nix/package.nix`
- [in-game-overlay/](../in-game-overlay/index.md) — optional spawned child (NixOS packages)

## Depended on by

- (packaging surface)

## Related knowledge

- [architecture/process-model.md](../../architecture/process-model.md)
- [decisions/release-tag-includes-linux-resources.md](../../decisions/release-tag-includes-linux-resources.md)
