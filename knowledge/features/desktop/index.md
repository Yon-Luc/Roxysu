---
last_verified: 2026-08
confidence: verified
touches:
  - apps/desktop/main.js
  - nix/prebuilt.nix
  - nix/package.nix
  - docs/electron-plan.md
  - publish.sh
---

# Desktop

## Purpose

Electron packaging shell that spawns server + realm-reader; same architecture as browser `bun run dev`.

## Business meaning

Distribute Roxysu as a desktop app without changing the local-mirror-centric architecture.

## Important symbols

- `apps/desktop/main.js` — spawns client app + realm-reader; sets `ROXYSU_DESKTOP=1` and `HUB_URL` (`https://roxysu-api.yonx.app` unless overridden)
- `nix/prebuilt.nix` / `nix/package.nix` — `--set-default HUB_URL https://roxysu-api.yonx.app`
- `publish.sh` — bumps versions, tags to trigger CI, then force-moves the tag to the `linux-resources` lock commit so `github:Yon-Luc/Roxysu/vX.Y.Z` wraps that payload

## Dependencies

- `apps/server`, `apps/realm-reader`

## Depended on by

- (packaging surface)

## Related knowledge

- [architecture/process-model.md](../../architecture/process-model.md)
- [decisions/release-tag-includes-linux-resources.md](../../decisions/release-tag-includes-linux-resources.md)
