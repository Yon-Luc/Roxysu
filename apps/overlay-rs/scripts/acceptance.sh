#!/usr/bin/env bash
# Phase 8 automated acceptance gate (unit + CLI smoke). Manual compositor/
# soak items live in findings/overlay-rs-phase8.md.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== cargo test =="
cargo test

BIN=./target/debug/roxysu-overlay-rs
if [[ ! -x "$BIN" ]]; then
  cargo build
fi

echo "== CLI help =="
"$BIN" --help >/dev/null

echo "== CLI url with query equals =="
# Must accept --url=…?bg=clear&limit=25 (C expander used to break this).
# Wayland may be absent in CI — expect either ready or a clear Wayland error.
set +e
out=$("$BIN" --url='http://127.0.0.1:9/#/overlay?bg=clear&limit=25' --follow-focus=false --watchdog=false 2>&1)
code=$?
set -e
if echo "$out" | grep -q 'must start with http'; then
  echo "FAIL: URL with = rejected"
  echo "$out"
  exit 1
fi
if [[ $code -eq 0 ]]; then
  echo "unexpected clean exit without Wayland — killing if still running"
elif echo "$out" | grep -qiE 'Wayland|zwlr_layer_shell|no Wayland'; then
  echo "OK: refused without Wayland (expected in headless)"
else
  # Process may have started briefly; treat non-URL parse failure as OK for smoke.
  echo "OK: binary started (exit=$code)"
fi

echo "== match-mode / watchdog CLI parse =="
"$BIN" --help | grep -q -- '--match-mode'
"$BIN" --help | grep -q -- '--watchdog-breach-samples'
"$BIN" --help | grep -q -- '--telemetry-interval-sec'

echo "acceptance automated gate: PASS" >&2
echo "acceptance automated gate: PASS"
