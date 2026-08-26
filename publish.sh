#!/usr/bin/env bash
# Cut a Roxysu desktop release: bump versions → commit → tag → push → wait for
# CI assets → refresh flake.lock (linux-resources) → commit + push → move the
# same tag to HEAD so github:Yon-Luc/Roxysu/vX.Y.Z includes the matching payload.
#
# The first tag push is what triggers CI. The linux-resources pin can only be
# written after that tarball exists, so the tag is force-moved afterward.
#
# Usage:
#   ./publish.sh 0.1.5
#   ./publish.sh --bump patch|minor|major
#   ./publish.sh --flake-only 0.1.5   # after assets already exist on the release
#
# Flags:
#   --dry-run          Print actions; do not write/push
#   --skip-tests       Skip bun test / typecheck before tagging
#   --skip-push        Commit + tag locally only
#   --skip-flake       Stop after push (no wait / flake update)
#   --flake-only VER   Only wait for assets + update flake.lock + retarget tag
#   --yes              Skip interactive confirmation
#   --allow-dirty      Allow a dirty working tree (not recommended)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DESKTOP_PKG="$ROOT/apps/desktop/package.json"
SERVER_PKG="$ROOT/apps/server/package.json"
NIX_PACKAGE="$ROOT/nix/package.nix"
FLAKE_NIX="$ROOT/flake.nix"
STABLE_ASSET="Roxysu-linux-x64-resources.tar.gz"
TOSU_COUNTER_ZIP="$ROOT/apps/tosu-counter/dist/RoxysuPreview.zip"

DRY_RUN=0
SKIP_TESTS=0
SKIP_PUSH=0
SKIP_FLAKE=0
FLAKE_ONLY=0
ASSUME_YES=0
ALLOW_DIRTY=0
BUMP=""
VERSION=""

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: $*"
  else
    "$@"
  fi
}

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --skip-push) SKIP_PUSH=1; shift ;;
    --skip-flake) SKIP_FLAKE=1; shift ;;
    --flake-only)
      FLAKE_ONLY=1
      shift
      [[ $# -gt 0 ]] || die "--flake-only needs a version"
      VERSION="${1#v}"
      shift
      ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --bump)
      shift
      [[ $# -gt 0 ]] || die "--bump needs patch|minor|major"
      BUMP="$1"
      shift
      ;;
    -*)
      die "unknown flag: $1"
      ;;
    *)
      [[ -z "$VERSION" ]] || die "unexpected argument: $1"
      VERSION="${1#v}"
      shift
      ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

read_pkg_version() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$1"
}

bump_semver() {
  local ver="$1" kind="$2"
  node -e '
    const [maj, min, pat] = process.argv[1].split(".").map(Number);
    const kind = process.argv[2];
    if ([maj, min, pat].some((n) => Number.isNaN(n))) process.exit(2);
    let next;
    if (kind === "major") next = [maj + 1, 0, 0];
    else if (kind === "minor") next = [maj, min + 1, 0];
    else if (kind === "patch") next = [maj, min, pat + 1];
    else process.exit(2);
    console.log(next.join("."));
  ' "$ver" "$kind"
}

set_json_version() {
  local file="$1" ver="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: set version $ver in $file"
    return
  fi
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const ver = process.argv[2];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.version = ver;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$file" "$ver"
}

set_nix_package_version() {
  local ver="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: set nix/package.nix version = \"$ver\""
    return
  fi
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const ver = process.argv[2];
    let text = fs.readFileSync(p, "utf8");
    let replaced = 0;
    text = text.replace(/^(\s*version = ")[^"]+(";)/m, (m, a, b) => {
      if (replaced) return m;
      replaced = 1;
      return a + ver + b;
    });
    if (!replaced) {
      console.error("could not find version = \"…\"; in", p);
      process.exit(1);
    }
    fs.writeFileSync(p, text);
  ' "$NIX_PACKAGE" "$ver"
}

set_flake_linux_resources_url() {
  local ver="$1"
  local url="https://github.com/Yon-Luc/Roxysu/releases/download/v${ver}/Roxysu-${ver}-linux-x64-resources.tar.gz"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: set linux-resources url = $url"
    return
  fi
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const url = process.argv[2];
    let text = fs.readFileSync(p, "utf8");
    let replaced = 0;
    text = text.replace(
      /url = "https:\/\/github\.com\/Yon-Luc\/Roxysu\/releases\/[^"]+"/,
      () => {
        replaced += 1;
        return "url = \"" + url + "\"";
      },
    );
    if (replaced !== 1) {
      console.error("expected one linux-resources url in", p, "got", replaced);
      process.exit(1);
    }
    fs.writeFileSync(p, text);
  ' "$FLAKE_NIX" "$url"
}

confirm() {
  local prompt="$1"
  if [[ "$ASSUME_YES" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

wait_for_release_asset() {
  local tag="$1" asset="$2"
  local deadline=$((SECONDS + 3600))
  log "Waiting for GitHub release asset $asset on $tag (up to 60m)…"
  while (( SECONDS < deadline )); do
    if gh release view "$tag" --json assets \
      --jq ".assets[] | select(.name == \"$asset\") | .name" 2>/dev/null | grep -qx "$asset"; then
      log "Found $asset on $tag"
      return 0
    fi
    echo "  …still waiting ($(date +%H:%M:%S)). Check: gh run list --branch $tag"
    sleep 20
  done
  die "timed out waiting for $asset on release $tag"
}

update_flake_lock() {
  local tag="$1"
  local ver="${tag#v}"
  require_cmd nix
  log "Pinning linux-resources to ${tag} tarball…"
  local latest
  latest="$(gh release view --json tagName -q .tagName)"
  if [[ "$latest" != "$tag" ]]; then
    die "GitHub latest release is $latest, expected $tag — refuse to update flake.lock"
  fi
  set_flake_linux_resources_url "$ver"
  # --refresh bypasses Nix tarball-ttl so a new versioned URL is actually fetched.
  run nix flake update linux-resources --refresh
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return
  fi
  if git diff --quiet -- flake.lock flake.nix; then
    log "flake.lock / flake.nix unchanged (already pinned to this payload?)"
    return
  fi
  run git add flake.lock flake.nix
  run git commit -m "$(cat <<EOF
Pin linux-resources to ${tag}.

EOF
)"
  if [[ "$SKIP_PUSH" -eq 0 ]]; then
    run git push origin HEAD
  fi
  log "flake.lock updated for ${tag}"
}

# CI builds from the initial tag. After linux-resources is locked, the published
# tag must point at HEAD or github:Yon-Luc/Roxysu/vX.Y.Z wraps the previous payload.
retarget_release_tag() {
  local tag="$1"
  local version="${2:-${tag#v}}"
  local head peeled
  head="$(git rev-parse HEAD)"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    peeled="$(git rev-parse "$tag^{}")"
    if [[ "$peeled" == "$head" ]]; then
      log "Tag $tag already points at HEAD"
      return
    fi
  fi
  log "Moving $tag → $(git rev-parse --short HEAD) (includes linux-resources lock)"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: git tag -f -a $tag HEAD && git push --force origin $tag"
    return
  fi
  git tag -f -a "$tag" -m "Roxysu ${version}" HEAD
  if [[ "$SKIP_PUSH" -eq 0 ]]; then
    git push origin "refs/tags/${tag}" --force
    gh release edit "$tag" --target "$head" >/dev/null
  else
    log "Skipped tag push. Later: git push origin $tag --force"
  fi
}

release_notes() {
  local prev="$1" ver="$2"
  local range
  if git rev-parse "$prev" >/dev/null 2>&1; then
    range="${prev}..HEAD"
  else
    range="HEAD"
  fi
  {
    echo "## Summary"
    echo
    echo "- Version bump to ${ver}"
    echo
    echo "## Changes since ${prev}"
    echo
    git log "$range" --pretty=format:'- %s' --no-merges
    echo
    echo
    echo "Windows installers and the Linux resources archive are attached by CI."
    echo "RoxysuPreview.zip (standalone Tosu counter) is attached by publish.sh."
  }
}

upload_tosu_counter_zip() {
  local tag="$1"
  require_cmd bun
  log "Building Tosu counter zip…"
  run bun run tosu-counter
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: gh release upload $tag $TOSU_COUNTER_ZIP --clobber"
    return
  fi
  [[ -f "$TOSU_COUNTER_ZIP" ]] || die "missing $TOSU_COUNTER_ZIP after build"
  log "Uploading RoxysuPreview.zip to $tag…"
  gh release upload "$tag" "$TOSU_COUNTER_ZIP" --clobber
}

# --- flake-only path ----------------------------------------------------------
if [[ "$FLAKE_ONLY" -eq 1 ]]; then
  [[ -n "$VERSION" ]] || die "version required"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]] || die "invalid semver: $VERSION"
  TAG="v${VERSION}"
  require_cmd gh
  wait_for_release_asset "$TAG" "$STABLE_ASSET"
  update_flake_lock "$TAG"
  retarget_release_tag "$TAG" "$VERSION"
  exit 0
fi

# --- resolve version ----------------------------------------------------------
require_cmd node
require_cmd git
require_cmd gh

CURRENT="$(read_pkg_version "$DESKTOP_PKG")"
SERVER_VER="$(read_pkg_version "$SERVER_PKG")"
[[ "$CURRENT" == "$SERVER_VER" ]] || die "desktop ($CURRENT) and server ($SERVER_VER) versions differ — fix manually first"

if [[ -n "$BUMP" ]]; then
  [[ -z "$VERSION" ]] || die "pass either --bump or an explicit version, not both"
  case "$BUMP" in
    patch|minor|major) VERSION="$(bump_semver "$CURRENT" "$BUMP")" ;;
    *) die "--bump must be patch, minor, or major" ;;
  esac
fi

[[ -n "$VERSION" ]] || die "pass a version (e.g. 0.1.5) or --bump patch|minor|major"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]] || die "invalid semver: $VERSION"
TAG="v${VERSION}"

if [[ "$VERSION" == "$CURRENT" ]]; then
  die "already at $VERSION — nothing to bump"
fi

# Dry-run never writes; allow a dirty tree so local WIP does not block rehearsal.
if [[ "$ALLOW_DIRTY" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree is dirty; commit/stash first or pass --allow-dirty"
  fi
fi

PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

log "Release plan"
echo "  branch:  $BRANCH"
echo "  current: $CURRENT"
echo "  next:    $VERSION ($TAG)"
echo "  previous tag: ${PREV_TAG:-none}"
echo "  tests:   $([[ "$SKIP_TESTS" -eq 1 ]] && echo skip || echo run)"
echo "  push:    $([[ "$SKIP_PUSH" -eq 1 ]] && echo no || echo yes)"
echo "  flake:   $([[ "$SKIP_FLAKE" -eq 1 ]] && echo skip || echo wait + update)"
echo

confirm "Proceed with release $TAG?" || die "aborted"

# --- tests --------------------------------------------------------------------
if [[ "$SKIP_TESTS" -eq 0 ]]; then
  log "Running typecheck + tests…"
  run bun run typecheck
  run bun run test
fi

# --- bump ---------------------------------------------------------------------
log "Bumping package versions to $VERSION"
set_json_version "$DESKTOP_PKG" "$VERSION"
set_json_version "$SERVER_PKG" "$VERSION"
set_nix_package_version "$VERSION"

NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
release_notes "${PREV_TAG:-v0.0.0}" "$VERSION" >"$NOTES_FILE"

if [[ "$DRY_RUN" -eq 0 ]]; then
  git add "$DESKTOP_PKG" "$SERVER_PKG" "$NIX_PACKAGE"
  git commit -m "$(cat <<EOF
Bump version to ${VERSION}.

EOF
)"
  git tag -a "$TAG" -m "Roxysu ${VERSION}"
else
  echo "dry-run: commit version bump + annotated tag $TAG"
fi

# --- push + release notes -----------------------------------------------------
if [[ "$SKIP_PUSH" -eq 0 ]]; then
  log "Pushing $BRANCH and $TAG…"
  run git push origin HEAD
  run git push origin "$TAG"

  log "Ensuring GitHub release exists with notes…"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: gh release create/edit $TAG"
  else
    if gh release view "$TAG" >/dev/null 2>&1; then
      gh release edit "$TAG" --title "Roxysu v${VERSION}" --notes-file "$NOTES_FILE"
    else
      # CI workflows attach assets when the tag is pushed; create notes early.
      gh release create "$TAG" --title "Roxysu v${VERSION}" --notes-file "$NOTES_FILE" --verify-tag
    fi
  fi
  upload_tosu_counter_zip "$TAG"
else
  log "Skipped push. Next: git push origin HEAD && git push origin $TAG"
fi

# --- flake --------------------------------------------------------------------
if [[ "$SKIP_FLAKE" -eq 1 || "$SKIP_PUSH" -eq 1 ]]; then
  if [[ "$SKIP_FLAKE" -eq 1 ]]; then
    log "Skipped flake update. Later: ./publish.sh --flake-only $VERSION"
  fi
  log "Done (tag $TAG)."
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: would wait for $STABLE_ASSET then nix flake update linux-resources then move $TAG to HEAD"
  exit 0
fi

wait_for_release_asset "$TAG" "$STABLE_ASSET"
update_flake_lock "$TAG"
retarget_release_tag "$TAG" "$VERSION"
log "Release $TAG complete."
