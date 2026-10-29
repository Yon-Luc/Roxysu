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
# Rust in-game overlay host (apps/overlay-rs). Phase 8 default for desktop
# packaging (provides `bin/roxysu-overlay` symlink for resources/overlay/).
# C rollback: nix build .#roxysu-overlay-c
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

  # Desktop packages expect resources/overlay/roxysu-overlay.
  postInstall = ''
    ln -s roxysu-overlay-rs "$out/bin/roxysu-overlay"
  '';

  meta = {
    description = "Roxysu in-game overlay host (Rust; Wayland layer-shell + WebKitGTK)";
    license = lib.licenses.mit;
    platforms = ["x86_64-linux"];
    mainProgram = "roxysu-overlay";
  };
}
