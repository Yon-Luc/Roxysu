#!/usr/bin/env bash
# Release build for feel / FPS tests. Extra args go to roxysu-play-rune.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release
exec ./target/release/roxysu-play-rune "$@"
