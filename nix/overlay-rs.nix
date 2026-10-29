{
  lib,
  rustPlatform,
  pkg-config,
  openssl,
  wayland,
  gtk4,
  webkitgtk_6_0,
  gtk4-layer-shell,
  fontconfig,
  libclang,
  version,
}:
# Rust in-game overlay host (apps/overlay-rs). Parallel to nix/overlay.nix (C).
# Not bundled into the desktop package yet — Phase 8 cutover. Build with:
#   nix build .#roxysu-overlay-rs
# Point the desktop toggle at it for A/B:
#   ROXYSU_OVERLAY_BIN=$(nix build --print-out-paths .#roxysu-overlay-rs)/bin/roxysu-overlay-rs
rustPlatform.buildRustPackage {
  pname = "roxysu-overlay-rs";
  inherit version;

  src = ../apps/overlay-rs;

  cargoLock.lockFile = ../apps/overlay-rs/Cargo.lock;

  nativeBuildInputs = [
    pkg-config
    rustPlatform.bindgenHook
  ];

  buildInputs = [
    openssl
    wayland
    gtk4
    webkitgtk_6_0
    gtk4-layer-shell
    fontconfig
  ];

  # gtk-rs / webkit6-sys bindgen
  LIBCLANG_PATH = "${libclang.lib}/lib";

  meta = {
    description = "Roxysu in-game overlay host (Rust; Wayland layer-shell + WebKitGTK)";
    license = lib.licenses.mit;
    platforms = ["x86_64-linux"];
    mainProgram = "roxysu-overlay-rs";
  };
}
