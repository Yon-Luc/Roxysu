#!/usr/bin/env bash
# Launch Roxysu Play under NixOS-friendly env.
# Prefer an active `nix develop` / direnv shell (LD_LIBRARY_PATH + XKB_CONFIG_ROOT).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${XKB_CONFIG_ROOT:-}" && -d /etc/X11/xkb ]]; then
  export XKB_CONFIG_ROOT=/etc/X11/xkb
fi

exec bun --hot src/app.tsx
