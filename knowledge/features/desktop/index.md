---
last_verified: 2026-08
confidence: verified
touches:
  - apps/desktop/main.js
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

- `apps/desktop/main.js` — spawns client app + realm-reader + optional overlay host; sets `ROXYSU_DESKTOP=1` and `HUB_URL` (`https://roxysu-api.yonx.app` unless overridden). `watchOverlayHostSetting` polls the client-app settings store and spawns/restarts the bundled `resources/overlay/roxysu-overlay` on Linux + Wayland when `overlay.host_url` changes (skipped otherwise); `ROXYSU_OVERLAY_BIN` overrides the binary path
- `nix/prebuilt.nix` / `nix/package.nix` — bundle the In-game overlay host from [nix/overlay.nix](../../nix/overlay.nix) and set `--set-default HUB_URL https://roxysu-api.yonx.app`
- `publish.sh` — bumps versions, tags to trigger CI, pins `linux-resources` to the versioned GitHub tarball, then force-moves the tag to that lock commit

## Dependencies

- `apps/server`, `apps/realm-reader`
- [in-game-overlay/](../in-game-overlay/index.md) — optional spawned child (NixOS packages)

## Depended on by

- (packaging surface)

## Related knowledge

- [architecture/process-model.md](../../architecture/process-model.md)
- [decisions/release-tag-includes-linux-resources.md](../../decisions/release-tag-includes-linux-resources.md)
