---
last_verified: 2026-08
confidence: verified
touches:
  - publish.sh
  - flake.nix
  - flake.lock
  - .github/workflows/desktop-linux-resources.yml
  - .github/workflows/desktop-win.yml
---

# Release tags include the linux-resources lock

## Decision

A published version tag (`vX.Y.Z`) must point at a commit whose `flake.lock` pins `linux-resources` to **that** version's GitHub release tarball — not the previous payload.

## Reason

The prebuilt client app version comes from the tarball (`package.json` / `resources/manifest.json`), not from the git tag name. CI can only upload that tarball after a tag exists, so the first tag commit cannot yet contain the matching lock. Leaving the tag on the version-bump commit makes `github:Yon-Luc/Roxysu/vX.Y.Z` wrap the previous payload.

## Consequences

- Do not leave `vX.Y.Z` on the version-bump commit after `flake.lock` is refreshed.
- `publish.sh` force-moves the tag to HEAD after the linux-resources lock commit (and `--flake-only` does the same).
- Pin `linux-resources` to a **versioned** GitHub asset URL (`releases/download/vX.Y.Z/…`), never `releases/latest`. Nix caches tarballs by URL (`tarball-ttl`); `nix flake update linux-resources` against `latest` can keep or even downgrade to the previous payload.
- Consumers of `github:Yon-Luc/Roxysu` should `nix flake update --refresh` then rebuild — not update `linux-resources` in isolation.
- Linux-resources CI must not rebuild on a tag force-move (`github.event.created` only). Replacing the tarball at the same versioned URL would invalidate `flake.lock`.
- Windows CI **must** rebuild on tag force-move (no `github.event.created` guard). `publish.sh` retargets the tag after the linux tarball upload; cancelling the first build and skipping the retarget left releases without a Windows installer.

## Relevant implementation

- `publish.sh` — `set_flake_linux_resources_url()`, `update_flake_lock()`, `retarget_release_tag()`
- `flake.nix` input `linux-resources` (versioned release asset, content pinned in `flake.lock`)
- `.github/workflows/desktop-linux-resources.yml`, `.github/workflows/desktop-win.yml`
