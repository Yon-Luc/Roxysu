#!/usr/bin/env bash
# Build and run the Rust overlay host. Extra args go to roxysu-overlay-rs.
set -euo pipefail
cd "$(dirname "$0")"
cargo build
exec ./target/debug/roxysu-overlay-rs --output="${ROXYSU_OVERLAY_OUTPUT:-DP-4}" "$@"
