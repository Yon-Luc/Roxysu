---
last_verified: 2026-08
confidence: verified
touches:
  - publish.sh
  - flake.nix
  - flake.lock
---

# Release tags include the linux-resources lock

## Decision

A published version tag (`vX.Y.Z`) must point at a commit whose `flake.lock` pins `linux-resources` to **that** version's GitHub release tarball — not the previous payload.

## Reason

The prebuilt client app version comes from the tarball (`package.json` / `resources/manifest.json`), not from the git tag name. CI can only upload that tarball after a tag exists, so the first tag commit cannot yet contain the matching lock. Leaving the tag on the version-bump commit makes `github:Yon-Luc/Roxysu/vX.Y.Z` wrap the previous payload.

## Consequences

- Do not leave `vX.Y.Z` on the version-bump commit after `flake.lock` is refreshed.
- `publish.sh` force-moves the tag to HEAD after the linux-resources lock commit (and `--flake-only` does the same).
- Do not pin `linux-resources` in `flake.nix` to a tag that has not been retargeted yet.

## Relevant implementation

- `publish.sh` — `update_flake_lock()`, `retarget_release_tag()`
- `flake.nix` input `linux-resources` (`releases/latest/download/…`, content pinned in `flake.lock`)
