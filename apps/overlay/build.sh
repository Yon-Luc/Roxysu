#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cc -O2 -Wall -Wextra -o roxysu-overlay main.c \
  $(pkg-config --cflags --libs gtk4 webkitgtk-6.0 gtk4-layer-shell-0 wayland-client)

echo "built ./roxysu-overlay"
