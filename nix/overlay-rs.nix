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
# Rust in-game overlay host (apps/overlay-rs). Desktop packaging expects
# `bin/roxysu-overlay` (symlink to `roxysu-overlay-rs`).
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
  # The .desktop grant is what lets KWin advertise org_kde_plasma_window_management
  # to this binary. Dev and unpacked layouts also rewrite the same file at runtime
  # with the canonical /proc/self/exe, because store paths and Electron copies differ.
  postInstall = ''
    ln -s roxysu-overlay-rs "$out/bin/roxysu-overlay"
    mkdir -p "$out/share/applications"
    cat > "$out/share/applications/dev.roxysu.overlay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Roxysu overlay
Comment=In-game HUD host for Roxysu
Exec=$out/bin/roxysu-overlay-rs
NoDisplay=true
StartupNotify=false
X-KDE-Wayland-Interfaces=org_kde_plasma_window_management
EOF
  '';

  meta = {
    description = "Roxysu in-game overlay host (Rust; Wayland layer-shell + WebKitGTK)";
    license = lib.licenses.mit;
    platforms = ["x86_64-linux"];
    mainProgram = "roxysu-overlay";
  };
}
