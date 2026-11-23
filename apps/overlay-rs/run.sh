#!/usr/bin/env bash
# Build and run the Rust overlay host. Extra args go to roxysu-overlay-rs.
set -euo pipefail
cd "$(dirname "$0")"
cargo build
args=()
if [[ -n "${ROXYSU_OVERLAY_OUTPUT:-}" ]]; then
  args+=(--output="$ROXYSU_OVERLAY_OUTPUT")
fi
exec ./target/debug/roxysu-overlay-rs "${args[@]}" "$@"
