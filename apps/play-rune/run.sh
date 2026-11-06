#!/usr/bin/env bash
# Build and run the Roxysu Play Rune prototype. Extra args go to roxysu-play-rune
# (e.g. --snap out.png for headless smoke when supported).
set -euo pipefail
cd "$(dirname "$0")"
cargo build
exec ./target/debug/roxysu-play-rune "$@"
