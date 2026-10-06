---
last_verified: 2026-10
confidence: verified
touches:
  - apps/desktop/main.js
  - apps/server/src/index.node.ts
  - apps/server/src/shared/upgradeSocketGuard.ts
  - nix/overlay.nix
  - nix/prebuilt.nix
  - nix/package.nix
  - docs/electron-plan.md
  - publish.sh
---

# Desktop

## Purpose

Electron packaging shell that spawns server + realm-reader (and, on NixOS
packages, the bundled In-game overlay host); same architecture as browser
`bun run dev`.

## Business meaning

Distribute Roxysu as a desktop app without changing the local-mirror-centric architecture.

## Important symbols

- `apps/desktop/main.js` — spawns client app + realm-reader + optional overlay host; sets `ROXYSU_DESKTOP=1` and `HUB_URL` (`https://roxysu-api.yonx.app` unless overridden). Any server exit while not shutting down triggers a full app shutdown + `app.exit(code)` — so a server that dies on a single bad connection takes the whole desktop app with it. `REALM_MAX_OLD_SPACE_MB` optionally prepends `--max-old-space-size` to the realm-reader node spawn (opt-in heap guardrail; unset = no flag). `watchOverlayHostSetting` polls the client-app settings store and spawns/restarts/stops the bundled `resources/overlay/roxysu-overlay` on Linux + Wayland per the `overlay.host_enabled` toggle and the `overlay.host_url` value; while disabled it stops the child and suppresses the liveness respawn, otherwise respawns the host if it exits on its own (rate-limited to one auto-respawn per 15s); `ROXYSU_OVERLAY_BIN` overrides the binary path
- `apps/server/src/shared/upgradeSocketGuard.ts` — `guardUpgradeSocketErrors()` attaches a socket `error` listener to every HTTP **upgrade** socket on the Node server (armed from the `app.listen` callback in `index.node.ts`). Required because `@elysiajs/node` always installs a crossws upgrade handler even with no `.ws()` routes: a rejected handshake is answered by writing a normal HTTP body onto the raw upgrade socket, and crossws' `sendResponse` never listens for `error`, so a client that hangs up mid-response raises an unhandled `EPIPE`/`ECONNRESET` and kills the Node process (which then quits the desktop app). Upstream crossws is still unfixed — keep this guard, and do not patch `node_modules`. Bun (`src/index.ts`) is unaffected; it does not use the Node adapter
- The server child is spawned with `NODE_OPTIONS=--expose-gc` (merged with any inherited value). Backfill jobs need a forced collector between maps so note graphs do not accumulate; Node only exposes `global.gc` with that flag, and `NODE_OPTIONS` is the only channel that also reaches dev `tsx`, since `spawnNodeEntry` drops positional node args on the `tsx` path. Scope it to the server child — Electron itself must not inherit the flag. The same spawn path also explains why the server inherits a **~4 GB** default V8 heap on Node, which is why backfill jobs check heap ratio and not just free RAM (see [sunny-dan-recommendations/](../sunny-dan-recommendations/index.md) rules 11–13)
- `nix/prebuilt.nix` / `nix/package.nix` — bundle the In-game overlay host from [nix/overlay.nix](../../nix/overlay.nix) and set `--set-default HUB_URL https://roxysu-api.yonx.app`
- `publish.sh` — bumps versions, tags to trigger CI, builds and uploads
  `RoxysuPreview.zip` (standalone Tosu counter) to the GitHub release, pins
  `linux-resources` to the versioned GitHub tarball, then force-moves the tag
  to that lock commit

## Dependencies

- `apps/server`, `apps/realm-reader`
- [in-game-overlay/](../in-game-overlay/index.md) — optional spawned child (NixOS packages)

## Depended on by

- (packaging surface)

## Related knowledge

- [architecture/process-model.md](../../architecture/process-model.md)
- [decisions/release-tag-includes-linux-resources.md](../../decisions/release-tag-includes-linux-resources.md)
