#!/usr/bin/env bash
# Build Hub from repo root and push to publier.yonx.app (Podman).
#
# Usage (from anywhere):
#   ./apps/hub/script.sh
#   ./apps/hub/script.sh --tag 2026-08-15
#   ./apps/hub/script.sh --dry-run
#
# Env overrides:
#   IMAGE      full image name without tag (default: publier.yonx.app/roxysu/hub)
#   TAG        image tag (default: latest; --tag wins)
#   PLATFORM   build platform (default: linux/amd64)
#   ENGINE     podman|docker (default: first available, prefers podman)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-publier.yonx.app/roxysu/hub}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
ENGINE="${ENGINE:-}"
DRY_RUN=0
SKIP_LOGIN=0

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
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-login) SKIP_LOGIN=1; shift ;;
    --tag)
      shift
      [[ $# -gt 0 ]] || die "--tag needs a value"
      TAG="$1"
      shift
      ;;
    --image)
      shift
      [[ $# -gt 0 ]] || die "--image needs a value"
      IMAGE="$1"
      shift
      ;;
    --platform)
      shift
      [[ $# -gt 0 ]] || die "--platform needs a value"
      PLATFORM="$1"
      shift
      ;;
    --engine)
      shift
      [[ $# -gt 0 ]] || die "--engine needs podman|docker"
      ENGINE="$1"
      shift
      ;;
    -*)
      die "unknown flag: $1"
      ;;
    *)
      die "unexpected argument: $1 (use --tag NAME)"
      ;;
  esac
done

if [[ -z "$ENGINE" ]]; then
  if command -v podman >/dev/null 2>&1; then
    ENGINE=podman
  elif command -v docker >/dev/null 2>&1; then
    ENGINE=docker
  else
    die "need podman or docker on PATH"
  fi
fi

command -v "$ENGINE" >/dev/null 2>&1 || die "missing required command: $ENGINE"
[[ -f "$ROOT/apps/hub/Dockerfile" ]] || die "Dockerfile missing at apps/hub/Dockerfile"

REF="${IMAGE}:${TAG}"
REGISTRY="${IMAGE%%/*}"

log "Publish Hub"
echo "  root:     $ROOT"
echo "  engine:   $ENGINE"
echo "  platform: $PLATFORM"
echo "  image:    $REF"
echo

if [[ "$SKIP_LOGIN" -eq 0 ]]; then
  log "Ensuring login to $REGISTRY…"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "dry-run: $ENGINE login $REGISTRY"
  else
    # Reuses stored credentials when already logged in.
    "$ENGINE" login "$REGISTRY"
  fi
fi

log "Building $REF…"
BUILD_ARGS=(
  build
  --platform "$PLATFORM"
  -f apps/hub/Dockerfile
  -t "$REF"
  .
)
# Podman → Docker-compatible manifest for Coolify/Docker hosts.
if [[ "$ENGINE" == "podman" ]]; then
  BUILD_ARGS=(build --format docker --platform "$PLATFORM" -f apps/hub/Dockerfile -t "$REF" .)
fi
run "$ENGINE" "${BUILD_ARGS[@]}"

log "Pushing $REF…"
run "$ENGINE" push "$REF"

# Also push :latest when tagging a dated/version tag.
if [[ "$TAG" != "latest" ]]; then
  LATEST_REF="${IMAGE}:latest"
  log "Tagging and pushing $LATEST_REF…"
  run "$ENGINE" tag "$REF" "$LATEST_REF"
  run "$ENGINE" push "$LATEST_REF"
fi

log "Done. Coolify image should be: $REF"
echo "  Redeploy the Hub compose service, then re-prime caches that need sort=ranked_desc."
