#!/usr/bin/env bash
# Build and run the Rust overlay host. Extra args go to roxysu-overlay-rs.
set -euo pipefail
cd "$(dirname "$0")"
cargo build
# Transparent DMA-BUF buffers turn into uninitialized pixels after a long run.
# Set ROXYSU_OVERLAY_DMABUF=1 to keep the DMA-BUF renderer.
if [[ "${ROXYSU_OVERLAY_DMABUF:-}" != "1" ]]; then
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi
exec ./target/debug/roxysu-overlay-rs --output="${ROXYSU_OVERLAY_OUTPUT:-DP-4}" "$@"
