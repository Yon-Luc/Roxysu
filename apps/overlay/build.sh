#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

scanner=$(command -v wayland-scanner || true)
if [[ -z "$scanner" ]]; then
  echo "error: wayland-scanner not found (run inside 'nix develop')" >&2
  exit 1
fi

xml="${WLR_PROTOCOLS_XML:-}"
if [[ -z "$xml" || ! -f "$xml" ]]; then
  pkgdir=$(pkg-config --variable=pkgdatadir wlr-protocols 2>/dev/null || true)
  for candidate in \
    "$pkgdir/unstable/wlr-foreign-toplevel-management-unstable-v1.xml" \
    /usr/share/wlr-protocols/unstable/wlr-foreign-toplevel-management-unstable-v1.xml; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then xml=$candidate; break; fi
  done
fi
if [[ -z "$xml" || ! -f "$xml" ]]; then
  echo "error: wlr-foreign-toplevel-unstable-v1.xml not found (install wlr-protocols)" >&2
  exit 1
fi

mkdir -p gen
"$scanner" client-header "$xml" gen/foreign_toplevel.h
"$scanner" private-code "$xml" gen/foreign_toplevel.c

cc -O2 -Wall -Wextra -Igen -o roxysu-overlay main.c gen/foreign_toplevel.c \
  $(pkg-config --cflags --libs gtk4 webkitgtk-6.0 gtk4-layer-shell-0 wayland-client)

echo "built ./roxysu-overlay"
